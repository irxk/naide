import assert from 'node:assert/strict';
import test from 'node:test';
import { NaideVM } from '../src/native-engine.js';
import { lowerNativeFunction, verifyNativeIR } from '../src/native-ir.js';
import { inferNativeFunction } from '../src/native-type-inference.js';

function lower(source, name) {
  const engine = new NaideVM();
  const ast = engine.parse(source);
  const functions = new Map(ast.body
    .filter(node => node.type === 'Function')
    .map(node => [node.name, node]));
  const node = functions.get(name);
  return lowerNativeFunction(node, inferNativeFunction(node, { functions }));
}

test('typed native IR lowers arithmetic, loop control flow, and branch predicates', () => {
  const ir = lower([
    'fn sumEvens(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    if i % 2 == 0:',
    '      total += i',
    '  ret total',
  ].join('\n'), 'sumEvens');

  assert.ok(ir);
  assert.deepEqual(verifyNativeIR(ir), { valid: true, diagnostics: [] });
  assert.equal(ir.params.length, 1);
  assert.equal(ir.guards[0].kind, 'argument-type');
  assert.deepEqual(ir.body.map(statement => statement.op), ['local.init', 'range.for', 'return']);
  assert.equal(ir.body[1].body[0].op, 'if');
  assert.equal(ir.body[1].body[0].condition.type, 'boolean');
  assert.equal(ir.body[1].body[0].then[0].value.op, 'binary');
});

test('typed native IR lowers numeric conditional expressions for guarded helper inlining', () => {
  const ir = lower([
    'fn choose(int value) -> int:',
    '  ret value > 0 ? value + 1 : value - 1',
  ].join('\n'), 'choose');

  assert.ok(ir);
  assert.equal(ir.body[0].value.op, 'conditional');
  assert.equal(ir.body[0].value.condition.type, 'boolean');
  assert.equal(ir.body[0].value.consequent.type, 'number');
  assert.equal(ir.body[0].value.alternate.type, 'number');
  assert.deepEqual(verifyNativeIR(ir), { valid: true, diagnostics: [] });

  const malformed = structuredClone(ir);
  malformed.body[0].value.condition.type = 'number';
  assert.ok(verifyNativeIR(malformed).diagnostics.some(message =>
    message.includes('boolean type')));
});

test('typed native IR refuses dynamic and collection execution paths', () => {
  const dynamic = lower([
    'fn identity(value):',
    '  ret value',
  ].join('\n'), 'identity');
  const collection = lower([
    'fn sum(list values) -> int:',
    '  mut int total = 0',
    '  for value of values:',
    '    total += value',
    '  ret total',
  ].join('\n'), 'sum');

  assert.equal(dynamic, null);
  assert.equal(collection, null);
});

test('typed native IR requires a numeric return on every control-flow path', () => {
  const ir = lower([
    'fn maybe(int value) -> int:',
    '  if value > 0:',
    '    ret value',
  ].join('\n'), 'maybe');

  assert.equal(ir, null);
});

test('typed native IR verifier rejects malformed locals, operators, and branch types', () => {
  const malformed = {
    version: 1,
    kind: 'function',
    name: 'invalid',
    params: [{ index: 0, localId: 4, name: 'value', type: 'number' }],
    locals: [{ id: 4, name: 'value', type: 'number', mutable: true }],
    body: [{
      op: 'if',
      condition: { op: 'const', type: 'number', value: 1, source: { line: 1 } },
      then: [{
        op: 'return',
        value: {
          op: 'binary',
          type: 'number',
          operator: 'eval',
          left: { op: 'local.get', type: 'number', localId: 99 },
          right: { op: 'const', type: 'number', value: 1 },
        },
      }],
      otherwise: [],
    }],
    returnType: 'number',
    guards: [],
  };

  const result = verifyNativeIR(malformed);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(message => message.includes('boolean type')));
  assert.ok(result.diagnostics.some(message => message.includes('unknown local slot')));
  assert.ok(result.diagnostics.some(message => message.includes("operator 'eval'")));
});

test('typed native IR verifier rejects loop-local reads after the loop and malformed cycles', () => {
  const ir = lower([
    'fn sum(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    total += i',
    '  ret total',
  ].join('\n'), 'sum');
  assert.ok(ir);
  const invalidRead = structuredClone(ir);
  invalidRead.body[2].value = {
    op: 'local.get',
    type: 'number',
    localId: invalidRead.body[1].localId,
  };
  assert.ok(verifyNativeIR(invalidRead).diagnostics.some(message =>
    message.includes('uninitialized local')));

  const cyclic = {
    ...ir,
    body: [],
  };
  cyclic.body.push({
    op: 'if',
    condition: { op: 'const', type: 'boolean', value: true },
    then: cyclic.body,
    otherwise: [],
  });
  assert.ok(verifyNativeIR(cyclic).diagnostics.some(message =>
    message.includes('cycles or shared blocks')));
});
