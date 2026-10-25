import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  compile,
  NativeEngine as ExportedNativeEngine,
  runNativeAsync as exportedRunNativeAsync,
  runNativeFileAsync,
} from '../src/index.js';
import { NativeEngine, runNative, runNativeAsync } from '../src/native-engine.js';
import { createStore } from '../src/runtime.js';
import { createNativeCacheMiddleware, createNativeSseHub } from '../src/native-server.js';
import { NATIVE_AST_SUPPORT, NATIVE_SERVER_SUPPORT } from '../src/native-support.js';
import { checkNativeSource } from '../src/native-check.js';

const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));
assert.equal(ExportedNativeEngine, NativeEngine);
assert.equal(exportedRunNativeAsync, runNativeAsync);

test('native capability inventory classifies every parser AST node', () => {
  const parserSource = readFileSync(fileURLToPath(new URL('../src/parser.js', import.meta.url)), 'utf8');
  const engineSource = readFileSync(fileURLToPath(new URL('../src/native-engine.js', import.meta.url)), 'utf8');
  const parserTypes = new Set(
    [...parserSource.matchAll(/new ASTNode\(['"]([^'"]+)['"]/g)].map(match => match[1]),
  );
  const inventoryTypes = new Set(Object.keys(NATIVE_AST_SUPPORT));
  const dispatchedTypes = new Set(
    [...engineSource.matchAll(/case ['"]([^'"]+)['"]/g)].map(match => match[1]),
  );

  assert.deepEqual([...parserTypes].filter(type => !inventoryTypes.has(type)), []);
  assert.deepEqual([...inventoryTypes].filter(type => !parserTypes.has(type)), []);
  assert.deepEqual(
    Object.entries(NATIVE_AST_SUPPORT)
      .filter(([type, status]) => status === 'supported' && type !== 'Program' && !dispatchedTypes.has(type))
      .map(([type]) => type),
    [],
  );
  assert.ok(Object.values(NATIVE_AST_SUPPORT).every(status =>
    ['supported', 'contextual', 'unsupported'].includes(status)));
});

test('native evaluator errors explain unsupported and out-of-context AST nodes', async () => {
  const engine = new NativeEngine();
  const contextualDetail = /requires an execution context that is not active here/;
  const missingHandlerDetail = /marked supported but has no handler in this execution context/;
  const missingContractDetail = /AST type is missing from the native capability contract/;

  assert.throws(
    () => engine.executeStatement({ type: 'CliApp' }, engine.global),
    /Native CLI applications require asynchronous execution/,
  );
  assert.throws(
    () => engine.evaluate({ type: 'DynamicImport' }, engine.global),
    /Native dynamic import requires asynchronous execution/,
  );
  assert.throws(
    () => runNative('import("node:path")\n'),
    error => error.message.includes('requires asynchronous execution')
      && error.message.includes("NAIDE line 1"),
  );
  assert.throws(
    () => engine.executeStatement({ type: 'AuthDecl' }, engine.global),
    contextualDetail,
  );
  assert.throws(
    () => engine.executeStatement({ type: 'Program' }, engine.global),
    missingHandlerDetail,
  );
  assert.throws(
    () => engine.executeStatement({ type: 'UnknownNode' }, engine.global),
    missingContractDetail,
  );
  await assert.rejects(engine.executeAsyncStatement({ type: 'GraphqlDecl' }, engine.global), contextualDetail);
  await assert.rejects(engine.evaluateAsync({ type: 'DynamicImport', args: [] }, engine.global), /expects one argument/);
});

test('native dynamic imports use async execution and existing module permissions', async () => {
  await assert.rejects(
    runNativeAsync('any path = await import("node:path")\n'),
    /Node.js builtin 'node:path' is not enabled/,
  );
  const { globals } = await runNativeAsync([
    'any path = await import("node:path")',
    'str filename = path.basename("/tmp/example.txt")',
    '',
  ].join('\n'), { nodeModules: ['node:path'] });
  assert.equal(globals.get('filename'), 'example.txt');

  await assert.rejects(
    runNativeAsync('any path = await import("node:path", {})\n', { nodeModules: ['node:path'] }),
    /dynamic import options are not supported/,
  );
});

test('native dynamic imports load relative NAIDE modules from the current module', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-dynamic-import-'));
  try {
    const entryPath = join(directory, 'main.naide');
    writeFileSync(join(directory, 'plugin.naide'), 'pub int answer = 42\n');
    writeFileSync(entryPath, [
      'any plugin = await import("./plugin.naide")',
      'int answer = plugin.answer',
      '',
    ].join('\n'));

    const { globals } = await runNativeFileAsync(entryPath);
    assert.equal(globals.get('answer'), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native type checker keeps class methods out of the module function namespace', () => {
  const source = [
    'fn render(str value) -> str:',
    '  ret value',
    'schema Widget:',
    '  value str',
    '  fn render(int value) -> int:',
    '    ret value',
    'fn renderLabel() -> str:',
    '  ret render("widget")',
    '',
  ].join('\n');

  assert.deepEqual(checkNativeSource(source).errors, []);
});

test('native type checker validates self fields and method calls', () => {
  const valid = [
    'schema Widget:',
    '  value str',
    '  fn set(str next):',
    '    self.value = next',
    '  fn read() -> str:',
    '    ret self.value',
    '',
  ].join('\n');
  const invalid = [
    'schema Widget:',
    '  value str',
    '  fn set(str next):',
    '    self.value = 42',
    '  fn update(int count):',
    '    self.set(count, count)',
    '',
  ].join('\n');

  assert.deepEqual(checkNativeSource(valid).errors, []);
  const errors = checkNativeSource(invalid).errors.map(error => error.message);
  assert.ok(errors.some(message => message === 'Type mismatch: cannot assign int to str'));
  assert.ok(errors.some(message => message === "Argument 'next' of 'set' expects str but got int"));
  assert.ok(errors.some(message => message.includes("Argument count mismatch for 'set': expected 1, got 2")));
});

function captureOutput() {
  const lines = [];
  return {
    lines,
    log: (...values) => lines.push(values.join(' ')),
    info: (...values) => lines.push(values.join(' ')),
    error: (...values) => lines.push(values.join(' ')),
    warn: (...values) => lines.push(values.join(' ')),
  };
}

test('native engine directly evaluates variables, interpolation, functions, and closures', () => {
  const output = captureOutput();
  const source = [
    'mut int base = 4',
    'fn add(int value = 3) -> int:',
    '  ret base + value',
    'str message = "result={add()}"',
    'log message',
    '',
  ].join('\n');
  const result = runNative(source, { output });

  assert.equal(result.globals.get('message'), 'result=7');
  assert.deepEqual(output.lines, ['result=7']);
  assert.equal(result.globals.get('add')(), 7);
  assert.ok(result.steps > 0);
});

test('native engine runs conditions, loops, break/continue, and match branches', () => {
  const output = captureOutput();
  const source = [
    'mut int total = 0',
    'for i in 0..8:',
    '  if i == 2:',
    '    continue',
    '  if i == 6:',
    '    break',
    '  total += i',
    'each item in [10, 20]:',
    '  total += item',
    'mut int count = 0',
    'while count < 2:',
    '  count += 1',
    'match count:',
    '  1: log "wrong"',
    '  2: log "matched"',
    '  _: log "fallback"',
    '',
  ].join('\n');
  const result = runNative(source, { output });

  assert.equal(result.globals.get('total'), 43);
  assert.equal(result.globals.get('count'), 2);
  assert.deepEqual(output.lines, ['matched']);
});

test('native engine supports mutable collections, property calls, and destructuring', () => {
  const source = [
    'list values = [2, 4]',
    'values.push(6)',
    'mut int total = 0',
    'each value in values:',
    '  total += value',
    'map settings = {host: "localhost", port: 3000}',
    'str host = settings.host',
    'auto [first, second] = values',
    '',
  ].join('\n');
  const { globals } = runNative(source);

  assert.equal(globals.get('total'), 12);
  assert.equal(globals.get('host'), 'localhost');
  assert.equal(globals.get('first'), 2);
  assert.equal(globals.get('second'), 4);
});

test('native engine runs do-while, object iteration, lambdas, and try/fail/ensure', () => {
  const output = captureOutput();
  const source = [
    'mut int passes = 0',
    'do:',
    '  passes += 1',
    'while passes < 2',
    'mut int sum = 0',
    'each key, value in {a: 2, b: 3}:',
    '  sum += value',
    'list doubled = map([1, 2, 3], (value) => value * 2)',
    'try:',
    '  throw new Error("expected")',
    'fail err:',
    '  log err.message',
    'ensure:',
    '  log "cleanup"',
    '',
  ].join('\n');
  const { globals } = runNative(source, { output });

  assert.equal(globals.get('passes'), 2);
  assert.equal(globals.get('sum'), 5);
  assert.deepEqual(globals.get('doubled'), [2, 4, 6]);
  assert.deepEqual(output.lines, ['expected (NAIDE line 10)', 'cleanup']);
});

test('native engine collection helpers consume iterables with stable ordering', () => {
  const source = [
    'list values = [1, 2, 2, 3]',
    'list doubled = map(values, (value) => value * 2)',
    'list uniqueValues = unique(values)',
    'list positions = enumerate("ab")',
    'list pairs = zip([1, 2, 3], ["a", "b"])',
    'int found = find(values, (value) => value > 1)',
    'bool hasThree = some(values, (value) => value == 3)',
    'bool allPositive = every(values, (value) => value > 0)',
    'list flattened = flatMap([[1, 2], [3]], (value) => value)',
    'int total = sum(values)',
    'int reduced = reduce([1, 2], (left, right) => left + right, 0)',
    '',
  ].join('\n');
  const { globals } = runNative(source);

  assert.deepEqual(globals.get('doubled'), [2, 4, 4, 6]);
  assert.deepEqual(globals.get('uniqueValues'), [1, 2, 3]);
  assert.deepEqual(globals.get('positions'), [[0, 'a'], [1, 'b']]);
  assert.deepEqual(globals.get('pairs'), [[1, 'a'], [2, 'b']]);
  assert.equal(globals.get('found'), 2);
  assert.equal(globals.get('hasThree'), true);
  assert.equal(globals.get('allPositive'), true);
  assert.deepEqual(globals.get('flattened'), [1, 2, 3]);
  assert.equal(globals.get('total'), 8);
  assert.equal(globals.get('reduced'), 3);
});

test('native synchronous collection helpers preserve streaming and grouping semantics', () => {
  let leftPulls = 0;
  let leftClosed = 0;
  const left = {
    [Symbol.iterator]() {
      return {
        next: () => ({ value: leftPulls++, done: false }),
        return: () => { leftClosed++; return { done: true }; },
      };
    },
  };
  const source = [
    'list pairs = zip(left, [10, 20])',
    'list chunks = chunk([1, 2, 3, 4, 5], 2)',
    'list [evens, odds] = partition([1, 2, 3, 4], (value, index) => value % 2 == 0)',
    'any grouped = groupBy([1, 2, 3, 4], (value) => value % 2)',
    'int totalCount = count([1, 2, 3])',
    'int evenCount = count([1, 2, 3, 4], (value, index) => value % 2 == 0)',
    '',
  ].join('\n');
  const { globals } = runNative(source, { globals: { left } });

  assert.deepEqual(globals.get('pairs'), [[0, 10], [1, 20]]);
  assert.deepEqual(globals.get('chunks'), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(globals.get('evens'), [2, 4]);
  assert.deepEqual(globals.get('odds'), [1, 3]);
  assert.deepEqual(globals.get('grouped').get(0), [2, 4]);
  assert.deepEqual(globals.get('grouped').get(1), [1, 3]);
  assert.equal(globals.get('totalCount'), 3);
  assert.equal(globals.get('evenCount'), 2);
  assert.equal(leftPulls, 3);
  assert.equal(leftClosed, 1);
  assert.throws(
    () => runNative('list values = chunk([1], 0)\n'),
    /chunk size must be a positive safe integer/,
  );
  assert.throws(
    () => runNative('int total = count([1], 1)\n'),
    /count expects a function callback/,
  );
});

test('native asynchronous collection helpers consume iterables and close zip inputs', async () => {
  let leftPulls = 0;
  let leftClosed = 0;
  const left = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: leftPulls++, done: false }),
        return: async () => { leftClosed++; return { done: true }; },
      };
    },
  };
  const source = [
    'list pairs = await zipAsync(left, [10, 20])',
    'list chunks = await chunkAsync([1, 2, 3, 4, 5], 2)',
    'list [evens, odds] = await partitionAsync([1, 2, 3, 4], (value, index) => value % 2 == 0)',
    'any grouped = await groupByAsync([1, 2, 3, 4], groupKey)',
    'int evenCount = await countAsync([1, 2, 3, 4], isEven)',
    'list unique = await uniqueAsync([1, 2, 1, 3, 2])',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, {
    globals: {
      left,
      groupKey: async value => value % 2,
      isEven: async value => value % 2 === 0,
    },
  });

  assert.deepEqual(globals.get('pairs'), [[0, 10], [1, 20]]);
  assert.deepEqual(globals.get('chunks'), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(globals.get('evens'), [2, 4]);
  assert.deepEqual(globals.get('odds'), [1, 3]);
  assert.deepEqual(globals.get('grouped').get(0), [2, 4]);
  assert.deepEqual(globals.get('grouped').get(1), [1, 3]);
  assert.equal(globals.get('evenCount'), 2);
  assert.deepEqual(globals.get('unique'), [1, 2, 3]);
  assert.equal(leftPulls, 3);
  assert.equal(leftClosed, 1);
  assert.throws(
    () => runNative('list values = chunk([1], 0)\n'),
    /chunk size must be a positive safe integer/,
  );
  await assert.rejects(
    runNativeAsync('list values = await chunkAsync([1], 0)\n'),
    /chunkAsync size must be a positive safe integer/,
  );
});

test('native iterable queries short-circuit and bounded take helpers close iterators', () => {
  let pulls = 0;
  let closes = 0;
  const values = {
    [Symbol.iterator]() {
      let value = 0;
      return {
        next: () => { pulls++; return { value: value++, done: false }; },
        return: () => { closes++; return { done: true }; },
      };
    },
  };
  const { globals } = runNative([
    'int found = find(values, (value) => value == 3)',
    'list firstThree = take(values, 3)',
    'list belowThree = takeWhile(values, (value) => value < 3)',
    'any firstValue = first(values)',
    '',
  ].join('\n'), { globals: { values } });

  assert.equal(globals.get('found'), 3);
  assert.deepEqual(globals.get('firstThree'), [0, 1, 2]);
  assert.deepEqual(globals.get('belowThree'), [0, 1, 2]);
  assert.equal(globals.get('firstValue'), 0);
  assert.equal(pulls, 12);
  assert.equal(closes, 4);
  assert.throws(
    () => runNative('list values = take([1], -1)\n'),
    /take count must be a non-negative safe integer/,
  );
});

test('native engine executes synchronous generators and delegates iterable values', () => {
  const source = [
    'fn.gen sequence():',
    '  yield 1',
    '  for value of [2, 3]:',
    '    yield value',
    '  yield* range(4, 6)',
    '  ret 9',
    'fn.gen finish():',
    '  ret 9',
    'model Feed:',
    '  int seed',
    '  fn.gen values():',
    '    yield self.seed',
    '    yield self.seed + 1',
    'any feed = new Feed(6)',
    'list values = Array.from(sequence())',
    'list modelValues = Array.from(feed.values())',
    'any iterator = sequence()',
    'any first = iterator.next()',
    'any second = iterator.next()',
    'any finished = finish().next()',
    '',
  ].join('\n');
  const { globals } = runNative(source);

  assert.deepEqual(globals.get('values'), [1, 2, 3, 4, 5]);
  assert.deepEqual(globals.get('modelValues'), [6, 7]);
  assert.deepEqual(globals.get('first'), { value: 1, done: false });
  assert.deepEqual(globals.get('second'), { value: 2, done: false });
  assert.deepEqual(globals.get('finished'), { value: 9, done: true });
});

test('native generator reports unsupported nested yield expressions clearly', () => {
  assert.throws(
    () => runNative('fn.gen nested():\n  int value = yield 1\n  yield value\nlist values = Array.from(nested())\n'),
    /nested yield expressions are not supported yet/,
  );
});

test('native async generators await, delegate, run cleanup, and feed async collection helpers', async () => {
  let cleaned = 0;
  const source = [
    'fn.async.gen source():',
    '  yield await load(1)',
    '  yield await load(2)',
    'fn.async.gen sequence():',
    '  try:',
    '    yield* source()',
    '  ensure:',
    '    cleaned()',
    'fn.async.gen empty():',
    '  ret 9',
    'any lambda = fn.async.gen() -> int:',
    '  yield 5',
    'model Feed:',
    '  int seed',
    '  fn.async.gen values():',
    '    yield await load(self.seed)',
    'any feed = new Feed(3)',
    'list values = await mapAsync(sequence(), 2, (value) => value * 2)',
    'list methodValues = await mapAsync(feed.values(), 1, (value) => value)',
    'list lambdaValues = await mapAsync(lambda(), 1, (value) => value)',
    'list filteredValues = await filterAsync(sequence(), 1, (value) => value > 11)',
    'int total = await reduceAsync(sequence(), (sum, value) => sum + value, 0)',
    'await forEachAsync(sequence(), 2, (value) => value)',
    'any completed = await empty().next()',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, {
    globals: {
      load: async value => value + 10,
      cleaned: () => { cleaned++; },
    },
  });

  assert.deepEqual(globals.get('values'), [22, 24]);
  assert.deepEqual(globals.get('methodValues'), [13]);
  assert.deepEqual(globals.get('lambdaValues'), [5]);
  assert.deepEqual(globals.get('filteredValues'), [12]);
  assert.equal(globals.get('total'), 23);
  assert.deepEqual(globals.get('completed'), { value: 9, done: true });
  assert.equal(cleaned, 4);
});

test('native async iterable queries short-circuit, bound take, and close iterators', async () => {
  let pulls = 0;
  let closes = 0;
  const values = {
    [Symbol.asyncIterator]() {
      let value = 0;
      return {
        next: async () => { pulls++; return { value: value++, done: false }; },
        return: async () => { closes++; return { done: true }; },
      };
    },
  };
  const { globals } = await runNativeAsync([
    'int found = await findAsync(values, (value) => value == 2)',
    'bool hasFive = await someAsync(values, (value) => value == 5)',
    'bool allBelowFour = await everyAsync(values, (value) => value < 4)',
    'list firstTwo = await takeAsync(values, 2)',
    'list belowThree = await takeWhileAsync(values, (value) => value < 3)',
    'any firstValue = await firstAsync(values)',
    'list empty = await takeAsync(values, 0)',
    '',
  ].join('\n'), { globals: { values } });

  assert.equal(globals.get('found'), 2);
  assert.equal(globals.get('hasFive'), true);
  assert.equal(globals.get('allBelowFour'), false);
  assert.deepEqual(globals.get('firstTwo'), [0, 1]);
  assert.deepEqual(globals.get('belowThree'), [0, 1, 2]);
  assert.equal(globals.get('firstValue'), 0);
  assert.deepEqual(globals.get('empty'), []);
  assert.equal(pulls, 21);
  assert.equal(closes, 6);
});

test('native async generator failures retain NAIDE source and function diagnostics', async () => {
  await assert.rejects(
    runNativeAsync([
      'fn.async.gen broken():',
      '  yield 1',
      '  throw new TypeError("generator failed")',
      'list values = await mapAsync(broken(), 1, (value) => value)',
      '',
    ].join('\n')),
    error => error instanceof TypeError
      && /generator failed \(NAIDE line 3\)/.test(error.message)
      && /NAIDE stack:/.test(error.message)
      && /broken/.test(error.message),
  );
});

test('native iterable operations respect step budgets and close iterators on early exit', async () => {
  let closed = 0;
  const iterable = {
    [Symbol.iterator]() {
      let value = 0;
      return {
        next: () => ({ value: value++, done: false }),
        return: () => { closed++; return { done: true }; },
      };
    },
  };
  assert.throws(
    () => runNative('list values = map(large, (value) => value)\n', {
      maxSteps: 8,
      globals: { large: Array.from({ length: 100 }, (_, index) => index) },
    }),
    /step limit/,
  );
  runNative('for value of values:\n  break\n', { globals: { values: iterable } });
  assert.equal(closed, 1);

  let asyncClosed = 0;
  const asyncIterable = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: 1, done: false }),
        return: async () => { asyncClosed++; return { done: true }; },
      };
    },
  };
  let invalidConcurrencyPulled = false;
  const invalidConcurrencyInput = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          invalidConcurrencyPulled = true;
          return { value: 1, done: false };
        },
      };
    },
  };
  await assert.rejects(
    runNativeAsync('list values = await mapAsync(input, 0, (value) => value)\n', {
      globals: { input: invalidConcurrencyInput },
    }),
    /concurrency must be a positive safe integer/,
  );
  assert.equal(invalidConcurrencyPulled, false);
  await assert.rejects(
    runNativeAsync('list values = await mapAsync(input, 1, (value) => value)\n', {
      maxSteps: 20,
      globals: { input: asyncIterable },
    }),
    /step limit/,
  );
  assert.equal(asyncClosed, 1);
});

test('native for-await loops consume async iterables in async functions and generators', async () => {
  const input = {
    [Symbol.asyncIterator]() {
      let index = 1;
      return {
        next: async () => index <= 3
          ? { value: index++, done: false }
          : { value: undefined, done: true },
      };
    },
  };
  const source = [
    'fn.async totalValues(any input):',
    '  mut int total = 0',
    '  for await value of input:',
    '    total += value',
    '  ret total',
    'fn.async.gen forwarded(any input):',
    '  for await value of input:',
    '    yield value',
    'int total = await totalValues(input)',
    'list values = await mapAsync(forwarded(input), 2, (value) => value * 10)',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, { globals: { input } });
  assert.equal(globals.get('total'), 6);
  assert.deepEqual(globals.get('values'), [10, 20, 30]);
  assert.throws(
    () => runNative('for await value of values:\n  log value\n'),
    /for await.*requires async execution/,
  );
  assert.throws(
    () => runNative('for await value in values:\n  log value\n'),
    /for await.*requires an 'of' iterable loop/,
  );
  assert.throws(
    () => runNative('for value of values:\n  log value\n', {
      globals: { values: { [Symbol.asyncIterator]: async function* () { yield 1; } } },
    }),
    /not synchronously iterable/,
  );

  let closed = 0;
  const stoppable = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: 1, done: false }),
        return: async () => { closed++; return { done: true }; },
      };
    },
  };
  await runNativeAsync('for await value of input:\n  break\n', {
    globals: { input: stoppable },
  });
  assert.equal(closed, 1);
});

test('native engine loops consistently over built-in iterable collections', () => {
  const source = [
    'mut int total = 0',
    'each key, value in new Map([["a", 2], ["b", 3]]):',
    '  total += value',
    'each key, value in new Set([4, 5]):',
    '  total += key + value',
    'for value of "xy":',
    '  total += 1',
    '',
  ].join('\n');
  const { globals } = runNative(source);

  assert.equal(globals.get('total'), 17);
});

test('native async collection helpers bound concurrency, preserve order, and reduce sequentially', async () => {
  let active = 0;
  let peakActive = 0;
  const source = [
    'fn.async double(int value):',
    '  track(true)',
    '  await task.sleep(2)',
    '  track(false)',
    '  ret value * 2',
    'fn.async keepOdd(int value):',
    '  await task.sleep(1)',
    '  ret value % 2 == 1',
    'fn.async add(int total, int value):',
    '  ret total + value',
    'list doubled = await mapAsync([1, 2, 3, 4], 2, double)',
    'list odds = await filterAsync([1, 2, 3, 4], 2, keepOdd)',
    'int total = await reduceAsync([1, 2, 3], add, 10)',
    'await forEachAsync([], 1, double)',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, {
    globals: {
      track: started => {
        active += started ? 1 : -1;
        peakActive = Math.max(peakActive, active);
      },
    },
  });

  assert.deepEqual(globals.get('doubled'), [2, 4, 6, 8]);
  assert.deepEqual(globals.get('odds'), [1, 3]);
  assert.equal(globals.get('total'), 16);
  assert.equal(peakActive, 2);
  assert.equal(active, 0);
});

test('native async collection helpers reject invalid concurrency and callbacks', async () => {
  await assert.rejects(
    runNativeAsync('list values = await mapAsync([1], 0, (value) => value)\n'),
    /concurrency must be a positive safe integer/,
  );
  await assert.rejects(
    runNativeAsync('list values = await mapAsync([1], 1, 42)\n'),
    /callback must be a function/,
  );
  assert.throws(() => runNative('list values = map(42, (value) => value)\n'), /not synchronously iterable/);
});

test('native engine preserves the existing JavaScript runner behavior for core code', () => {
  const source = [
    'mut int total = 0',
    'fn add(int left, int right):',
    '  ret left + right',
    'for index in 1..5:',
    '  total += add(index, 1)',
    'if total == 18:',
    '  log "same"',
    'else:',
    '  log "different"',
    '',
  ].join('\n');
  const nativeOutput = captureOutput();
  const compiledOutput = captureOutput();
  const generated = compile(source).js;
  runNative(source, { output: nativeOutput });
  runInNewContext(generated, { console: compiledOutput });

  assert.deepEqual(nativeOutput.lines, compiledOutput.lines);
});

test('native async engine supports async functions, await, and concurrent await_all', async () => {
  let active = 0;
  let peakActive = 0;
  const delay = value => new Promise(resolveDelay => {
    active++;
    peakActive = Math.max(peakActive, active);
    setTimeout(() => {
      active--;
      resolveDelay(value * 10);
    }, value === 1 ? 20 : 5);
  });
  const source = [
    'fn.async work(int value) -> int:',
    '  ret await delay(value)',
    'list pending = [work(1), work(2)]',
    'list results = await.all pending',
    'int first = await work(3)',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, { globals: { delay }, output: captureOutput() });

  assert.deepEqual(globals.get('results'), [10, 20]);
  assert.equal(globals.get('first'), 30);
  assert.equal(peakActive, 2);
});

test('native engine exposes project-scoped asynchronous file I/O', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-io-'));
  try {
    const entryPath = join(directory, 'main.naide');
    const outsidePath = join(resolve(directory, '..'), `${basename(directory)}-outside.txt`);
    const source = [
      'await io.writeText("first.txt", "hello")',
      'await io.appendText("first.txt", " NAIDE")',
      'await.all [io.writeText("second.txt", "second"), io.writeText("third.txt", "third")]',
      'str text = await io.readText("first.txt")',
      'bool found = await io.exists("second.txt")',
      'bool missing = await io.exists("missing.txt")',
      'list names = await io.listDir(".")',
      '',
    ].join('\n');
    writeFileSync(entryPath, source);
    const { globals } = await runNativeFileAsync(entryPath, { output: captureOutput() });

    assert.equal(globals.get('text'), 'hello NAIDE');
    assert.equal(globals.get('found'), true);
    assert.equal(globals.get('missing'), false);
    assert.deepEqual(globals.get('names').sort(), ['first.txt', 'main.naide', 'second.txt', 'third.txt']);
    await assert.rejects(
      runNativeAsync(`await io.writeText("../${basename(outsidePath)}", "blocked")\n`, {
        sourceFile: entryPath,
        output: captureOutput(),
      }),
      /escapes the project directory/,
    );
    assert.equal(existsSync(outsidePath), false);

    const injectedIO = {
      readText: async path => `from ${path}`,
      writeText: async () => {},
      appendText: async () => {},
      exists: async () => false,
      listDir: async () => [],
    };
    const injected = await runNativeAsync('str content = await io.readText("virtual.txt")\n', {
      io: injectedIO,
      output: captureOutput(),
    });
    assert.equal(injected.globals.get('content'), 'from virtual.txt');
    assert.throws(() => new NativeEngine({ io: {} }), /must provide readText, writeText/);
    assert.throws(() => new NativeEngine({ globals: { io: injectedIO } }), /through the 'io' option/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native engine provides asynchronous HTTP helpers and supports host transport injection', async () => {
  const requests = [];
  let activeRequests = 0;
  let peakRequests = 0;
  const http = {
    async request(url, options = {}) {
      requests.push({ url: String(url), options });
      activeRequests++;
      peakRequests = Math.max(peakRequests, activeRequests);
      await new Promise(resolveRequest => setTimeout(resolveRequest, 5));
      activeRequests--;
      return {
        status: 200,
        ok: true,
        async json() { return { message: 'hello', method: options.method || 'GET' }; },
      };
    },
    get(url, options) { return this.request(url, { ...options, method: 'GET' }); },
    post(url, body, options) { return this.request(url, { ...options, method: 'POST', body }); },
  };
  const source = [
    'map response = await http.get("https://api.example.test/items")',
    'map data = await response.json()',
    'map created = await http.post("https://api.example.test/items", "payload", {headers: {contentType: "text/plain"}})',
    'list concurrent = await.all [http.get("https://api.example.test/a"), http.get("https://api.example.test/b")]',
    'int status = response.status',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, { http, output: captureOutput() });

  assert.equal(globals.get('status'), 200);
  assert.equal(globals.get('data').message, 'hello');
  assert.equal(globals.get('data').method, 'GET');
  assert.equal(requests[0].url, 'https://api.example.test/items');
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[1].options.body, 'payload');
  assert.equal(globals.get('created').status, 200);
  assert.equal(globals.get('concurrent').length, 2);
  assert.equal(peakRequests, 2);
  await assert.rejects(
    runNativeAsync('await http.get("file:///secret")\n', { output: captureOutput() }),
    /does not support the 'file:' protocol/,
  );
  assert.throws(() => new NativeEngine({ http: {} }), /must provide request, get, post/);
  assert.throws(() => new NativeEngine({ globals: { http } }), /through the 'http' option/);
});

test('native async engine provides task spawn, aggregation, race, and sleep primitives', async () => {
  let active = 0;
  let peakActive = 0;
  const work = async value => {
    active++;
    peakActive = Math.max(peakActive, active);
    await new Promise(resolveWork => setTimeout(resolveWork, value === 1 || value === 3 ? 15 : 5));
    active--;
    return value * 10;
  };
  const source = [
    'fn.async compute(int value):',
    '  ret await work(value)',
    'list results = await task.all([task.spawn(compute, 1), task.spawn(compute, 2)])',
    'int winner = await task.race([task.spawn(compute, 3), task.spawn(compute, 4)])',
    'await task.sleep(0)',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, { globals: { work }, output: captureOutput() });

  assert.deepEqual(globals.get('results'), [10, 20]);
  assert.equal(globals.get('winner'), 40);
  assert.equal(peakActive, 2);
  await assert.rejects(
    runNativeAsync('await task.all([task.spawn(failWork)])\n', {
      globals: { failWork: () => Promise.reject(new Error('task failed')) },
      output: captureOutput(),
    }),
    /task failed/,
  );
  await assert.rejects(
    runNativeAsync('await task.race(42)\n', { output: captureOutput() }),
    /expect a list of tasks/,
  );
  await assert.rejects(
    runNativeAsync('await task.sleep(-1)\n', { output: captureOutput() }),
    /finite non-negative number/,
  );
  assert.throws(() => new NativeEngine({ globals: { task: {} } }), /cannot be replaced/);
});

test('native task map bounds concurrency and preserves result order', async () => {
  let active = 0;
  let peakActive = 0;
  const source = [
    'fn.async double(int value):',
    '  ret await transform(value)',
    'list results = await task.map([1, 2, 3, 4, 5], 2, double)',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, {
    globals: {
      async transform(value) {
        active++;
        peakActive = Math.max(peakActive, active);
        await new Promise(resolveTransform => setTimeout(resolveTransform, value === 1 ? 15 : 3));
        active--;
        return value * 2;
      },
    },
    output: captureOutput(),
  });

  assert.deepEqual(globals.get('results'), [2, 4, 6, 8, 10]);
  assert.equal(peakActive, 2);
  await assert.rejects(
    runNativeAsync('await task.map([1], 0, double)\n', {
      globals: { double: value => value },
      output: captureOutput(),
    }),
    /concurrency must be a positive safe integer/,
  );
  const started = [];
  await assert.rejects(
    runNativeAsync('await task.map([1, 2, 3], 1, mapWork)\n', {
      globals: {
        async mapWork(value) {
          started.push(value);
          if (value === 2) throw new Error('map failed');
          return value;
        },
      },
      output: captureOutput(),
    }),
    /map failed/,
  );
  assert.deepEqual(started, [1, 2]);
});

test('native task cancellation and timeout propagate AbortSignal to cooperative work', async () => {
  const source = [
    'fn.async slow(any signal):',
    '  await task.sleep(1000, signal)',
    '  ret "finished"',
    'str result = await task.withTimeout(slow, 5)',
    '',
  ].join('\n');
  await assert.rejects(
    runNativeAsync(source, { output: captureOutput() }),
    error => error.name === 'TimeoutError' && /timed out after 5 ms/.test(error.message),
  );

  const cancelled = await runNativeAsync([
    'map cancellation = task.controller()',
    'mut bool observed = false',
    'fn.async waitForCancellation(any signal):',
    '  try:',
    '    await task.sleep(1000, signal)',
    '  fail error:',
    '    observed = task.isCancelled(signal)',
    '    task.throwIfCancelled(signal)',
    'list pending = [task.spawn(waitForCancellation, cancellation.signal)]',
    'await task.sleep(0)',
    'await cancellation.cancel("stop requested")',
    'try:',
    '  await task.all(pending)',
    'fail error:',
    '  observed = observed and error == "stop requested"',
    '',
  ].join('\n'), { output: captureOutput() });
  assert.equal(cancelled.globals.get('observed'), true);
  assert.equal(cancelled.globals.get('cancellation').signal.aborted, true);

  await assert.rejects(
    runNativeAsync('await task.withTimeout(42, 1)\n', { output: captureOutput() }),
    /expects a function/,
  );
  await assert.rejects(
    runNativeAsync('await task.withTimeout(noop, -1)\n', {
      globals: { noop: () => {} },
      output: captureOutput(),
    }),
    /finite non-negative number/,
  );

  let httpSignal;
  const http = {
    request(url, options = {}) {
      httpSignal = options.signal;
      return new Promise((resolveRequest, rejectRequest) => {
        options.signal.addEventListener('abort', () => rejectRequest(options.signal.reason), { once: true });
      });
    },
    get(url, options) { return this.request(url, { ...options, method: 'GET' }); },
    post(url, body, options) { return this.request(url, { ...options, method: 'POST', body }); },
  };
  await assert.rejects(
    runNativeAsync([
      'fn.async load(any signal):',
      '  ret await http.get("https://api.example.test/slow", {signal: signal})',
      'await task.withTimeout(load, 5)',
      '',
    ].join('\n'), { http, output: captureOutput() }),
    error => error.name === 'TimeoutError',
  );
  assert.equal(httpSignal.aborted, true);
});

test('native task channels rendezvous, buffer in FIFO order, and close cleanly', async () => {
  const source = [
    'map channel = task.channel()',
    'mut list received = []',
    'fn.async consume(any messages):',
    '  mut bool finished = false',
    '  while not finished:',
    '    map item = await messages.receive()',
    '    if item.done:',
    '      finished = true',
    '    else:',
    '      received.push(item.value)',
    'list consumer = [task.spawn(consume, channel)]',
    'await channel.send("one")',
    'await channel.send("two")',
    'bool firstClose = channel.close()',
    'bool secondClose = channel.close()',
    'await task.all(consumer)',
    'map end = await channel.receive()',
    'list buffered = task.channel(2)',
    'await buffered.send(10)',
    'await buffered.send(20)',
    'bool bufferedClose = buffered.close()',
    'map bufferedFirst = await buffered.receive()',
    'map bufferedSecond = await buffered.receive()',
    'map bufferedEnd = await buffered.receive()',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, { output: captureOutput() });

  assert.deepEqual(globals.get('received'), ['one', 'two']);
  assert.equal(globals.get('firstClose'), true);
  assert.equal(globals.get('secondClose'), false);
  assert.deepEqual(globals.get('end'), { value: undefined, done: true });
  assert.deepEqual(globals.get('bufferedFirst'), { value: 10, done: false });
  assert.deepEqual(globals.get('bufferedSecond'), { value: 20, done: false });
  assert.deepEqual(globals.get('bufferedEnd'), { value: undefined, done: true });
});

test('native task channels reject blocked sends on close and validate capacity', async () => {
  await assert.rejects(
    runNativeAsync([
      'map channel = task.channel()',
      'list sender = [task.spawn(channel.send, "pending")]',
      'await task.sleep(0)',
      'channel.close()',
      'await task.all(sender)',
      '',
    ].join('\n'), { output: captureOutput() }),
    /Cannot send to a closed task channel/,
  );
  await assert.rejects(
    runNativeAsync('map channel = task.channel(-1)\n', { output: captureOutput() }),
    /capacity must be a non-negative safe integer/,
  );
});

test('native task channels cancel blocked senders and receivers without losing later messages', async () => {
  const source = [
    'map receiveChannel = task.channel(1)',
    'map receiveCancel = task.controller()',
    'list receiveWaiter = [task.spawn(receiveChannel.receive, receiveCancel.signal)]',
    'await task.sleep(0)',
    'await receiveCancel.cancel("receive cancelled")',
    'mut bool receiveCancelled = false',
    'try:',
    '  await task.all(receiveWaiter)',
    'fail error:',
    '  receiveCancelled = error == "receive cancelled"',
    'await receiveChannel.send("kept")',
    'map afterReceiveCancel = await receiveChannel.receive()',
    'map sendChannel = task.channel(1)',
    'await sendChannel.send("first")',
    'map sendCancel = task.controller()',
    'list sendWaiter = [task.spawn(sendChannel.send, "discarded", sendCancel.signal)]',
    'await task.sleep(0)',
    'await sendCancel.cancel("send cancelled")',
    'mut bool sendCancelled = false',
    'try:',
    '  await task.all(sendWaiter)',
    'fail error:',
    '  sendCancelled = error == "send cancelled"',
    'map firstAfterCancel = await sendChannel.receive()',
    'await sendChannel.send("third")',
    'map thirdAfterCancel = await sendChannel.receive()',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source, { output: captureOutput() });

  assert.equal(globals.get('receiveCancelled'), true);
  assert.deepEqual(globals.get('afterReceiveCancel'), { value: 'kept', done: false });
  assert.equal(globals.get('sendCancelled'), true);
  assert.deepEqual(globals.get('firstAfterCancel'), { value: 'first', done: false });
  assert.deepEqual(globals.get('thirdAfterCancel'), { value: 'third', done: false });
  await assert.rejects(
    runNativeAsync([
      'map channel = task.channel(1)',
      'map cancelled = task.controller()',
      'await cancelled.cancel("already cancelled")',
      'await channel.receive(cancelled.signal)',
      '',
    ].join('\n'), {
      output: captureOutput(),
    }),
    /already cancelled/,
  );
});

test('native engine imports cached relative NAIDE modules and their public exports', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-modules-'));
  try {
    const entryPath = join(directory, 'main.naide');
    writeFileSync(join(directory, 'math.naide'), [
      'pub int base = 40',
      'int internal = 100',
      'pub fn add(int left, int right):',
      '  ret left + right + base',
      '',
    ].join('\n'));
    writeFileSync(entryPath, [
      'use { add as sum } from "./math"',
      'use helpers from "./math.naide"',
      'int answer = sum(1, 1)',
      'int namespaced = helpers.add(0, 2)',
      '',
    ].join('\n'));

    const { globals } = await runNativeFileAsync(entryPath);
    assert.equal(globals.get('answer'), 42);
    assert.equal(globals.get('namespaced'), 42);

    const counts = new Map();
    const cachedEngine = new NativeEngine({
      sourceFile: entryPath,
      moduleLoader(path) {
        counts.set(path, (counts.get(path) || 0) + 1);
        return readFileSync(path, 'utf8');
      },
      output: captureOutput(),
    });
    await cachedEngine.executeAsync([
      'use { base } from "./math"',
      'use helpers from "./math"',
      'int answer = base + helpers.base',
      '',
    ].join('\n'));
    assert.equal([...counts.values()].reduce((total, count) => total + count, 0), 1);

    const syncEngine = new NativeEngine({
      sourceFile: entryPath,
      moduleLoader: path => readFileSync(path, 'utf8'),
      output: captureOutput(),
    });
    syncEngine.execute([
      'use { base } from "./math"',
      'int answer = base + 2',
      '',
    ].join('\n'));
    assert.equal(syncEngine.global.get('answer'), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native engine rejects private exports and detects circular module imports', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-module-errors-'));
  try {
    const entryPath = join(directory, 'main.naide');
    writeFileSync(join(directory, 'private.naide'), 'int secret = 7\n');
    writeFileSync(join(directory, 'a.naide'), 'use { value } from "./b"\npub int value = 1\n');
    writeFileSync(join(directory, 'b.naide'), 'use { value } from "./a"\npub int value = 2\n');
    writeFileSync(entryPath, 'use { secret } from "./private"\n');
    await assert.rejects(runNativeFileAsync(entryPath), /does not export 'secret'/);

    writeFileSync(entryPath, 'use { value } from "./a"\n');
    await assert.rejects(runNativeFileAsync(entryPath), /Circular native module import detected/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native engine resolves installed NAIDE packages through their manifest entry points', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-packages-'));
  try {
    const entryPath = join(directory, 'main.naide');
    const packageDirectory = join(directory, 'node_modules', '@demo', 'numbers');
    const nestedPackageDirectory = join(packageDirectory, 'node_modules', 'shared-values');
    mkdirSync(join(packageDirectory, 'src'), { recursive: true });
    mkdirSync(nestedPackageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, 'naide.pkg.json'), JSON.stringify({
      name: '@demo/numbers',
      main: 'src/index.naide',
      exports: { './math': './src/index.naide' },
    }));
    writeFileSync(join(packageDirectory, 'src', 'index.naide'), [
      'use { offset } from "shared-values"',
      'pub fn add(int left, int right):',
      '  ret left + right + offset',
      '',
    ].join('\n'));
    writeFileSync(join(nestedPackageDirectory, 'naide.pkg.json'), JSON.stringify({
      name: 'shared-values',
      main: 'index.naide',
    }));
    writeFileSync(join(nestedPackageDirectory, 'index.naide'), 'pub int offset = 2\n');
    writeFileSync(entryPath, [
      'use { add as sum } from "@demo/numbers"',
      'use { add as subpathAdd } from "@demo/numbers/math"',
      'use numbers from "@demo/numbers"',
      'int answer = sum(20, 20)',
      'int subpathAnswer = subpathAdd(10, 30)',
      'int namespaced = numbers.add(1, 1)',
      '',
    ].join('\n'));

    const { globals } = await runNativeFileAsync(entryPath);
    assert.equal(globals.get('answer'), 42);
    assert.equal(globals.get('subpathAnswer'), 42);
    assert.equal(globals.get('namespaced'), 4);
    const syncEngine = new NativeEngine({ sourceFile: entryPath });
    assert.equal(syncEngine.execute(readFileSync(entryPath, 'utf8')).globals.get('answer'), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native engine and compiler loader prefer NAIDE packages in naide_modules', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-modules-directory-'));
  try {
    const entryPath = join(directory, 'main.naide');
    const naidePackage = join(directory, 'naide_modules', '@demo', 'numbers');
    const legacyPackage = join(directory, 'node_modules', '@demo', 'numbers');
    mkdirSync(naidePackage, { recursive: true });
    mkdirSync(legacyPackage, { recursive: true });
    writeFileSync(join(naidePackage, 'naide.pkg.json'), JSON.stringify({ main: 'index.naide' }));
    writeFileSync(join(naidePackage, 'index.naide'), 'pub fn answer() -> int:\n  ret 42\n');
    writeFileSync(join(legacyPackage, 'naide.pkg.json'), JSON.stringify({ main: 'index.naide' }));
    writeFileSync(join(legacyPackage, 'index.naide'), 'pub fn answer() -> int:\n  ret 7\n');
    writeFileSync(entryPath, 'use { answer } from "@demo/numbers"\nint result = answer()\n');

    const result = await runNativeFileAsync(entryPath);
    assert.equal(result.globals.get('result'), 42);

    const moduleEntry = join(directory, 'run.mjs');
    writeFileSync(moduleEntry, [
      'import { answer } from "@demo/numbers";',
      'console.log(answer());',
      '',
    ].join('\n'));
    const loaderPath = fileURLToPath(new URL('../src/register.js', import.meta.url));
    const child = spawnSync(process.execPath, ['--import', pathToFileURL(loaderPath).href, moduleEntry], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /42/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('naide pkg install mirrors NAIDE source packages into naide_modules', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-package-install-'));
  try {
    const fakeNpm = join(directory, 'fake-npm.mjs');
    writeFileSync(fakeNpm, [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { resolve } from "node:path";',
      'const root = process.cwd();',
      'const packageDirectory = resolve(root, "node_modules", "@demo", "numbers");',
      'mkdirSync(packageDirectory, { recursive: true });',
      'writeFileSync(resolve(root, "package.json"), JSON.stringify({ dependencies: { "@demo/numbers": "^1.2.3" } }));',
      'writeFileSync(resolve(packageDirectory, "package.json"), JSON.stringify({ name: "@demo/numbers", version: "1.2.3" }));',
      'writeFileSync(resolve(packageDirectory, "naide.pkg.json"), JSON.stringify({ main: "index.naide" }));',
      'writeFileSync(resolve(packageDirectory, "index.naide"), "pub int answer = 42\\n");',
      '',
    ].join('\n'));
    const result = spawnSync(process.execPath, [cliPath, 'pkg', 'install', '@demo/numbers'], {
      cwd: directory,
      env: { ...process.env, npm_execpath: fakeNpm },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const storedPackage = join(directory, 'naide_modules', '@demo', 'numbers');
    assert.equal(existsSync(join(storedPackage, 'index.naide')), true);
    assert.equal(JSON.parse(readFileSync(join(directory, 'naide.pkg.json'), 'utf8')).dependencies['@demo/numbers'], '^1.2.3');
    assert.match(readFileSync(join(directory, '.gitignore'), 'utf8'), /^naide_modules\/$/m);
    writeFileSync(join(directory, 'main.naide'), 'use { answer } from "@demo/numbers"\nint result = answer\n');
    assert.equal((await runNativeFileAsync(join(directory, 'main.naide'))).globals.get('result'), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native engine loads declared JavaScript packages and rejects unsafe NAIDE package entries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-package-errors-'));
  try {
    const entryPath = join(directory, 'main.naide');
    const packageDirectory = join(directory, 'node_modules', 'example-package');
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      type: 'module',
      dependencies: { 'example-package': '1.0.0' },
    }));

    writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'example-package', main: 'index.js' }));
    writeFileSync(join(packageDirectory, 'index.js'), 'export const answer = 42;\n');
    writeFileSync(entryPath, 'use { answer } from "example-package"\n');
    assert.equal((await runNativeFileAsync(entryPath)).globals.get('answer'), 42);

    writeFileSync(join(packageDirectory, 'naide.pkg.json'), JSON.stringify({
      name: 'example-package',
      main: '../outside.naide',
    }));
    writeFileSync(entryPath, 'use example from "example-package"\n');
    await assert.rejects(runNativeFileAsync(entryPath), /entry must resolve to a \.naide file inside the package/);

    writeFileSync(join(packageDirectory, 'naide.pkg.json'), '{');
    await assert.rejects(runNativeFileAsync(entryPath), /manifest .* is invalid JSON/);

    writeFileSync(join(packageDirectory, 'naide.pkg.json'), JSON.stringify({
      name: 'example-package',
      main: 'index.naide',
      exports: { './escape': '../outside.naide' },
    }));
    writeFileSync(entryPath, 'use example from "example-package/private"\n');
    await assert.rejects(runNativeFileAsync(entryPath), /does not export '\.\/private'/);
    writeFileSync(entryPath, 'use example from "example-package/escape"\n');
    await assert.rejects(runNativeFileAsync(entryPath), /export '\.\/escape' must map to a relative/);

    writeFileSync(join(packageDirectory, 'naide.pkg.json'), JSON.stringify({
      name: 'example-package',
      main: 'index.naide',
      exports: [],
    }));
    writeFileSync(entryPath, 'use example from "example-package"\n');
    await assert.rejects(runNativeFileAsync(entryPath), /exports must be an object/);

    writeFileSync(join(packageDirectory, 'naide.pkg.json'), JSON.stringify({
      name: 'example-package',
      main: 'index.naide',
      exports: {},
    }));
    writeFileSync(entryPath, 'use example from "example-package/../outside"\n');
    await assert.rejects(runNativeFileAsync(entryPath), /invalid NAIDE package import path/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native imports require explicit Node capabilities and declared npm dependencies', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-host-imports-'));
  try {
    const entryPath = join(directory, 'main.naide');
    writeFileSync(entryPath, [
      'use { randomUUID } from "node:crypto"',
      'str value = randomUUID()',
      '',
    ].join('\n'));
    await assert.rejects(
      runNativeFileAsync(entryPath),
      /not enabled.*--node-module node:crypto/,
    );
    const enabled = await runNativeFileAsync(entryPath, { nodeModules: ['node:crypto'] });
    assert.match(enabled.globals.get('value'), /^[0-9a-f-]{36}$/i);

    mkdirSync(join(directory, 'node_modules', 'tiny-esm'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      type: 'module',
      dependencies: { 'tiny-esm': '1.0.0' },
    }));
    writeFileSync(join(directory, 'node_modules', 'tiny-esm', 'package.json'), JSON.stringify({
      name: 'tiny-esm',
      type: 'module',
      exports: './index.js',
    }));
    writeFileSync(join(directory, 'node_modules', 'tiny-esm', 'index.js'), [
      'export const double = value => value * 2;',
      '',
    ].join('\n'));
    writeFileSync(entryPath, [
      'use { double } from "tiny-esm"',
      'int value = double(21)',
      '',
    ].join('\n'));
    const imported = await runNativeFileAsync(entryPath);
    assert.equal(imported.globals.get('value'), 42);

    writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module', dependencies: {} }));
    await assert.rejects(
      runNativeFileAsync(entryPath),
      /not declared in this project manifest/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native engine creates frozen enums and supports public enum exports', async () => {
  const { globals } = runNative([
    'enum Color:',
    '  RED',
    '  GREEN',
    '  BLUE',
    'enum Status: ACTIVE, INACTIVE',
    'int selected = Color.GREEN',
    'int inactive = Status.INACTIVE',
    '',
  ].join('\n'));
  assert.equal(globals.get('selected'), 1);
  assert.equal(globals.get('inactive'), 1);
  assert.equal(Object.isFrozen(globals.get('Color')), true);
  assert.equal(Object.hasOwn(globals.get('Color'), 'BLUE'), true);

  const directory = mkdtempSync(join(tmpdir(), 'naide-native-enum-'));
  try {
    const entryPath = join(directory, 'main.naide');
    writeFileSync(join(directory, 'colors.naide'), [
      'pub enum Color:',
      '  RED',
      '  GREEN',
      '',
    ].join('\n'));
    writeFileSync(entryPath, [
      'use { Color } from "./colors"',
      'int selected = Color.GREEN',
      '',
    ].join('\n'));
    const asyncResult = await runNativeFileAsync(entryPath);
    assert.equal(asyncResult.globals.get('selected'), 1);
    const syncResult = new NativeEngine({ sourceFile: entryPath })
      .execute(readFileSync(entryPath, 'utf8'));
    assert.equal(syncResult.globals.get('selected'), 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native engine constructs models with defaults, inherited fields, methods, and public exports', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-models-'));
  try {
    const entryPath = join(directory, 'main.naide');
    writeFileSync(join(directory, 'models.naide'), [
      'pub model Animal:',
      '  str name',
      '  int age = 0',
      '  fn describe() -> str:',
      '    ret "{self.name}:{self.age}"',
      'pub model Dog extends Animal:',
      '  str breed = "mixed"',
      '  fn describe() -> str:',
      '    ret super.describe() + "!"',
      '  fn.async label() -> str:',
      '    ret "{self.name} the {self.breed}"',
      '',
    ].join('\n'));
    writeFileSync(entryPath, [
      'use { Animal, Dog } from "./models"',
      'any dog = new Dog("Rex", 5, "Labrador")',
      'str description = dog.describe()',
      'str label = await dog.label()',
      'bool isAnimal = dog instanceof Animal',
      '',
    ].join('\n'));

    const asyncResult = await runNativeFileAsync(entryPath);
    assert.equal(asyncResult.globals.get('description'), 'Rex:5!');
    assert.equal(asyncResult.globals.get('label'), 'Rex the Labrador');
    assert.equal(asyncResult.globals.get('isAnimal'), true);

    const syncEngine = new NativeEngine({ sourceFile: entryPath });
    const syncResult = syncEngine.execute([
      'use { Dog } from "./models"',
      'any dog = new Dog("Milo")',
      'str description = dog.describe()',
      '',
    ].join('\n'));
    assert.equal(syncResult.globals.get('description'), 'Milo:0!');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native engine executes schema classes, regular expressions, and async swap statements', async () => {
  const source = [
    'schema Counter:',
    '  value int default(1)',
    '  init(int start = 1):',
    '    self.value = start',
    '  fn increment() -> int:',
    '    self.value += 1',
    '    ret self.value',
    '',
    'auto counter = new Counter(8)',
    'int current = counter.increment()',
    String.raw`bool matched = /foo\/bar/i.test("FOO/bar")`,
    'mut int left = 10',
    'mut int right = 20',
    'swap left, right',
    '',
  ].join('\n');
  const { globals } = await runNativeAsync(source);

  assert.equal(globals.get('current'), 9);
  assert.equal(globals.get('matched'), true);
  assert.equal(globals.get('left'), 20);
  assert.equal(globals.get('right'), 10);
  const synchronous = runNative([
    String.raw`bool matched = /item-\d+/i.test("ITEM-42")`,
    'mut int first = 1',
    'mut int second = 2',
    'swap first, second',
    '',
  ].join('\n'));
  assert.equal(synchronous.globals.get('matched'), true);
  assert.equal(synchronous.globals.get('first'), 2);
  assert.equal(synchronous.globals.get('second'), 1);
  const syncClass = runNative([
    'schema Counter:',
    '  value int default(1)',
    '  fn increment() -> int:',
    '    ret self.value + 1',
    'auto counter = new Counter(3)',
    'int nextValue = counter.increment()',
    '',
  ].join('\n'));
  assert.equal(syncClass.globals.get('nextValue'), 4);
  assert.deepEqual(checkNativeSource(source).errors, []);
  assert.throws(
    () => runNative(String.raw`bool invalid = /test/gg.test("test")`),
    /Invalid native regular-expression literal/,
  );
});

test('native engine runs custom model initializers with defaults and parameter binding', async () => {
  const source = [
    'model User:',
    '  str name',
    '  int age = 18',
    '  init(str displayName, int years = 20):',
    '    self.name = displayName',
    '    self.age = years',
    '  fn summary() -> str:',
    '    ret "{self.name}:{self.age}"',
    'any user = new User("Ada")',
    'any older = new User("Grace", 35)',
    'str first = user.summary()',
    'str second = older.summary()',
    '',
  ].join('\n');
  const syncResult = runNative(source);
  assert.equal(syncResult.globals.get('first'), 'Ada:20');
  assert.equal(syncResult.globals.get('second'), 'Grace:35');

  const asyncResult = await runNativeAsync(source);
  assert.equal(asyncResult.globals.get('first'), 'Ada:20');
  assert.equal(asyncResult.globals.get('second'), 'Grace:35');
});

test('native derived model initializers retain parent initialization and inherited defaults', () => {
  const source = [
    'model Parent:',
    '  str name',
    '  init(str value):',
    '    self.name = "parent {value}"',
    'model Child extends Parent:',
    '  str suffix = "!"',
    '  init(str value):',
    '    self.suffix = value',
    'any child = new Child("ready")',
    'str result = "{child.name}:{child.suffix}"',
    '',
  ].join('\n');
  const { globals } = runNative(source);
  assert.equal(globals.get('result'), 'parent ready:ready');
});

test('native models support static and async static methods with inheritance', async () => {
  const source = [
    'model Factory:',
    '  static str prefix = "factory"',
    '  static fn create(str name):',
    '    ret new Factory("{Factory.prefix}:{name}")',
    '  static fn.async label(str name):',
    '    ret "{self.prefix} created {name}"',
    '  str name',
    'model ExtendedFactory extends Factory:',
    '  static int version = 2',
    '  static fn kind():',
    '    ret "{ExtendedFactory.prefix}:v{ExtendedFactory.version}"',
    '  static fn.async label(str name):',
    '    ret await super.label(name) + "!"',
    'any factory = ExtendedFactory.create("Ada")',
    'str name = factory.name',
    'str kind = ExtendedFactory.kind()',
    'str label = await ExtendedFactory.label(name)',
    '',
  ].join('\n');
  const syncResult = runNative(source.replace('str label = await ExtendedFactory.label(name)\n', ''));
  assert.equal(syncResult.globals.get('name'), 'factory:Ada');
  assert.equal(syncResult.globals.get('kind'), 'factory:v2');

  const asyncResult = await runNativeAsync(source);
  assert.equal(asyncResult.globals.get('name'), 'factory:Ada');
  assert.equal(asyncResult.globals.get('kind'), 'factory:v2');
  assert.equal(asyncResult.globals.get('label'), 'factory created factory:Ada!');
  assert.equal(asyncResult.globals.get('ExtendedFactory').prefix, 'factory');
  assert.equal(asyncResult.globals.get('ExtendedFactory').version, 2);
});

test('native engine scopes block variables and prevents reassignment of immutable bindings', () => {
  const { globals } = runNative([
    'if true:',
    '  int scoped = 1',
    'mut int outer = 1',
    'if true:',
    '  outer = 2',
    '',
  ].join('\n'));

  assert.equal(globals.get('outer'), 2);
  assert.throws(() => globals.get('scoped'), /Unknown name 'scoped'/);
  assert.throws(() => runNative('int fixed = 1\nfixed = 2\n'), /Cannot reassign immutable binding 'fixed'/);
});

test('native engine enforces execution limits and reports unsupported language features', () => {
  const engine = new NativeEngine({ maxSteps: 20, output: captureOutput() });
  assert.throws(
    () => engine.execute('while true:\n  mut int local = 1\n'),
    error => /step limit \(20\) exceeded/.test(error.message)
      && /NAIDE stack:/.test(error.message)
    && /line 2/.test(error.message),
  );
  assert.throws(() => runNative('use { readFile } from "node:fs"\n'), /does not load Node\.js built-ins/);
});

test('native engine includes source locations and function frames in runtime errors', async () => {
  const source = [
    'fn inner():',
    '  throw new TypeError("broken")',
    'fn middle():',
    '  inner()',
    'fn outer():',
    '  middle()',
    'outer()',
    '',
  ].join('\n');
  const sourceFile = join(tmpdir(), 'native-stack.naide');
  assert.throws(
    () => runNative(source, { sourceFile, output: captureOutput() }),
    error => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /broken \(NAIDE line 2\)/);
      assert.match(error.message, /NAIDE stack:/);
      assert.match(error.message, /outer \(.*native-stack\.naide:5\)/);
      assert.match(error.message, /middle \(.*native-stack\.naide:3\)/);
      assert.match(error.message, /inner \(.*native-stack\.naide:1\)/);
      return true;
    },
  );
  await assert.rejects(
    runNativeAsync(source, { sourceFile, output: captureOutput() }),
    error => /NAIDE stack:/.test(error.message) && /inner/.test(error.message) && /outer/.test(error.message),
  );

  const depthLimited = new NativeEngine({ maxCallDepth: 3, output: captureOutput() });
  assert.throws(
    () => depthLimited.execute('fn recurse():\n  recurse()\nrecurse()\n'),
    error => error instanceof RangeError
      && /call depth limit \(3\) exceeded/.test(error.message)
      && /recurse/.test(error.message)
      && /NAIDE stack:/.test(error.message),
  );
});

test('native engine exposes explicitly provided runtime arguments and environment values', async () => {
  const runtimeOptions = {
    args: ['input.txt', '--verbose'],
    env: { APP_MODE: 'test' },
    cwd: tmpdir(),
    platform: 'test-platform',
    arch: 'test-arch',
  };
  const { globals } = await runNativeAsync([
    'list args = runtime.args',
    'str mode = runtime.env.get("APP_MODE")',
    'bool hasSecret = runtime.env.has("SECRET_TOKEN")',
    'list envNames = runtime.env.keys()',
    'str directory = runtime.cwd',
    'str platform = runtime.platform',
    'str architecture = runtime.arch',
    'runtime.exitCode = 23',
    '',
  ].join('\n'), { runtime: runtimeOptions, output: captureOutput() });

  assert.deepEqual(globals.get('args'), ['input.txt', '--verbose']);
  assert.equal(globals.get('mode'), 'test');
  assert.equal(globals.get('hasSecret'), false);
  assert.deepEqual(globals.get('envNames'), ['APP_MODE']);
  assert.equal(globals.get('directory'), resolve(tmpdir()));
  assert.equal(globals.get('platform'), 'test-platform');
  assert.equal(globals.get('architecture'), 'test-arch');
  assert.equal(globals.get('runtime').exitCode, 23);
  runtimeOptions.args.push('mutated');
  runtimeOptions.env.APP_MODE = 'mutated';
  assert.deepEqual(globals.get('runtime').args, ['input.txt', '--verbose']);
  assert.equal(globals.get('runtime').env.get('APP_MODE'), 'test');
  await assert.rejects(
    runNativeAsync('runtime.exitCode = 256\n', { output: captureOutput() }),
    /between 0 and 255/,
  );
  assert.throws(() => new NativeEngine({ runtime: { args: [1] } }), /list of strings/);
  assert.throws(() => new NativeEngine({ runtime: { env: { INVALID_NAME: 1 } } }), /must be a string/);
  assert.throws(() => new NativeEngine({ globals: { runtime: {} } }), /cannot be replaced/);
});

test('native server runs JSON routes, validates CRUD data, applies CORS, and protects paths', async () => {
  const source = [
    'schema Widget:',
    '  id auto',
    '  name str required min(2) max(40)',
    '',
    'server app port 0:',
    '  cors ["http://localhost:3000"]',
    '  limit "/api/*" 100 "1m"',
    '  limit "/limited" 1 "1m"',
    '  auth "native-server-test-secret-at-least-32-bytes" :',
    '    protect "/api/*"',
    '    public "/api/health"',
    '    public "/api/token"',
    '    public "/api/open/*"',
    '  crud "/api/widgets" Widget',
    '  get "/api/health":',
    '    ret {status: "ok"}',
    '  cookie',
    '  get "/cookies":',
    '    ret {theme: req.cookies.theme}',
    '  get "/api/open":',
    '    ret {status: "open"}',
    '  get "/api/open/resource":',
    '    ret {status: "open"}',
    '  get "/api/private/who":',
    '    ret {user: req.user.sub}',
    '  get "/api/private/team/:id":',
    '    ret {user: req.user.sub, team: req.params.id}',
    '  get "/api/token":',
    '    ret {token: auth.sign({sub: "test-user"})}',
    '  get "/api/files/*":',
    '    ret {path: req.params["0"]}',
    '  get "/limited":',
    '    ret {ok: true}',
    '  get "/redirect":',
    '    ret.redirect "/api/health"',
    '  get "/permanent-redirect":',
    '    ret.redirect 301 "/api/health"',
    '  get "/invalid-redirect":',
    '    ret.redirect 200 "/api/health"',
    '',
  ].join('\n');
  const output = captureOutput();
  const result = await runNativeAsync(source, { output, maxRequestBodyBytes: 32 });
  const app = result.globals.get('app');
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: 'http://localhost:3000' },
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:3000');

    const openBase = await fetch(`${baseUrl}/api/open`);
    assert.equal(openBase.status, 200);
    const openNested = await fetch(`${baseUrl}/api/open/resource`);
    assert.equal(openNested.status, 200);
    const cookies = await fetch(`${baseUrl}/cookies`, {
      headers: { cookie: 'theme=dark%20mode; malformed; empty=' },
    });
    assert.equal(cookies.status, 200);
    assert.deepEqual(await cookies.json(), { theme: 'dark mode' });

    const preflight = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3000');

    const limited = await fetch(`${baseUrl}/limited`);
    assert.equal(limited.status, 200);
    const limitedAgain = await fetch(`${baseUrl}/limited`);
    assert.equal(limitedAgain.status, 429);

    const redirect = await fetch(`${baseUrl}/redirect`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/api/health');
    const permanentRedirect = await fetch(`${baseUrl}/permanent-redirect`, { redirect: 'manual' });
    assert.equal(permanentRedirect.status, 301);
    assert.equal(permanentRedirect.headers.get('location'), '/api/health');
    const invalidRedirect = await fetch(`${baseUrl}/invalid-redirect`, { redirect: 'manual' });
    assert.equal(invalidRedirect.status, 500);

    const denied = await fetch(`${baseUrl}/api/private/who`);
    assert.equal(denied.status, 401);

    const tokenResponse = await fetch(`${baseUrl}/api/token`);
    assert.equal(tokenResponse.status, 200);
    const { token } = await tokenResponse.json();
    const nestedFile = await fetch(`${baseUrl}/api/files/manuals/start-here`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(nestedFile.status, 200);
    assert.deepEqual(await nestedFile.json(), { path: 'manuals/start-here' });

    const allowed = await fetch(`${baseUrl}/api/private/who`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { user: 'test-user' });

    const team = await fetch(`${baseUrl}/api/private/team/core`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(team.status, 200);
    assert.deepEqual(await team.json(), { user: 'test-user', team: 'core' });

    const tooLarge = await fetch(`${baseUrl}/api/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'x'.repeat(40) }),
    });
    assert.equal(tooLarge.status, 413);

    const invalid = await fetch(`${baseUrl}/api/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'x' }),
    });
    assert.equal(invalid.status, 400);

    const created = await fetch(`${baseUrl}/api/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Board' }),
    });
    assert.equal(created.status, 201);
    const widget = await created.json();
    assert.equal(widget.name, 'Board');
    assert.equal(typeof widget.id, 'string');

    const listed = await fetch(`${baseUrl}/api/widgets`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).data.map(item => item.id), [widget.id]);
  } finally {
    await app.close();
  }
});

test('native server rejects weak auth secrets and unsafe auth path patterns', async () => {
  await assert.rejects(
    runNativeAsync('server app port 0:\n  auth "too-short":\n    protect "/private/*"\n'),
    /secret of at least 32 UTF-8 bytes/,
  );
  await assert.rejects(
    runNativeAsync('server app port 0:\n  auth "native-server-test-secret-at-least-32-bytes":\n    public "/api/*.private"\n'),
    /may only use a trailing/,
  );
});

test('native server sessions persist per signed cookie and can be destroyed', async () => {
  const { globals } = await runNativeAsync([
    'server app port 0:',
    '  session "native-session-secret-with-more-than-32-bytes"',
    '  get "/counter":',
    '    req.session.count = (req.session.count || 0) + 1',
    '    ret {count: req.session.count, id: req.sessionId}',
    '  get "/destroy":',
    '    req.session.destroy()',
    '    ret {destroyed: true}',
    '',
  ].join('\n'), { output: captureOutput() });
  const app = globals.get('app');
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const firstResponse = await fetch(`${baseUrl}/counter`);
    assert.equal(firstResponse.status, 200);
    const firstValue = await firstResponse.json();
    assert.equal(firstValue.count, 1);
    const setCookie = firstResponse.headers.get('set-cookie');
    assert.match(setCookie, /; HttpOnly; Secure;/);
    const cookie = setCookie.split(';', 1)[0];
    assert.match(cookie, /^naide_sid=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i);

    const secondResponse = await fetch(`${baseUrl}/counter`, { headers: { cookie } });
    const secondValue = await secondResponse.json();
    assert.equal(secondValue.count, 2);
    assert.equal(secondValue.id, firstValue.id);

    const forgedCookie = `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;
    const forgedResponse = await fetch(`${baseUrl}/counter`, { headers: { cookie: forgedCookie } });
    const forgedValue = await forgedResponse.json();
    assert.equal(forgedValue.count, 1);
    assert.notEqual(forgedValue.id, firstValue.id);

    const destroyResponse = await fetch(`${baseUrl}/destroy`, { headers: { cookie } });
    assert.deepEqual(await destroyResponse.json(), { destroyed: true });
    assert.match(destroyResponse.headers.get('set-cookie'), /Max-Age=0/);

    const restartedResponse = await fetch(`${baseUrl}/counter`, { headers: { cookie } });
    const restartedValue = await restartedResponse.json();
    assert.equal(restartedValue.count, 1);
    assert.notEqual(restartedValue.id, firstValue.id);
  } finally {
    await app.close();
  }
});

test('native server sessions reject weak secrets and duplicate declarations', async () => {
  await assert.rejects(
    runNativeAsync('server app port 0:\n  session "too-short"\n'),
    /sessions require a secret of at least 32 UTF-8 bytes/,
  );
  await assert.rejects(
    runNativeAsync([
      'server app port 0:',
      '  session "native-session-secret-with-more-than-32-bytes"',
      '  session "another-native-session-secret-over-32-bytes"',
      '',
    ].join('\n')),
    /Only one session declaration/,
  );
});

test('native server sends SSE events to live clients and closes streams cleanly', async () => {
  const { globals } = await runNativeAsync([
    'server app port 0:',
    '  sse "/events"',
    '  sse "/events/secondary"',
    '  get "/clients":',
    '    ret {count: sse.count}',
    '  post "/publish":',
    '    sse.broadcast("line one\\nline two", "update")',
    '    ret {sent: true}',
    '',
  ].join('\n'), { output: captureOutput() });
  const app = globals.get('app');
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const readers = [];
  try {
    const streamResponse = await fetch(`${baseUrl}/events`);
    assert.equal(streamResponse.status, 200);
    assert.match(streamResponse.headers.get('content-type'), /^text\/event-stream/);
    assert.match(streamResponse.headers.get('cache-control'), /no-cache/);
    const reader = streamResponse.body.getReader();
    readers.push(reader);
    const initialFrame = new TextDecoder().decode((await reader.read()).value);
    assert.equal(initialFrame, 'retry: 3000\n\n');

    const secondResponse = await fetch(`${baseUrl}/events/secondary`);
    const secondReader = secondResponse.body.getReader();
    readers.push(secondReader);
    assert.equal(new TextDecoder().decode((await secondReader.read()).value), 'retry: 3000\n\n');
    assert.deepEqual(await (await fetch(`${baseUrl}/clients`)).json(), { count: 2 });

    const publishResponse = await fetch(`${baseUrl}/publish`, { method: 'POST' });
    assert.equal(publishResponse.status, 200);
    const eventFrame = new TextDecoder().decode((await reader.read()).value);
    assert.equal(eventFrame, 'event: update\ndata: line one\ndata: line two\n\n');
    const secondEventFrame = new TextDecoder().decode((await secondReader.read()).value);
    assert.equal(secondEventFrame, eventFrame);

    await app.close();
    for (const activeReader of readers) assert.equal((await activeReader.read()).done, true);
  } finally {
    for (const activeReader of readers) activeReader.releaseLock();
    await app.close();
  }
});

test('native SSE validates event frames', () => {
  const hub = createNativeSseHub();
  try {
    assert.throws(
      () => hub.send('value', 'bad\nevent'),
      /event names must be non-empty strings without line breaks/,
    );
    assert.throws(() => hub.send(undefined), /must be serializable/);
    assert.throws(
      () => hub.send('x'.repeat(262_145)),
      /payload exceeds 262144 bytes/,
    );
  } finally {
    hub.close();
  }
});

test('native SSE disconnects clients that exceed the bounded backpressure queue', () => {
  const hub = createNativeSseHub();
  class BackpressuredResponse extends EventEmitter {
    constructor() {
      super();
      this.headers = new Map();
      this.destroyed = false;
    }

    setHeader(name, value) { this.headers.set(name, value); }
    flushHeaders() {}
    write() { return false; }
    destroy() {
      this.destroyed = true;
      this.emit('close');
    }
    end() {}
  }

  const response = new BackpressuredResponse();
  try {
    hub.attach(response);
    assert.equal(hub.count, 1);
    for (let index = 0; index < 5; index++) hub.send('x'.repeat(250_000));
    assert.equal(response.destroyed, true);
    assert.equal(hub.count, 0);
  } finally {
    hub.close();
  }
});

test('native server cache stores GET responses per caller and honors no-store', async () => {
  const { globals } = await runNativeAsync([
    'mut int hits = 0',
    'server app port 0:',
    '  cache "/cached/*" "1m"',
    '  get "/cached/value":',
    '    hits += 1',
    '    ret {count: hits}',
    '  get "/cached/private":',
    '    hits += 1',
    '    res.set("cache-control", "no-store")',
    '    ret {count: hits}',
    '',
  ].join('\n'), { output: captureOutput() });
  const app = globals.get('app');
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const first = await fetch(`${baseUrl}/cached/value`, { headers: { authorization: 'Bearer alpha' } });
    assert.equal(first.headers.get('x-cache'), 'MISS');
    assert.deepEqual(await first.json(), { count: 1 });

    const repeat = await fetch(`${baseUrl}/cached/value`, { headers: { authorization: 'Bearer alpha' } });
    assert.equal(repeat.headers.get('x-cache'), 'HIT');
    assert.deepEqual(await repeat.json(), { count: 1 });

    const isolated = await fetch(`${baseUrl}/cached/value`, { headers: { authorization: 'Bearer beta' } });
    assert.equal(isolated.headers.get('x-cache'), 'MISS');
    assert.deepEqual(await isolated.json(), { count: 2 });

    for (let expectedCount = 3; expectedCount <= 4; expectedCount++) {
      const noStore = await fetch(`${baseUrl}/cached/private`);
      assert.equal(noStore.headers.get('x-cache'), null);
      assert.deepEqual(await noStore.json(), { count: expectedCount });
    }
  } finally {
    await app.close();
  }
});

test('native response cache rejects invalid durations', () => {
  assert.throws(() => createNativeCacheMiddleware('never'), /Invalid native cache duration/);
  assert.throws(() => createNativeCacheMiddleware(0), /Invalid native cache duration/);
});

test('native server renders safe project-confined templates and blocks missing view setup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-views-'));
  const viewsDirectory = join(directory, 'views');
  mkdirSync(viewsDirectory);
  writeFileSync(join(viewsDirectory, 'home.html'), [
    '<h1>{{title}}</h1>',
    '{{each item in items}}<b>{{item}}</b>{{/each}}',
    '{{if show}}<i>visible</i>{{/if}}',
    '',
  ].join(''));
  try {
    const { globals } = await runNativeAsync([
      'server app port 0:',
      '  view "views"',
      '  get "/":',
      '    ret.render "home" {title: "<Welcome>", items: ["<one>", "two"], show: true}',
      '  get "/named":',
      '    ret.render req.query.name',
      '',
    ].join('\n'), { sourceFile: join(directory, 'main.naide'), output: captureOutput() });
    const app = globals.get('app');
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    try {
      const response = await fetch(baseUrl);
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(
        await response.text(),
        '<h1>&lt;Welcome&gt;</h1><b>&lt;one&gt;</b><b>two</b><i>visible</i>',
      );
      const traversal = await fetch(`${baseUrl}/named?name=../main`);
      assert.equal(traversal.status, 500);
      assert.deepEqual(await traversal.json(), { error: 'Internal server error' });
    } finally {
      await app.close();
    }

    const noView = await runNativeAsync([
      'server app port 0:',
      '  get "/":',
      '    ret.render "home"',
      '',
    ].join('\n'), { sourceFile: join(directory, 'main.naide'), output: captureOutput() });
    const noViewApp = noView.globals.get('app');
    try {
      const response = await fetch(`http://127.0.0.1:${noViewApp.server.address().port}`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Internal server error' });
    } finally {
      await noViewApp.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native queue declarations register jobs and await their completion', async () => {
  const { globals } = await runNativeAsync([
    'mut int total = 0',
    'queue jobs:',
    '  job "add"(amount):',
    '    total += amount',
    '  job "double"(amount):',
    '    total += amount * 2',
    'await jobs.add("add", 3)',
    'await jobs.add("double", 4)',
    '',
  ].join('\n'), { output: captureOutput() });
  assert.equal(globals.get('total'), 11);
  assert.equal(globals.get('jobs').size, 0);
});

test('native CSV declarations export escaped rows through project-confined I/O', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-csv-'));
  mkdirSync(join(directory, 'exports'));
  const sourceFile = join(directory, 'main.naide');
  try {
    await runNativeAsync([
      'csv "users" format "csv":',
      '  columns "name" "note"',
      '  from [{name: "Alice", note: "hello, world"}, {name: "Bob", note: "say \\"hi\\""}]',
      '  output "exports/users.csv"',
      '',
    ].join('\n'), { sourceFile, output: captureOutput() });
    assert.equal(
      readFileSync(join(directory, 'exports', 'users.csv'), 'utf8'),
      'name,note\r\nAlice,"hello, world"\r\nBob,"say ""hi"""\r\n',
    );

    await assert.rejects(
      runNativeAsync('csv "users":\n  output "../outside.csv"\n', { sourceFile }),
      /escapes the project directory/,
    );
    await assert.rejects(
      runNativeAsync('csv "users" format "xlsx":\n  columns "id"\n', { sourceFile }),
      /does not support 'xlsx' format yet/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native prompts interpolate defaults and tests execute assertions', async () => {
  const output = captureOutput();
  const { globals } = await runNativeAsync([
    'prompt greeting {name: "friend"}:',
    '  "Hello {name}!"',
    '  "Welcome to {place}."',
    'test "native arithmetic":',
    '  assert 2 * 3 == 6',
    'str message = greeting({name: "Ada", place: "NAIDE"})',
    '',
  ].join('\n'), { output });
  assert.equal(globals.get('message'), 'Hello Ada!\nWelcome to NAIDE.');
  assert.ok(output.lines.some(line => line.includes('PASS native arithmetic')));
  await assert.rejects(
    runNativeAsync('test "failing assertion":\n  assert false\n', { output: captureOutput() }),
    /Assertion failed/,
  );
});

test('native pages render escaped HTML through project-confined output', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-page-'));
  mkdirSync(join(directory, 'public'));
  const sourceFile = join(directory, 'main.naide');
  try {
    await runNativeAsync([
      'page "public/index.html":',
      '  lang "ja"',
      '  title "NAIDE & Friends"',
      '  h1 "Hello <world>"',
      '  style "./site.css"',
      '  script "./app.js"',
      '  img "./logo.png" "NAIDE logo"',
      '  a "/docs" "Read docs":',
      '    class "primary"',
      '',
    ].join('\n'), { sourceFile, output: captureOutput() });
    const html = readFileSync(join(directory, 'public', 'index.html'), 'utf8');
    assert.match(html, /<html lang="ja">/);
    assert.match(html, /<title>NAIDE &amp; Friends<\/title>/);
    assert.match(html, /<h1>Hello &lt;world&gt;<\/h1>/);
    assert.match(html, /<link rel="stylesheet" href="\.\/site\.css">/);
    assert.match(html, /<script src="\.\/app\.js"><\/script>/);
    assert.match(html, /<img src="\.\/logo\.png" alt="NAIDE logo">/);
    assert.match(html, /<a href="\/docs" class="primary">Read docs<\/a>/);
    await assert.rejects(
      runNativeAsync('page "../outside.html":\n  h1 "blocked"\n', { sourceFile }),
      /escapes the project directory/,
    );
    await assert.rejects(
      runNativeAsync('page "public/unsafe.html":\n  a "javascript:alert(1)" "unsafe"\n', { sourceFile }),
      /Unsafe native page .* URL/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native i18n loads confined locales and validates locale selection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-i18n-'));
  mkdirSync(join(directory, 'locales'));
  writeFileSync(join(directory, 'locales', 'en.json'), JSON.stringify({ greeting: 'Hello {name}' }));
  writeFileSync(join(directory, 'locales', 'ja.json'), JSON.stringify({ greeting: 'こんにちは {name}' }));
  const sourceFile = join(directory, 'main.naide');
  try {
    const { globals } = await runNativeAsync([
      'i18n "locales":',
      '  default "en"',
      '  lang "en" "en.json"',
      '  lang "ja" "ja.json"',
      'str english = i18n.t("greeting", {name: "Ada"})',
      'i18n.setLang("ja")',
      'str japanese = i18n.t("greeting", {name: "Ada"})',
      '',
    ].join('\n'), { sourceFile, output: captureOutput() });
    assert.equal(globals.get('english'), 'Hello Ada');
    assert.equal(globals.get('japanese'), 'こんにちは Ada');
    assert.equal(globals.get('i18n').getLang(), 'ja');
    await assert.rejects(
      runNativeAsync('i18n "locales":\n  default "fr"\n  lang "en" "en.json"\n', { sourceFile }),
      /has no declared translation file/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native logging honors levels, formats entries, and awaits confined file writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-logging-'));
  mkdirSync(join(directory, 'logs'));
  const sourceFile = join(directory, 'main.naide');
  const output = captureOutput();
  try {
    await runNativeAsync([
      'logging "api":',
      '  level "warn"',
      '  file "logs/app.log"',
      '  format "json"',
      'await logger.info("hidden")',
      'await logger.warn("visible", 7)',
      '',
    ].join('\n'), { sourceFile, output });
    assert.equal(output.lines.length, 1);
    const entries = readFileSync(join(directory, 'logs', 'app.log'), 'utf8').trim().split('\n');
    assert.equal(entries.length, 1);
    assert.deepEqual(JSON.parse(entries[0]), {
      timestamp: JSON.parse(entries[0]).timestamp,
      level: 'warn',
      logger: 'api',
      message: 'visible 7',
    });
    await assert.rejects(
      runNativeAsync('logging "api":\n  file "../outside.log"\nawait logger.info("blocked")\n', {
        sourceFile,
        output: captureOutput(),
      }),
      /escapes the project directory/,
    );
    await assert.rejects(
      runNativeAsync('logging "api":\n  rotate "1d"\n', { output: captureOutput() }),
      /does not support file rotation/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native CLI applications validate typed options, flags, and help output', async () => {
  const output = captureOutput();
  const source = [
    'cli greet "Greeting tool":',
    '  arg "count" int "How many"',
    '  arg "name" str',
    '  flag "v" "verbose" "Show details"',
    '  run (args):',
    '    log args.count + " " + args.name + " " + args.verbose',
    '',
  ].join('\n');
  await runNativeAsync(source, {
    runtime: { args: ['--count', '3', '--name', 'Ada', '-v'] },
    output,
  });
  assert.deepEqual(output.lines, ['3 Ada true']);

  const helpOutput = captureOutput();
  await runNativeAsync(source, { runtime: { args: ['--help'] }, output: helpOutput });
  assert.ok(helpOutput.lines.some(line => line.includes('Greeting tool')));
  assert.ok(helpOutput.lines.some(line => line.includes('--count <int>')));
  await assert.rejects(
    runNativeAsync(source, { runtime: { args: ['--count', '3.5'] }, output: captureOutput() }),
    /must be a safe integer/,
  );
  await assert.rejects(
    runNativeAsync(source, { runtime: { args: ['--unknown', 'x'] }, output: captureOutput() }),
    /Unknown option '--unknown'/,
  );
});

test('native search uses the host HTTP capability and authenticates Meilisearch requests', async () => {
  const requests = [];
  const http = {
    request: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ hits: [{ id: 1 }] }),
        text: async () => '',
      };
    },
    get: async () => { throw new Error('Unexpected GET'); },
    post: async () => { throw new Error('Unexpected POST'); },
  };
  const { globals } = await runNativeAsync([
    'search "meilisearch" "https://search.example.test/" "secret-key":',
    '  index "products"',
    'map results = await search.query("ada", {limit: 5})',
    '',
  ].join('\n'), { http, output: captureOutput() });
  assert.deepEqual(globals.get('results'), { hits: [{ id: 1 }] });
  assert.equal(requests[0].url, 'https://search.example.test/indexes/products/search');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.authorization, 'Bearer secret-key');
  assert.deepEqual(JSON.parse(requests[0].options.body), { limit: 5, q: 'ada' });

  await assert.rejects(
    runNativeAsync([
      'search "meilisearch" "http://search.example.test" "secret":',
      '  index "products"',
      'await search.query("x")',
      '',
    ].join('\n'), {
      http: {
        ...http,
        request: async () => ({
          ok: false,
          status: 401,
          text: async () => 'unauthorized',
        }),
      },
      output: captureOutput(),
    }),
    /HTTP 401: unauthorized/,
  );
});

test('native event watches await listeners and every schedules bounded intervals', async () => {
  const { globals } = await runNativeAsync([
    'mut int watched = 0',
    'mut int ticks = 0',
    'watch User.create (event):',
    '  watched += event.data.id',
    'await events.emit("User.create", {id: 4})',
    'every "1h":',
    '  ticks += 1',
    'scheduler.stopAll()',
    '',
  ].join('\n'), { output: captureOutput() });
  assert.equal(globals.get('watched'), 4);
  assert.equal(globals.get('ticks'), 1);
  assert.equal(globals.get('scheduler').activeCount, 0);
  await assert.rejects(
    runNativeAsync('every "* * * * *":\n  log "unsupported"\n', { output: captureOutput() }),
    /cron expressions are not supported/,
  );
});

test('native on declarations subscribe to host event emitters', async () => {
  const emitter = new EventEmitter();
  const { globals } = await runNativeAsync([
    'mut int received = 0',
    'on emitter.ready:',
    '  received += 1',
    'emitter.emit("ready")',
    'await task.sleep(1)',
    '',
  ].join('\n'), { globals: { emitter }, output: captureOutput() });
  assert.equal(globals.get('received'), 1);
});

test('native SQL declarations require and use the host database adapter', async () => {
  const connections = [];
  const stores = [];
  const database = {
    connect: async options => {
      const connection = { options };
      connections.push(connection);
      return connection;
    },
    createStore: async ({ driver, connection, schema }) => {
      stores.push({ driver, connection, schema: schema.name });
      return createStore(schema);
    },
  };
  const { globals } = await runNativeAsync([
    'db.sql "sqlite" "data/app.db"',
    'schema User:',
    '  id auto',
    '  name str required',
    'map user = UserStore.create({name: "Ada"})',
    '',
  ].join('\n'), { database, output: captureOutput() });
  assert.deepEqual(connections[0].options, { driver: 'sqlite', connection: 'data/app.db' });
  assert.deepEqual(stores, [{ driver: 'sqlite', connection: connections[0], schema: 'User' }]);
  assert.equal(globals.get('user').name, 'Ada');

  const { globals: connected } = await runNativeAsync('db.connect("sqlite://memory")\n', {
    database,
    output: captureOutput(),
  });
  assert.equal(connected.get('db').options.connection, 'sqlite://memory');
  await assert.rejects(
    runNativeAsync('db.sql "sqlite" "data.db"\n', { output: captureOutput() }),
    /requires a host database capability/,
  );
});

test('native bot declarations register event and slash handlers through a host adapter', async () => {
  const registrations = { events: new Map(), commands: new Map(), started: false };
  const bot = {
    create: async options => {
      registrations.options = options;
      return {
        on: (event, handler) => registrations.events.set(event, handler),
        command: (name, description, handler) => registrations.commands.set(name, { description, handler }),
        start: async token => {
          assert.equal(token, options.token);
          registrations.started = true;
        },
      };
    },
  };
  const { globals } = await runNativeAsync([
    'mut int messages = 0',
    'mut int commands = 0',
    'bot assistant type "discord" token "test-token" prefix "!":',
    '  on "message" (message):',
    '    messages += 1',
    '  slash "ping" "Check health" (interaction):',
    '    commands += 1',
    '',
  ].join('\n'), { bot, output: captureOutput() });
  assert.equal(registrations.options.platform, 'discord');
  assert.equal(registrations.started, true);
  await registrations.events.get('message')({ content: 'hello' });
  await registrations.commands.get('ping').handler({ commandName: 'ping' });
  assert.equal(globals.get('messages'), 1);
  assert.equal(globals.get('commands'), 1);
  assert.equal(registrations.commands.get('ping').description, 'Check health');
});

test('native storage declarations pass credentials to a validated host adapter', async () => {
  let options;
  const client = {
    upload: async () => 'uploaded',
    download: async () => 'contents',
    remove: async () => true,
  };
  const { globals } = await runNativeAsync([
    'storage "s3" "bucket-name" "access-key" "secret-key":',
    '  region "us-west-2"',
    'str downloaded = await storage.download("report.txt")',
    '',
  ].join('\n'), {
    storage: {
      connect: async value => {
        options = value;
        return client;
      },
    },
    output: captureOutput(),
  });
  assert.equal(globals.get('downloaded'), 'contents');
  assert.deepEqual(options, {
    provider: 's3',
    bucket: 'bucket-name',
    accessKey: 'access-key',
    secretKey: 'secret-key',
    region: 'us-west-2',
  });
  await assert.rejects(
    runNativeAsync('storage "s3" "bucket" "key" "secret":\n  region "us-east-1"\n', {
      output: captureOutput(),
    }),
    /requires a host storage capability/,
  );
});

test('native screens produce immutable host-neutral component trees with actions', async () => {
  const { globals } = await runNativeAsync([
    'mut int clicks = 0',
    'screen Welcome:',
    '  text "Hello"',
    '  input "Your name"',
    '  button "Continue":',
    '    clicks += 1',
    'map view = Welcome()',
    '',
  ].join('\n'), { output: captureOutput() });
  const view = globals.get('view');
  assert.equal(view.type, 'View');
  assert.deepEqual(view.children.map(element => element.type), ['Text', 'TextInput', 'Button']);
  assert.equal(view.children[0].children[0], 'Hello');
  assert.equal(view.children[1].props.placeholder, 'Your name');
  await view.children[2].props.onPress();
  assert.equal(globals.get('clicks'), 1);
  assert.throws(() => { view.children.push('injected'); }, TypeError);
});

test('native mail configuration uses the host transport and explicit credentials', async () => {
  let options;
  const transport = { sendMail: async message => ({ accepted: [message.to] }) };
  const { globals } = await runNativeAsync([
    'mail "smtp.example.test" 587:',
    '  user "mailer"',
    '  pass "secret"',
    'map result = await mail.sendMail({to: "user@example.test", subject: "Hello"})',
    '',
  ].join('\n'), {
    mailer: {
      createTransport: value => {
        options = value;
        return transport;
      },
    },
    output: captureOutput(),
  });
  assert.deepEqual(options, {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    auth: { user: 'mailer', pass: 'secret' },
  });
  assert.deepEqual(globals.get('result'), { accepted: ['user@example.test'] });
  await assert.rejects(
    runNativeAsync('mail "smtp.example.test" 587:\n  user "mailer"\n', { output: captureOutput() }),
    /requires a host mailer capability/,
  );
});

test('native Web Push exposes validated single and batch delivery', async () => {
  const deliveries = [];
  let configuration;
  const { globals } = await runNativeAsync([
    'push "public-key" "private-key":',
    '  endpoint "/subscribe"',
    'await push.send({endpoint: "https://push.example.test"}, "Title", "Body", {id: 4})',
    'map results = await push.sendAll([{endpoint: "https://push.example.test"}], "Update", "Changed")',
    '',
  ].join('\n'), {
    push: {
      configure: async value => {
        configuration = value;
        return {
          sendNotification: async (subscription, payload) => {
            deliveries.push({ subscription, payload: JSON.parse(payload) });
          },
        };
      },
    },
    output: captureOutput(),
  });
  assert.deepEqual(configuration, {
    publicKey: 'public-key',
    privateKey: 'private-key',
    subject: 'mailto:noreply@example.com',
  });
  assert.equal(globals.get('push').endpoint, '/subscribe');
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries[0].payload, { title: 'Title', body: 'Body', data: { id: 4 } });
  assert.equal(globals.get('results').length, 1);
});

test('native server serves OpenAPI paths and schema components', async () => {
  const { globals } = await runNativeAsync([
    'schema Widget:',
    '  id auto',
    '  name str required',
    '  count int',
    'server app port 0:',
    '  get "/widgets/:id":',
    '    ret {id: req.params.id}',
    '  post "/widgets":',
    '    ret req.body',
    '  openapi "/docs"',
    '',
  ].join('\n'), { output: captureOutput() });
  const app = globals.get('app');
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/docs`);
    assert.equal(response.status, 200);
    const spec = await response.json();
    assert.equal(spec.openapi, '3.1.0');
    assert.deepEqual(spec.paths['/widgets/{id}'].get.parameters, [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    assert.equal(spec.paths['/widgets'].post.requestBody.required, true);
    assert.deepEqual(spec.components.schemas.Widget.required, ['name']);
    assert.equal(spec.components.schemas.Widget.properties.count.type, 'integer');
  } finally {
    await app.close();
  }
});

test('native downloads serve confined files with safe content-disposition headers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-download-'));
  writeFileSync(join(directory, 'report.txt'), 'native download payload');
  try {
    const { globals } = await runNativeAsync([
      'server app port 0:',
      '  get "/report":',
      '    ret.download "report.txt" "résumé.txt"',
      '  get "/outside":',
      '    ret.download "../outside.txt"',
      '',
    ].join('\n'), { sourceFile: join(directory, 'main.naide'), output: captureOutput() });
    const app = globals.get('app');
    try {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}/report`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/octet-stream');
      assert.match(response.headers.get('content-disposition'), /filename="r_sum_.txt"/);
      assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''r%C3%A9sum%C3%A9.txt/);
      assert.equal(await response.text(), 'native download payload');

      const rejected = await fetch(`http://127.0.0.1:${app.server.address().port}/outside`);
      assert.equal(rejected.status, 500);
      assert.deepEqual(await rejected.json(), { error: 'Internal server error' });
    } finally {
      await app.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native server parses bounded multipart uploads and exposes file metadata', async () => {
  const { globals } = await runNativeAsync([
    'server app port 0:',
    '  upload "/files" "document" (req, res):',
    '    ret {name: req.file.filename, size: req.file.size, type: req.file.contentType, bytes: req.file.data.length, note: req.body.note}',
    '',
  ].join('\n'), { output: captureOutput() });
  const app = globals.get('app');
  try {
    const form = new FormData();
    form.set('note', 'hello');
    form.set('document', new Blob(['safe content']), 'report.txt');
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/files`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      name: 'report.txt',
      size: 12,
      type: 'application/octet-stream',
      bytes: 12,
      note: 'hello',
    });

    const missingFile = new FormData();
    missingFile.set('other', new Blob(['x']), 'x.txt');
    const rejected = await fetch(`http://127.0.0.1:${app.server.address().port}/files`, {
      method: 'POST',
      body: missingFile,
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: "Multipart request is missing file field 'document'." });
  } finally {
    await app.close();
  }
});

test('native server protocol declarations require explicit host adapters', async () => {
  assert.deepEqual(
    Object.entries(NATIVE_SERVER_SUPPORT)
      .filter(([, support]) => support.status === 'unsupported')
      .map(([type]) => type),
    [],
  );
  assert.equal(NATIVE_SERVER_SUPPORT.WsDecl.status, 'contextual');
  assert.equal(NATIVE_SERVER_SUPPORT.GraphqlDecl.status, 'contextual');

  await assert.rejects(
    runNativeAsync('server app port 0:\n  graphql "/graphql"\n'),
    /Native GraphqlDecl requires the explicit nativeServices\.graphql host adapter/,
  );
  await assert.rejects(
    runNativeAsync('server app port 0:\n  ws "/socket":\n    on "message":\n      log "message"\n'),
    /Native WsDecl requires the explicit nativeServices\.websocket host adapter/,
  );

  let graphQLConfig;
  let socketClosed = false;
  const { globals } = await runNativeAsync([
    'server app port 0:',
    '  graphql "/graphql"',
    '  ws "/socket":',
    '    on "message"(data):',
    '      log data',
    '',
  ].join('\n'), {
    nativeServices: {
      graphql: config => {
        graphQLConfig = config;
        return (_request, response) => response.json({ queryPath: config.path });
      },
      websocket: config => ({
        handler: () => config.events.message({ text: 'hello' }),
        close: async () => { socketClosed = true; },
      }),
    },
    output: captureOutput(),
  });
  const app = globals.get('app');
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  try {
    assert.equal(graphQLConfig.path, '/graphql');
    const response = await fetch(`${baseUrl}/graphql`, { method: 'POST' });
    assert.deepEqual(await response.json(), { queryPath: '/graphql' });
    await app.upgradeHandlers[0].handler({}, {}, Buffer.alloc(0));
  } finally {
    await app.close();
  }
  assert.equal(socketClosed, true);
});

test('native service declarations validate and execute through explicit adapters', async () => {
  assert.throws(() => new NativeEngine({ nativeServices: null }), /adapters must be provided as an object/);
  assert.throws(() => new NativeEngine({ nativeServices: { image: {} } }), /adapter 'image' must be a function/);
  assert.throws(() => new NativeEngine({ nativeServices: { unknown: () => {} } }), /Unknown native service adapter/);

  const calls = [];
  const source = [
    'desktop app:',
    '  title "Editor"',
    '  size 800 600',
    '  load "index.html"',
    'oauth "google" "client-id" "client-secret":',
    '  callback "/auth/callback"',
    'pay "stripe" "payment-secret":',
    '  success "https://example.test/paid"',
    'pdf "report.pdf":',
    '  title "Quarterly report"',
    'image "source.png" -> "result.png":',
    '  resize 80 60',
    'migrate "create-widgets":',
    '  up:',
    '    db.execute("up")',
    '  down:',
    '    db.execute("down")',
    'grpc "widgets" port 51000:',
    '  rpc getWidget(id):',
    '    ret {id: id}',
    'webrtc "room":',
    '  on offer(data):',
    '    ret data',
    'blockchain "token":',
    '  network "testnet"',
    '  provider "https://rpc.example.test"',
    '',
  ].join('\n');
  const nativeServices = Object.fromEntries([
    'desktop', 'oauth', 'payments', 'pdf', 'image', 'migration', 'grpc', 'webrtc', 'blockchain',
  ].map(name => [name, async config => {
    calls.push([name, config]);
    if (name === 'desktop') return { title: config.title };
    if (name === 'payments') return { provider: config.provider };
    if (name === 'blockchain') return { network: config.network };
    return undefined;
  }]));
  const serviceDirectory = mkdtempSync(join(tmpdir(), 'naide-native-services-'));
  writeFileSync(join(serviceDirectory, 'source.png'), 'test image');
  writeFileSync(join(serviceDirectory, 'index.html'), '<main>desktop</main>');
  try {
    const { globals } = await runNativeAsync(source, {
      sourceFile: join(serviceDirectory, 'main.naide'),
      nativeServices,
    });
    const byName = Object.fromEntries(calls);

    assert.deepEqual(globals.get('app'), { title: 'Editor' });
    assert.deepEqual(globals.get('pay'), { provider: 'stripe' });
    assert.deepEqual(globals.get('token'), { network: 'testnet' });
    assert.equal(byName.desktop.width, 800);
    assert.match(byName.desktop.load, /index\.html$/);
    assert.equal(byName.oauth.callback, '/auth/callback');
    assert.equal(byName.payments.successUrl, 'https://example.test/paid');
    assert.match(byName.pdf.filename, /report\.pdf$/);
    assert.match(byName.image.input, /source\.png$/);
    assert.match(byName.image.output, /result\.png$/);
    assert.equal(byName.grpc.port, 51000);
    assert.deepEqual(await byName.grpc.rpcs.getWidget({ id: 42 }), { id: { id: 42 } });
    assert.deepEqual(await byName.webrtc.events.offer({ sdp: 'offer' }), { sdp: 'offer' });
    const migrationDatabase = { execute: async value => value };
    assert.equal(await byName.migration.up(migrationDatabase), undefined);
    assert.equal(await byName.migration.down(migrationDatabase), undefined);
  } finally {
    rmSync(serviceDirectory, { recursive: true, force: true });
  }
});

test('native service adapters fail explicitly when absent and preserve adapter failures', async () => {
  const serviceDirectory = mkdtempSync(join(tmpdir(), 'naide-native-service-errors-'));
  writeFileSync(join(serviceDirectory, 'source.png'), 'test image');
  writeFileSync(join(serviceDirectory, 'index.html'), '<main>desktop</main>');
  const sourceFile = join(serviceDirectory, 'main.naide');
  const declarations = [
    ['desktop', 'desktop app:\n  load "index.html"\n'],
    ['oauth', 'oauth "google" "id" "secret":\n  callback "/callback"\n'],
    ['payments', 'pay "stripe" "secret":\n  webhook "/webhook"\n'],
    ['image', 'image "source.png":\n  grayscale\n'],
    ['pdf', 'pdf "report.pdf":\n  text "report"\n'],
    ['migration', 'migrate "add-table":\n  up:\n    db.execute("up")\n  down:\n    db.execute("down")\n'],
    ['grpc', 'grpc "service":\n  rpc ping():\n    ret {}\n'],
    ['webrtc', 'webrtc "room":\n  on offer(data):\n    ret data\n'],
    ['blockchain', 'blockchain "token":\n  network "mainnet"\n'],
    ['websocket', 'ws "/socket":\n  on "message":\n    log "message"\n'],
  ];
  try {
    for (const [name, declaration] of declarations) {
      await assert.rejects(
        runNativeAsync(declaration, { sourceFile }),
        new RegExp(`nativeServices\\.${name} host adapter`),
        `${name} must identify its missing adapter`,
      );
    }
    await assert.rejects(
      runNativeAsync('oauth "google" "id" "secret":\n  callback "/callback"\n', {
        nativeServices: { oauth: async () => { throw new Error('provider unavailable'); } },
      }),
      /provider unavailable/,
    );
    await assert.rejects(
      runNativeAsync('image "../outside.png":\n  grayscale\n', {
        sourceFile,
        nativeServices: { image: async () => assert.fail('Path escapes must not reach the adapter.') },
      }),
      /escapes the project directory/,
    );
    await assert.rejects(
      runNativeAsync('image "source.png":\n  sharpen\n', {
        sourceFile,
        nativeServices: { image: async () => assert.fail('Unsupported operation must not reach the adapter.') },
      }),
      /does not support operation 'sharpen'/,
    );
  } finally {
    rmSync(serviceDirectory, { recursive: true, force: true });
  }
});

test('native WebSocket adapter cleanup failures are reported after the HTTP server closes', async () => {
  const { globals } = await runNativeAsync(
    'server app port 0:\n  ws "/socket":\n    on "message":\n      log "message"\n',
    {
      nativeServices: {
        websocket: () => ({
          handler: () => {},
          close: async () => { throw new Error('socket cleanup failed'); },
        }),
      },
      output: captureOutput(),
    },
  );
  const app = globals.get('app');
  await assert.rejects(app.close(), /socket cleanup failed/);
  assert.equal(app.server, null);
});

test('native server composes nested route-group paths and scoped authentication', async () => {
  const source = [
    'schema Widget:',
    '  id auto',
    '  name str required',
    '',
    'server app port 0:',
    '  group "/api/v1":',
    '    auth "native-route-group-secret-at-least-32-bytes":',
    '      public "/health"',
    '      public "/token"',
    '    get "/health":',
    '      ret {status: "ok"}',
    '    get "/token":',
    '      ret {token: auth.sign({sub: "group-user"})}',
    '    get "/private":',
    '      ret {user: req.user.sub}',
    '    group "/nested":',
    '      get "/:id":',
    '        ret {user: req.user.sub, id: req.params.id}',
    '    crud "/widgets" Widget',
    '',
  ].join('\n');
  const result = await runNativeAsync(source, { output: captureOutput() });
  const app = result.globals.get('app');
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const health = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const denied = await fetch(`${baseUrl}/api/v1/private`);
    assert.equal(denied.status, 401);

    const tokenResult = await fetch(`${baseUrl}/api/v1/token`);
    assert.equal(tokenResult.status, 200);
    const { token } = await tokenResult.json();
    const headers = { authorization: `Bearer ${token}` };

    const privateRoute = await fetch(`${baseUrl}/api/v1/private`, { headers });
    assert.equal(privateRoute.status, 200);
    assert.deepEqual(await privateRoute.json(), { user: 'group-user' });

    const nestedRoute = await fetch(`${baseUrl}/api/v1/nested/item-42`, { headers });
    assert.equal(nestedRoute.status, 200);
    assert.deepEqual(await nestedRoute.json(), { user: 'group-user', id: 'item-42' });

    const widgets = await fetch(`${baseUrl}/api/v1/widgets`, { headers });
    assert.equal(widgets.status, 200);
    assert.deepEqual((await widgets.json()).data, []);
  } finally {
    await app.close();
  }
});

test('native server resolves reusable middleware, validates routes, and runs error handlers', async () => {
  const source = [
    'fn annotate(req, res, next):',
    '  req.headers["x-native-middleware"] = "applied"',
    '  next()',
    '',
    'schema Widget:',
    '  id auto',
    '  name str required min(2)',
    '',
    'server app port 0:',
    '  mid annotate "/api"',
    '  validate "/api/widgets" Widget',
    '  error (err, req, res):',
    '    ret.status 418 {error: err.message}',
    '  get "/api/marked":',
    '    ret {marker: req.headers["x-native-middleware"]}',
    '  post "/api/widgets":',
    '    ret req.body',
    '  get "/api/fail":',
    '    throw new Error("handled failure")',
    '',
  ].join('\n');
  const result = await runNativeAsync(source, { output: captureOutput() });
  const app = result.globals.get('app');
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const marked = await fetch(`${baseUrl}/api/marked`);
    assert.equal(marked.status, 200);
    assert.deepEqual(await marked.json(), { marker: 'applied' });

    const invalid = await fetch(`${baseUrl}/api/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    assert.equal(invalid.status, 400);

    const valid = await fetch(`${baseUrl}/api/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Board' }),
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { name: 'Board' });

    const failure = await fetch(`${baseUrl}/api/fail`);
    assert.equal(failure.status, 418);
    assert.deepEqual(await failure.json(), { error: 'handled failure (NAIDE line 19)' });
  } finally {
    await app.close();
  }
});

test('native server persists file-backed CRUD data inside the project directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-server-store-'));
  const entryPath = join(directory, 'app.naide');
  writeFileSync(entryPath, [
    'db "data/"',
    '',
    'schema Note:',
    '  id auto',
    '  text str required',
    '',
    'server app port 0:',
    '  crud "/notes" Note',
    '',
  ].join('\n'));

  let app;
  try {
    const first = await runNativeFileAsync(entryPath);
    app = first.globals.get('app');
    const port = app.server.address().port;
    const created = await fetch(`http://127.0.0.1:${port}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'persistent' }),
    });
    assert.equal(created.status, 201);
    const note = await created.json();
    await app.close();
    app = null;

    const second = await runNativeFileAsync(entryPath);
    app = second.globals.get('app');
    const list = await fetch(`http://127.0.0.1:${app.server.address().port}/notes`);
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).data, [note]);
    assert.ok(existsSync(join(directory, 'data', 'Note.json')));
    await app.close();
    app = null;

    writeFileSync(join(directory, 'data', 'Note.json'), '{invalid');
    await assert.rejects(runNativeFileAsync(entryPath), /contains invalid JSON/);
  } finally {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('default CLI runs a source file directly without emitting a JavaScript artifact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-cli-'));
  try {
    const sourcePath = join(directory, 'main.naide');
    writeFileSync(sourcePath, 'log "native output"\n');
    const result = spawnSync(process.execPath, [cliPath, sourcePath], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /native output/);
    assert.match(result.stdout, /Native NAIDE execution completed/);
    assert.deepEqual(readdirSync(directory).sort(), ['main.naide']);

    const directFlag = spawnSync(process.execPath, [cliPath, '--native', sourcePath], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(directFlag.status, 0, directFlag.stdout + directFlag.stderr);
    assert.match(directFlag.stdout, /native output/);
    assert.deepEqual(readdirSync(directory).sort(), ['main.naide']);

    const compilerGuardPath = join(directory, 'compiler-guard.mjs');
    writeFileSync(compilerGuardPath, [
      'export async function resolve(specifier, context, nextResolve) {',
      "  if (specifier.endsWith('/src/index.js')) throw new Error('Compiler module was loaded');",
      '  return nextResolve(specifier, context);',
      '}',
      '',
    ].join('\n'));
    const isolatedNative = spawnSync(process.execPath, [
      '--experimental-loader',
      pathToFileURL(compilerGuardPath).href,
      cliPath,
      sourcePath,
    ], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(isolatedNative.status, 0, isolatedNative.stdout + isolatedNative.stderr);
    assert.match(isolatedNative.stdout, /native output/);
    assert.doesNotMatch(isolatedNative.stderr, /Compiler module was loaded/);

    const repl = spawnSync(process.execPath, [cliPath], {
      cwd: resolve('.'),
      input: 'int answer = 40 + 2\nlog answer\n.exit\n',
      encoding: 'utf8',
    });
    assert.equal(repl.status, 0, repl.stdout + repl.stderr);
    assert.match(repl.stdout, /direct native execution/i);
    assert.match(repl.stdout, /42/);

    const compiledRun = spawnSync(process.execPath, [cliPath, '--compile', sourcePath], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(compiledRun.status, 0, compiledRun.stdout + compiledRun.stderr);
    assert.match(compiledRun.stdout, /native output/);
    assert.doesNotMatch(compiledRun.stdout, /Native NAIDE execution completed/);

    const limited = spawnSync(process.execPath, [
      cliPath, sourcePath, '--steps', '1',
    ], { cwd: resolve('.'), encoding: 'utf8' });
    assert.equal(limited.status, 1);
    assert.match(limited.stderr, /step limit \(1\) exceeded/);

    writeFileSync(sourcePath, [
      'fn.async result():',
      '  ret 42',
      'fn.async.gen answers():',
      '  yield await result()',
      'list values = await mapAsync(answers(), 1, (value) => value)',
      'log values[0]',
      '',
    ].join('\n'));
    const asyncRun = spawnSync(process.execPath, [cliPath, sourcePath], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(asyncRun.status, 0, asyncRun.stdout + asyncRun.stderr);
    assert.match(asyncRun.stdout, /42/);
    assert.match(asyncRun.stdout, /Native NAIDE execution completed/);

    writeFileSync(sourcePath, [
      'log runtime.args',
      'log runtime.env.get("NAIDE_TEST_VALUE")',
      'log runtime.env.has("NAIDE_TEST_SECRET")',
      'runtime.exitCode = 7',
      '',
    ].join('\n'));
    const withRuntimeOptions = spawnSync(process.execPath, [
      cliPath, sourcePath, '--env', 'NAIDE_TEST_VALUE', '--', 'alpha', 'beta',
    ], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NAIDE_TEST_VALUE: 'injected',
        NAIDE_TEST_SECRET: 'not-allowed-without-opt-in',
      },
    });
    assert.equal(withRuntimeOptions.status, 7, withRuntimeOptions.stdout + withRuntimeOptions.stderr);
    assert.match(withRuntimeOptions.stdout, /alpha.*beta/);
    assert.match(withRuntimeOptions.stdout, /injected/);
    assert.match(withRuntimeOptions.stdout, /false/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
