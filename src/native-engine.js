import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { access, appendFile, readdir, realpath, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { arch as hostArch, cwd as hostCwd, platform as hostPlatform } from 'node:process';
import { Lexer } from './lexer.js';
import { Parser } from './parser.js';

const UNINITIALIZED = Symbol('uninitialized');

class ReturnSignal {
  constructor(value) { this.value = value; }
}

class BreakSignal {}
class ContinueSignal {}

class PromiseValue {
  constructor(promise) { this.promise = Promise.resolve(promise); }
}

class Environment {
  constructor(parent = null) {
    this.parent = parent;
    this.bindings = new Map();
  }

  define(name, value, mutable = false) {
    if (this.bindings.has(name)) throw new Error(`Name '${name}' is already defined in this scope.`);
    this.bindings.set(name, { value, mutable });
    return value;
  }

  find(name) {
    if (this.bindings.has(name)) return { environment: this, binding: this.bindings.get(name) };
    if (this.parent) return this.parent.find(name);
    throw new Error(`Unknown name '${name}'.`);
  }

  get(name) {
    const { binding } = this.find(name);
    if (binding.value === UNINITIALIZED) throw new Error(`'${name}' was used before it was initialized.`);
    return binding.value;
  }

  assign(name, value) {
    const { binding } = this.find(name);
    if (!binding.mutable) throw new Error(`Cannot reassign immutable binding '${name}'. Declare it with 'mut'.`);
    binding.value = value;
    return value;
  }
}

function toBoolean(value) {
  return Boolean(value);
}

function parseNumber(value) {
  const normalized = String(value).replaceAll('_', '');
  if (normalized.endsWith('n')) return BigInt(normalized.slice(0, -1));
  return Number(normalized);
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export class NativeEngine {
  constructor({
    globals = {},
    output = console,
    maxSteps = 1_000_000,
    maxCallDepth = 512,
    sourceFile = null,
    moduleLoader = path => readFileSync(path, 'utf8'),
    io = null,
    http = null,
    runtime = {},
  } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new RangeError('maxSteps must be a positive safe integer.');
    if (!Number.isSafeInteger(maxCallDepth) || maxCallDepth < 1) throw new RangeError('maxCallDepth must be a positive safe integer.');
    if (globals && Object.hasOwn(globals, 'io')) {
      throw new TypeError("Pass the native engine I/O capability through the 'io' option, not 'globals.io'.");
    }
    if (globals && Object.hasOwn(globals, 'http')) {
      throw new TypeError("Pass the native engine HTTP capability through the 'http' option, not 'globals.http'.");
    }
    if (globals && Object.hasOwn(globals, 'task')) {
      throw new TypeError("'task' is a native engine built-in and cannot be replaced through 'globals.task'.");
    }
    if (globals && Object.hasOwn(globals, 'runtime')) {
      throw new TypeError("'runtime' is a native engine built-in and cannot be replaced through 'globals.runtime'.");
    }
    this.maxSteps = maxSteps;
    this.maxCallDepth = maxCallDepth;
    this.steps = 0;
    this.callDepth = 0;
    this.output = output;
    this.sourceFile = sourceFile ? resolve(sourceFile) : null;
    this.moduleLoader = moduleLoader;
    this.io = io == null ? this.createIO() : this.validateIO(io);
    this.http = http == null ? this.createHTTP() : this.validateHTTP(http);
    this.runtime = this.createRuntime(runtime);
    this.builtins = new Environment();
    this.global = new Environment(this.builtins);
    this.modulePaths = new WeakMap();
    this.modulePaths.set(this.global, this.sourceFile);
    this.moduleCache = new Map();
    this.moduleLoading = new Set();
    this.moduleLoads = new Map();
    this.moduleAncestors = new Map();
    if (this.sourceFile) this.moduleAncestors.set(this.sourceFile, []);
    this.installGlobals(globals);
  }

  installGlobals(globals) {
    const builtins = {
      abs: Math.abs,
      ceil: Math.ceil,
      floor: Math.floor,
      round: Math.round,
      min: Math.min,
      max: Math.max,
      sqrt: Math.sqrt,
      pow: Math.pow,
      len: value => value?.length ?? Object.keys(value ?? {}).length,
      str: value => String(value),
      int: value => Math.trunc(Number(value)),
      num: value => Number(value),
      bool: value => Boolean(value),
      range: (start, end, step = 1) => {
        const first = end === undefined ? 0 : start;
        const last = end === undefined ? start : end;
        if (!Number.isFinite(first) || !Number.isFinite(last) || !Number.isFinite(step)) {
          throw new TypeError('range arguments must be finite numbers.');
        }
        if (step === 0) throw new RangeError('range step cannot be zero.');
        const values = [];
        for (let value = first; step > 0 ? value < last : value > last; value += step) {
          values.push(value);
          if (values.length > this.maxSteps) throw new RangeError('range exceeded the native engine step limit.');
        }
        return values;
      },
      map: (items, callback) => Array.from(this.iterable(items), callback),
      filter: (items, callback) => Array.from(this.iterable(items)).filter(callback),
      reduce: (items, callback, ...initial) => {
        const values = Array.from(this.iterable(items));
        return initial.length ? values.reduce(callback, initial[0]) : values.reduce(callback);
      },
      find: (items, callback) => {
        if (typeof callback !== 'function') throw new TypeError('find expects a function callback.');
        for (const [index, value] of this.enumerateIterable(items)) {
          if (callback(value, index)) return value;
        }
        return undefined;
      },
      some: (items, callback) => {
        if (typeof callback !== 'function') throw new TypeError('some expects a function callback.');
        for (const [index, value] of this.enumerateIterable(items)) {
          if (callback(value, index)) return true;
        }
        return false;
      },
      every: (items, callback) => {
        if (typeof callback !== 'function') throw new TypeError('every expects a function callback.');
        for (const [index, value] of this.enumerateIterable(items)) {
          if (!callback(value, index)) return false;
        }
        return true;
      },
      flatMap: (items, callback) => Array.from(this.iterable(items)).flatMap(callback),
      unique: items => [...new Set(this.iterable(items))],
      enumerate: items => Array.from(this.iterable(items), (value, index) => [index, value]),
      first: (items, ...fallback) => {
        for (const value of this.iterable(items)) return value;
        return fallback[0];
      },
      take: (items, count) => {
        this.validateCollectionCount(count, 'take');
        const values = [];
        if (count === 0) return values;
        for (const value of this.iterable(items)) {
          values.push(value);
          if (values.length === count) break;
        }
        return values;
      },
      takeWhile: (items, callback) => {
        if (typeof callback !== 'function') throw new TypeError('takeWhile expects a function callback.');
        const values = [];
        let index = 0;
        for (const value of this.iterable(items)) {
          if (!callback(value, index++)) break;
          values.push(value);
        }
        return values;
      },
      drop: (items, count) => {
        this.validateCollectionCount(count, 'drop');
        const values = [];
        let skipped = 0;
        for (const value of this.iterable(items)) {
          if (skipped < count) skipped++;
          else values.push(value);
        }
        return values;
      },
      zip: (...items) => this.zip(items),
      chunk: (items, size) => this.chunk(items, size),
      partition: (items, callback) => this.partition(items, callback),
      groupBy: (items, callback) => this.groupBy(items, callback),
      count: (items, ...predicate) => this.count(items, predicate),
      sum: items => {
        const values = Array.from(this.iterable(items));
        return values.length ? values.slice(1).reduce((total, value) => total + value, values[0]) : 0;
      },
      mapAsync: (items, concurrency, callback) => this.mapAsync(items, concurrency, callback),
      filterAsync: (items, concurrency, callback) => this.filterAsync(items, concurrency, callback),
      reduceAsync: (items, callback, ...initial) => this.reduceAsync(items, callback, initial),
      forEachAsync: (items, concurrency, callback) => this.forEachAsync(items, concurrency, callback),
      findAsync: (items, callback) => this.findAsync(items, callback),
      someAsync: (items, callback) => this.someAsync(items, callback),
      everyAsync: (items, callback) => this.everyAsync(items, callback),
      takeAsync: (items, count) => this.takeAsync(items, count),
      takeWhileAsync: (items, callback) => this.takeWhileAsync(items, callback),
      firstAsync: (items, ...fallback) => this.firstAsync(items, fallback),
      zipAsync: (...items) => this.zipAsync(items),
      chunkAsync: (items, size) => this.chunkAsync(items, size),
      partitionAsync: (items, callback) => this.partitionAsync(items, callback),
      groupByAsync: (items, callback) => this.groupByAsync(items, callback),
      countAsync: (items, ...predicate) => this.countAsync(items, predicate),
      uniqueAsync: items => this.uniqueAsync(items),
      log: (...values) => this.output.log(...values),
      print: (...values) => this.output.log(...values),
      Math,
      JSON,
      Number,
      String,
      Boolean,
      BigInt,
      Array,
      Object,
      Map,
      Set,
      Error,
      TypeError,
      RangeError,
      console: this.output,
      io: this.io,
      http: this.http,
      task: this.createTask(),
      runtime: this.runtime,
      ...globals,
    };
    for (const [name, value] of Object.entries(builtins)) {
      this.builtins.define(name, value);
    }
  }

  iterable(value) {
    if (value == null || typeof value[Symbol.iterator] !== 'function') {
      throw new TypeError('Value is not synchronously iterable.');
    }
    const engine = this;
    return (function* boundedIterable() {
      const iterator = value[Symbol.iterator]();
      let completed = false;
      try {
        while (true) {
          engine.tick();
          const step = iterator.next();
          if (!step || typeof step !== 'object') {
            throw new TypeError('Iterator result must be an object.');
          }
          if (step.done) {
            completed = true;
            return step.value;
          }
          yield step.value;
        }
      } finally {
        if (!completed && typeof iterator.return === 'function') iterator.return();
      }
    }());
  }

  *enumerateIterable(value) {
    let index = 0;
    for (const item of this.iterable(value)) yield [index++, item];
  }

  validateCollectionCount(count, operation) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(`${operation} count must be a non-negative safe integer.`);
    }
  }

  validateCollectionSize(size, operation) {
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new RangeError(`${operation} size must be a positive safe integer.`);
    }
  }

  validateCollectionCallback(callback, operation) {
    if (typeof callback !== 'function') {
      throw new TypeError(`${operation} expects a function callback.`);
    }
  }

  zip(items) {
    const iterators = items.map(item => this.iterable(item)[Symbol.iterator]());
    const result = [];
    try {
      while (iterators.length > 0) {
        const row = [];
        for (const iterator of iterators) {
          const step = iterator.next();
          if (step.done) return result;
          row.push(step.value);
        }
        result.push(row);
      }
      return result;
    } finally {
      for (const iterator of iterators) {
        if (typeof iterator.return === 'function') iterator.return();
      }
    }
  }

  chunk(items, size) {
    this.validateCollectionSize(size, 'chunk');
    const result = [];
    let current = [];
    for (const value of this.iterable(items)) {
      current.push(value);
      if (current.length === size) {
        result.push(current);
        current = [];
      }
    }
    if (current.length > 0) result.push(current);
    return result;
  }

  partition(items, callback) {
    this.validateCollectionCallback(callback, 'partition');
    const included = [];
    const excluded = [];
    let index = 0;
    for (const value of this.iterable(items)) {
      (callback(value, index++) ? included : excluded).push(value);
    }
    return [included, excluded];
  }

  groupBy(items, callback) {
    this.validateCollectionCallback(callback, 'groupBy');
    const groups = new Map();
    let index = 0;
    for (const value of this.iterable(items)) {
      const key = callback(value, index++);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(value);
    }
    return groups;
  }

  count(items, predicate) {
    if (predicate.length > 0) this.validateCollectionCallback(predicate[0], 'count');
    let result = 0;
    let index = 0;
    for (const value of this.iterable(items)) {
      if (predicate.length === 0 || predicate[0](value, index)) result++;
      index++;
    }
    return result;
  }

  async collectAsyncIterable(value) {
    if (value == null) throw new TypeError('Value is not iterable.');
    const asyncIterator = value[Symbol.asyncIterator];
    if (typeof asyncIterator !== 'function') return Array.from(this.iterable(value));
    const iterator = asyncIterator.call(value);
    const values = [];
    let completed = false;
    try {
      while (true) {
        this.tick();
        const step = await iterator.next();
        if (!step || typeof step !== 'object') {
          throw new TypeError('Async iterator result must be an object.');
        }
        if (step.done) {
          completed = true;
          return values;
        }
        values.push(step.value);
      }
    } finally {
      if (!completed && typeof iterator.return === 'function') await iterator.return();
    }
  }

  async mapAsync(items, concurrency, callback) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new RangeError('Async collection concurrency must be a positive safe integer.');
    }
    if (typeof callback !== 'function') throw new TypeError('Async collection callback must be a function.');
    const values = await this.collectAsyncIterable(items);
    const results = new Array(values.length);
    const errors = [];
    let nextIndex = 0;
    let stopped = false;
    const worker = async () => {
      while (!stopped) {
        const index = nextIndex++;
        if (index >= values.length) return;
        try {
          this.tick();
          results[index] = await callback(values[index], index);
        } catch (error) {
          errors.push({ index, error });
          stopped = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
    if (errors.length) {
      errors.sort((left, right) => left.index - right.index);
      throw errors[0].error;
    }
    return results;
  }

  async filterAsync(items, concurrency, callback) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new RangeError('Async collection concurrency must be a positive safe integer.');
    }
    if (typeof callback !== 'function') throw new TypeError('Async collection callback must be a function.');
    const values = await this.collectAsyncIterable(items);
    const included = await this.mapAsync(values, concurrency, callback);
    return values.filter((_value, index) => included[index]);
  }

  async reduceAsync(items, callback, initial) {
    if (typeof callback !== 'function') throw new TypeError('Async collection callback must be a function.');
    const values = await this.collectAsyncIterable(items);
    if (values.length === 0 && initial.length === 0) {
      throw new TypeError('Reduce of empty iterable with no initial value.');
    }
    let index = initial.length ? 0 : 1;
    let accumulator = initial.length ? initial[0] : values[0];
    for (; index < values.length; index++) {
      accumulator = await callback(accumulator, values[index], index);
    }
    return accumulator;
  }

  async forEachAsync(items, concurrency, callback) {
    await this.mapAsync(items, concurrency, callback);
  }

  async findAsync(items, callback) {
    if (typeof callback !== 'function') throw new TypeError('Async collection callback must be a function.');
    let index = 0;
    for await (const value of this.asyncIterable(items)) {
      if (await callback(value, index++)) return value;
    }
    return undefined;
  }

  async someAsync(items, callback) {
    if (typeof callback !== 'function') throw new TypeError('Async collection callback must be a function.');
    let index = 0;
    for await (const value of this.asyncIterable(items)) {
      if (await callback(value, index++)) return true;
    }
    return false;
  }

  async everyAsync(items, callback) {
    if (typeof callback !== 'function') throw new TypeError('Async collection callback must be a function.');
    let index = 0;
    for await (const value of this.asyncIterable(items)) {
      if (!await callback(value, index++)) return false;
    }
    return true;
  }

  async takeAsync(items, count) {
    this.validateCollectionCount(count, 'takeAsync');
    const values = [];
    if (count === 0) return values;
    for await (const value of this.asyncIterable(items)) {
      values.push(value);
      if (values.length === count) break;
    }
    return values;
  }

  async takeWhileAsync(items, callback) {
    if (typeof callback !== 'function') throw new TypeError('Async collection callback must be a function.');
    const values = [];
    let index = 0;
    for await (const value of this.asyncIterable(items)) {
      if (!await callback(value, index++)) break;
      values.push(value);
    }
    return values;
  }

  async firstAsync(items, fallback) {
    for await (const value of this.asyncIterable(items)) return value;
    return fallback[0];
  }

  async zipAsync(items) {
    for (const item of items) {
      if (item == null
        || (typeof item[Symbol.asyncIterator] !== 'function'
          && typeof item[Symbol.iterator] !== 'function')) {
        throw new TypeError('Value is not asynchronously iterable.');
      }
    }
    const iterators = items.map(item => this.asyncIterable(item)[Symbol.asyncIterator]());
    const result = [];
    try {
      while (iterators.length > 0) {
        const row = [];
        for (const iterator of iterators) {
          const step = await iterator.next();
          if (step.done) return result;
          row.push(step.value);
        }
        result.push(row);
      }
      return result;
    } finally {
      for (const iterator of iterators) {
        if (typeof iterator.return === 'function') await iterator.return();
      }
    }
  }

  async chunkAsync(items, size) {
    this.validateCollectionSize(size, 'chunkAsync');
    const result = [];
    let current = [];
    for await (const value of this.asyncIterable(items)) {
      current.push(value);
      if (current.length === size) {
        result.push(current);
        current = [];
      }
    }
    if (current.length > 0) result.push(current);
    return result;
  }

  async partitionAsync(items, callback) {
    this.validateCollectionCallback(callback, 'partitionAsync');
    const included = [];
    const excluded = [];
    let index = 0;
    for await (const value of this.asyncIterable(items)) {
      (await callback(value, index++) ? included : excluded).push(value);
    }
    return [included, excluded];
  }

  async groupByAsync(items, callback) {
    this.validateCollectionCallback(callback, 'groupByAsync');
    const groups = new Map();
    let index = 0;
    for await (const value of this.asyncIterable(items)) {
      const key = await callback(value, index++);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(value);
    }
    return groups;
  }

  async countAsync(items, predicate) {
    if (predicate.length > 0) this.validateCollectionCallback(predicate[0], 'countAsync');
    let result = 0;
    let index = 0;
    for await (const value of this.asyncIterable(items)) {
      if (predicate.length === 0 || await predicate[0](value, index)) result++;
      index++;
    }
    return result;
  }

  async uniqueAsync(items) {
    const seen = new Set();
    const result = [];
    for await (const value of this.asyncIterable(items)) {
      if (seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  validateIO(io) {
    const methods = ['readText', 'writeText', 'appendText', 'exists', 'listDir'];
    if (!io || methods.some(method => typeof io[method] !== 'function')) {
      throw new TypeError(`Native engine io capability must provide ${methods.join(', ')} methods.`);
    }
    return io;
  }

  createIO() {
    return Object.freeze({
      readText: async path => readFile(await this.resolveIOPath(path), 'utf8'),
      writeText: async (path, text) => {
        if (typeof text !== 'string') throw new TypeError('io.writeText expects text as a string.');
        await writeFile(await this.resolveIOPath(path, true), text, 'utf8');
      },
      appendText: async (path, text) => {
        if (typeof text !== 'string') throw new TypeError('io.appendText expects text as a string.');
        await appendFile(await this.resolveIOPath(path, true), text, 'utf8');
      },
      exists: async path => {
        const resolvedPath = await this.resolveIOPath(path, true);
        try {
          await access(resolvedPath);
          return true;
        } catch (error) {
          if (error.code === 'ENOENT') return false;
          throw error;
        }
      },
      listDir: async path => readdir(await this.resolveIOPath(path)),
    });
  }

  validateHTTP(http) {
    const methods = ['request', 'get', 'post'];
    if (!http || methods.some(method => typeof http[method] !== 'function')) {
      throw new TypeError(`Native engine http capability must provide ${methods.join(', ')} methods.`);
    }
    return http;
  }

  createRuntime(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Native engine runtime options must be an object.');
    }
    const args = options.args ?? [];
    const env = options.env ?? {};
    const cwd = options.cwd ?? hostCwd();
    const platform = options.platform ?? hostPlatform;
    const architecture = options.arch ?? hostArch;
    if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
      throw new TypeError('Native engine runtime args must be a list of strings.');
    }
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      throw new TypeError('Native engine runtime env must be an object of explicitly allowed values.');
    }
    if (typeof cwd !== 'string' || typeof platform !== 'string' || typeof architecture !== 'string') {
      throw new TypeError('Native engine runtime cwd, platform, and arch must be strings.');
    }
    const allowedEnvironment = Object.create(null);
    for (const [name, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new TypeError(`Invalid environment variable name '${name}'.`);
      if (typeof value !== 'string') throw new TypeError(`Environment variable '${name}' must be a string.`);
      allowedEnvironment[name] = value;
    }
    const environment = Object.freeze({
      get: name => Object.hasOwn(allowedEnvironment, name) ? allowedEnvironment[name] : undefined,
      has: name => Object.hasOwn(allowedEnvironment, name),
      keys: () => Object.keys(allowedEnvironment),
    });
    const state = { exitCode: 0 };
    const runtime = {
      args: Object.freeze([...args]),
      env: environment,
      cwd: resolve(cwd),
      platform,
      arch: architecture,
    };
    Object.defineProperty(runtime, 'exitCode', {
      enumerable: true,
      get: () => state.exitCode,
      set: value => {
        if (!Number.isInteger(value) || value < 0 || value > 255) {
          throw new RangeError('runtime.exitCode must be an integer between 0 and 255.');
        }
        state.exitCode = value;
      },
    });
    return Object.freeze(runtime);
  }

  createHTTP() {
    if (typeof globalThis.fetch !== 'function') {
      throw new Error('Native engine HTTP requires a host fetch implementation; pass the http option.');
    }
    const request = (url, options = {}) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch (error) {
        throw new TypeError(`Native engine HTTP requires an absolute HTTP(S) URL: ${error.message}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new TypeError(`Native engine HTTP does not support the '${parsed.protocol}' protocol.`);
      }
      if (options == null || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('Native engine http.request options must be an object.');
      }
      return globalThis.fetch(parsed, options);
    };
    return Object.freeze({
      request,
      get: (url, options = {}) => request(url, { ...options, method: 'GET' }),
      post: (url, body, options = {}) => request(url, { ...options, method: 'POST', body }),
    });
  }

  createTask() {
    const validateSignal = signal => {
      if (signal !== undefined && (
        signal === null
        || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function'
        || typeof signal.removeEventListener !== 'function'
      )) {
        throw new TypeError('Expected an AbortSignal.');
      }
      return signal;
    };
    return Object.freeze({
      spawn: (callback, ...args) => {
        if (typeof callback !== 'function') throw new TypeError('task.spawn expects a function.');
        return Promise.resolve().then(() => callback(...args));
      },
      all: tasks => Promise.all(this.unwrapTasks(tasks)),
      race: tasks => Promise.race(this.unwrapTasks(tasks)),
      channel: capacity => this.createChannel(capacity),
      controller: () => {
        const controller = new AbortController();
        return Object.freeze({
          signal: controller.signal,
          cancel: reason => controller.abort(reason),
        });
      },
      isCancelled: signal => Boolean(validateSignal(signal)?.aborted),
      throwIfCancelled: signal => {
        const validated = validateSignal(signal);
        if (validated?.aborted) {
          throw validated.reason ?? new Error('Task was cancelled.');
        }
      },
      withTimeout: async (callback, milliseconds, ...args) => {
        if (typeof callback !== 'function') throw new TypeError('task.withTimeout expects a function.');
        if (!Number.isFinite(milliseconds) || milliseconds < 0) {
          throw new RangeError('task.withTimeout duration must be a finite non-negative number.');
        }
        const controller = new AbortController();
        let timer;
        const timeout = new Promise((resolveTimeout, rejectTimeout) => {
          timer = setTimeout(() => {
            const error = new Error(`Task timed out after ${milliseconds} ms.`);
            error.name = 'TimeoutError';
            controller.abort(error);
            rejectTimeout(error);
          }, milliseconds);
        });
        const work = Promise.resolve().then(() => callback(...args, controller.signal));
        try {
          return await Promise.race([work, timeout]);
        } finally {
          clearTimeout(timer);
        }
      },
      map: async (items, concurrency, callback) => {
        if (!Array.isArray(items)) throw new TypeError('task.map expects a list of items.');
        if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
          throw new RangeError('task.map concurrency must be a positive safe integer.');
        }
        if (typeof callback !== 'function') throw new TypeError('task.map expects a function callback.');
        const results = new Array(items.length);
        let nextIndex = 0;
        let failed = false;
        let failure;
        const worker = async () => {
          while (!failed) {
            const index = nextIndex++;
            if (index >= items.length) return;
            try {
              results[index] = await callback(items[index], index);
            } catch (error) {
              failed = true;
              failure = error;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
        if (failed) throw failure;
        return results;
      },
      sleep: (milliseconds, signal) => {
        if (!Number.isFinite(milliseconds) || milliseconds < 0) {
          throw new RangeError('task.sleep duration must be a finite non-negative number.');
        }
        const validatedSignal = validateSignal(signal);
        if (validatedSignal?.aborted) {
          return Promise.reject(validatedSignal.reason ?? new Error('Task was cancelled.'));
        }
        return new Promise((resolveSleep, rejectSleep) => {
          const onAbort = () => {
            clearTimeout(timer);
            rejectSleep(validatedSignal.reason ?? new Error('Task was cancelled.'));
          };
          const timer = setTimeout(() => {
            validatedSignal?.removeEventListener('abort', onAbort);
            resolveSleep();
          }, milliseconds);
          validatedSignal?.addEventListener('abort', onAbort, { once: true });
        });
      },
    });
  }

  createChannel(capacity = 0) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError('task.channel capacity must be a non-negative safe integer.');
    }
    const buffer = [];
    const receivers = [];
    const senders = [];
    let closed = false;

    const result = (value, done = false) => Object.freeze({ value, done });
    const makeClosedError = () => new Error('Cannot send to a closed task channel.');
    const settleReceiver = (receiver, item) => receiver.resolve(result(item));
    const validateSignal = signal => {
      if (signal !== undefined && (
        signal === null
        || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function'
        || typeof signal.removeEventListener !== 'function'
      )) {
        throw new TypeError('Expected an AbortSignal.');
      }
      return signal;
    };
    const wait = (queue, entry, signal) => new Promise((resolvePromise, rejectPromise) => {
      const settle = (handler, value) => {
        if (entry.abortListener) signal?.removeEventListener('abort', entry.abortListener);
        const index = queue.indexOf(entry);
        if (index !== -1) queue.splice(index, 1);
        handler(value);
      };
      entry.resolve = value => settle(resolvePromise, value);
      entry.reject = error => settle(rejectPromise, error);
      entry.signal = signal;
      if (signal?.aborted) {
        entry.reject(signal.reason ?? new Error('Task was cancelled.'));
        return;
      }
      if (signal) {
        entry.abortListener = () => entry.reject(signal.reason ?? new Error('Task was cancelled.'));
        signal.addEventListener('abort', entry.abortListener, { once: true });
      }
      queue.push(entry);
    });

    const channel = {
      async send(value, signal) {
        const validatedSignal = validateSignal(signal);
        if (validatedSignal?.aborted) throw validatedSignal.reason ?? new Error('Task was cancelled.');
        if (closed) throw makeClosedError();
        const receiver = receivers.shift();
        if (receiver) {
          settleReceiver(receiver, value);
          return;
        }
        if (buffer.length < capacity) {
          buffer.push(value);
          return;
        }
        const sender = { value };
        await wait(senders, sender, validatedSignal);
      },
      async receive(signal) {
        const validatedSignal = validateSignal(signal);
        if (validatedSignal?.aborted) throw validatedSignal.reason ?? new Error('Task was cancelled.');
        if (buffer.length > 0) {
          const value = buffer.shift();
          if (senders.length > 0 && !closed) {
            const sender = senders[0];
            buffer.push(sender.value);
            sender.resolve();
          }
          return result(value, false);
        }
        if (senders.length > 0 && !closed) {
          const sender = senders.shift();
          sender.resolve();
          return result(sender.value, false);
        }
        if (closed) return result(undefined, true);
        const receiver = {};
        return wait(receivers, receiver, validatedSignal);
      },
      close() {
        if (closed) return false;
        closed = true;
        for (const sender of [...senders]) sender.reject(makeClosedError());
        if (buffer.length === 0) {
          for (const receiver of [...receivers]) receiver.resolve(result(undefined, true));
        }
        return true;
      },
      get closed() { return closed; },
    };

    return Object.freeze(channel);
  }

  unwrapTasks(tasks) {
    if (!Array.isArray(tasks)) throw new TypeError('task.all and task.race expect a list of tasks.');
    return tasks.map(task => this.unwrapPromiseValue(task));
  }

  async resolveIOPath(path, allowMissing = false) {
    if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) {
      throw new TypeError('Native engine io paths must be non-empty relative paths.');
    }
    const root = await realpath(dirname(this.sourceFile || resolve('.')));
    const candidate = resolve(root, path);
    const relativePath = relative(root, candidate);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error(`Native engine io path escapes the project directory: '${path}'.`);
    }

    let probe = candidate;
    while (true) {
      try {
        const actualPath = await realpath(probe);
        const actualRelativePath = relative(root, actualPath);
        if (actualRelativePath === '..' || actualRelativePath.startsWith(`..${sep}`) || isAbsolute(actualRelativePath)) {
          throw new Error(`Native engine io path escapes the project directory through a symbolic link: '${path}'.`);
        }
        break;
      } catch (error) {
        if (!allowMissing || error.code !== 'ENOENT') throw error;
        const parent = dirname(probe);
        if (parent === probe) throw error;
        probe = parent;
      }
    }
    return candidate;
  }

  tick(node) {
    this.steps++;
    if (this.steps > this.maxSteps) {
      const line = node?._line ? ` at line ${node._line}` : '';
      throw new Error(`Native engine step limit (${this.maxSteps}) exceeded${line}.`);
    }
  }

  execute(sourceOrAst) {
    const ast = typeof sourceOrAst === 'string' ? this.parse(sourceOrAst) : sourceOrAst;
    if (ast?.type !== 'Program') throw new TypeError('NativeEngine.execute expects NAIDE source or a Program AST.');
    try {
      this.executeStatements(ast.body, this.global);
    } catch (signal) {
      if (signal instanceof ReturnSignal) throw new Error("'ret' is only valid inside a function.");
      if (signal instanceof BreakSignal || signal instanceof ContinueSignal) {
        throw new Error('Loop control is only valid inside a loop.');
      }
      throw this.formatExecutionError(signal);
    }
    return { steps: this.steps, globals: this.global };
  }

  executeFile(filePath) {
    const path = resolve(filePath);
    if (extname(path) !== '.naide') throw new Error('Native engine file entry must have a .naide extension.');
    this.sourceFile = path;
    this.modulePaths.set(this.global, path);
    return this.execute(this.moduleLoader(path));
  }

  async executeAsync(sourceOrAst) {
    const ast = typeof sourceOrAst === 'string' ? this.parse(sourceOrAst) : sourceOrAst;
    if (ast?.type !== 'Program') throw new TypeError('NativeEngine.executeAsync expects NAIDE source or a Program AST.');
    try {
      await this.executeAsyncStatements(ast.body, this.global);
    } catch (error) {
      throw this.formatExecutionError(error);
    }
    return { steps: this.steps, globals: this.global };
  }

  async executeFileAsync(filePath) {
    const path = resolve(filePath);
    if (extname(path) !== '.naide') throw new Error('Native engine file entry must have a .naide extension.');
    this.sourceFile = path;
    this.modulePaths.set(this.global, path);
    return this.executeAsync(this.moduleLoader(path));
  }

  parse(source) {
    const tokens = new Lexer(source).tokenize();
    return new Parser(tokens).parse();
  }

  executeStatements(statements, environment) {
    for (const statement of statements) {
      try {
        this.tick(statement);
        this.executeStatement(statement, environment);
      } catch (error) {
        if (error instanceof ReturnSignal || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
        const line = statement._line;
        if (line) {
          if (error instanceof Error && !error.message.includes(`NAIDE line ${line}`)) {
            error.message = `${error.message} (NAIDE line ${line})`;
          }
          this.addErrorFrame(error, { file: this.findModulePath(environment), line });
        }
        throw error;
      }
    }
  }

  *executeGeneratorStatements(statements, environment) {
    for (const statement of statements) {
      try {
        this.tick(statement);
        yield* this.executeGeneratorStatement(statement, environment);
      } catch (error) {
        if (error instanceof ReturnSignal || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
        const line = statement._line;
        if (line) {
          if (error instanceof Error && !error.message.includes(`NAIDE line ${line}`)) {
            error.message = `${error.message} (NAIDE line ${line})`;
          }
          this.addErrorFrame(error, { file: this.findModulePath(environment), line });
        }
        throw error;
      }
    }
  }

  *executeGeneratorStatement(node, environment) {
    switch (node.type) {
      case 'ExprStatement':
        if (node.expression.type === 'Yield') {
          yield* this.evaluateYield(node.expression, environment);
          return;
        }
        this.evaluate(node.expression, environment);
        return;
      case 'Return':
        throw new ReturnSignal(node.value ? this.evaluate(node.value, environment) : undefined);
      case 'If': {
        if (toBoolean(this.evaluate(node.condition, environment))) {
          yield* this.executeGeneratorStatements(node.body, new Environment(environment));
          return;
        }
        for (const branch of node.elifs || []) {
          if (toBoolean(this.evaluate(branch.condition, environment))) {
            yield* this.executeGeneratorStatements(branch.body, new Environment(environment));
            return;
          }
        }
        if (node.elseBody) yield* this.executeGeneratorStatements(node.elseBody, new Environment(environment));
        return;
      }
      case 'Each':
      case 'ForEach': {
        const collection = this.evaluate(node.collection || node.iterable, environment);
        if (collection == null) throw new TypeError('Cannot iterate over null or undefined.');
        let entries = node.type === 'Each' && node.key
          ? collection instanceof Map
            ? collection.entries()
            : collection instanceof Set
              ? Array.from(collection, (value, index) => [index, value])
              : Array.isArray(collection) || typeof collection === 'string'
                ? Array.from(collection, (value, index) => [index, value])
                : Object.entries(collection)
          : node.type === 'ForEach' && node.iteration === 'in'
            ? Object.keys(collection)
            : collection;
        if (node.type === 'ForEach' && node.isAsync) {
          throw new Error("'for await' is not available in a synchronous generator.");
        }
        for (const entry of entries) {
          this.tick(node);
          const scope = new Environment(environment);
          if (node.type === 'Each' && node.key) {
            scope.define(node.key, entry[0]);
            scope.define(node.value, entry[1]);
          } else {
            scope.define(node.type === 'Each' ? node.value : node.varName, entry);
          }
          try {
            yield* this.executeGeneratorStatements(node.body, scope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
        }
        return;
      }
      case 'For': {
        const start = this.evaluate(node.start, environment);
        const end = this.evaluate(node.end, environment);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          throw new TypeError('Native range bounds must be finite numbers.');
        }
        for (let value = start; value < end;) {
          this.tick(node);
          const scope = new Environment(environment);
          scope.define(node.varName, value, true);
          try {
            yield* this.executeGeneratorStatements(node.body, scope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
          value = scope.get(node.varName) + 1;
        }
        return;
      }
      case 'While':
      case 'DoWhile': {
        do {
          if (node.type === 'While' && !toBoolean(this.evaluate(node.condition, environment))) break;
          this.tick(node);
          try {
            yield* this.executeGeneratorStatements(node.body, new Environment(environment));
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
        } while (node.type === 'DoWhile' || toBoolean(this.evaluate(node.condition, environment)));
        return;
      }
      case 'Function':
      case 'Model':
      case 'EnumDecl':
        this.executeStatement(node, environment);
        return;
      default:
        if (this.containsYield(node)) {
          throw new Error('Native generators support yield as an expression statement; nested yield expressions are not supported yet.');
        }
        this.executeStatement(node, environment);
    }
  }

  *evaluateYield(node, environment) {
    const value = node.value ? this.evaluate(node.value, environment) : undefined;
    if (node.delegate) return yield* this.iterable(value);
    return yield value;
  }

  async *asyncIterable(value) {
    if (value == null) throw new TypeError('Value is not iterable.');
    const asyncIterator = value[Symbol.asyncIterator];
    const iterator = typeof asyncIterator === 'function'
      ? asyncIterator.call(value)
      : this.iterable(value)[Symbol.iterator]();
    let completed = false;
    try {
      while (true) {
        this.tick();
        const step = await iterator.next();
        if (!step || typeof step !== 'object') {
          throw new TypeError('Iterator result must be an object.');
        }
        if (step.done) {
          completed = true;
          return step.value;
        }
        yield step.value;
      }
    } finally {
      if (!completed && typeof iterator.return === 'function') await iterator.return();
    }
  }

  async *executeAsyncGeneratorStatements(statements, environment) {
    for (const statement of statements) {
      try {
        this.tick(statement);
        yield* this.executeAsyncGeneratorStatement(statement, environment);
      } catch (error) {
        if (error instanceof ReturnSignal || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
        const line = statement._line;
        if (line) {
          if (error instanceof Error && !error.message.includes(`NAIDE line ${line}`)) {
            error.message = `${error.message} (NAIDE line ${line})`;
          }
          this.addErrorFrame(error, { file: this.findModulePath(environment), line });
        }
        throw error;
      }
    }
  }

  async *executeAsyncGeneratorStatement(node, environment) {
    switch (node.type) {
      case 'ExprStatement':
        if (node.expression.type === 'Yield') {
          yield* this.evaluateAsyncYield(node.expression, environment);
          return;
        }
        await this.evaluateAsync(node.expression, environment);
        return;
      case 'Return':
        throw new ReturnSignal(node.value ? await this.evaluateAsync(node.value, environment) : undefined);
      case 'If': {
        if (toBoolean(await this.evaluateAsync(node.condition, environment))) {
          yield* this.executeAsyncGeneratorStatements(node.body, new Environment(environment));
          return;
        }
        for (const branch of node.elifs || []) {
          if (toBoolean(await this.evaluateAsync(branch.condition, environment))) {
            yield* this.executeAsyncGeneratorStatements(branch.body, new Environment(environment));
            return;
          }
        }
        if (node.elseBody) yield* this.executeAsyncGeneratorStatements(node.elseBody, new Environment(environment));
        return;
      }
      case 'Each':
      case 'ForEach': {
        const collection = await this.evaluateAsync(node.collection || node.iterable, environment);
        if (collection == null) throw new TypeError('Cannot iterate over null or undefined.');
        let entries;
        if (node.type === 'Each' && node.key && collection && typeof collection[Symbol.asyncIterator] === 'function') {
          entries = (async function* (engine) {
            let index = 0;
            for await (const value of engine.asyncIterable(collection)) yield [index++, value];
          }(this));
        } else if (node.type === 'Each' && node.key) {
          entries = collection instanceof Map
            ? collection.entries()
            : collection instanceof Set
              ? Array.from(collection, (value, index) => [index, value])
              : Array.isArray(collection) || typeof collection === 'string'
                ? Array.from(collection, (value, index) => [index, value])
                : Object.entries(collection);
        } else if (node.type === 'ForEach' && node.iteration === 'in') {
          entries = Object.keys(collection);
        } else {
          entries = node.type === 'ForEach' && !node.isAsync
            ? this.iterable(collection)
            : this.asyncIterable(collection);
        }
        for await (const entry of this.asyncIterable(entries)) {
          this.tick(node);
          const scope = new Environment(environment);
          if (node.type === 'Each' && node.key) {
            scope.define(node.key, entry[0]);
            scope.define(node.value, entry[1]);
          } else {
            scope.define(node.type === 'Each' ? node.value : node.varName, entry);
          }
          try {
            yield* this.executeAsyncGeneratorStatements(node.body, scope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
        }
        return;
      }
      case 'For': {
        const start = await this.evaluateAsync(node.start, environment);
        const end = await this.evaluateAsync(node.end, environment);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          throw new TypeError('Native range bounds must be finite numbers.');
        }
        for (let value = start; value < end;) {
          this.tick(node);
          const scope = new Environment(environment);
          scope.define(node.varName, value, true);
          try {
            yield* this.executeAsyncGeneratorStatements(node.body, scope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
          value = scope.get(node.varName) + 1;
        }
        return;
      }
      case 'While':
      case 'DoWhile': {
        do {
          if (node.type === 'While' && !toBoolean(await this.evaluateAsync(node.condition, environment))) break;
          this.tick(node);
          try {
            yield* this.executeAsyncGeneratorStatements(node.body, new Environment(environment));
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
        } while (node.type === 'DoWhile' || toBoolean(await this.evaluateAsync(node.condition, environment)));
        return;
      }
      case 'Try':
        yield* this.executeAsyncGeneratorTry(node, environment);
        return;
      case 'Match': {
        const value = await this.evaluateAsync(node.value, environment);
        for (const branch of node.cases) {
          if (branch.pattern.type === 'DefaultPattern'
            || Object.is(await this.evaluateAsync(branch.pattern, environment), value)) {
            yield* this.executeAsyncGeneratorStatements(branch.body, new Environment(environment));
            break;
          }
        }
        return;
      }
      case 'Function':
      case 'Model':
      case 'EnumDecl':
        this.executeStatement(node, environment);
        return;
      default:
        if (this.containsYield(node)) {
          throw new Error('Native generators support yield as an expression statement; nested yield expressions are not supported yet.');
        }
        await this.executeAsyncStatement(node, environment);
    }
  }

  async *evaluateAsyncYield(node, environment) {
    const value = node.value ? await this.evaluateAsync(node.value, environment) : undefined;
    if (node.delegate) {
      yield* this.asyncIterable(value);
      return;
    }
    yield value;
  }

  async *executeAsyncGeneratorTry(node, environment) {
    try {
      yield* this.executeAsyncGeneratorStatements(node.body, new Environment(environment));
    } catch (error) {
      if (error instanceof ReturnSignal || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
      if (!node.catchBody) throw error;
      const scope = new Environment(environment);
      if (node.catchVar) scope.define(node.catchVar, error);
      yield* this.executeAsyncGeneratorStatements(node.catchBody, scope);
    } finally {
      if (node.ensureBody) {
        yield* this.executeAsyncGeneratorStatements(node.ensureBody, new Environment(environment));
      }
    }
  }

  containsYield(value, root = true) {
    if (!value || typeof value !== 'object') return false;
    if (value.type === 'Yield') return true;
    if (!root && ['Function', 'Lambda', 'ArrowFn', 'Model'].includes(value.type)) return false;
    if (Array.isArray(value)) return value.some(item => this.containsYield(item, false));
    return Object.entries(value).some(([key, item]) => key !== '_line' && this.containsYield(item, false));
  }

  addErrorFrame(error, frame) {
    if (!(error instanceof Error)) return;
    if (!Object.hasOwn(error, 'naideFrames')) {
      Object.defineProperty(error, 'naideFrames', { value: [], configurable: true });
    }
    const frames = error.naideFrames;
    if (!frames.some(existing => existing.file === frame.file && existing.line === frame.line
      && existing.functionName === frame.functionName)) {
      frames.push(frame);
    }
  }

  formatExecutionError(error) {
    if (!(error instanceof Error) || !error.naideFrames?.length || error.naideFormatted) return error;
    const frames = [...error.naideFrames].reverse().map(frame => {
      const location = frame.file ? `${frame.file}${frame.line ? `:${frame.line}` : ''}` : frame.line ? `line ${frame.line}` : 'unknown location';
      return `  at ${frame.functionName ? `${frame.functionName} ` : ''}(${location})`;
    });
    error.message = `${error.message}\nNAIDE stack:\n${frames.join('\n')}`;
    Object.defineProperty(error, 'naideFormatted', { value: true, configurable: true });
    return error;
  }

  resolveModulePath(specifier, environment) {
    if (specifier && typeof specifier === 'object' && specifier.parts) {
      if (specifier.parts.some(part => part.type !== 'text')) {
        throw new Error('Native module imports require a literal path.');
      }
      specifier = specifier.parts.map(part => part.value).join('');
    }
    if (typeof specifier !== 'string') throw new TypeError('Native module import path must be a string literal.');
    if (specifier.includes('\0')) throw new Error('Native module import path contains a null byte.');
    if (specifier.startsWith('node:')) {
      throw new Error(`Native engine does not load Node.js built-ins; received '${specifier}'.`);
    }
    const referrer = this.findModulePath(environment);
    if (!referrer) throw new Error(`Cannot resolve '${specifier}' without a source file path. Run the program from a .naide file.`);
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      return this.resolvePackageModulePath(specifier, referrer);
    }
    const path = resolve(dirname(referrer), specifier);
    const modulePath = extname(path) ? path : `${path}.naide`;
    if (extname(modulePath) !== '.naide') {
      throw new Error(`Native engine imports only support .naide files: '${specifier}'.`);
    }
    return modulePath;
  }

  resolvePackageModulePath(specifier, referrer) {
    const segments = specifier.split('/');
    const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    const packageSuffix = segments.slice(specifier.startsWith('@') ? 2 : 1);
    if (!/^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(packageName)
      || packageName.split('/').some(segment => segment === '.' || segment === '..')
      || packageSuffix.some(segment => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..')) {
      throw new Error(`Native engine received an invalid NAIDE package import path '${specifier}'.`);
    }

    let directory = dirname(referrer);
    while (true) {
      const packageDirectory = resolve(directory, 'node_modules', ...packageName.split('/'));
      const manifestPath = resolve(packageDirectory, 'naide.pkg.json');
      if (existsSync(packageDirectory)) {
        if (!existsSync(manifestPath)) {
          throw new Error(`Package '${packageName}' is not a NAIDE source package; expected '${manifestPath}'.`);
        }
        let manifest;
        try {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        } catch (error) {
          throw new Error(`NAIDE package manifest '${manifestPath}' is invalid JSON: ${error.message}`);
        }
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
          throw new TypeError(`NAIDE package manifest '${manifestPath}' must contain an object.`);
        }
        if (manifest.exports !== undefined
          && (!manifest.exports || typeof manifest.exports !== 'object' || Array.isArray(manifest.exports))) {
          throw new TypeError(`NAIDE package '${packageName}' exports must be an object of subpath-to-file mappings.`);
        }

        let entry;
        if (packageSuffix.length === 0) {
          entry = manifest.main ?? 'index.naide';
        } else {
          const exportKey = `./${packageSuffix.join('/')}`;
          if (!Object.hasOwn(manifest.exports || {}, exportKey)) {
            throw new Error(`NAIDE package '${packageName}' does not export '${exportKey}'.`);
          }
          entry = manifest.exports[exportKey];
          if (typeof entry !== 'string' || !entry.startsWith('./')) {
            throw new TypeError(`NAIDE package '${packageName}' export '${exportKey}' must map to a relative .naide file.`);
          }
        }

        if (typeof entry !== 'string' || !entry || isAbsolute(entry)) {
          throw new TypeError(`NAIDE package '${packageName}' must declare a relative .naide main entry.`);
        }
        const packageRealPath = realpathSync(packageDirectory);
        const entryPath = resolve(packageDirectory, entry);
        const entryRelativePath = relative(packageDirectory, entryPath);
        if (entryRelativePath === '..' || entryRelativePath.startsWith(`..${sep}`)
          || isAbsolute(entryRelativePath) || extname(entryPath) !== '.naide') {
          throw new Error(`NAIDE package '${packageName}' entry must resolve to a .naide file inside the package.`);
        }
        if (!existsSync(entryPath)) {
          throw new Error(`NAIDE package '${packageName}' entry does not exist: '${entryPath}'.`);
        }
        const entryRealPath = realpathSync(entryPath);
        const realRelativePath = relative(packageRealPath, entryRealPath);
        if (realRelativePath === '..' || realRelativePath.startsWith(`..${sep}`)
          || isAbsolute(realRelativePath) || extname(entryRealPath) !== '.naide') {
          throw new Error(`NAIDE package '${packageName}' entry must resolve to a .naide file inside the package.`);
        }
        return entryRealPath;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new Error(`Cannot resolve NAIDE package '${packageName}'. Install it and ensure it contains a naide.pkg.json with a .naide main entry.`);
  }

  findModulePath(environment) {
    for (let current = environment; current; current = current.parent) {
      if (this.modulePaths.has(current)) return this.modulePaths.get(current);
    }
    return null;
  }

  importModule(node, environment) {
    const path = this.resolveModulePath(node.source, environment);
    const namespace = this.loadModuleSync(path);
    if (node.type === 'Use') {
      environment.define(node.alias || node.name, namespace);
      return;
    }
    for (const binding of node.names) {
      if (!Object.hasOwn(namespace, binding.name)) {
        throw new Error(`Module '${node.source}' does not export '${binding.name}'.`);
      }
      environment.define(binding.alias || binding.name, namespace[binding.name]);
    }
  }

  loadModuleSync(path) {
    if (this.moduleCache.has(path)) return this.moduleCache.get(path);
    if (this.moduleLoading.has(path)) throw new Error(`Circular native module import detected: '${path}'.`);
    this.moduleLoading.add(path);
    try {
      const source = this.moduleLoader(path);
      if (typeof source !== 'string') throw new TypeError(`Native module loader must return source text for '${path}'.`);
      const ast = this.parse(source);
      const scope = new Environment(this.builtins);
      this.modulePaths.set(scope, path);
      this.executeStatements(ast.body, scope);
      const exports = this.collectExports(ast, scope, path);
      this.moduleCache.set(path, exports);
      return exports;
    } finally {
      this.moduleLoading.delete(path);
    }
  }

  async importModuleAsync(node, environment) {
    const path = this.resolveModulePath(node.source, environment);
    const referrer = this.findModulePath(environment);
    const ancestors = referrer
      ? [...(this.moduleAncestors.get(referrer) || []), referrer]
      : [];
    const namespace = await this.loadModuleAsync(path, ancestors);
    if (node.type === 'Use') {
      environment.define(node.alias || node.name, namespace);
      return;
    }
    for (const binding of node.names) {
      if (!Object.hasOwn(namespace, binding.name)) {
        throw new Error(`Module '${node.source}' does not export '${binding.name}'.`);
      }
      environment.define(binding.alias || binding.name, namespace[binding.name]);
    }
  }

  async loadModuleAsync(path, ancestors = []) {
    if (this.moduleCache.has(path)) return this.moduleCache.get(path);
    if (ancestors.includes(path)) throw new Error(`Circular native module import detected: '${path}'.`);
    if (this.moduleLoads.has(path)) return this.moduleLoads.get(path);
    this.moduleLoading.add(path);
    const load = (async () => {
      try {
        const source = await this.moduleLoader(path);
        if (typeof source !== 'string') throw new TypeError(`Native module loader must return source text for '${path}'.`);
        const ast = this.parse(source);
        const scope = new Environment(this.builtins);
        this.modulePaths.set(scope, path);
        this.moduleAncestors.set(path, ancestors);
        await this.executeAsyncStatements(ast.body, scope);
        const exports = this.collectExports(ast, scope, path);
        this.moduleCache.set(path, exports);
        return exports;
      } finally {
        this.moduleLoading.delete(path);
        this.moduleLoads.delete(path);
      }
    })();
    this.moduleLoads.set(path, load);
    return load;
  }

  collectExports(ast, environment, path) {
    const exports = Object.create(null);
    for (const declaration of ast.body) {
      if (!declaration.isPublic) continue;
      if (declaration.type !== 'Function' && declaration.type !== 'TypedVar'
        && declaration.type !== 'EnumDecl' && declaration.type !== 'Model') {
        throw new Error(`Native module '${path}' only exports public functions and values.`);
      }
      exports[declaration.name] = environment.get(declaration.name);
    }
    return Object.freeze(exports);
  }

  createEnum(node) {
    return Object.freeze(Object.fromEntries(node.values.map((value, index) => [value, index])));
  }

  createModel(node, closure) {
    const engine = this;
    const parentModel = node.parent ? closure.get(node.parent) : null;
    if (node.parent && typeof parentModel !== 'function') {
      throw new TypeError(`Model '${node.name}' extends unknown model '${node.parent}'.`);
    }

    function NativeModel(...args) {
      if (!(this instanceof NativeModel)) throw new TypeError(`Model '${node.name}' must be constructed with 'new'.`);
      const parentFields = parentModel?.naideFields || [];
      if (parentModel) {
        parentModel.apply(this, node.init ? args : args.slice(0, parentFields.length));
      }
      const fieldScope = new Environment(closure);
      fieldScope.define('self', this);
      for (let index = 0; index < node.fields.length; index++) {
        const field = node.fields[index];
        const value = !node.init && args[parentFields.length + index] !== undefined
          ? args[parentFields.length + index]
          : field.defaultValue
            ? engine.evaluate(field.defaultValue, fieldScope)
            : undefined;
        this[field.name] = value;
        fieldScope.define(field.name, value, true);
      }
      if (node.init) engine.invokeFunction(node.init, closure, args, this, parentModel?.prototype || null);
    }

    Object.defineProperty(NativeModel, 'name', { value: node.name });
    Object.defineProperty(NativeModel, 'naideFields', {
      value: parentModel ? [...(parentModel.naideFields || []), ...node.fields] : [...node.fields],
    });
    if (parentModel) {
      Object.setPrototypeOf(NativeModel, parentModel);
      Object.setPrototypeOf(NativeModel.prototype, parentModel.prototype);
    }
    const superPrototype = parentModel?.prototype || null;
    for (const method of node.methods) {
      const implementation = method.isGenerator
        ? method.isAsync
          ? function naideAsyncGeneratorMethod(...args) {
            return engine.invokeAsyncGeneratorFunction(
              method,
              closure,
              args,
              this,
              method.isStatic ? parentModel : superPrototype,
            );
          }
          : function naideGeneratorMethod(...args) {
            return engine.invokeGeneratorFunction(
              method,
              closure,
              args,
              this,
              method.isStatic ? parentModel : superPrototype,
            );
          }
        : method.isStatic
        ? method.isAsync
          ? async function naideStaticAsyncMethod(...args) {
            return engine.invokeFunctionAsync(method, closure, args, this, parentModel);
          }
          : function naideStaticMethod(...args) {
            return engine.invokeFunction(method, closure, args, this, parentModel);
          }
        : method.isAsync
          ? async function naideModelAsyncMethod(...args) {
            return engine.invokeFunctionAsync(method, closure, args, this, superPrototype);
          }
          : function naideModelMethod(...args) {
            return engine.invokeFunction(method, closure, args, this, superPrototype);
          };
      Object.defineProperty(method.isStatic ? NativeModel : NativeModel.prototype, method.name, {
        value: implementation,
        writable: true,
        configurable: true,
      });
    }
    for (const field of node.staticFields || []) {
      Object.defineProperty(NativeModel, field.name, {
        value: this.evaluate(field.defaultValue, closure),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return NativeModel;
  }

  executeStatement(node, environment) {
    switch (node.type) {
      case 'TypedVar':
        environment.define(node.name, this.evaluate(node.value, environment), node.isMut);
        return;
      case 'EnumDecl':
        environment.define(node.name, this.createEnum(node), false);
        return;
      case 'Model':
        environment.define(node.name, this.createModel(node, environment), false);
        return;
      case 'Function':
        environment.define(node.name, this.createFunction(node, environment), false);
        return;
      case 'Return':
        throw new ReturnSignal(node.value ? this.evaluate(node.value, environment) : undefined);
      case 'If': {
        if (toBoolean(this.evaluate(node.condition, environment))) {
          this.executeScoped(node.body, environment);
          return;
        }
        for (const branch of node.elifs || []) {
          if (toBoolean(this.evaluate(branch.condition, environment))) {
            this.executeScoped(branch.body, environment);
            return;
          }
        }
        if (node.elseBody) this.executeScoped(node.elseBody, environment);
        return;
      }
      case 'Each':
        return this.executeEach(node, environment);
      case 'For':
        return this.executeRange(node, environment);
      case 'ForEach':
        return this.executeForEach(node, environment);
      case 'While':
      case 'DoWhile':
        return this.executeWhile(node, environment);
      case 'Match':
        return this.executeMatch(node, environment);
      case 'Assignment':
        this.assign(node.target, this.evaluate(node.value, environment), environment);
        return;
      case 'CompoundAssign': {
        const current = this.readAssignable(node.target, environment);
        if (node.op === '&&=' && !current) return;
        if (node.op === '||=' && current) return;
        if (node.op === '??=' && current != null) return;
        const value = this.evaluate(node.value, environment);
        this.assign(node.target, this.binary(node.op.slice(0, -1), current, value), environment);
        return;
      }
      case 'ExprStatement':
        this.evaluate(node.expression, environment);
        return;
      case 'Log':
        this.log(node, environment);
        return;
      case 'Throw':
        throw this.evaluate(node.value, environment);
      case 'Break':
        throw new BreakSignal();
      case 'Continue':
        throw new ContinueSignal();
      case 'Try':
        return this.executeTry(node, environment);
      case 'AssertStmt':
        if (!toBoolean(this.evaluate(node.expr, environment))) throw new Error('Assertion failed.');
        return;
      case 'Destructure':
        return this.executeDestructure(node, environment);
      case 'Swap': {
        const first = this.readAssignable(node.a, environment);
        const second = this.readAssignable(node.b, environment);
        this.assign(node.a, second, environment);
        this.assign(node.b, first, environment);
        return;
      }
      case 'Use':
      case 'UseDestructured':
        return this.importModule(node, environment);
      default:
        throw new Error(`Native engine does not support statement '${node.type}'.`);
    }
  }

  async executeAsyncStatements(statements, environment) {
    for (const statement of statements) {
      try {
        this.tick(statement);
        await this.executeAsyncStatement(statement, environment);
      } catch (error) {
        if (error instanceof ReturnSignal || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
        const line = statement._line;
        if (line) {
          if (error instanceof Error && !error.message.includes(`NAIDE line ${line}`)) {
            error.message = `${error.message} (NAIDE line ${line})`;
          }
          this.addErrorFrame(error, { file: this.findModulePath(environment), line });
        }
        throw error;
      }
    }
  }

  async executeAsyncStatement(node, environment) {
    switch (node.type) {
      case 'TypedVar':
        environment.define(node.name, await this.evaluateAsync(node.value, environment), node.isMut);
        return;
      case 'EnumDecl':
        environment.define(node.name, this.createEnum(node), false);
        return;
      case 'Model':
        environment.define(node.name, this.createModel(node, environment), false);
        return;
      case 'Function':
        environment.define(node.name, this.createFunction(node, environment), false);
        return;
      case 'Return':
        throw new ReturnSignal(node.value ? await this.evaluateAsync(node.value, environment) : undefined);
      case 'If': {
        if (toBoolean(await this.evaluateAsync(node.condition, environment))) {
          await this.executeAsyncScoped(node.body, environment);
          return;
        }
        for (const branch of node.elifs || []) {
          if (toBoolean(await this.evaluateAsync(branch.condition, environment))) {
            await this.executeAsyncScoped(branch.body, environment);
            return;
          }
        }
        if (node.elseBody) await this.executeAsyncScoped(node.elseBody, environment);
        return;
      }
      case 'Each':
      case 'For':
      case 'ForEach':
      case 'While':
      case 'DoWhile':
        return this.executeAsyncLoop(node, environment);
      case 'Match': {
        const value = await this.evaluateAsync(node.value, environment);
        for (const branch of node.cases) {
          if (branch.pattern.type === 'DefaultPattern'
            || Object.is(await this.evaluateAsync(branch.pattern, environment), value)) {
            await this.executeAsyncScoped(branch.body, environment);
            break;
          }
        }
        return;
      }
      case 'Assignment':
        this.assign(node.target, await this.evaluateAsync(node.value, environment), environment);
        return;
      case 'CompoundAssign': {
        const current = this.readAssignable(node.target, environment);
        if (node.op === '&&=' && !current) return;
        if (node.op === '||=' && current) return;
        if (node.op === '??=' && current != null) return;
        this.assign(node.target, this.binary(node.op.slice(0, -1), current, await this.evaluateAsync(node.value, environment)), environment);
        return;
      }
      case 'ExprStatement':
        await this.evaluateAsync(node.expression, environment);
        return;
      case 'Log':
      {
        const values = [];
        for (const argument of node.args) values.push(await this.evaluateAsync(argument, environment));
        const logger = this.output[node.level] || this.output.log;
        logger(...values);
        return;
      }
      case 'Throw':
        throw await this.evaluateAsync(node.value, environment);
      case 'Break':
        throw new BreakSignal();
      case 'Continue':
        throw new ContinueSignal();
      case 'Try':
        return this.executeAsyncTry(node, environment);
      case 'AssertStmt':
        if (!toBoolean(await this.evaluateAsync(node.expr, environment))) throw new Error('Assertion failed.');
        return;
      case 'Destructure':
        return this.executeAsyncDestructure(node, environment);
      case 'AwaitAll':
        await Promise.all(node.expressions.map(async expression => this.unwrapPromiseValue(await this.evaluateAsync(expression, environment))));
        return;
      case 'Use':
      case 'UseDestructured':
        return this.importModuleAsync(node, environment);
      default:
        throw new Error(`Native async engine does not support statement '${node.type}'.`);
    }
  }

  async executeAsyncScoped(statements, parent) {
    await this.executeAsyncStatements(statements, new Environment(parent));
  }

  async executeAsyncTry(node, environment) {
    try {
      await this.executeAsyncScoped(node.body, environment);
    } catch (error) {
      if (error instanceof ReturnSignal || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
      if (!node.catchBody) throw error;
      const scope = new Environment(environment);
      if (node.catchVar) scope.define(node.catchVar, error);
      await this.executeAsyncStatements(node.catchBody, scope);
    } finally {
      if (node.ensureBody) await this.executeAsyncScoped(node.ensureBody, environment);
    }
  }

  async executeAsyncDestructure(node, environment) {
    const value = await this.evaluateAsync(node.value, environment);
    const source = node.pattern === 'array' ? Array.from(value) : value;
    const consumedKeys = new Set(node.names.filter(item => !item.rest).map(item => item.name));
    for (let index = 0; index < node.names.length; index++) {
      const item = node.names[index];
      const key = node.pattern === 'array' ? index : item.name;
      let next = item.rest
        ? node.pattern === 'array'
          ? source.slice(index)
          : Object.fromEntries(Object.entries(source).filter(([name]) => !consumedKeys.has(name)))
        : source?.[key];
      if (next === undefined && item.defaultValue) next = await this.evaluateAsync(item.defaultValue, environment);
      environment.define(item.alias || item.name, next, node.isMut);
    }
  }

  async executeAsyncLoop(node, environment) {
    const runBody = async scope => {
      try {
        await this.executeAsyncScoped(node.body, scope);
        return 'continue';
      } catch (signal) {
        if (signal instanceof BreakSignal) return 'break';
        if (signal instanceof ContinueSignal) return 'continue';
        throw signal;
      }
    };
    if (node.type === 'Each' || node.type === 'ForEach') {
      const collection = await this.evaluateAsync(node.collection || node.iterable, environment);
      if (collection == null) throw new TypeError('Cannot iterate over null or undefined.');
      let entries = node.type === 'Each' && node.key
        ? collection instanceof Map
          ? collection.entries()
          : collection instanceof Set
            ? Array.from(collection, (value, index) => [index, value])
            : Array.isArray(collection) || typeof collection === 'string'
              ? Array.from(collection, (value, index) => [index, value])
              : Object.entries(collection)
        : node.type === 'ForEach' && node.iteration === 'in'
          ? Object.keys(collection)
          : node.isAsync
            ? this.asyncIterable(collection)
            : this.iterable(collection);
      if (node.type === 'ForEach' && node.isAsync) {
        if (node.iteration !== 'of') throw new Error("'for await' requires an 'of' iterable loop.");
        entries = this.asyncIterable(collection);
      }
      for await (const entry of this.asyncIterable(entries)) {
        this.tick(node);
        const scope = new Environment(environment);
        if (node.type === 'Each' && node.key) {
          scope.define(node.key, entry[0]);
          scope.define(node.value, entry[1]);
        } else {
          scope.define(node.type === 'Each' ? node.value : node.varName, node.type === 'Each' ? entry : entry);
        }
        if (await runBody(scope) === 'break') break;
      }
      return;
    }
    if (node.type === 'For') {
      const start = await this.evaluateAsync(node.start, environment);
      const end = await this.evaluateAsync(node.end, environment);
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new TypeError('Native range bounds must be finite numbers.');
      for (let value = start; value < end; value++) {
        this.tick(node);
        const scope = new Environment(environment);
        scope.define(node.varName, value, true);
        if (await runBody(scope) === 'break') break;
      }
      return;
    }
    if (node.type === 'While') {
      while (toBoolean(await this.evaluateAsync(node.condition, environment))) {
        this.tick(node);
        if (await runBody(new Environment(environment)) === 'break') break;
      }
      return;
    }
    do {
      this.tick(node);
      if (await runBody(new Environment(environment)) === 'break') break;
    } while (toBoolean(await this.evaluateAsync(node.condition, environment)));
  }

  async invokeFunctionAsync(node, closure, args, receiver = undefined, superPrototype = null) {
    this.callDepth++;
    if (this.callDepth > this.maxCallDepth) {
      this.callDepth--;
      const error = new RangeError(`Native engine call depth limit (${this.maxCallDepth}) exceeded.`);
      this.addErrorFrame(error, {
        file: this.findModulePath(closure),
        line: node._line,
        functionName: node.name,
      });
      throw error;
    }
    const scope = new Environment(closure);
    if (receiver !== undefined) scope.define('self', receiver);
    if (receiver !== undefined && superPrototype) {
      scope.define('super', this.createSuperBinding(superPrototype, receiver));
    }
    try {
      let argIndex = 0;
      for (const parameter of node.params) {
        if (parameter.spread) {
          scope.define(parameter.name, args.slice(argIndex));
          argIndex = args.length;
        } else {
          const value = argIndex < args.length
            ? args[argIndex++]
            : parameter.defaultValue
              ? await this.evaluateAsync(parameter.defaultValue, scope)
              : undefined;
          scope.define(parameter.name, value, true);
        }
      }
      try {
        await this.executeAsyncStatements(node.body, scope);
      } catch (signal) {
        if (signal instanceof ReturnSignal) return signal.value;
        this.addErrorFrame(signal, {
          file: this.findModulePath(closure),
          line: node._line,
          functionName: node.name,
        });
        throw signal;
      }
      return undefined;
    } finally {
      this.callDepth--;
    }
  }

  unwrapPromiseValue(value) {
    return value instanceof PromiseValue ? value.promise : value;
  }

  async evaluateAsync(node, environment) {
    this.tick(node);
    switch (node.type) {
      case 'Await':
        return await this.unwrapPromiseValue(await this.evaluateAsync(node.expr, environment));
      case 'AwaitAllExpr': {
        const values = await this.evaluateAsync(node.expr, environment);
        if (!Array.isArray(values)) throw new TypeError('await_all expression expects a list.');
        return Promise.all(values.map(value => this.unwrapPromiseValue(value)));
      }
      case 'Number':
      case 'Bool':
      case 'Null':
      case 'Identifier':
      case 'Self':
        return this.evaluate(node, environment);
      case 'String':
        return this.evaluateStringAsync(node.value, environment);
      case 'Array': {
        const values = [];
        for (const element of node.elements) {
          const value = await this.evaluateAsync(element.type === 'Spread' ? element.expr : element, environment);
          if (element.type === 'Spread') values.push(...value);
          else values.push(value);
        }
        return values;
      }
      case 'Object': {
        const result = {};
        for (const property of node.properties) {
          if (property.type === 'spread') Object.assign(result, await this.evaluateAsync(property.value, environment));
          else if (property.type === 'shorthand') result[property.key] = environment.get(property.key);
          else {
            const key = typeof property.key === 'string'
              ? property.key
              : property.key.type === 'Computed'
                ? await this.evaluateAsync(property.key.expr, environment)
                : await this.evaluateAsync(property.key, environment);
            result[key] = await this.evaluateAsync(property.value, environment);
          }
        }
        return result;
      }
      case 'Binary': {
        const left = await this.evaluateAsync(node.left, environment);
        if (node.op === '&&') return left && this.evaluateAsync(node.right, environment);
        if (node.op === '||') return left || this.evaluateAsync(node.right, environment);
        if (node.op === '??') return left ?? this.evaluateAsync(node.right, environment);
        return this.binary(node.op, left, await this.evaluateAsync(node.right, environment));
      }
      case 'Unary': {
        const value = await this.evaluateAsync(node.expr, environment);
        if (node.op === '!') return !value;
        if (node.op === '-') return -value;
        if (node.op === '+') return +value;
        if (node.op === '~') return ~value;
        throw new Error(`Unsupported unary operator '${node.op}'.`);
      }
      case 'MemberAccess':
      case 'OptionalAccess': {
        const object = await this.evaluateAsync(node.object, environment);
        if (object == null) {
          if (node.type === 'OptionalAccess') return undefined;
          throw new TypeError(`Cannot read '${node.property}' from ${object}.`);
        }
        return object[node.property];
      }
      case 'IndexAccess':
      case 'OptionalIndexAccess': {
        const object = await this.evaluateAsync(node.object, environment);
        if (object == null) {
          if (node.type === 'OptionalIndexAccess') return undefined;
          throw new TypeError(`Cannot index ${object}.`);
        }
        return object[await this.evaluateAsync(node.index, environment)];
      }
      case 'Call':
      case 'OptionalCall':
        return this.evaluateCallAsync(node, environment);
      case 'ArrowFn':
      case 'Lambda':
        return this.createLambda(node, environment);
      case 'Ternary':
        return toBoolean(await this.evaluateAsync(node.condition, environment))
          ? this.evaluateAsync(node.consequent, environment)
          : this.evaluateAsync(node.alternate, environment);
      case 'TypeOf':
        return this.typeOf(await this.evaluateAsync(node.expr, environment));
      case 'Update':
        return this.evaluateUpdate(node, environment);
      case 'New':
        return this.evaluateNewAsync(node.expr, environment);
      case 'Spread':
        return this.evaluateAsync(node.expr, environment);
      case 'Pipe': {
        const left = await this.evaluateAsync(node.left, environment);
        if (node.right.type === 'Call') {
          const callee = await this.evaluateAsync(node.right.callee, environment);
          const args = [];
          for (const arg of node.right.args) args.push(await this.evaluateAsync(arg, environment));
          return this.call(callee, [left, ...args]);
        }
        return this.call(await this.evaluateAsync(node.right, environment), [left]);
      }
      default:
        throw new Error(`Native async engine does not support expression '${node.type}'.`);
    }
  }

  async evaluateStringAsync(value, environment) {
    if (value.raw !== null && value.raw !== undefined) return value.raw;
    let result = '';
    for (const part of value.parts) {
      if (part.type === 'text') result += part.value;
      else {
        const expression = new Parser(new Lexer(part.value).tokenize()).parseExpression();
        result += formatValue(await this.evaluateAsync(expression, environment));
      }
    }
    return result;
  }

  async evaluateCallAsync(node, environment) {
    let callee;
    let receiver;
    if (['MemberAccess', 'OptionalAccess', 'IndexAccess', 'OptionalIndexAccess'].includes(node.callee.type)) {
      receiver = await this.evaluateAsync(node.callee.object, environment);
      const optional = node.callee.type.startsWith('Optional');
      if (receiver == null) {
        if (optional) return undefined;
        throw new TypeError('Cannot call a member on null or undefined.');
      }
      const property = node.callee.property ?? await this.evaluateAsync(node.callee.index, environment);
      callee = receiver[property];
    } else {
      callee = await this.evaluateAsync(node.callee, environment);
      if (node.type === 'OptionalCall' && callee == null) return undefined;
    }
    const args = [];
    for (const argument of node.args) {
      const value = await this.evaluateAsync(argument.type === 'Spread' ? argument.expr : argument, environment);
      if (argument.type === 'Spread') args.push(...value);
      else args.push(value);
    }
    const result = this.call(callee, args, receiver);
    return result instanceof Promise ? new PromiseValue(result) : result;
  }

  async evaluateNewAsync(expression, environment) {
    let callee = expression;
    const args = [];
    if (expression.type === 'Call') {
      callee = expression.callee;
      for (const arg of expression.args) {
        const value = await this.evaluateAsync(arg.type === 'Spread' ? arg.expr : arg, environment);
        if (arg.type === 'Spread') args.push(...value);
        else args.push(value);
      }
    }
    const constructor = await this.evaluateAsync(callee, environment);
    return Reflect.construct(constructor, args);
  }

  executeScoped(statements, parent) {
    this.executeStatements(statements, new Environment(parent));
  }

  executeEach(node, environment) {
    const collection = this.evaluate(node.collection, environment);
    let entries;
    if (collection == null) throw new TypeError('Cannot iterate over null or undefined.');
    if (node.key) {
      entries = collection instanceof Map
        ? collection.entries()
        : collection instanceof Set
          ? Array.from(collection, (value, index) => [index, value])
          : Array.isArray(collection) || typeof collection === 'string'
            ? Array.from(collection, (value, index) => [index, value])
            : Object.entries(collection);
      for (const [key, value] of entries) {
        this.tick(node);
        const scope = new Environment(environment);
        scope.define(node.key, key);
        scope.define(node.value, value);
        if (this.loopBody(node.body, scope)) break;
      }
      return;
    }
    for (const value of this.iterable(collection)) {
      this.tick(node);
      const scope = new Environment(environment);
      scope.define(node.value, value);
      if (this.loopBody(node.body, scope)) break;
    }
  }

  executeForEach(node, environment) {
    if (node.isAsync) throw new Error("'for await' requires async execution.");
    const iterable = this.evaluate(node.iterable, environment);
    if (iterable == null) throw new TypeError('Cannot iterate over null or undefined.');
    const entries = node.iteration === 'in'
      ? Object.keys(iterable)
      : this.iterable(iterable);
    for (const value of entries) {
      this.tick(node);
      const scope = new Environment(environment);
      scope.define(node.varName, value);
      if (this.loopBody(node.body, scope)) break;
    }
  }

  executeRange(node, environment) {
    const start = this.evaluate(node.start, environment);
    const end = this.evaluate(node.end, environment);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new TypeError('Native range bounds must be finite numbers.');
    }
    for (let value = start; value < end;) {
      this.tick(node);
      const scope = new Environment(environment);
      scope.define(node.varName, value, true);
      if (this.loopBody(node.body, scope)) break;
      value = scope.get(node.varName) + 1;
    }
  }

  executeWhile(node, environment) {
    const runBody = () => {
      this.tick(node);
      try {
        this.executeScoped(node.body, environment);
        return false;
      } catch (signal) {
        if (signal instanceof BreakSignal) return true;
        if (signal instanceof ContinueSignal) return false;
        throw signal;
      }
    };
    if (node.type === 'While') {
      while (toBoolean(this.evaluate(node.condition, environment))) {
        if (runBody()) break;
      }
      return;
    }
    do {
      if (runBody()) break;
    } while (toBoolean(this.evaluate(node.condition, environment)));
  }

  loopBody(body, environment) {
    try {
      this.executeStatements(body, environment);
      return false;
    } catch (signal) {
      if (signal instanceof BreakSignal) return true;
      if (signal instanceof ContinueSignal) return false;
      throw signal;
    }
  }

  executeMatch(node, environment) {
    const value = this.evaluate(node.value, environment);
    const branch = node.cases.find(item => item.pattern.type === 'DefaultPattern'
      || Object.is(this.evaluate(item.pattern, environment), value));
    if (branch) this.executeScoped(branch.body, environment);
  }

  executeTry(node, environment) {
    try {
      this.executeScoped(node.body, environment);
    } catch (error) {
      if (error instanceof ReturnSignal || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
      if (!node.catchBody) throw error;
      const scope = new Environment(environment);
      if (node.catchVar) scope.define(node.catchVar, error);
      this.executeStatements(node.catchBody, scope);
    } finally {
      if (node.ensureBody) this.executeScoped(node.ensureBody, environment);
    }
  }

  executeDestructure(node, environment) {
    const value = this.evaluate(node.value, environment);
    const source = node.pattern === 'array' ? Array.from(value) : value;
    const consumedKeys = new Set(node.names.filter(item => !item.rest).map(item => item.name));
    for (let index = 0; index < node.names.length; index++) {
      const item = node.names[index];
      let next;
      if (item.rest) {
        next = node.pattern === 'array'
          ? source.slice(index)
          : Object.fromEntries(Object.entries(source).filter(([key]) => !consumedKeys.has(key)));
      } else {
        const key = node.pattern === 'array' ? index : item.name;
        next = source?.[key];
        if (next === undefined && item.defaultValue) next = this.evaluate(item.defaultValue, environment);
      }
      environment.define(item.alias || item.name, next, node.isMut);
    }
  }

  createFunction(node, closure) {
    const engine = this;
    if (node.isGenerator) {
      if (node.isAsync) {
        return function naideAsyncGeneratorFunction(...args) {
          return engine.invokeAsyncGeneratorFunction(node, closure, args, this);
        };
      }
      return function naideGeneratorFunction(...args) {
        return engine.invokeGeneratorFunction(node, closure, args, this);
      };
    }
    if (node.isAsync) {
      return async function naideAsyncFunction(...args) {
        return engine.invokeFunctionAsync(node, closure, args, this);
      };
    }
    return function naideFunction(...args) {
      return engine.invokeFunction(node, closure, args, this);
    };
  }

  invokeGeneratorFunction(node, closure, args, receiver = undefined, superPrototype = null) {
    const engine = this;
    const generator = this.runGeneratorFunction(node, closure, args, receiver, superPrototype);
    const resume = (method, value) => {
      engine.callDepth++;
      if (engine.callDepth > engine.maxCallDepth) {
        engine.callDepth--;
        const error = new RangeError(`Native engine call depth limit (${engine.maxCallDepth}) exceeded.`);
        engine.addErrorFrame(error, {
          file: engine.findModulePath(closure),
          line: node._line,
          functionName: node.name,
        });
        throw error;
      }
      try {
        return generator[method](value);
      } finally {
        engine.callDepth--;
      }
    };
    return {
      next: value => resume('next', value),
      return: value => resume('return', value),
      throw: error => resume('throw', error),
      [Symbol.iterator]() { return this; },
    };
  }

  invokeAsyncGeneratorFunction(node, closure, args, receiver = undefined, superPrototype = null) {
    const engine = this;
    const generator = this.runAsyncGeneratorFunction(node, closure, args, receiver, superPrototype);
    const resume = async (method, value) => {
      engine.callDepth++;
      if (engine.callDepth > engine.maxCallDepth) {
        engine.callDepth--;
        const error = new RangeError(`Native engine call depth limit (${engine.maxCallDepth}) exceeded.`);
        engine.addErrorFrame(error, {
          file: engine.findModulePath(closure),
          line: node._line,
          functionName: node.name,
        });
        throw error;
      }
      try {
        return await generator[method](value);
      } finally {
        engine.callDepth--;
      }
    };
    return {
      next: value => resume('next', value),
      return: value => resume('return', value),
      throw: error => resume('throw', error),
      [Symbol.asyncIterator]() { return this; },
    };
  }

  async *runAsyncGeneratorFunction(node, closure, args, receiver, superPrototype) {
    const scope = new Environment(closure);
    if (receiver !== undefined) {
      scope.define('self', receiver);
      if (superPrototype) scope.define('super', this.createSuperBinding(superPrototype, receiver));
    }
    try {
      let argIndex = 0;
      for (const parameter of node.params) {
        if (parameter.spread) {
          scope.define(parameter.name, args.slice(argIndex));
          argIndex = args.length;
        } else {
          const value = argIndex < args.length
            ? args[argIndex++]
            : parameter.defaultValue
              ? await this.evaluateAsync(parameter.defaultValue, scope)
              : undefined;
          scope.define(parameter.name, value, true);
        }
      }
      yield* this.executeAsyncGeneratorStatements(node.body, scope);
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      this.addErrorFrame(signal, {
        file: this.findModulePath(closure),
        line: node._line,
        functionName: node.name,
      });
      throw signal;
    }
  }

  *runGeneratorFunction(node, closure, args, receiver, superPrototype) {
    const scope = new Environment(closure);
    if (receiver !== undefined) {
      scope.define('self', receiver);
      if (superPrototype) scope.define('super', this.createSuperBinding(superPrototype, receiver));
    }
    try {
      let argIndex = 0;
      for (const parameter of node.params) {
        if (parameter.spread) {
          scope.define(parameter.name, args.slice(argIndex));
          argIndex = args.length;
        } else {
          const value = argIndex < args.length
            ? args[argIndex++]
            : parameter.defaultValue
              ? this.evaluate(parameter.defaultValue, scope)
              : undefined;
          scope.define(parameter.name, value, true);
        }
      }
      yield* this.executeGeneratorStatements(node.body, scope);
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      this.addErrorFrame(signal, {
        file: this.findModulePath(closure),
        line: node._line,
        functionName: node.name,
      });
      throw signal;
    }
  }

  invokeFunction(node, closure, args, receiver = undefined, superPrototype = null) {
    this.callDepth++;
    if (this.callDepth > this.maxCallDepth) {
      this.callDepth--;
      const error = new RangeError(`Native engine call depth limit (${this.maxCallDepth}) exceeded.`);
      this.addErrorFrame(error, {
        file: this.findModulePath(closure),
        line: node._line,
        functionName: node.name,
      });
      throw error;
    }
    const scope = new Environment(closure);
    if (receiver !== undefined) scope.define('self', receiver);
    if (receiver !== undefined && superPrototype) {
      scope.define('super', this.createSuperBinding(superPrototype, receiver));
    }
    try {
      let argIndex = 0;
      for (const parameter of node.params) {
        if (parameter.spread) {
          scope.define(parameter.name, args.slice(argIndex));
          argIndex = args.length;
        } else {
          const value = argIndex < args.length
            ? args[argIndex++]
            : parameter.defaultValue
              ? this.evaluate(parameter.defaultValue, scope)
              : undefined;
          scope.define(parameter.name, value, true);
        }
      }
      try {
        this.executeStatements(node.body, scope);
      } catch (signal) {
        if (signal instanceof ReturnSignal) return signal.value;
        this.addErrorFrame(signal, {
          file: this.findModulePath(closure),
          line: node._line,
          functionName: node.name,
        });
        throw signal;
      }
      return undefined;
    } finally {
      this.callDepth--;
    }
  }

  createSuperBinding(superPrototype, receiver) {
    return new Proxy(Object.create(superPrototype), {
      get: (_target, property) => {
        const value = Reflect.get(superPrototype, property, receiver);
        return typeof value === 'function' ? value.bind(receiver) : value;
      },
    });
  }

  log(node, environment) {
    const values = node.args.map(argument => this.evaluate(argument, environment));
    const logger = this.output[node.level] || this.output.log;
    logger(...values);
  }

  evaluate(node, environment) {
    this.tick(node);
    switch (node.type) {
      case 'Number': return parseNumber(node.value);
      case 'String': return this.evaluateString(node.value, environment);
      case 'Bool': return node.value;
      case 'Null': return null;
      case 'Yield':
        throw new Error('Yield expressions can only be evaluated while a native generator is running.');
      case 'Identifier': return environment.get(node.name);
      case 'Self': return environment.get('self');
      case 'Array':
        return node.elements.flatMap(element => element.type === 'Spread'
          ? Array.from(this.evaluate(element.expr, environment))
          : [this.evaluate(element, environment)]);
      case 'Object':
        return this.evaluateObject(node.properties, environment);
      case 'Binary':
        return this.evaluateBinary(node, environment);
      case 'Unary': {
        const value = this.evaluate(node.expr, environment);
        if (node.op === '!') return !value;
        if (node.op === '-') return -value;
        if (node.op === '+') return +value;
        if (node.op === '~') return ~value;
        throw new Error(`Unsupported unary operator '${node.op}'.`);
      }
      case 'MemberAccess': {
        const object = this.evaluate(node.object, environment);
        if (object == null) throw new TypeError(`Cannot read '${node.property}' from ${object}.`);
        return object[node.property];
      }
      case 'OptionalAccess': {
        const object = this.evaluate(node.object, environment);
        return object == null ? undefined : object[node.property];
      }
      case 'IndexAccess': {
        const object = this.evaluate(node.object, environment);
        const index = this.evaluate(node.index, environment);
        if (object == null) throw new TypeError(`Cannot index ${object}.`);
        return object[index];
      }
      case 'OptionalIndexAccess': {
        const object = this.evaluate(node.object, environment);
        return object == null ? undefined : object[this.evaluate(node.index, environment)];
      }
      case 'Call':
      case 'OptionalCall':
        return this.evaluateCall(node, environment);
      case 'ArrowFn':
      case 'Lambda':
        return this.createLambda(node, environment);
      case 'Ternary':
        return toBoolean(this.evaluate(node.condition, environment))
          ? this.evaluate(node.consequent, environment)
          : this.evaluate(node.alternate, environment);
      case 'TypeOf': return this.typeOf(this.evaluate(node.expr, environment));
      case 'Update': return this.evaluateUpdate(node, environment);
      case 'New': return this.evaluateNew(node.expr, environment);
      case 'Spread': return this.evaluate(node.expr, environment);
      case 'Pipe': {
        const left = this.evaluate(node.left, environment);
        if (node.right.type === 'Call') {
          const callee = this.evaluate(node.right.callee, environment);
          return this.call(callee, [left, ...node.right.args.map(arg => this.evaluate(arg, environment))]);
        }
        return this.call(this.evaluate(node.right, environment), [left]);
      }
      default:
        throw new Error(`Native engine does not support expression '${node.type}'.`);
    }
  }

  evaluateString(value, environment) {
    if (value.raw !== null && value.raw !== undefined) return value.raw;
    return value.parts.map(part => {
      if (part.type === 'text') return part.value;
      const expression = new Parser(new Lexer(part.value).tokenize()).parseExpression();
      return formatValue(this.evaluate(expression, environment));
    }).join('');
  }

  evaluateObject(properties, environment) {
    const result = {};
    for (const property of properties) {
      if (property.type === 'spread') {
        Object.assign(result, this.evaluate(property.value, environment));
      } else if (property.type === 'shorthand') {
        result[property.key] = environment.get(property.key);
      } else {
        const key = typeof property.key === 'string'
          ? property.key
          : property.key.type === 'Computed'
            ? this.evaluate(property.key.expr, environment)
            : this.evaluate(property.key, environment);
        result[key] = this.evaluate(property.value, environment);
      }
    }
    return result;
  }

  evaluateBinary(node, environment) {
    const left = this.evaluate(node.left, environment);
    if (node.op === '&&') return left && this.evaluate(node.right, environment);
    if (node.op === '||') return left || this.evaluate(node.right, environment);
    if (node.op === '??') return left ?? this.evaluate(node.right, environment);
    const right = this.evaluate(node.right, environment);
    return this.binary(node.op, left, right);
  }

  binary(operator, left, right) {
    switch (operator) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return left / right;
      case '%': return left % right;
      case '**': return left ** right;
      case '==': case '===': return left === right;
      case '!=': case '!==': return left !== right;
      case '>': return left > right;
      case '<': return left < right;
      case '>=': return left >= right;
      case '<=': return left <= right;
      case '&': return left & right;
      case '|': return left | right;
      case '^': return left ^ right;
      case '<<': return left << right;
      case '>>': return left >> right;
      case '>>>': return left >>> right;
      case 'in': return left in right;
      case 'instanceof': return left instanceof right;
      default: throw new Error(`Native engine does not support operator '${operator}'.`);
    }
  }

  evaluateCall(node, environment) {
    let callee;
    let receiver;
    if (node.callee.type === 'MemberAccess' || node.callee.type === 'OptionalAccess') {
      receiver = this.evaluate(node.callee.object, environment);
      if (receiver == null) {
        if (node.callee.type === 'OptionalAccess') return undefined;
        throw new TypeError(`Cannot call '${node.callee.property}' on ${receiver}.`);
      }
      callee = receiver[node.callee.property];
    } else if (node.callee.type === 'IndexAccess' || node.callee.type === 'OptionalIndexAccess') {
      receiver = this.evaluate(node.callee.object, environment);
      if (receiver == null) {
        if (node.callee.type === 'OptionalIndexAccess') return undefined;
        throw new TypeError(`Cannot call an indexed value on ${receiver}.`);
      }
      callee = receiver[this.evaluate(node.callee.index, environment)];
    } else {
      callee = this.evaluate(node.callee, environment);
      if (node.type === 'OptionalCall' && callee == null) return undefined;
    }
    const args = node.args.flatMap(argument => argument.type === 'Spread'
      ? Array.from(this.evaluate(argument.expr, environment))
      : [this.evaluate(argument, environment)]);
    return this.call(callee, args, receiver);
  }

  evaluateNew(expression, environment) {
    let callee = expression;
    let args = [];
    if (expression.type === 'Call') {
      args = expression.args.flatMap(argument => argument.type === 'Spread'
        ? Array.from(this.evaluate(argument.expr, environment))
        : [this.evaluate(argument, environment)]);
      callee = expression.callee;
    }
    const constructor = this.evaluate(callee, environment);
    if (typeof constructor !== 'function') throw new TypeError('Value after new is not a constructor.');
    return Reflect.construct(constructor, args);
  }

  call(callee, args, receiver = undefined) {
    if (typeof callee !== 'function') throw new TypeError(`Value is not callable: ${formatValue(callee)}.`);
    return callee.apply(receiver, args);
  }

  createLambda(node, closure) {
    if (node.isGenerator) {
      const generatorNode = { ...node, name: '<lambda>' };
      if (node.isAsync) {
        return (...args) => this.invokeAsyncGeneratorFunction(generatorNode, closure, args);
      }
      return (...args) => this.invokeGeneratorFunction(generatorNode, closure, args);
    }
    if (node.isAsync) throw new Error('Native engine lambdas do not yet support async functions.');
    const engine = this;
    return (...args) => {
      engine.callDepth++;
      if (engine.callDepth > engine.maxCallDepth) {
        engine.callDepth--;
        throw new RangeError(`Native engine call depth limit (${engine.maxCallDepth}) exceeded.`);
      }
      const scope = new Environment(closure);
      try {
        for (let index = 0; index < node.params.length; index++) {
          scope.define(node.params[index].name, args[index], true);
        }
        if (node.type === 'ArrowFn') return engine.evaluate(node.body, scope);
        try {
          engine.executeStatements(node.body, scope);
        } catch (signal) {
          if (signal instanceof ReturnSignal) return signal.value;
          throw signal;
        }
        return undefined;
      } finally {
        engine.callDepth--;
      }
    };
  }

  evaluateUpdate(node, environment) {
    const current = this.readAssignable(node.expr, environment);
    const increment = typeof current === 'bigint' ? 1n : 1;
    const next = node.op === '++' ? current + increment : current - increment;
    this.assign(node.expr, next, environment);
    return node.prefix ? next : current;
  }

  readAssignable(target, environment) {
    if (target.type === 'Identifier') return environment.get(target.name);
    if (target.type === 'MemberAccess') {
      const object = this.evaluate(target.object, environment);
      return object[target.property];
    }
    if (target.type === 'IndexAccess') {
      const object = this.evaluate(target.object, environment);
      return object[this.evaluate(target.index, environment)];
    }
    throw new Error(`Invalid assignment target '${target.type}'.`);
  }

  assign(target, value, environment) {
    if (target.type === 'Identifier') return environment.assign(target.name, value);
    if (target.type === 'MemberAccess') {
      const object = this.evaluate(target.object, environment);
      if (object == null) throw new TypeError('Cannot assign a property on null or undefined.');
      object[target.property] = value;
      return value;
    }
    if (target.type === 'IndexAccess') {
      const object = this.evaluate(target.object, environment);
      if (object == null) throw new TypeError('Cannot assign an index on null or undefined.');
      object[this.evaluate(target.index, environment)] = value;
      return value;
    }
    throw new Error(`Invalid assignment target '${target.type}'.`);
  }

  typeOf(value) {
    return typeof value;
  }
}

export function runNative(source, options = {}) {
  const engine = new NativeEngine(options);
  return engine.execute(source);
}

export async function runNativeAsync(source, options = {}) {
  const engine = new NativeEngine(options);
  return engine.executeAsync(source);
}

export async function runNativeFileAsync(filePath, options = {}) {
  const engine = new NativeEngine({ ...options, sourceFile: filePath });
  return engine.executeFileAsync(filePath);
}
