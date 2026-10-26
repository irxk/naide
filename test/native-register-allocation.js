import assert from 'node:assert/strict';
import test from 'node:test';
import { NaideVM } from '../src/native-engine.js';
import { isNativeMachineFunction } from '../src/native-machine-compiler.js';
import { nativeMachineCodeAvailable } from '../src/native-machine-bridge.js';

function seededIntegers(seed, count, minimum, maximum) {
  let state = seed >>> 0;
  return Array.from({ length: count }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return minimum + (state % (maximum - minimum + 1));
  });
}
import { lowerNativeFunction } from '../src/native-ir.js';
import { inferNativeFunction } from '../src/native-type-inference.js';
import { emitWindowsX64 } from '../src/native-x64.js';

function compile(source, options) {
  const ast = new NaideVM().parse(source);
  const node = ast.body.find(item => item.type === 'Function');
  const inference = inferNativeFunction(node);
  const ir = lowerNativeFunction(node, inference);
  return ir && emitWindowsX64(ir, options);
}

test('Windows x64 allocator assigns live values to disjoint volatile registers and spills pressure', () => {
  const source = [
    'fn pressure(int n) -> int:',
    '  mut int a = n + 1',
    '  mut int b = n + 2',
    '  mut int c = n + 3',
    '  mut int d = n + 4',
    '  mut int e = n + 5',
    '  for i in 0..n:',
    '    a = a + i',
    '    b = b + i * 2',
    '    c = c + i * 3',
    '    d = d + i * 4',
    '    e = e + i * 5',
    '  ret a + b + c + d + e',
  ].join('\n');
  const allocated = compile(source);
  const stackOnly = compile(source, { registerAllocation: false });

  assert.ok(allocated);
  assert.ok(stackOnly);
  assert.ok(allocated.registerAllocation.allocatedValues > 0);
  assert.ok(allocated.registerAllocation.spilledValues > 0);
  assert.ok(allocated.code.length < stackOnly.code.length);
  assert.ok(allocated.frameSize < stackOnly.frameSize);
  assert.equal(stackOnly.registerAllocation.allocatedValues, 0);

  const intervals = allocated.registerAllocation.intervals
    .filter(interval => interval.register !== null);
  for (let left = 0; left < intervals.length; left++) {
    for (let right = left + 1; right < intervals.length; right++) {
      if (intervals[left].register !== intervals[right].register) continue;
      assert.ok(
        intervals[left].end < intervals[right].start
          || intervals[right].end < intervals[left].start,
        `overlapping values share XMM${intervals[left].register}`,
      );
    }
  }
});

test('Windows x64 allocator keeps loop bounds and values live across branches distinct', () => {
  const source = [
    'fn branch(int n) -> int:',
    '  mut int total = n',
    '  for i in 0..n:',
    '    if i % 2 == 0:',
    '      total = total + i',
    '    else:',
    '      total = total - i',
    '  ret total',
  ].join('\n');
  const code = compile(source);

  assert.ok(code);
  assert.ok(code.registerAllocation.allocatedValues >= 2);
  assert.ok(code.frameSize >= 32);
});

test('allocated native registers preserve results and step charges under spill pressure', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const source = [
    'fn pressure(int n) -> int:',
    '  mut int a = n + 1',
    '  mut int b = n + 2',
    '  mut int c = n + 3',
    '  mut int d = n + 4',
    '  mut int e = n + 5',
    '  for i in 0..n:',
    '    if i % 2 == 0:',
    '      a = a + i',
    '    else:',
    '      a = a - i',
    '    b = b + i * 2',
    '    c = c + i * 3',
    '    d = d + i * 4',
    '    e = e + i * 5',
    '  ret a + b + c + d + e',
  ].join('\n');
  const machine = new NaideVM({
    nativeMachineCode: true,
    nativeMachineCodeDiagnostics: true,
  });
  const reference = new NaideVM();
  machine.execute(source);
  reference.execute(source);
  const nativeFunction = machine.global.get('pressure');
  const referenceFunction = reference.global.get('pressure');
  assert.ok(isNativeMachineFunction(nativeFunction));
  assert.ok(machine.getNativeMachineCodeStats().spilledNativeValues > 0);

  for (const bound of [-2, 0, 1, 2, 10, 100, ...seededIntegers(93, 32, -5, 120)]) {
    const machineStepsBefore = machine.steps;
    const referenceStepsBefore = reference.steps;
    assert.equal(nativeFunction(bound), referenceFunction(bound));
    assert.equal(machine.steps - machineStepsBefore, reference.steps - referenceStepsBefore);
  }
});
