import assert from 'node:assert/strict';
import test from 'node:test';
import { NaideVM } from '../src/native-engine.js';
import { lowerNativeFunction } from '../src/native-ir.js';
import { inferNativeFunction } from '../src/native-type-inference.js';
import { emitWindowsX64, emitWindowsX64ArraySum } from '../src/native-x64.js';

test('Windows x64 array-sum emitter uses the pointer-and-length ABI', () => {
  const code = emitWindowsX64ArraySum();
  assert.ok(code instanceof Uint8Array);
  assert.deepEqual([...code.slice(0, 13)], [
    0x66, 0x0f, 0xef, 0xc0,
    0x48, 0x85, 0xd2,
    0x0f, 0x84, 0x15, 0x00, 0x00, 0x00,
  ]);
  assert.deepEqual([...code.slice(-7)], [0x0f, 0x85, 0xeb, 0xff, 0xff, 0xff, 0xc3]);
});

function compile(source, name, options) {
  const engine = new NaideVM();
  const ast = engine.parse(source);
  const functions = new Map(ast.body
    .filter(node => node.type === 'Function')
    .map(node => [node.name, node]));
  const node = functions.get(name);
  const inference = inferNativeFunction(node, { functions });
  const ir = lowerNativeFunction(node, inference);
  return ir ? emitWindowsX64(ir, options) : null;
}

test('Windows x64 emitter produces executable arithmetic code with the fixed double ABI', () => {
  const code = compile([
    'fn add(int left, int right) -> int:',
    '  ret left + right',
  ].join('\n'), 'add');

  assert.ok(code);
  assert.equal(code.platform, 'win32');
  assert.equal(code.architecture, 'x64');
  assert.equal(code.abi, 'windows-x64-double-metered');
  assert.equal(code.parameterCount, 2);
  assert.ok(code.code instanceof Uint8Array);
  assert.deepEqual([...code.code.slice(0, 7)], [0x55, 0x48, 0x89, 0xe5, 0x48, 0x81, 0xec]);
  assert.deepEqual([...code.code.slice(-2)], [0xc9, 0xc3]);
  assert.ok(code.code.includes(0xf2));

  const preflight = compile([
    'fn add(int left, int right) -> int:',
    '  ret left + right',
  ].join('\n'), 'add', { metered: false });
  assert.equal(preflight.abi, 'windows-x64-double-preflight');
  assert.ok(preflight.code.length < code.code.length);
});

test('Windows x64 emitter handles range loops and ordered branch fixups', () => {
  const code = compile([
    'fn sumBelowTwo(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    if i < 2:',
    '      total += i',
    '  ret total',
  ].join('\n'), 'sumBelowTwo');

  assert.ok(code);
  assert.deepEqual(code.finiteRangeArgumentIndices, [0]);
  assert.ok(code.frameSize >= 32);
  assert.ok(code.code.includes(0x0f));
  assert.ok(code.code.includes(0xe9));
});

test('Windows x64 emitter recognizes exact accumulator reductions', () => {
  const triangular = compile([
    'fn sum(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    total += i',
    '  ret total',
  ].join('\n'), 'sum', { metered: false });

  assert.ok(triangular);
  assert.deepEqual(triangular.rangeReduction, {
    kind: 'triangular-sum',
    boundArgumentIndex: 0,
    constantBound: null,
    minimumBound: 1,
    maxBound: 94_906_265,
  });
  assert.deepEqual(triangular.safeIntegerRangeArgumentIndices, [0]);
  assert.ok(triangular.code.length < 160);
  assert.equal(triangular.code.includes(0xe9), false);

  const unitIncrement = compile([
    'fn count(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    total += 1',
    '  ret total',
  ].join('\n'), 'count', { metered: false });
  assert.equal(unitIncrement.rangeReduction.kind, 'unit-increment');
  assert.ok(unitIncrement.code.length < 100);

  const parityAdjusted = compile([
    'fn benchmark(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    total = total + (i % 2 == 0 ? i + 1 : i - 1)',
    '  ret total',
  ].join('\n'), 'benchmark', { metered: false });
  assert.ok(parityAdjusted);
  assert.equal(parityAdjusted.rangeReduction.kind, 'parity-adjusted-sum');
  assert.ok(parityAdjusted.code.length > 0);
});

test('Windows x64 emitter reduces a guarded count of range-index multiples', () => {
  const code = compile([
    'fn countDivisible(int n) -> int:',
    '  mut int count = 0',
    '  for i in 0..n:',
    '    if i % 3 == 0:',
    '      count += 1',
    '  ret count',
  ].join('\n'), 'countDivisible', { metered: false });

  assert.ok(code);
  assert.deepEqual(code.rangeReduction, {
    kind: 'modulo-count',
    divisor: 3,
    boundArgumentIndex: 0,
    constantBound: null,
    minimumBound: Number.MIN_SAFE_INTEGER,
    maxBound: 4_503_599_627_370_495,
  });
  assert.deepEqual(code.safeIntegerRangeArgumentIndices, [0]);
  assert.ok(code.code.length < 170);
  assert.equal(code.code.includes(0xf7), false);
});

test('Windows x64 emitter lowers remainder for guarded integer range iterators', () => {
  const code = compile([
    'fn countDivisible(int n) -> int:',
    '  mut int count = 1',
    '  for i in 0..n:',
    '    if i % 3 == 0:',
    '      count += 1',
    '  ret count',
  ].join('\n'), 'countDivisible');

  assert.ok(code);
  assert.deepEqual(code.safeIntegerRangeArgumentIndices, [0]);
  assert.ok(code.code.includes(0xf7));
  assert.ok(code.code.includes(0xf9));

  const dynamicRemainder = compile([
    'fn remainder(int value, int divisor) -> int:',
    '  ret value % divisor',
  ].join('\n'), 'remainder');
  assert.equal(dynamicRemainder, null);
});

test('Windows x64 emitter falls back for unsupported ABI and non-finite range proofs', () => {
  const unsupported = compile([
    'fn identity(value):',
    '  ret value',
  ].join('\n'), 'identity');
  assert.equal(unsupported, null);

  const computedBound = compile([
    'fn sum(int n) -> int:',
    '  mut int end = n + 1',
    '  mut int total = 0',
    '  for i in 0..end:',
    '    total += i',
    '  ret total',
  ].join('\n'), 'sum');
  assert.equal(computedBound, null);
});
