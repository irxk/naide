import assert from 'node:assert/strict';
import test from 'node:test';
import { NaideVM } from '../src/native-engine.js';
import { inferNativeFunction } from '../src/native-type-inference.js';

function infer(source, name) {
  const engine = new NaideVM();
  const ast = engine.parse(source);
  const functions = new Map(ast.body
    .filter(node => node.type === 'Function')
    .map(node => [node.name, node]));
  return inferNativeFunction(functions.get(name), { functions });
}

test('native type inference proves the numeric loop subset and marks annotation guards', () => {
  const result = infer([
    'fn sum(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    total += i',
    '  ret total',
  ].join('\n'), 'sum');

  assert.equal(result.eligible, true);
  assert.deepEqual(result.parameters, [{
    name: 'n',
    types: ['number'],
    guardRequired: true,
    source: 'annotation',
  }]);
  assert.deepEqual(result.locals, [{
    name: 'total',
    types: ['number'],
    guardRequired: true,
    source: 'joined',
  }]);
  assert.deepEqual(result.returnType, ['number']);
  assert.equal(result.returnGuardRequired, true);
  assert.deepEqual(result.diagnostics, []);
});

test('native type inference keeps unannotated values dynamic', () => {
  const result = infer([
    'fn identity(value):',
    '  ret value',
  ].join('\n'), 'identity');

  assert.equal(result.eligible, false);
  assert.deepEqual(result.parameters[0].types, ['unknown']);
  assert.equal(result.parameters[0].guardRequired, false);
  assert.deepEqual(result.returnType, ['unknown']);
});

test('native type inference widens incompatible branch assignments', () => {
  const result = infer([
    'fn select(bool choose) -> any:',
    '  mut any value = 1',
    '  if choose:',
    '    value = 2',
    '  else:',
    '    value = "two"',
    '  ret value',
  ].join('\n'), 'select');

  assert.equal(result.eligible, false);
  assert.deepEqual(result.returnType, ['number', 'string']);
  assert.deepEqual(result.locals.find(local => local.name === 'value').types, ['number', 'string']);
});

test('native type inference rejects unsupported statements and dynamic local calls', () => {
  const result = infer([
    'fn work(int value) -> any:',
    '  value(1)',
    '  log value',
    '  ret value',
  ].join('\n'), 'work');

  assert.equal(result.eligible, false);
  assert.ok(result.diagnostics.some(message => message.includes('Call through local')));
  assert.ok(result.diagnostics.some(message => message.includes("Statement 'Log'")));
  assert.deepEqual(result.returnType, ['number']);
});

test('native type inference handles each branch independently and does not leak locals', () => {
  const result = infer([
    'fn choose(int flag) -> int:',
    '  mut int result = 0',
    '  if flag > 0:',
    '    int branchOnly = 1',
    '    result = branchOnly',
    '  else:',
    '    result = 2',
    '  ret result',
  ].join('\n'), 'choose');

  assert.equal(result.eligible, true);
  assert.equal(result.locals.some(local => local.name === 'branchOnly'), false);
  assert.deepEqual(result.locals.find(local => local.name === 'result').types, ['number']);
});
