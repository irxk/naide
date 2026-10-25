import { spawnSync } from 'node:child_process';
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

const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));
assert.equal(ExportedNativeEngine, NativeEngine);
assert.equal(exportedRunNativeAsync, runNativeAsync);

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

test('native engine rejects JavaScript packages and unsafe NAIDE package entries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-package-errors-'));
  try {
    const entryPath = join(directory, 'main.naide');
    const packageDirectory = join(directory, 'node_modules', 'example-package');
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(entryPath, 'use example from "example-package"\n');
    writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'example-package', main: 'index.js' }));
    await assert.rejects(runNativeFileAsync(entryPath), /is not a NAIDE source package/);

    writeFileSync(join(packageDirectory, 'naide.pkg.json'), JSON.stringify({
      name: 'example-package',
      main: '../outside.naide',
    }));
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

test('native CLI runs a source file without emitting a JavaScript artifact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-cli-'));
  try {
    const sourcePath = join(directory, 'main.naide');
    writeFileSync(sourcePath, 'log "native output"\n');
    const result = spawnSync(process.execPath, [cliPath, 'native', sourcePath], {
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
      '--native',
      sourcePath,
    ], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(isolatedNative.status, 0, isolatedNative.stdout + isolatedNative.stderr);
    assert.match(isolatedNative.stdout, /native output/);
    assert.doesNotMatch(isolatedNative.stderr, /Compiler module was loaded/);

    const limited = spawnSync(process.execPath, [
      cliPath, 'native', sourcePath, '--steps', '1',
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
    const asyncRun = spawnSync(process.execPath, [cliPath, 'native', sourcePath], {
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
      cliPath, 'native', sourcePath, '--env', 'NAIDE_TEST_VALUE', '--', 'alpha', 'beta',
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
