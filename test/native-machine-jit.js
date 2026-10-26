import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeMachineCodeAvailable } from '../src/native-machine-bridge.js';
import { isNativeMachineFunction } from '../src/native-machine-compiler.js';
import { NaideVM } from '../src/native-engine.js';

function seededIntegers(seed, count, minimum, maximum) {
  let state = seed >>> 0;
  return Array.from({ length: count }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return minimum + (state % (maximum - minimum + 1));
  });
}

test('Windows x64 machine JIT matches the interpreter, meters steps, and enforces limits', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const source = [
    'fn add(int left, int right) -> int:',
    '  ret left + right',
    'fn sumTo(int end) -> int:',
    '  mut int total = 0',
    '  for i in 0..end:',
    '    total += i',
    '  ret total',
    'fn choose(int value) -> int:',
    '  if value > 4:',
    '    ret value * 3',
    '  else:',
    '    ret value + 7',
    '',
  ].join('\n');
  const machine = new NaideVM({ nativeMachineCode: true });
  const reference = new NaideVM();
  machine.execute(source);
  reference.execute(source);

  for (const [name, args, expected] of [
    ['add', [3, 8], 11],
    ['sumTo', [0], 0],
    ['sumTo', [1], 0],
    ['sumTo', [10], 45],
    ['choose', [5], 15],
    ['choose', [2], 9],
  ]) {
    const machineFunction = machine.global.get(name);
    const referenceFunction = reference.global.get(name);
    assert.ok(isNativeMachineFunction(machineFunction), `${name} should execute as machine code`);
    const machineStepsBefore = machine.steps;
    const referenceStepsBefore = reference.steps;
    assert.equal(machineFunction(...args), expected);
    assert.equal(referenceFunction(...args), expected);
    assert.equal(machine.steps - machineStepsBefore, reference.steps - referenceStepsBefore);
  }
  assert.throws(() => machine.global.get('sumTo')(Infinity), /range bounds must be finite/);

  const sumTo = machine.global.get('sumTo');
  const stepsBefore = machine.steps;
  const referenceStepsBefore = reference.steps;
  const expected = reference.global.get('sumTo')(20);
  assert.equal(sumTo(20), expected);
  assert.equal(machine.steps - stepsBefore, reference.steps - referenceStepsBefore);
});

test('machine JIT reports the same failing step and source line at the execution limit', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const source = [
    'fn sumTo(int end) -> int:',
    '  mut int total = 0',
    '  for i in 0..end:',
    '    total += i',
    '  ret total',
    '',
  ].join('\n');
  const engine = new NaideVM({ nativeMachineCode: true });
  engine.execute(source);
  const sumTo = engine.global.get('sumTo');
  const stepsBefore = engine.steps;
  const result = sumTo(10);
  const stepsSpent = engine.steps - stepsBefore;

  engine.maxSteps = engine.steps + stepsSpent - 1;
  assert.throws(() => sumTo(10), new RegExp(`step limit \\(${engine.maxSteps}\\) exceeded.*line 5`));
  assert.equal(engine.steps, engine.maxSteps + 1);
  assert.throws(() => sumTo(10), new RegExp(`step limit \\(${engine.maxSteps}\\) exceeded.*line 2`));
  assert.equal(engine.steps, engine.maxSteps + 2);
});

test('machine JIT falls back for dynamic arguments and preserves call-depth enforcement', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const engine = new NaideVM({ nativeMachineCode: true, maxCallDepth: 1 });
  engine.execute([
    'fn add(int left, int right) -> int:',
    '  ret left + right',
    'fn inner(int value) -> int:',
    '  ret value + 1',
    'fn outer(int value) -> int:',
    '  ret inner(value)',
    '',
  ].join('\n'));

  assert.equal(engine.global.get('add')('3', 4), '34');
  assert.ok(isNativeMachineFunction(engine.global.get('add')));
  assert.throws(
    () => engine.global.get('outer')(1),
    error => error instanceof RangeError && /call depth limit \(1\) exceeded/.test(error.message),
  );
});

test('machine JIT executes integer range remainder and falls back for fractional bounds', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const machine = new NaideVM({ nativeMachineCode: true, nativeMachineCodeDiagnostics: true });
  const reference = new NaideVM();
  const source = [
    'fn countDivisible(int n) -> int:',
    '  mut int count = 0',
    '  for i in 0..n:',
    '    if i % 3 == 0:',
    '      count += 1',
    '  ret count',
    '',
  ].join('\n');
  machine.execute(source);
  reference.execute(source);
  const countDivisible = machine.global.get('countDivisible');
  const referenceFunction = reference.global.get('countDivisible');
  assert.ok(isNativeMachineFunction(countDivisible));

  for (const bound of [0, 1, 2, 3, 10, 100]) {
    const machineStepsBefore = machine.steps;
    const referenceStepsBefore = reference.steps;
    assert.equal(countDivisible(bound), referenceFunction(bound));
    assert.equal(machine.steps - machineStepsBefore, reference.steps - referenceStepsBefore);
  }
  assert.equal(countDivisible(10.5), referenceFunction(10.5));
  assert.equal(machine.getNativeMachineCodeStats().guardFallbacks, 1);
});

test('machine JIT inlines immutable pure numeric calls with exact step and call-depth guards', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const source = [
    'fn increment(value):',
    '  ret value + 1',
    'fn benchmark(int n) -> int:',
    '  mut int result = 0',
    '  for i in 0..n:',
    '    result = increment(result)',
    '  ret result',
    '',
  ].join('\n');
  const machine = new NaideVM({ nativeMachineCode: true, nativeMachineCodeDiagnostics: true });
  const reference = new NaideVM();
  machine.execute(source);
  const referenceAst = reference.parse(source);
  reference.execute(referenceAst);
  const benchmark = machine.global.get('benchmark');
  const referenceBenchmark = reference.global.get('benchmark');
  assert.ok(isNativeMachineFunction(benchmark));

  for (const count of [0, 1, 10, 100]) {
    const machineStepsBefore = machine.steps;
    const referenceStepsBefore = reference.steps;
    assert.equal(benchmark(count), referenceBenchmark(count));
    assert.equal(machine.steps - machineStepsBefore, reference.steps - referenceStepsBefore);
  }
  assert.equal(machine.getNativeMachineCodeStats().inlinedCalls, 1);

  const machineBudget = machine.steps + 20;
  const referenceBudget = reference.steps + 20;
  machine.maxSteps = machineBudget;
  reference.maxSteps = referenceBudget;
  let machineError;
  let referenceError;
  try {
    benchmark(10);
  } catch (error) {
    machineError = error;
  }
  try {
    const referenceNode = referenceAst.body.find(node =>
      node.type === 'Function' && node.name === 'benchmark');
    reference.invokeFunction(referenceNode, reference.global, [10]);
  } catch (error) {
    referenceError = error;
  }
  assert.match(machineError.message, /step limit/);
  assert.equal(machineError.message, referenceError.message);
  assert.equal(machine.steps, reference.steps);

  const shallow = new NaideVM({ nativeMachineCode: true, maxCallDepth: 1 });
  shallow.execute(source);
  assert.throws(
    () => shallow.global.get('benchmark')(1),
    /call depth limit \(1\) exceeded/,
  );
});

test('machine JIT inlines pure conditional numeric helpers with exact branch semantics', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const source = [
    'fn adjust(int value) -> int:',
    '  if value % 2 == 0:',
    '    ret value + 1',
    '  ret value - 1',
    'fn adjustElse(int value) -> int:',
    '  if value < 0:',
    '    ret 0 - value',
    '  else:',
    '    ret value + 2',
    'fn benchmark(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    total = total + adjust(i)',
    '  ret total',
    'fn benchmarkElse(int n) -> int:',
    '  mut int total = 0',
    '  for i in 0..n:',
    '    total = total + adjustElse(i)',
    '  ret total',
    '',
  ].join('\n');
  const machine = new NaideVM({ nativeMachineCode: true, nativeMachineCodeDiagnostics: true });
  const reference = new NaideVM();
  machine.execute(source);
  reference.execute(source);
  const benchmark = machine.global.get('benchmark');
  const referenceBenchmark = reference.global.get('benchmark');
  const benchmarkElse = machine.global.get('benchmarkElse');
  const referenceBenchmarkElse = reference.global.get('benchmarkElse');
  assert.ok(isNativeMachineFunction(benchmark));
  assert.ok(isNativeMachineFunction(benchmarkElse));
  assert.ok(machine.getNativeMachineCodeStats().inlinedCalls >= 2);
  assert.ok(machine.getNativeMachineCodeStats().allocatedNativeValues > 0);
  assert.ok(machine.getNativeMachineCodeStats().peakLiveNativeValues > 0);

  for (const count of [-1, 0, 1, 2, 3, 10, 100, ...seededIntegers(71, 32, -5, 200)]) {
    const machineStepsBefore = machine.steps;
    const referenceStepsBefore = reference.steps;
    assert.equal(benchmark(count), referenceBenchmark(count));
    assert.equal(machine.steps - machineStepsBefore, reference.steps - referenceStepsBefore);
  }
  for (const count of [0, 1, 2, 10, ...seededIntegers(83, 16, -5, 100)]) {
    const machineStepsBefore = machine.steps;
    const referenceStepsBefore = reference.steps;
    assert.equal(benchmarkElse(count), referenceBenchmarkElse(count));
    assert.equal(machine.steps - machineStepsBefore, reference.steps - referenceStepsBefore);
  }

  const fractionalStepsBefore = machine.steps;
  const referenceFractionalStepsBefore = reference.steps;
  assert.equal(benchmark(10.5), referenceBenchmark(10.5));
  assert.equal(machine.steps - fractionalStepsBefore,
    reference.steps - referenceFractionalStepsBefore);
  assert.ok(machine.getNativeMachineCodeStats().guardFallbacks > 0);

  machine.maxSteps = machine.steps + 12;
  reference.maxSteps = reference.steps + 12;
  let machineError;
  let referenceError;
  try {
    benchmark(10);
  } catch (error) {
    machineError = error;
  }
  try {
    referenceBenchmark(10);
  } catch (error) {
    referenceError = error;
  }
  assert.match(machineError.message, /step limit/);
  assert.equal(machineError.message, referenceError.message);
  assert.equal(machine.steps, reference.steps);

  const shallow = new NaideVM({ nativeMachineCode: true, maxCallDepth: 1 });
  shallow.execute(source);
  assert.throws(
    () => shallow.global.get('benchmark')(1),
    /call depth limit \(1\) exceeded/,
  );
});

test('unsupported functions stay on the existing NaideVM tier', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const engine = new NaideVM({ nativeMachineCode: true });
  engine.execute([
    'fn identity(value):',
    '  ret value',
    '',
  ].join('\n'));

  const identity = engine.global.get('identity');
  assert.equal(isNativeMachineFunction(identity), false);
  assert.equal(identity('unchanged'), 'unchanged');
});

test('explicit machine tier availability is reported instead of silently falling back', () => {
  if (nativeMachineCodeAvailable) {
    assert.doesNotThrow(() => new NaideVM({ nativeMachineCode: true }));
    return;
  }
  assert.throws(
    () => new NaideVM({ nativeMachineCode: true }),
    /requires the Windows x64 bridge/,
  );
});

test('native machine code tiers up after the configured hot-call threshold', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const engine = new NaideVM({
    nativeMachineCode: true,
    nativeMachineCodeThreshold: 3,
    nativeMachineCodeDiagnostics: true,
  });
  engine.execute([
    'fn sumTo(int end) -> int:',
    '  mut int total = 0',
    '  for i in 0..end:',
    '    total += i',
    '  ret total',
    '',
  ].join('\n'));

  const sumTo = engine.global.get('sumTo');
  assert.equal(isNativeMachineFunction(sumTo), false);
  assert.equal(sumTo(10), 45);
  assert.equal(sumTo(10), 45);
  assert.equal(isNativeMachineFunction(sumTo), false);
  assert.equal(sumTo(10), 45);
  assert.equal(isNativeMachineFunction(sumTo), true);

  const stats = engine.getNativeMachineCodeStats();
  assert.equal(stats.enabled, true);
  assert.equal(stats.threshold, 3);
  assert.equal(stats.compilationAttempts, 1);
  assert.equal(stats.compiledFunctions, 1);
  assert.equal(stats.tieredFunctions, 1);
  assert.equal(stats.unsupportedFunctions, 0);
  assert.ok(stats.compilationTimeMs > 0);
  assert.ok(stats.generatedCodeBytes > 0);
  assert.equal(stats.nativeCalls, 1);
  assert.equal(stats.tieringWarmupCalls, 2);
  assert.equal(stats.guardFallbacks, 0);
  assert.equal(stats.stepBudgetFallbacks, 0);
});

test('tiered native JIT keeps low-benefit leaf functions on the existing fast tier', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const engine = new NaideVM({
    nativeMachineCode: true,
    nativeMachineCodeThreshold: 2,
    nativeMachineCodeDiagnostics: true,
  });
  engine.execute([
    'fn identity(value):',
    '  ret value',
    '',
  ].join('\n'));

  const identity = engine.global.get('identity');
  assert.equal(identity('first'), 'first');
  assert.equal(identity('second'), 'second');
  assert.equal(identity('third'), 'third');
  assert.equal(isNativeMachineFunction(identity), false);

  const stats = engine.getNativeMachineCodeStats();
  assert.equal(stats.compilationAttempts, 0);
  assert.equal(stats.compiledFunctions, 0);
  assert.equal(stats.unsupportedFunctions, 0);
  assert.equal(stats.tieringWarmupCalls, 0);
  assert.equal(stats.skippedLowBenefitFunctions, 1);
});

test('tiered native JIT records an unsupported hot candidate and keeps the fast fallback', {
  skip: nativeMachineCodeAvailable ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const engine = new NaideVM({
    nativeMachineCode: true,
    nativeMachineCodeThreshold: 2,
    nativeMachineCodeDiagnostics: true,
  });
  engine.execute([
    'fn branch(int end) -> int:',
    '  mut int count = 0',
    '  for i in 0..end:',
    '    if i ** 2 == 4:',
    '      count += 1',
    '  ret count',
    '',
  ].join('\n'));

  const branch = engine.global.get('branch');
  assert.equal(branch(2), 0);
  assert.equal(branch(3), 1);
  assert.equal(branch(4), 1);
  assert.equal(isNativeMachineFunction(branch), false);

  const stats = engine.getNativeMachineCodeStats();
  assert.equal(stats.compilationAttempts, 1);
  assert.equal(stats.compiledFunctions, 0);
  assert.equal(stats.unsupportedFunctions, 1);
  assert.equal(stats.skippedLowBenefitFunctions, 0);
});

test('native machine-code tier options validate thresholds and diagnostics', () => {
  assert.throws(
    () => new NaideVM({ nativeMachineCodeThreshold: 2 }),
    /requires nativeMachineCode to be enabled/,
  );
  assert.throws(
    () => new NaideVM({ nativeMachineCodeDiagnostics: 'enabled' }),
    /nativeMachineCodeDiagnostics must be a boolean/,
  );
});
