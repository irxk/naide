import { existsSync, readFileSync } from 'node:fs';
import { access, appendFile, readdir, realpath, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { arch as hostArch, cwd as hostCwd, platform as hostPlatform } from 'node:process';
import { pathToFileURL } from 'node:url';
import { resolveNaidePackage } from './naide-package.js';
import {
  createFileStore,
  createPrompt,
  createQueue,
  createSchema,
  createStore,
  buildOpenApiSpec,
  hash,
  jwtSign,
  jwtVerify,
  registerCrud,
  uuid,
  verify,
} from './runtime.js';
import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { createNativeCacheMiddleware, NativeHttpApp } from './native-server.js';
import { NATIVE_AST_SUPPORT, NATIVE_SERVER_SUPPORT } from './native-support.js';

const UNINITIALIZED = Symbol('uninitialized');

class ReturnSignal {
  constructor(value) { this.value = value; }
}

class BreakSignal {}
class ContinueSignal {}

class RouteResponseSignal {
  constructor(response) { this.response = response; }
}

class PromiseValue {
  constructor(promise) { this.promise = Promise.resolve(promise); }
}

class Environment {
  constructor(parent = null) {
    this.parent = parent;
    this.bindings = new Map();
    this.isRouteScope = parent?.isRouteScope ?? false;
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

function unsupportedNodeError(engineName, kind, node) {
  const status = NATIVE_AST_SUPPORT[node.type];
  let detail;
  if (status === 'unsupported') {
    detail = 'it is explicitly unsupported by the native capability contract';
  } else if (status === 'contextual') {
    detail = 'it requires an execution context that is not active here';
  } else if (status === 'supported') {
    detail = 'it is marked supported but has no handler in this execution context';
  } else {
    detail = 'its AST type is missing from the native capability contract';
  }
  return new Error(`${engineName} cannot execute ${kind} '${node.type}': ${detail}.`);
}

export class NaideVM {
  constructor({
    globals = {},
    output = console,
    maxSteps = 1_000_000,
    maxCallDepth = 512,
    sourceFile = null,
    moduleLoader = path => readFileSync(path, 'utf8'),
    io = null,
    http = null,
    database = null,
    bot = null,
    storage = null,
    mailer = null,
    push = null,
    nativeServices = {},
    runtime = {},
    serverHost = '127.0.0.1',
    maxRequestBodyBytes = 1_048_576,
    nodeModules = [],
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
    this.database = database == null ? null : this.validateDatabase(database);
    this.bot = bot == null ? null : this.validateBot(bot);
    this.storage = storage == null ? null : this.validateStorage(storage);
    this.mailer = mailer == null ? null : this.validateMailer(mailer);
    this.push = push == null ? null : this.validatePush(push);
    this.nativeServices = this.validateNativeServices(nativeServices);
    this.runtime = this.createRuntime(runtime);
    this.serverHost = serverHost;
    this.maxRequestBodyBytes = maxRequestBodyBytes;
    if (!Array.isArray(nodeModules) || nodeModules.some(name => typeof name !== 'string' || !name.startsWith('node:'))) {
      throw new TypeError("nodeModules must be a list of explicit 'node:' builtin module specifiers.");
    }
    this.nodeModules = new Set(nodeModules);
    this.hostModuleNamespaces = new Map();
    this.databaseDirectory = null;
    this.sqlDriver = null;
    this.sqlDatabase = null;
    this.schemas = new Map();
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
    this.nativeEventBus = this.createNativeEventBus();
    this.builtins.define('events', this.nativeEventBus, false);
    this.scheduleHandles = new Set();
    const engine = this;
    this.builtins.define('scheduler', Object.freeze({
      stopAll: () => {
        for (const handle of this.scheduleHandles) clearInterval(handle);
        this.scheduleHandles.clear();
      },
      get activeCount() {
        return engine.scheduleHandles.size;
      },
    }), false);
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
      hash,
      verify,
      uuid,
      log: (...values) => this.output.log(...values),
      print: (...values) => this.output.log(...values),
      Math,
      JSON,
      Number,
      String,
      Boolean,
      BigInt,
      Date,
      undefined,
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

  createNativeEventBus() {
    const listeners = new Map();
    return Object.freeze({
      on: (name, listener) => {
        if (typeof name !== 'string' || !name) throw new TypeError('Native event names must be non-empty strings.');
        if (typeof listener !== 'function') throw new TypeError('Native event listeners must be functions.');
        const handlers = listeners.get(name) || [];
        handlers.push(listener);
        listeners.set(name, handlers);
      },
      emit: async (name, data) => {
        if (typeof name !== 'string' || !name) throw new TypeError('Native event names must be non-empty strings.');
        const handlers = listeners.get(name) || [];
        const payload = Object.freeze({ event: name, data, timestamp: new Date().toISOString() });
        await Promise.all(handlers.map(listener => listener(payload)));
      },
    });
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

  validateDatabase(database) {
    const methods = ['connect', 'createStore'];
    if (!database || methods.some(method => typeof database[method] !== 'function')) {
      throw new TypeError(`Native database capability must provide ${methods.join(', ')} methods.`);
    }
    return database;
  }

  validateBot(bot) {
    if (!bot || typeof bot.create !== 'function') {
      throw new TypeError('Native bot capability must provide a create(options) method.');
    }
    return bot;
  }

  validateStorage(storage) {
    if (!storage || typeof storage.connect !== 'function') {
      throw new TypeError('Native storage capability must provide a connect(options) method.');
    }
    return storage;
  }

  validateMailer(mailer) {
    if (!mailer || typeof mailer.createTransport !== 'function') {
      throw new TypeError('Native mailer capability must provide createTransport(options).');
    }
    return mailer;
  }

  validatePush(push) {
    if (!push || typeof push.configure !== 'function') {
      throw new TypeError('Native push capability must provide configure(options).');
    }
    return push;
  }

  validateNativeServices(services) {
    if (!services || typeof services !== 'object' || Array.isArray(services)) {
      throw new TypeError('Native service adapters must be provided as an object of functions.');
    }
    const allowed = new Set([
      'blockchain', 'desktop', 'graphql', 'grpc', 'image', 'migration',
      'oauth', 'payments', 'pdf', 'webrtc', 'websocket',
    ]);
    for (const [name, adapter] of Object.entries(services)) {
      if (!allowed.has(name)) throw new TypeError(`Unknown native service adapter '${name}'.`);
      if (typeof adapter !== 'function') {
        throw new TypeError(`Native service adapter '${name}' must be a function.`);
      }
    }
    return Object.freeze({ ...services });
  }

  requireNativeService(name, nodeType) {
    const adapter = this.nativeServices[name];
    if (!adapter) {
      throw new Error(`Native ${nodeType} requires the explicit nativeServices.${name} host adapter.`);
    }
    return adapter;
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
    if (ast?.type !== 'Program') throw new TypeError('NaideVM.execute expects NAIDE source or a Program AST.');
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
    if (ast?.type !== 'Program') throw new TypeError('NaideVM.executeAsync expects NAIDE source or a Program AST.');
    try {
      await this.executeAsyncStatements(ast.body, this.global);
    } catch (error) {
      if (error instanceof RouteResponseSignal) {
        throw new Error("'ret' response statements can only be used inside a server route.");
      }
      if (error instanceof ReturnSignal) throw new Error("'ret' is only valid inside a function.");
      if (error instanceof BreakSignal || error instanceof ContinueSignal) {
        throw new Error('Loop control is only valid inside a loop.');
      }
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
        if (error instanceof ReturnSignal || error instanceof RouteResponseSignal
          || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
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
      if (error instanceof ReturnSignal || error instanceof RouteResponseSignal
        || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
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
    return resolveNaidePackage(specifier, referrer);
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

  readModuleSpecifier(source) {
    return this.nativeLiteralString(source, 'A native module import path');
  }

  async loadHostModule(specifier, referrer) {
    if (this.hostModuleNamespaces.has(specifier)) return this.hostModuleNamespaces.get(specifier);
    let namespace;
    if (specifier.startsWith('node:')) {
      if (!this.nodeModules.has(specifier)) {
        throw new Error(`Node.js builtin '${specifier}' is not enabled. Pass it explicitly with --node-module ${specifier}.`);
      }
      namespace = await import(specifier);
    } else {
      const packageSegments = specifier.split('/');
      const packageName = specifier.startsWith('@')
        ? packageSegments.slice(0, 2).join('/')
        : packageSegments[0];
      if (!/^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(packageName)
        || packageSegments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw new Error(`Invalid JavaScript package import path '${specifier}'.`);
      }
      if (!referrer) throw new Error(`Cannot resolve npm package '${packageName}' without a .naide source file.`);
      if (!this.isDeclaredDependency(packageName, referrer)) {
        throw new Error(`JavaScript package '${packageName}' is not declared in this project manifest. Add it to dependencies before importing it.`);
      }
      const parentUrl = pathToFileURL(referrer).href;
      let resolvedUrl;
      try {
        resolvedUrl = import.meta.resolve(specifier, parentUrl);
      } catch (error) {
        try {
          resolvedUrl = pathToFileURL(createRequire(referrer).resolve(specifier)).href;
        } catch {
          throw new Error(`Cannot resolve declared JavaScript package import '${specifier}': ${error.message}`);
        }
      }
      if (!resolvedUrl.startsWith('file:')) {
        throw new Error(`JavaScript package '${specifier}' resolved to an unsupported module URL.`);
      }
      namespace = await import(resolvedUrl);
    }
    this.hostModuleNamespaces.set(specifier, namespace);
    return namespace;
  }

  isDeclaredDependency(packageName, referrer) {
    let directory = dirname(referrer);
    while (true) {
      if (!directory.split(sep).some(segment => ['node_modules', 'naide_modules'].includes(segment))) {
        for (const filename of ['nidpackage.json', 'package.json']) {
          const manifestPath = resolve(directory, filename);
          if (!existsSync(manifestPath)) continue;
          let manifest;
          try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          } catch (error) {
            throw new Error(`Project manifest '${manifestPath}' is invalid JSON: ${error.message}`);
          }
          if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
            throw new TypeError(`Project manifest '${manifestPath}' must contain an object.`);
          }
          for (const field of ['dependencies', 'optionalDependencies']) {
            if (Object.hasOwn(manifest[field] || {}, packageName)) return true;
          }
        }
      }
      const parent = dirname(directory);
      if (parent === directory) return false;
      directory = parent;
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
    const specifier = this.readModuleSpecifier(node.source);
    const namespace = await this.loadModuleNamespaceAsync(specifier, environment);
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

  async loadModuleNamespaceAsync(specifier, environment) {
    const referrer = this.findModulePath(environment);
    let namespace;
    if (specifier.startsWith('node:')) {
      namespace = await this.loadHostModule(specifier, referrer);
    } else {
      let path;
      try {
        path = this.resolveModulePath(specifier, environment);
      } catch (error) {
        if (specifier.startsWith('./') || specifier.startsWith('../')
          || (!error.message.includes('not a NAIDE source package')
            && !error.message.startsWith('Cannot resolve NAIDE package'))) {
          throw error;
        }
        namespace = await this.loadHostModule(specifier, referrer);
      }
      if (path) {
        const ancestors = referrer
          ? [...(this.moduleAncestors.get(referrer) || []), referrer]
          : [];
        namespace = await this.loadModuleAsync(path, ancestors);
      }
    }
    return namespace;
  }

  async evaluateDynamicImport(node, environment) {
    if (node.args.length === 0) {
      throw new Error('Native dynamic import expects one argument.');
    }
    if (node.args.length > 1) {
      throw new Error('Native dynamic import options are not supported yet.');
    }
    const specifier = await this.evaluateAsync(node.args[0], environment);
    if (typeof specifier !== 'string') {
      throw new TypeError('Native dynamic import path must evaluate to a string.');
    }
    return new PromiseValue(this.loadModuleNamespaceAsync(specifier, environment));
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
    if (node.type === 'ClassDecl') {
      node = {
        ...node,
        fields: node.fields.map(field => ({
          name: field.name,
          type: field.type,
          defaultValue: field.modifiers.find(modifier => modifier.name === 'default')?.args[0] ?? null,
        })),
        init: node.init ? {
          ...node.init,
          type: 'Function',
          name: `${node.name}.init`,
          isAsync: false,
          isGenerator: false,
          returnType: null,
        } : null,
        staticFields: [],
      };
    }
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
      case 'ClassDecl':
        environment.define(node.name, this.createModel(node, environment), false);
        return;
      case 'Function':
        environment.define(node.name, this.createFunction(node, environment), false);
        return;
      case 'PromptDecl':
        environment.define(
          node.name,
          this.createNativePrompt(node, node.defaults ? this.evaluate(node.defaults, environment) : {}),
          false,
        );
        return;
      case 'TestDecl': {
        const name = this.evaluate(node.name, environment);
        const scope = new Environment(environment);
        try {
          this.executeStatements(node.body, scope);
        } catch (error) {
          if (!(error instanceof ReturnSignal)) throw error;
        }
        this.output.log?.(`PASS ${formatValue(name)}`);
        return;
      }
      case 'QueueDecl':
        environment.define(node.name, this.createNativeQueue(node, environment), false);
        return;
      case 'LoggingDecl':
        environment.define('logger', this.createNativeLogger(node), false);
        return;
      case 'Screen':
        this.executeNativeScreen(node, environment);
        return;
      case 'CliApp':
        throw new Error('Native CLI applications require asynchronous execution.');
      case 'EveryDecl':
      case 'WatchDecl':
      case 'On':
      case 'DbConnect':
      case 'DbSql':
      case 'Bot':
      case 'StorageDecl':
      case 'MailConfig':
      case 'PushDecl':
        throw new Error(`Native '${node.type}' declarations require asynchronous execution.`);
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
        throw unsupportedNodeError('Native engine', 'statement', node);
    }
  }

  async executeAsyncStatements(statements, environment) {
    for (const statement of statements) {
      try {
        this.tick(statement);
        await this.executeAsyncStatement(statement, environment);
      } catch (error) {
        if (error instanceof ReturnSignal || error instanceof RouteResponseSignal
          || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
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
      case 'DesktopApp':
      case 'OauthDecl':
      case 'PayDecl':
      case 'ImageDecl':
      case 'PdfDecl':
      case 'MigrateDecl':
      case 'GrpcDecl':
      case 'WebrtcDecl':
      case 'BlockchainDecl':
      case 'WsDecl':
        return this.executeNativeServiceDeclaration(node, environment);
      case 'CsvDecl':
        await this.executeNativeCsv(node, environment);
        return;
      case 'Page':
        await this.executeNativePage(node);
        return;
      case 'I18nDecl':
        await this.executeNativeI18n(node, environment);
        return;
      case 'SearchDecl':
        await this.executeNativeSearch(node, environment);
        return;
      case 'CliApp':
        return this.executeNativeCli(node, environment);
      case 'EveryDecl':
        await this.executeNativeEvery(node, environment);
        return;
      case 'WatchDecl':
        this.registerNativeWatch(node, environment);
        return;
      case 'On':
        return this.executeNativeOn(node, environment);
      case 'DbConnect':
        await this.executeNativeDbConnect(node, environment);
        return;
      case 'DbSql':
        await this.executeNativeDbSql(node);
        return;
      case 'Bot':
        await this.executeNativeBot(node, environment);
        return;
      case 'StorageDecl':
        await this.executeNativeStorage(node, environment);
        return;
      case 'MailConfig':
        await this.executeNativeMail(node, environment);
        return;
      case 'PushDecl':
        await this.executeNativePush(node, environment);
        return;
      case 'LoggingDecl':
        environment.define('logger', this.createNativeLogger(node), false);
        return;
      case 'Screen':
        this.executeNativeScreen(node, environment);
        return;
      case 'EnumDecl':
        environment.define(node.name, this.createEnum(node), false);
        return;
      case 'Model':
      case 'ClassDecl':
        environment.define(node.name, this.createModel(node, environment), false);
        return;
      case 'Function':
        environment.define(node.name, this.createFunction(node, environment), false);
        return;
      case 'PromptDecl':
        environment.define(
          node.name,
          this.createNativePrompt(node, node.defaults ? await this.evaluateAsync(node.defaults, environment) : {}),
          false,
        );
        return;
      case 'TestDecl': {
        const name = await this.evaluateAsync(node.name, environment);
        const scope = new Environment(environment);
        try {
          await this.executeAsyncStatements(node.body, scope);
        } catch (error) {
          if (!(error instanceof ReturnSignal)) throw error;
        }
        this.output.log?.(`PASS ${formatValue(name)}`);
        return;
      }
      case 'QueueDecl':
        environment.define(node.name, this.createNativeQueue(node, environment), false);
        return;
      case 'Return':
        if (environment.isRouteScope) {
          throw new RouteResponseSignal({
            kind: 'json',
            value: node.value ? await this.evaluateAsync(node.value, environment) : undefined,
          });
        }
        throw new ReturnSignal(node.value ? await this.evaluateAsync(node.value, environment) : undefined);
      case 'ReturnStatus':
        if (!environment.isRouteScope) throw new Error("'ret.status' is only valid inside a server route.");
        throw new RouteResponseSignal({
          kind: 'json',
          status: await this.evaluateAsync(node.statusCode, environment),
          value: await this.evaluateAsync(node.body, environment),
        });
      case 'ReturnRender': {
        if (!environment.isRouteScope) throw new Error("'ret.render' is only valid inside a server route.");
        const renderer = environment.get('render');
        if (typeof renderer !== 'function') {
          throw new Error("'ret.render' requires a 'view' declaration in the native server.");
        }
        const template = await this.evaluateAsync(node.template, environment);
        const data = node.data ? await this.evaluateAsync(node.data, environment) : {};
        throw new RouteResponseSignal({
          kind: 'html',
          value: await renderer(template, data),
        });
      }
      case 'ReturnDownload': {
        if (!environment.isRouteScope) throw new Error("'ret.download' is only valid inside a server route.");
        const filePath = await this.evaluateAsync(node.filePath, environment);
        if (typeof filePath !== 'string' || filePath.length === 0) {
          throw new TypeError('Native download paths must evaluate to non-empty relative paths.');
        }
        const downloadName = node.filename
          ? await this.evaluateAsync(node.filename, environment)
          : basename(filePath);
        if (typeof downloadName !== 'string' || downloadName.length === 0) {
          throw new TypeError('Native download filenames must evaluate to non-empty strings.');
        }
        const bytes = await readFile(await this.resolveIOPath(filePath));
        throw new RouteResponseSignal({ kind: 'download', value: bytes, filename: downloadName });
      }
      case 'ReturnRedirect':
        if (!environment.isRouteScope) throw new Error("'ret.redirect' is only valid inside a server route.");
        throw new RouteResponseSignal({
          kind: 'redirect',
          status: await this.evaluateAsync(node.statusCode, environment),
          value: await this.evaluateAsync(node.url, environment),
        });
      case 'ReturnMethod': {
        if (!environment.isRouteScope) throw new Error(`'ret.${node.method}' is only valid inside a server route.`);
        const value = await this.evaluateAsync(node.value, environment);
        throw new RouteResponseSignal({ kind: node.method, value });
      }
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
      case 'Swap': {
        const first = this.readAssignable(node.a, environment);
        const second = this.readAssignable(node.b, environment);
        this.assign(node.a, second, environment);
        this.assign(node.b, first, environment);
        return;
      }
      case 'AwaitAll':
        await Promise.all(node.expressions.map(async expression => this.unwrapPromiseValue(await this.evaluateAsync(expression, environment))));
        return;
      case 'Use':
      case 'UseDestructured':
        return this.importModuleAsync(node, environment);
      case 'DbDir':
        this.databaseDirectory = this.nativeLiteralString(node.path, 'The db directory path');
        return;
      case 'EnvDecl':
        return this.executeEnvironmentDeclaration(node, environment);
      case 'SchemaDecl':
        return this.executeSchemaDeclaration(node, environment);
      case 'Server':
        return this.executeNativeServer(node, environment);
      default:
        throw unsupportedNodeError('Native async engine', 'statement', node);
    }
  }

  async executeEnvironmentDeclaration(node, environment) {
    for (const variable of node.vars) {
      const rules = Object.fromEntries(variable.modifiers.map(modifier => [modifier.name, modifier]));
      let value = this.runtime.env.get(variable.name);
      if (value === undefined && rules.default?.args?.length) {
        value = await this.evaluateAsync(rules.default.args[0], environment);
      }
      if (value === undefined && rules.required) {
        throw new Error(`Required environment variable '${variable.name}' is not available. Pass it explicitly with --env ${variable.name}.`);
      }
      if (value !== undefined) {
        switch (variable.type) {
          case 'str':
          case 'string':
            value = String(value);
            break;
          case 'int':
          case 'integer':
            value = Number(value);
            if (!Number.isSafeInteger(value)) throw new TypeError(`Environment variable '${variable.name}' must be a safe integer.`);
            break;
          case 'num':
          case 'number':
            value = Number(value);
            if (!Number.isFinite(value)) throw new TypeError(`Environment variable '${variable.name}' must be a finite number.`);
            break;
          case 'bool':
          case 'boolean':
            if (value === 'true' || value === '1' || value === true) value = true;
            else if (value === 'false' || value === '0' || value === false) value = false;
            else throw new TypeError(`Environment variable '${variable.name}' must be true, false, 1, or 0.`);
            break;
          default:
            throw new TypeError(`Unsupported environment variable type '${variable.type}'.`);
        }
      }
      environment.define(variable.name, value);
    }
  }

  nativeLiteralString(value, label) {
    if (typeof value === 'string') return value;
    if (value?.parts && value.parts.every(part => part.type === 'text')) {
      return value.parts.map(part => part.value).join('');
    }
    throw new TypeError(`${label} must be a string literal without interpolation.`);
  }

  async executeNativePage(node) {
    const filename = this.nativeLiteralString(node.filename, 'A native page output path');
    const body = [];
    const head = [];
    let title = 'NAIDE Page';
    let language = 'en';
    for (const element of node.elements) {
      const elementTag = element.tag.toLowerCase();
      if (element.tag === 'title') {
        title = this.nativeLiteralString(element.args[0], 'A native page title');
      } else if (element.tag === 'lang') {
        language = this.nativeLiteralString(element.args[0], 'A native page language');
      } else if (element.tag === 'meta') {
        const name = this.nativeLiteralString(element.args[0], 'A native page meta name');
        const content = this.nativeLiteralString(element.args[1], 'A native page meta content');
        head.push(`<meta name="${this.escapeNativeHtmlAttribute(name)}" content="${this.escapeNativeHtmlAttribute(content)}">`);
      } else if (elementTag === 'style' || elementTag === 'link') {
        const href = this.nativeLiteralString(element.args[0], 'A native page stylesheet URL');
        head.push(`<link rel="stylesheet" href="${this.escapeNativeHtmlAttribute(this.nativePageUrl(href, 'stylesheet'))}">`);
      } else if (elementTag === 'script' || elementTag === 'module') {
        const src = this.nativeLiteralString(element.args[0], 'A native page script URL');
        body.push(`<script${elementTag === 'module' ? ' type="module"' : ''} src="${this.escapeNativeHtmlAttribute(this.nativePageUrl(src, 'script'))}"></script>`);
      } else {
        body.push(this.renderNativePageElement(element));
      }
    }
    const html = [
      '<!DOCTYPE html>',
      `<html lang="${this.escapeNativeHtmlAttribute(language)}">`,
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<title>${this.escapeNativeHtmlText(title)}</title>`,
      ...head,
      '</head>',
      '<body>',
      ...body,
      '</body>',
      '</html>',
    ].join('\n');
    await this.io.writeText(filename, html);
  }

  executeNativeScreen(node, environment) {
    const component = () => Object.freeze({
      type: 'View',
      props: Object.freeze({ style: Object.freeze({ flex: 1, padding: 16, justifyContent: 'center' }) }),
      children: Object.freeze(node.elements.map(element => {
        if (element.type !== 'ScreenElement') {
          throw new TypeError(`Native screen '${node.name}' contains a non-screen element.`);
        }
        const value = element.args[0]
          ? this.nativeLiteralString(element.args[0], `A native screen '${element.tag}' value`)
          : '';
        if (element.tag === 'button') {
          return Object.freeze({
            type: 'Button',
            props: Object.freeze({
              title: value,
              onPress: async (...args) => {
                const scope = new Environment(environment);
                for (const [index, parameter] of (element.params || []).entries()) scope.define(parameter, args[index]);
                await this.executeAsyncStatements(element.body, scope);
              },
            }),
            children: Object.freeze([]),
          });
        }
        if (element.tag === 'input') {
          return Object.freeze({
            type: 'TextInput',
            props: Object.freeze({ placeholder: value }),
            children: Object.freeze([]),
          });
        }
        if (element.tag === 'image') {
          if (!value || isAbsolute(value) || value.split(/[\\/]/).some(part => part === '..' || part === '.')) {
            throw new Error(`Native screen image path '${value}' must be a safe project-relative path.`);
          }
          return Object.freeze({
            type: 'Image',
            props: Object.freeze({ source: value }),
            children: Object.freeze([]),
          });
        }
        return Object.freeze({
          type: 'Text',
          props: Object.freeze({}),
          children: Object.freeze([value]),
        });
      })),
    });
    environment.define(node.name, component, false);
  }

  renderNativePageElement(element) {
    const tag = element.tag.toLowerCase();
    const args = (element.args || []).map(value => this.nativeLiteralString(value, `A native page '${tag}' argument`));
    if (tag === 'style' || tag === 'link') {
      const href = this.nativePageUrl(args[0] || '', 'stylesheet');
      return `<link rel="stylesheet" href="${this.escapeNativeHtmlAttribute(href)}">`;
    }
    if (tag === 'script' || tag === 'module') {
      const src = this.nativePageUrl(args[0] || '', 'script');
      return `<script${tag === 'module' ? ' type="module"' : ''} src="${this.escapeNativeHtmlAttribute(src)}"></script>`;
    }
    const attributes = [];
    for (const child of element.children || []) {
      const name = child.tag === 'attr'
        ? this.nativeLiteralString(child.args[0], 'A native page attribute name')
        : child.tag;
      const value = child.tag === 'attr'
        ? this.nativeLiteralString(child.args[1], 'A native page attribute value')
        : this.nativeLiteralString(child.args[0], `A native page '${name}' attribute`);
      if (!/^(?:id|class|title|type|name|href|src|alt|placeholder|value|for|role|action|method|target|rel|width|height|autocomplete|min|max|step|rows|cols|maxlength|minlength|pattern|aria-[a-z0-9-]+|data-[a-z0-9-]+|disabled|required|checked|selected|multiple|readonly|autofocus|novalidate)$/.test(name)) {
        throw new Error(`Unsupported or unsafe native page attribute '${name}'.`);
      }
      if (/^(?:href|src|action|formaction)$/.test(name) && value
        && !/^(?:https?:|mailto:|\/|#|\.\/|\.\.\/)/i.test(value)) {
        throw new Error(`Unsafe native page URL '${value}'.`);
      }
      attributes.push(value === '' && /^(?:disabled|required|checked|selected|multiple|readonly|autofocus|novalidate)$/.test(name)
        ? name
        : `${name}="${this.escapeNativeHtmlAttribute(value)}"`);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(tag) || ['script', 'style', 'iframe', 'object', 'embed'].includes(tag)) {
      throw new Error(`Unsupported or unsafe native page element '${element.tag}'.`);
    }
    let inferredAttribute = '';
    if (tag === 'a' && args[0]) inferredAttribute = ` href="${this.escapeNativeHtmlAttribute(this.nativePageUrl(args[0], 'link'))}"`;
    if (tag === 'input') {
      if (args[0]) inferredAttribute += ` type="${this.escapeNativeHtmlAttribute(args[0])}"`;
      if (args[1]) inferredAttribute += ` name="${this.escapeNativeHtmlAttribute(args[1])}" placeholder="${this.escapeNativeHtmlAttribute(args[1])}"`;
    }
    if (tag === 'img' && args[0]) {
      inferredAttribute = ` src="${this.escapeNativeHtmlAttribute(this.nativePageUrl(args[0], 'image'))}"`;
      if (args[1]) inferredAttribute += ` alt="${this.escapeNativeHtmlAttribute(args[1])}"`;
    }
    const content = this.escapeNativeHtmlText(
      tag === 'a' ? (args[1] || '') : (['img', 'input', 'link'].includes(tag) ? '' : (args[0] || '')),
    );
    const nested = (element.children || [])
      .filter(child => !this.isNativePageAttribute(child.tag))
      .map(child => this.renderNativePageElement(child))
      .join('');
    const renderedAttributes = attributes.length ? ` ${attributes.join(' ')}` : '';
    if (['area', 'base', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'].includes(tag)) {
      if (content || nested) throw new Error(`Void native page element '${tag}' cannot contain content.`);
      return `<${tag}${inferredAttribute}${renderedAttributes}>`;
    }
    return `<${tag}${inferredAttribute}${renderedAttributes}>${content}${nested}</${tag}>`;
  }

  nativePageUrl(value, kind) {
    const allowed = kind === 'link'
      ? /^(?:https?:|mailto:|\/|#|\.\/|\.\.\/)/i
      : /^(?:https?:|\/|\.\/|\.\.\/)/i;
    if (!value || !allowed.test(value)) throw new Error(`Unsafe native page ${kind} URL '${value}'.`);
    return value;
  }

  isNativePageAttribute(name) {
    return name === 'attr' || new Set([
      'id', 'class', 'title', 'type', 'name', 'href', 'src', 'alt', 'placeholder', 'value',
      'for', 'role', 'action', 'method', 'target', 'rel', 'width', 'height', 'autocomplete',
      'min', 'max', 'step', 'rows', 'cols', 'maxlength', 'minlength', 'pattern', 'disabled',
      'required', 'checked', 'selected', 'multiple', 'readonly', 'autofocus', 'novalidate',
    ]).has(name) || name.startsWith('data-') || name.startsWith('aria-');
  }

  escapeNativeHtmlText(value) {
    return String(value).replace(/[&<>"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    })[character]);
  }

  escapeNativeHtmlAttribute(value) {
    return this.escapeNativeHtmlText(value).replace(/'/g, '&#39;');
  }

  async executeNativeI18n(node, environment) {
    const directory = this.nativeLiteralString(node.dir, 'A native locale directory');
    const defaultLanguage = node.defaultLang
      ? this.nativeLiteralString(node.defaultLang, 'A native default locale')
      : 'en';
    const translations = Object.create(null);
    for (const locale of node.langs) {
      const code = this.nativeLiteralString(locale.code, 'A native locale code');
      const file = this.nativeLiteralString(locale.file, 'A native locale file');
      const contents = await this.io.readText(join(directory, file));
      const values = JSON.parse(contents);
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError(`Native locale '${code}' must contain a JSON object.`);
      }
      translations[code] = values;
    }
    if (!Object.hasOwn(translations, defaultLanguage)) {
      throw new Error(`Native default locale '${defaultLanguage}' has no declared translation file.`);
    }
    let currentLanguage = defaultLanguage;
    const i18n = Object.freeze({
      t: (key, params = {}) => {
        if (typeof key !== 'string') throw new TypeError('i18n.t expects a string key.');
        if (!params || typeof params !== 'object' || Array.isArray(params)) {
          throw new TypeError('i18n.t parameters must be an object.');
        }
        const value = key.split('.').reduce(
          (current, part) => current && Object.hasOwn(current, part) ? current[part] : undefined,
          translations[currentLanguage],
        );
        let text = typeof value === 'string' ? value : key;
        for (const [name, replacement] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, String(replacement));
        }
        return text;
      },
      setLang: code => {
        if (typeof code !== 'string' || !Object.hasOwn(translations, code)) {
          throw new Error(`Native locale '${code}' is not declared.`);
        }
        currentLanguage = code;
      },
      getLang: () => currentLanguage,
    });
    environment.define('i18n', i18n, false);
  }

  createNativeLogger(node) {
    const name = this.nativeLiteralString(node.name, 'A native logger name');
    const level = node.level ? this.nativeLiteralString(node.level, 'A native logger level') : 'info';
    const file = node.file ? this.nativeLiteralString(node.file, 'A native logger file') : null;
    const format = node.format ? this.nativeLiteralString(node.format, 'A native logger format') : 'text';
    if (node.rotate) throw new Error('Native logging does not support file rotation yet.');
    const priorities = ['error', 'warn', 'info', 'debug'];
    if (!priorities.includes(level)) throw new TypeError(`Unsupported native logger level '${level}'.`);
    if (format !== 'text' && format !== 'json') throw new TypeError(`Unsupported native logger format '${format}'.`);
    const logger = {};
    for (const method of priorities) {
      logger[method] = async (...values) => {
        if (priorities.indexOf(method) > priorities.indexOf(level)) return;
        const message = values.map(value => formatValue(value)).join(' ');
        const line = format === 'json'
          ? JSON.stringify({ timestamp: new Date().toISOString(), level: method, logger: name, message })
          : `[${method.toUpperCase()}] [${name}] ${message}`;
        const writer = this.output[method] || this.output.log;
        writer?.(line);
        if (file) await this.io.appendText(file, `${line}\n`);
      };
    }
    return Object.freeze(logger);
  }

  async executeNativeCli(node, environment) {
    const description = node.description
      ? this.nativeLiteralString(node.description, `A description for native CLI '${node.name}'`)
      : node.name;
    const args = Object.create(null);
    const definitions = new Map(node.args.map(argument => [
      this.nativeLiteralString(argument.name, `An argument name for native CLI '${node.name}'`),
      argument,
    ]));
    const flags = new Map(node.flags.flatMap(flag => {
      const short = this.nativeLiteralString(flag.short, `A short flag for native CLI '${node.name}'`);
      const long = this.nativeLiteralString(flag.long, `A long flag for native CLI '${node.name}'`);
      return [[`-${short}`, long], [`--${long}`, long]];
    }));
    const tokens = this.runtime.args;
    if (tokens.includes('--help') || tokens.includes('-h')) {
      this.output.log?.(description);
      this.output.log?.('Options:');
      for (const [name, argument] of definitions) {
        this.output.log?.(`  --${name} <${argument.type}>${argument.description ? `  ${this.nativeLiteralString(argument.description, 'A CLI argument description')}` : ''}`);
      }
      for (const [short, long] of flags) {
        if (!short.startsWith('-') || short.startsWith('--')) continue;
        const definition = node.flags.find(flag => this.nativeLiteralString(flag.long, 'A CLI flag name') === long);
        this.output.log?.(`  ${short}, --${long}${definition?.description ? `  ${this.nativeLiteralString(definition.description, 'A CLI flag description')}` : ''}`);
      }
      return;
    }
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (flags.has(token)) {
        args[flags.get(token)] = true;
        continue;
      }
      if (!token.startsWith('--')) throw new Error(`Unexpected positional argument '${token}' for native CLI '${node.name}'.`);
      const name = token.slice(2);
      const definition = definitions.get(name);
      if (!definition) throw new Error(`Unknown option '--${name}' for native CLI '${node.name}'.`);
      const value = tokens[++index];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Option '--${name}' requires a ${definition.type} value.`);
      }
      switch (definition.type) {
        case 'int': {
          const parsed = Number(value);
          if (!Number.isSafeInteger(parsed)) throw new TypeError(`Option '--${name}' must be a safe integer.`);
          args[name] = parsed;
          break;
        }
        case 'num': {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) throw new TypeError(`Option '--${name}' must be a finite number.`);
          args[name] = parsed;
          break;
        }
        case 'bool':
          if (value !== 'true' && value !== 'false') throw new TypeError(`Option '--${name}' must be true or false.`);
          args[name] = value === 'true';
          break;
        case 'str':
        case 'string':
          args[name] = value;
          break;
        default:
          throw new TypeError(`Unsupported native CLI argument type '${definition.type}'.`);
      }
    }
    if (!node.run) return;
    const scope = new Environment(environment);
    scope.define('args', args, false);
    for (const parameter of node.run.params) {
      if (parameter !== 'args') scope.define(parameter, args, false);
    }
    await this.executeAsyncStatements(node.run.body, scope);
  }

  async executeNativeSearch(node, environment) {
    const engine = this.nativeLiteralString(node.engine, 'A native search engine');
    if (!['meilisearch', 'elasticsearch'].includes(engine)) {
      throw new Error(`Native search does not support '${engine}'; use 'meilisearch' or 'elasticsearch'.`);
    }
    const host = await this.evaluateAsync(node.host, environment);
    const apiKey = await this.evaluateAsync(node.apiKey, environment);
    const index = node.index
      ? this.nativeLiteralString(node.index, 'A native search index')
      : 'default';
    if (typeof host !== 'string' || typeof apiKey !== 'string' || !apiKey) {
      throw new TypeError('Native search host and API key must be non-empty strings.');
    }
    let base;
    try {
      base = new URL(host);
    } catch (error) {
      throw new TypeError(`Native search host must be an absolute HTTP(S) URL: ${error.message}`);
    }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new TypeError('Native search host must be an HTTP(S) URL without credentials, query, or fragment.');
    }
    const baseUrl = `${base.origin}${base.pathname.replace(/\/+$/, '')}`;
    const encodedIndex = encodeURIComponent(index);
    const request = async (method, endpoint, body) => {
      const response = await this.http.request(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Native ${engine} request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
      }
      if (response.status === 204) return null;
      return response.json();
    };
    const search = engine === 'meilisearch'
      ? {
          query: (query, options = {}) => {
            if (typeof query !== 'string') throw new TypeError('search.query expects a string query.');
            return request('POST', `/indexes/${encodedIndex}/search`, { ...options, q: query });
          },
          add: documents => request('POST', `/indexes/${encodedIndex}/documents`, documents),
          update: documents => request('PUT', `/indexes/${encodedIndex}/documents`, documents),
          remove: id => request('DELETE', `/indexes/${encodedIndex}/documents/${encodeURIComponent(String(id))}`),
        }
      : {
          query: (query, options = {}) => request('POST', `/${encodedIndex}/_search`, {
            query: { match: { _all: query } },
            ...options,
          }),
          add: document => request('POST', `/${encodedIndex}/_doc`, document),
          update: document => {
            if (!document || typeof document !== 'object' || document.id === undefined) {
              throw new TypeError('Native Elasticsearch updates require a document with an id field.');
            }
            return request('PUT', `/${encodedIndex}/_doc/${encodeURIComponent(String(document.id))}`, document);
          },
          remove: id => request('DELETE', `/${encodedIndex}/_doc/${encodeURIComponent(String(id))}`),
        };
    environment.define('search', Object.freeze(search), false);
  }

  async executeNativeEvery(node, environment) {
    const interval = await this.evaluateAsync(node.interval, environment);
    let milliseconds = interval;
    if (typeof interval === 'string') {
      const match = /^(\d+)(ms|s|m|h|d)$/.exec(interval.trim());
      if (!match) throw new Error('Native every supports numeric intervals or duration strings ending in ms, s, m, h, or d; cron expressions are not supported.');
      const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
      milliseconds = Number(match[1]) * unit;
    }
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647) {
      throw new RangeError('Native every interval must be an integer from 1 to 2147483647 milliseconds.');
    }
    const invoke = async () => {
      try {
        await this.executeAsyncStatements(node.body, new Environment(environment));
      } catch (error) {
        (this.output.error || this.output.log || console.error)(`[NAIDE every] ${error.message}`);
      }
    };
    await invoke();
    const timer = setInterval(invoke, milliseconds);
    this.scheduleHandles.add(timer);
  }

  registerNativeWatch(node, environment) {
    const eventName = node.eventName;
    this.nativeEventBus.on(eventName, async payload => {
      const scope = new Environment(environment);
      const parameters = node.params.length ? node.params : ['event'];
      parameters.forEach((name, index) => scope.define(name, index === 0 ? payload : undefined));
      await this.executeAsyncStatements(node.body, scope);
    });
  }

  async executeNativeOn(node, environment) {
    const listener = async () => {
      await this.executeAsyncStatements(node.body, new Environment(environment));
    };
    if (node.event.type === 'MemberAccess') {
      const emitter = await this.evaluateAsync(node.event.object, environment);
      if (!emitter || typeof emitter.on !== 'function') {
        throw new TypeError(`Native event target '${node.event.property}' must expose an on(event, listener) method.`);
      }
      return emitter.on(node.event.property, listener);
    }
    const subscribe = await this.evaluateAsync(node.event, environment);
    if (typeof subscribe !== 'function') throw new TypeError('Native on declaration requires an event subscription function.');
    return this.call(subscribe, [listener]);
  }

  requireNativeDatabase() {
    if (!this.database) {
      throw new Error('NaideVM SQL requires a host database capability. Pass database.connect and database.createStore to NaideVM.');
    }
    return this.database;
  }

  async executeNativeBot(node, environment) {
    if (!this.bot) {
      throw new Error('Native bot declarations require a host bot capability. Pass bot.create(options) to NativeEngine.');
    }
    const platform = node.botType
      ? this.nativeLiteralString(node.botType, 'A native bot platform')
      : 'discord';
    if (!['discord', 'slack', 'telegram', 'line'].includes(platform)) {
      throw new Error(`Native bot platform '${platform}' is not supported.`);
    }
    const token = node.token
      ? await this.evaluateAsync(node.token, environment)
      : this.runtime.env.get('BOT_TOKEN');
    if (typeof token !== 'string' || !token) {
      throw new Error(`Native ${platform} bot requires a token expression or an explicitly provided BOT_TOKEN runtime value.`);
    }
    const prefix = node.prefix ? await this.evaluateAsync(node.prefix, environment) : '!';
    if (typeof prefix !== 'string') throw new TypeError('Native bot prefix must be a string.');
    const client = await this.bot.create({ name: node.name, platform, token, prefix });
    if (!client || typeof client.on !== 'function' || typeof client.command !== 'function'
      || typeof client.start !== 'function') {
      throw new TypeError('Native bot adapter must return a client with on, command, and start methods.');
    }
    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const event = this.nativeLiteralString(handler.event, `An event name for native bot '${node.name}'`);
        client.on(event, async (...values) => {
          const scope = new Environment(environment);
          const parameters = handler.params.length ? handler.params : ['event'];
          parameters.forEach((name, index) => scope.define(name, values[index]));
          await this.executeAsyncStatements(handler.body, scope);
        });
      } else if (handler.type === 'BotSlashCmd') {
        const name = this.nativeLiteralString(handler.name, `A slash command name for native bot '${node.name}'`);
        const description = this.nativeLiteralString(handler.description, `A slash command description for native bot '${node.name}'`);
        client.command(name, description, async (...values) => {
          const scope = new Environment(environment);
          const parameters = handler.params.length ? handler.params : ['interaction'];
          parameters.forEach((parameter, index) => scope.define(parameter, values[index]));
          await this.executeAsyncStatements(handler.body, scope);
        });
      } else {
        throw unsupportedNodeError('Native bot adapter', 'handler', handler);
      }
    }
    await client.start(token);
    environment.define(node.name, client, false);
  }

  async executeNativeStorage(node, environment) {
    if (!this.storage) {
      throw new Error('NaideVM object storage requires a host storage capability. Pass storage.connect(options) to NaideVM.');
    }
    const provider = this.nativeLiteralString(node.provider, 'A native storage provider');
    if (!['s3', 'gcs'].includes(provider)) {
      throw new Error(`Native storage provider '${provider}' is unsupported; use 's3' or 'gcs'.`);
    }
    const bucket = await this.evaluateAsync(node.bucket, environment);
    const accessKey = await this.evaluateAsync(node.accessKey, environment);
    const secretKey = await this.evaluateAsync(node.secretKey, environment);
    if ([bucket, accessKey, secretKey].some(value => typeof value !== 'string' || !value)) {
      throw new TypeError('Native storage bucket and credentials must be non-empty strings.');
    }
    const options = {
      provider,
      bucket,
      accessKey,
      secretKey,
      region: node.region ? this.nativeLiteralString(node.region, 'A native storage region') : 'us-east-1',
    };
    const client = await this.storage.connect(options);
    const methods = ['upload', 'download', 'remove'];
    if (!client || methods.some(method => typeof client[method] !== 'function')) {
      throw new TypeError(`Native storage adapter must return a client with ${methods.join(', ')} methods.`);
    }
    environment.define('storage', client, false);
  }

  async executeNativeMail(node, environment) {
    if (!this.mailer) {
      throw new Error('NaideVM mail requires a host mailer capability. Pass mailer.createTransport(options) to NaideVM.');
    }
    const host = this.nativeLiteralString(node.host, 'A native mail host');
    const port = await this.evaluateAsync(node.port, environment);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new TypeError('Native mail host and port must be valid; port must be between 1 and 65535.');
    }
    const user = node.user ? await this.evaluateAsync(node.user, environment) : this.runtime.env.get('MAIL_USER');
    const pass = node.pass ? await this.evaluateAsync(node.pass, environment) : this.runtime.env.get('MAIL_PASS');
    if ((user === undefined) !== (pass === undefined)) {
      throw new Error('Native mail authentication requires both MAIL_USER and MAIL_PASS values.');
    }
    if (user !== undefined && (typeof user !== 'string' || typeof pass !== 'string')) {
      throw new TypeError('Native mail credentials must be strings.');
    }
    const transport = this.mailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user === undefined ? {} : { auth: { user, pass } }),
    });
    if (!transport || typeof transport.sendMail !== 'function') {
      throw new TypeError('Native mail adapter must return a transport with sendMail(options).');
    }
    environment.define('mail', transport, false);
  }

  async executeNativePush(node, environment) {
    if (!this.push) {
      throw new Error('NaideVM push requires a host Web Push capability. Pass push.configure(options) to NaideVM.');
    }
    const publicKey = await this.evaluateAsync(node.publicKey, environment);
    const privateKey = await this.evaluateAsync(node.privateKey, environment);
    if (typeof publicKey !== 'string' || !publicKey || typeof privateKey !== 'string' || !privateKey) {
      throw new TypeError('Native Web Push keys must be non-empty strings.');
    }
    const endpoint = node.endpoint
      ? this.nativeLiteralString(node.endpoint, 'A native Web Push endpoint')
      : '/subscribe';
    const sender = await this.push.configure({ publicKey, privateKey, subject: 'mailto:noreply@example.com' });
    if (!sender || typeof sender.sendNotification !== 'function') {
      throw new TypeError('Native push adapter must return an object with sendNotification(subscription, payload).');
    }
    const push = Object.freeze({
      endpoint,
      send: (subscription, title, body, data = {}) => {
        if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
          throw new TypeError('push.send requires a subscription object.');
        }
        return sender.sendNotification(subscription, JSON.stringify({ title, body, data }));
      },
      sendAll: (subscriptions, title, body, data = {}) => {
        if (!Array.isArray(subscriptions)) throw new TypeError('push.sendAll expects a list of subscriptions.');
        return Promise.allSettled(subscriptions.map(subscription =>
          sender.sendNotification(subscription, JSON.stringify({ title, body, data }))));
      },
    });
    environment.define('push', push, false);
  }

  async executeNativeDbConnect(node, environment) {
    const connectionString = await this.evaluateAsync(node.connectionString, environment);
    if (typeof connectionString !== 'string' || !connectionString) {
      throw new TypeError('db.connect requires a non-empty connection string.');
    }
    const database = this.requireNativeDatabase();
    const connection = await database.connect({ driver: 'sqlite', connection: connectionString });
    if (connection == null) throw new TypeError('Native database connect returned no connection.');
    environment.define('db', connection, false);
  }

  async executeNativeDbSql(node) {
    const driver = this.nativeLiteralString(node.driver, 'A native SQL driver').toLowerCase();
    if (driver !== 'sqlite' && driver !== 'postgres' && driver !== 'pg') {
      throw new Error(`Native SQL does not support driver '${driver}'; use 'sqlite' or 'postgres'.`);
    }
    let connectionString;
    if (node.connection) {
      connectionString = this.nativeLiteralString(node.connection, 'A native SQL connection string');
    } else if (driver === 'sqlite') {
      connectionString = 'data.db';
    } else {
      connectionString = this.runtime.env.get('DATABASE_URL');
      if (!connectionString) {
        throw new Error('Native postgres requires an explicit connection string or DATABASE_URL runtime value.');
      }
    }
    const database = this.requireNativeDatabase();
    this.sqlDriver = driver === 'pg' ? 'postgres' : driver;
    this.sqlDatabase = await database.connect({ driver: this.sqlDriver, connection: connectionString });
    if (this.sqlDatabase == null) throw new TypeError('Native database connect returned no connection.');
  }

  async executeSchemaDeclaration(node, environment) {
    let inheritedFields = {};
    if (node.parent) {
      const parent = this.schemas.get(node.parent);
      if (!parent) throw new Error(`Schema '${node.name}' extends unknown schema '${node.parent}'.`);
      inheritedFields = { ...parent.fields };
    }
    const fields = { ...inheritedFields };
    const supportedModifiers = new Set(['required', 'optional', 'unique', 'email', 'url', 'auto', 'min', 'max', 'default']);
    for (const field of node.fields) {
      const type = {
        auto: 'id',
        timestamp: 'timestamp',
        str: 'string',
        int: 'integer',
        num: 'number',
        bool: 'boolean',
      }[field.type] || field.type;
      const definition = { type };
      if (field.enumValues) {
        definition.values = [];
        for (const value of field.enumValues) definition.values.push(await this.evaluateAsync(value, environment));
      }
      for (const modifier of field.modifiers) {
        if (!supportedModifiers.has(modifier.name)) {
          throw new Error(`Native schema '${node.name}' does not support modifier '${modifier.name}'.`);
        }
        switch (modifier.name) {
          case 'required': definition.required = true; break;
          case 'optional': definition.required = false; break;
          case 'unique': definition.unique = true; break;
          case 'email': definition.email = true; break;
          case 'url': definition.url = true; break;
          case 'auto': definition.auto = true; break;
          case 'min':
          case 'max':
          case 'default':
            if (modifier.args.length !== 1) throw new Error(`Schema modifier '${modifier.name}' expects one argument.`);
            definition[modifier.name] = await this.evaluateAsync(modifier.args[0], environment);
            break;
          default:
            break;
        }
      }
      fields[field.name] = definition;
    }

    const schema = createSchema(node.name, fields);
    this.schemas.set(node.name, schema);
    environment.define(`${node.name}Schema`, schema);
    let store;
    if (this.sqlDatabase) {
      store = await this.database.createStore({
        driver: this.sqlDriver,
        connection: this.sqlDatabase,
        schema,
      });
      const methods = ['getAll', 'getById', 'create', 'update', 'delete', 'where', 'count', 'clear'];
      if (!store || methods.some(method => typeof store[method] !== 'function')) {
        throw new TypeError(`Native SQL store for schema '${node.name}' must provide ${methods.join(', ')} methods.`);
      }
    } else if (this.databaseDirectory) {
      store = createFileStore(schema, await this.resolveIOPath(
        `${this.databaseDirectory.replace(/[\\/]+$/, '')}/${node.name}.json`,
        true,
      ));
    } else {
      store = createStore(schema);
    }
    store.all = store.getAll;
    environment.define(`${node.name}Store`, store);
  }

  createNativeRouteHandler(route, closure) {
    return async (request, response) => {
      const scope = new Environment(closure);
      scope.isRouteScope = true;
      const values = [request, response];
      const parameters = route.params.length > 0 ? route.params : ['req', 'res'];
      parameters.forEach((name, index) => scope.define(name, values[index]));
      try {
        await this.executeAsyncStatements(route.body, scope);
      } catch (error) {
        if (!(error instanceof RouteResponseSignal)) throw error;
        const result = error.response;
        if (result.status !== undefined) response.status(result.status);
        switch (result.kind) {
          case 'json':
            response.json(result.value);
            break;
          case 'html':
            response.type('html').send(result.value);
            break;
          case 'text':
            response.type('text').send(result.value);
            break;
          case 'send':
            response.send(result.value);
            break;
          case 'download':
            this.applyNativeDownload(result, response);
            break;
          case 'redirect':
            this.validateNativeRedirectStatus(result.status);
            response.redirect(result.value);
            break;
          default:
            throw new Error(`Native server route response method '${result.kind}' is not supported.`);
        }
      }
    };
  }

  createNativeMiddleware(middleware, closure) {
    return async (request, response, next) => {
      const scope = new Environment(closure);
      scope.isRouteScope = true;
      const parameters = middleware.params.length > 0 ? middleware.params : ['req', 'res', 'next'];
      [request, response, next].slice(0, parameters.length)
        .forEach((value, index) => scope.define(parameters[index], value));
      try {
        await this.executeAsyncStatements(middleware.body, scope);
      } catch (error) {
        if (!(error instanceof RouteResponseSignal)) throw error;
        this.applyNativeRouteResponse(error.response, response);
      }
    };
  }

  applyNativeRouteResponse(result, response) {
    if (result.status !== undefined) response.status(result.status);
    if (result.kind === 'json') response.json(result.value);
    else if (result.kind === 'text' || result.kind === 'html') response.type(result.kind).send(result.value);
    else if (result.kind === 'download') this.applyNativeDownload(result, response);
    else if (result.kind === 'redirect') {
      this.validateNativeRedirectStatus(result.status);
      response.redirect(result.value);
    } else throw new Error(`Native route response method '${result.kind}' is not supported.`);
  }

  applyNativeDownload(result, response) {
    const fallback = result.filename
      .replace(/[^\x20-\x7e]|["\\;]/g, '_')
      .replace(/[/\\]/g, '_') || 'download';
    const encoded = encodeURIComponent(result.filename).replace(/['()*]/g, character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.set('content-disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
    response.type('application/octet-stream').send(result.value);
  }

  createNativeErrorHandler(node, closure) {
    return async (error, request, response) => {
      const scope = new Environment(closure);
      scope.isRouteScope = true;
      const parameters = node.params.length > 0 ? node.params : ['err', 'req', 'res'];
      [error, request, response].slice(0, parameters.length)
        .forEach((value, index) => scope.define(parameters[index], value));
      try {
        await this.executeAsyncStatements(node.body, scope);
      } catch (handlerError) {
        if (!(handlerError instanceof RouteResponseSignal)) throw handlerError;
        this.applyNativeRouteResponse(handlerError.response, response);
      }
      return response.headersSent;
    };
  }

  validateNativeRedirectStatus(status) {
    if (status !== undefined && (!Number.isInteger(status) || status < 300 || status > 399)) {
      throw new RangeError('Native redirect status must be an integer between 300 and 399.');
    }
  }

  createNativePrompt(node, defaults) {
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
      throw new TypeError(`Native prompt '${node.name}' defaults must be an object.`);
    }
    const template = node.lines.map(line => line.parts.map(part => (
      part.type === 'expr' ? `{${part.value}}` : part.value
    )).join('')).join('\n');
    return createPrompt(template, defaults);
  }

  async nativeServiceValue(value, environment) {
    if (value?.parts) return this.nativeLiteralString(value, 'A native service string argument');
    return value && typeof value === 'object' && value.type
      ? this.evaluateAsync(value, environment)
      : value;
  }

  createNativeServiceHandlers(events, environment, label) {
    const handlers = Object.create(null);
    for (const event of events) {
      const eventName = event.name ?? event.event;
      const name = eventName?.parts
        ? this.nativeLiteralString(eventName, `A native ${label} event name`)
        : eventName;
      if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError(`Native ${label} event names must be non-empty strings.`);
      }
      if (Object.hasOwn(handlers, name)) {
        throw new Error(`Native ${label} declares event '${name}' more than once.`);
      }
      handlers[name] = async (payload, connection) => {
        const scope = new Environment(environment);
        for (const [index, parameter] of event.params.entries()) {
          const value = event.params.length === 1
            ? payload
            : payload && typeof payload === 'object'
              ? payload[parameter]
              : undefined;
          scope.define(parameter, value);
          if (index === 0 && !scope.bindings.has('data')) scope.define('data', payload);
        }
        if (!scope.bindings.has('connection')) scope.define('connection', connection);
        try {
          await this.executeAsyncStatements(event.body, scope);
        } catch (error) {
          if (error instanceof ReturnSignal) return error.value;
          throw error;
        }
      };
    }
    return Object.freeze(handlers);
  }

  async executeNativeServiceDeclaration(node, environment) {
    switch (node.type) {
      case 'DesktopApp': {
        const title = node.title
          ? this.nativeLiteralString(node.title, 'A native desktop title')
          : node.name;
        const width = node.width ? await this.evaluateAsync(node.width, environment) : 800;
        const height = node.height ? await this.evaluateAsync(node.height, environment) : 600;
        const load = node.load ? await this.evaluateAsync(node.load, environment) : 'index.html';
        if (!Number.isSafeInteger(width) || width < 1 || width > 16384
          || !Number.isSafeInteger(height) || height < 1 || height > 16384) {
          throw new RangeError('Native desktop window dimensions must be safe integers between 1 and 16384.');
        }
        if (typeof load !== 'string' || load.length === 0) {
          throw new TypeError('Native desktop load target must be a non-empty string.');
        }
        const loadPath = await this.resolveIOPath(load);
        const result = await this.requireNativeService('desktop', node.type)({
          name: node.name,
          title,
          width,
          height,
          load: loadPath,
        });
        environment.define(node.name, result, false);
        return;
      }
      case 'OauthDecl': {
        const clientId = await this.evaluateAsync(node.clientId, environment);
        const clientSecret = await this.evaluateAsync(node.clientSecret, environment);
        const provider = this.nativeLiteralString(node.provider, 'A native OAuth provider');
        if (provider.length === 0) throw new TypeError('Native OAuth provider must not be empty.');
        if (typeof clientId !== 'string' || clientId.length === 0
          || typeof clientSecret !== 'string' || clientSecret.length === 0) {
          throw new TypeError('Native OAuth client ID and secret must be non-empty strings.');
        }
        const oauth = await this.requireNativeService('oauth', node.type)({
          provider,
          clientId,
          clientSecret,
          callback: node.callback
            ? this.nativeLiteralString(node.callback, 'A native OAuth callback')
            : '/auth/callback',
          scope: node.scope
            ? this.nativeLiteralString(node.scope, 'A native OAuth scope')
            : 'email profile',
        });
        const providerBinding = `oauth${provider.charAt(0).toUpperCase()}${provider.slice(1).replace(/\W/g, '')}`;
        environment.define(providerBinding, oauth, false);
        if (!environment.bindings.has('oauth')) environment.define('oauth', oauth, false);
        return;
      }
      case 'PayDecl': {
        const secretKey = await this.evaluateAsync(node.secretKey, environment);
        const webhookSecret = node.webhookSecret
          ? await this.evaluateAsync(node.webhookSecret, environment)
          : null;
        const provider = this.nativeLiteralString(node.provider, 'A native payment provider');
        if (provider.length === 0) throw new TypeError('Native payment provider must not be empty.');
        if (typeof secretKey !== 'string' || secretKey.length === 0) {
          throw new TypeError('Native payment provider secret key must be a non-empty string.');
        }
        if (webhookSecret !== null && (typeof webhookSecret !== 'string' || webhookSecret.length === 0)) {
          throw new TypeError('Native payment webhook secret must be a non-empty string.');
        }
        const pay = await this.requireNativeService('payments', node.type)({
          provider,
          secretKey,
          webhookSecret,
          webhook: node.webhook ? this.nativeLiteralString(node.webhook, 'A native payment webhook path') : '/webhook',
          successUrl: node.successUrl ? this.nativeLiteralString(node.successUrl, 'A native payment success URL') : null,
          cancelUrl: node.cancelUrl ? this.nativeLiteralString(node.cancelUrl, 'A native payment cancellation URL') : null,
        });
        environment.define('pay', pay, false);
        return;
      }
      case 'ImageDecl': {
        const input = await this.evaluateAsync(node.input, environment);
        const output = node.output ? await this.evaluateAsync(node.output, environment) : input;
        if (typeof input !== 'string' || input.length === 0 || typeof output !== 'string' || output.length === 0) {
          throw new TypeError('Native image input and output paths must be non-empty strings.');
        }
        const operations = [];
        for (const operation of node.operations) {
          if (!['resize', 'crop', 'watermark', 'rotate', 'blur', 'grayscale', 'greyscale', 'flip', 'format']
            .includes(operation.op)) {
            throw new Error(`Native image processing does not support operation '${operation.op}'.`);
          }
          const args = [];
          for (const argument of operation.args) args.push(await this.nativeServiceValue(argument, environment));
          operations.push({ op: operation.op, args });
        }
        await this.requireNativeService('image', node.type)({
          input: await this.resolveIOPath(input),
          output: await this.resolveIOPath(output, true),
          operations,
        });
        return;
      }
      case 'PdfDecl': {
        const elements = [];
        for (const element of node.elements) {
          const args = [];
          for (const argument of element.args) args.push(await this.nativeServiceValue(argument, environment));
          elements.push({ tag: element.tag, args });
        }
        await this.requireNativeService('pdf', node.type)({
          filename: await this.resolveIOPath(
            this.nativeLiteralString(node.filename, 'A native PDF output path'),
            true,
          ),
          elements,
        });
        return;
      }
      case 'MigrateDecl': {
        const migration = {
          name: this.nativeLiteralString(node.name, 'A native migration name'),
          up: async database => this.executeNativeMigrationBody(node.up, environment, database),
          down: async database => this.executeNativeMigrationBody(node.down, environment, database),
        };
        await this.requireNativeService('migration', node.type)(migration);
        return;
      }
      case 'GrpcDecl': {
        const port = node.port ? await this.evaluateAsync(node.port, environment) : 50051;
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new RangeError('Native gRPC port must be an integer between 1 and 65535.');
        }
        const name = this.nativeLiteralString(node.name, 'A native gRPC service name');
        if (name.length === 0) throw new TypeError('Native gRPC service name must not be empty.');
        const names = new Set();
        const rpcs = Object.create(null);
        for (const rpc of node.rpcs) {
          if (!/^[A-Za-z_]\w*$/.test(rpc.method) || names.has(rpc.method)) {
            throw new TypeError(`Native gRPC method '${rpc.method}' must be a unique identifier.`);
          }
          names.add(rpc.method);
          rpcs[rpc.method] = async request => {
            const scope = new Environment(environment);
            for (const [index, parameter] of rpc.params.entries()) {
              scope.define(parameter, index === 0 ? request : request?.[parameter]);
            }
            try {
              await this.executeAsyncStatements(rpc.body, scope);
            } catch (error) {
              if (error instanceof ReturnSignal) return error.value;
              throw error;
            }
            return undefined;
          };
        }
        await this.requireNativeService('grpc', node.type)({
          name,
          port,
          rpcs: Object.freeze(rpcs),
        });
        return;
      }
      case 'WebrtcDecl': {
        const name = this.nativeLiteralString(node.name, 'A native WebRTC application name');
        const stun = node.stun ? this.nativeLiteralString(node.stun, 'A native STUN server') : 'stun:stun.l.google.com:19302';
        const turn = node.turn ? this.nativeLiteralString(node.turn, 'A native TURN server') : null;
        if (!name || !stun || turn === '') throw new TypeError('Native WebRTC name and ICE server URLs must not be empty.');
        await this.requireNativeService('webrtc', node.type)({
          name,
          stun,
          turn,
          events: this.createNativeServiceHandlers(node.events, environment, 'WebRTC declaration'),
        });
        return;
      }
      case 'BlockchainDecl': {
        const name = this.nativeLiteralString(node.name, 'A native blockchain name');
        const provider = node.provider ? await this.evaluateAsync(node.provider, environment) : 'http://localhost:8545';
        const blockchain = await this.requireNativeService('blockchain', node.type)({
          name,
          network: node.network ? this.nativeLiteralString(node.network, 'A native blockchain network') : 'ethereum',
          provider,
          contract: node.contract ? this.nativeLiteralString(node.contract, 'A native blockchain contract') : null,
          abi: node.abi ? this.nativeLiteralString(node.abi, 'A native blockchain ABI path') : null,
        });
        environment.define(name.replace(/\W/g, '_'), blockchain, false);
        return;
      }
      case 'WsDecl': {
        await this.requireNativeService('websocket', node.type)({
          path: this.nativeLiteralString(node.path, 'A native WebSocket path'),
          events: this.createNativeServiceHandlers(node.events, environment, 'WebSocket declaration'),
        });
        return;
      }
      default:
        throw unsupportedNodeError('Native async engine', 'service declaration', node);
    }
  }

  async executeNativeMigrationBody(statements, environment, database) {
    if (!database || typeof database !== 'object') {
      throw new TypeError('Native migration callbacks require a database object.');
    }
    const scope = new Environment(environment);
    scope.define('db', database, false);
    try {
      await this.executeAsyncStatements(statements, scope);
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value;
      throw error;
    }
  }

  async executeNativeCsv(node, environment) {
    const name = this.nativeLiteralString(node.name, 'A native CSV export name');
    const format = node.format
      ? this.nativeLiteralString(node.format, 'A native CSV export format')
      : 'csv';
    if (format !== 'csv') {
      throw new Error(`Native CSV export does not support '${format}' format yet; use 'csv'.`);
    }
    const columns = node.columns.map(column => this.nativeLiteralString(column, 'A native CSV column'));
    const source = node.source ? await this.evaluateAsync(node.source, environment) : [];
    if (!Array.isArray(source)) throw new TypeError('Native CSV source must evaluate to a list of rows.');
    if (source.some(row => !row || typeof row !== 'object' || (!Array.isArray(row) && Buffer.isBuffer(row)))) {
      throw new TypeError('Native CSV rows must be objects or lists.');
    }
    const headers = columns.length > 0
      ? columns
      : source.length > 0 && !Array.isArray(source[0])
        ? Object.keys(source[0])
        : [];
    const quote = value => {
      if (value === null || value === undefined) return '';
      const text = typeof value === 'string' ? value
        : typeof value === 'bigint' ? String(value)
          : typeof value === 'object' ? JSON.stringify(value)
            : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const lines = [];
    if (headers.length > 0) lines.push(headers.map(quote).join(','));
    for (const row of source) {
      const values = Array.isArray(row)
        ? headers.length > 0 ? headers.map((_header, index) => row[index]) : row
        : headers.map(header => row[header]);
      lines.push(values.map(quote).join(','));
    }
    const output = node.output
      ? this.nativeLiteralString(node.output, 'A native CSV output path')
      : `${name}.csv`;
    await this.io.writeText(output, lines.length > 0 ? `${lines.join('\r\n')}\r\n` : '');
  }

  createNativeQueue(node, closure) {
    const queue = createQueue();
    const names = new Set();
    for (const job of node.jobs) {
      const jobName = this.nativeLiteralString(job.name, 'A native queue job name');
      if (names.has(jobName)) throw new Error(`Native queue '${node.name}' declares job '${jobName}' more than once.`);
      names.add(jobName);
      queue.register(jobName, async data => {
        const scope = new Environment(closure);
        const parameters = job.params.length > 0 ? job.params : ['data'];
        parameters.forEach((name, index) => scope.define(name, index === 0 ? data : undefined));
        try {
          await this.executeAsyncStatements(job.body, scope);
        } catch (error) {
          if (error instanceof ReturnSignal) return error.value;
          throw error;
        }
      });
    }
    return queue;
  }

  createNativeViewRenderer(directory) {
    if (typeof directory !== 'string' || directory.length === 0 || isAbsolute(directory)) {
      throw new TypeError('Native view directory must be a non-empty project-relative path.');
    }
    const viewRootPromise = this.resolveIOPath(directory).then(realpath);
    const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character]);
    const lookup = (value, path) => path.split('.').reduce((current, key) => (
      current && typeof current === 'object' && Object.hasOwn(current, key)
        ? current[key]
        : undefined
    ), value);

    const renderTemplate = (template, data, depth = 0) => {
      if (depth > 16) throw new RangeError('Native template nesting exceeds 16 levels.');
      let rendered = template.replace(
        /\{\{\s*each\s+([A-Za-z_$][\w$]*)\s+in\s+([\w$.]+)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g,
        (_match, itemName, listPath, body) => {
          const items = lookup(data, listPath);
          if (!Array.isArray(items)) {
            throw new TypeError(`Native template collection '${listPath}' must be a list.`);
          }
          return items.map(item => renderTemplate(body, { ...data, [itemName]: item }, depth + 1)).join('');
        },
      );
      rendered = rendered.replace(
        /\{\{\s*if\s+([\w$.]+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g,
        (_match, valuePath, body) => lookup(data, valuePath)
          ? renderTemplate(body, data, depth + 1)
          : '',
      );
      return rendered.replace(/\{\{\s*([\w$.]+)\s*\}\}/g, (_match, valuePath) => {
        const value = lookup(data, valuePath);
        return value == null ? '' : escapeHtml(value);
      });
    };

    return async (name, data = {}) => {
      if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('Native template names must be non-empty strings.');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('Native template data must be an object.');
      }
      const filename = extname(name) ? name : `${name}.html`;
      const viewRoot = await viewRootPromise;
      const templatePath = await realpath(resolve(viewRoot, filename));
      const templateRelativePath = relative(viewRoot, templatePath);
      if (templateRelativePath === '..' || templateRelativePath.startsWith(`..${sep}`) || isAbsolute(templateRelativePath)) {
        throw new Error(`Native template path escapes the configured view directory: '${name}'.`);
      }
      const template = await readFile(templatePath, 'utf8');
      return renderTemplate(template, data);
    };
  }

  async executeNativeServer(node, environment) {
    const app = new NativeHttpApp({
      output: this.output,
      host: this.serverHost,
      bodyLimit: this.maxRequestBodyBytes,
    });
    environment.define(node.name, app);
    const serverScope = new Environment(environment);

    for (const middleware of node.middleware) {
      app.use(this.createNativeMiddleware(middleware, serverScope));
    }

    await this.registerNativeServerRoutes(app, node.routes, environment, serverScope);

    const port = node.port ? await this.evaluateAsync(node.port, environment) : 3000;
    const server = await app.listen(port);
    const address = server.address();
    this.output.log?.(`Server running at http://${this.serverHost}:${address.port}`);
    return app;
  }

  nativeServerPath(prefix, path, description) {
    const value = this.nativeLiteralString(path, description);
    if (!value.startsWith('/')) throw new TypeError(`${description} must start with "/".`);
    if (!prefix) return value;
    return `${prefix.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`;
  }

  createNativeOpenApiSpec(app, environment) {
    const schemasByName = new Map();
    for (let scope = environment; scope; scope = scope.parent) {
      for (const { value } of scope.bindings.values()) {
        if (value && typeof value.name === 'string' && value.fields
          && typeof value.validate === 'function' && typeof value.defaults === 'function'
          && !schemasByName.has(value.name)) {
          schemasByName.set(value.name, value);
        }
      }
    }
    const spec = buildOpenApiSpec([...schemasByName.values()]);
    for (const route of app.routes) {
      if (route.openapi || route.sseHub) continue;
      const path = route.path
        .replace(/:([A-Za-z_][\w]*)/g, '{$1}')
        .replace(/\/\*$/, '/{wildcard}');
      const operations = spec.paths[path] || (spec.paths[path] = {});
      const parameters = [...path.matchAll(/\{([A-Za-z_][\w]*)\}/g)].map(match => ({
        name: match[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      operations[route.method] = {
        operationId: `${route.method}_${path.replace(/[{}\/]/g, '_').replace(/^_+|_+$/g, '') || 'root'}`,
        parameters,
        responses: {
          200: { description: 'Successful response' },
          400: { description: 'Invalid request' },
          404: { description: 'Resource not found' },
        },
      };
      if (['post', 'put', 'patch'].includes(route.method)) {
        operations[route.method].requestBody = {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        };
      }
    }
    return spec;
  }

  async registerNativeServerRoutes(app, routes, environment, serverScope, prefix = '') {
    for (const child of routes) {
      const support = NATIVE_SERVER_SUPPORT[child.type];
      if (support?.status === 'unsupported') {
        throw new Error(`Native server does not support '${child.type}': ${support.reason}`);
      }
      switch (child.type) {
        case 'Route': {
          const path = this.nativeServerPath(prefix, child.path, 'A native route path');
          const handlers = [];
          for (const middleware of child.middleware || []) {
            const value = await this.evaluateAsync(middleware, environment);
            if (typeof value !== 'function') throw new TypeError('Route middleware must evaluate to a function.');
            handlers.push(value);
          }
          handlers.push(this.createNativeRouteHandler(child, serverScope));
          const method = child.method === 'del' ? 'delete' : child.method;
          app[method](path, ...handlers);
          break;
        }
        case 'CrudDecl': {
          const schema = environment.get(`${child.schemaName}Schema`);
          const store = environment.get(`${child.schemaName}Store`);
          registerCrud(app, this.nativeServerPath(prefix, child.path, 'A native CRUD path'), schema, store, this.nativeEventBus);
          break;
        }
        case 'ErrorHandler':
          app.useError(this.createNativeErrorHandler(child, serverScope));
          break;
        case 'AuthDecl': {
          const secret = await this.evaluateAsync(child.secret, environment);
          if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
            throw new TypeError('Native server authentication requires a secret of at least 32 UTF-8 bytes.');
          }
          const publicPaths = child.publicPaths.map(path => this.nativeServerPath(prefix, path, 'An authentication public path'));
          const protectedPaths = child.protectedPaths.map(path => this.nativeServerPath(prefix, path, 'An authentication protected path'));
          const middleware = this.createNativeAuth(secret, publicPaths, protectedPaths);
          if (protectedPaths.length > 0) {
            for (const path of protectedPaths) app.use(path, middleware);
          }
          else if (prefix) app.use(prefix, middleware);
          else app.use(middleware);
          if (serverScope.bindings.has('auth')) throw new Error('Only one auth declaration is supported per native server.');
          serverScope.define('auth', Object.freeze({
            sign: (payload, expiresIn) => jwtSign(payload, secret, expiresIn),
            verify: token => jwtVerify(token, secret),
          }));
          break;
        }
        case 'GroupDecl': {
          const groupPrefix = this.nativeServerPath(prefix, child.prefix, 'A native route-group prefix');
          await this.registerNativeServerRoutes(app, child.routes, environment, serverScope, groupPrefix);
          break;
        }
        case 'CorsDecl': {
          const configuredOrigins = await this.evaluateAsync(child.origins, environment);
          const origins = typeof configuredOrigins === 'string' ? [configuredOrigins] : configuredOrigins;
          if (!Array.isArray(origins) || origins.some(origin => typeof origin !== 'string')) {
            throw new TypeError('Native server CORS origins must be a string or a list of strings.');
          }
          app.use(this.createNativeCors(origins));
          break;
        }
        case 'CookieDecl':
          app.use(this.createNativeCookieParser());
          break;
        case 'SessionDecl': {
          const secret = await this.evaluateAsync(child.secret, environment);
          app.useSession(secret);
          break;
        }
        case 'UploadDecl': {
          const path = this.nativeServerPath(prefix, child.path, 'A native upload path');
          const fieldName = this.nativeLiteralString(child.fieldName, 'A native upload field name');
          if (!fieldName) throw new TypeError('Native upload field names must not be empty.');
          app.register('post', path, [this.createNativeRouteHandler(child, serverScope)]);
          app.routes.at(-1).uploadField = fieldName;
          break;
        }
        case 'SseDecl': {
          const path = this.nativeServerPath(prefix, child.path, 'A native SSE path');
          const hub = serverScope.bindings.has('sse')
            ? serverScope.get('sse')
            : app.registerSse(path);
          if (!serverScope.bindings.has('sse')) serverScope.define('sse', hub);
          else app.registerSse(path, hub);
          break;
        }
        case 'CacheDecl': {
          const path = this.nativeServerPath(prefix, child.path, 'A native cache path');
          const duration = await this.evaluateAsync(child.duration, environment);
          app.use(path, createNativeCacheMiddleware(duration));
          break;
        }
        case 'ViewDecl': {
          if (serverScope.bindings.has('render')) {
            throw new Error('Only one view directory is supported per native server.');
          }
          serverScope.define(
            'render',
            this.createNativeViewRenderer(this.nativeLiteralString(child.dir, 'A native view directory')),
          );
          break;
        }
        case 'QueueDecl':
          serverScope.define(child.name, this.createNativeQueue(child, serverScope));
          break;
        case 'GraphqlDecl': {
          const path = this.nativeServerPath(prefix, child.path, 'A native GraphQL path');
          const stores = Object.create(null);
          for (const [name] of this.schemas) stores[name] = serverScope.get(`${name}Store`);
          const handler = await this.requireNativeService('graphql', child.type)({
            path,
            schemas: Object.freeze(Object.fromEntries(this.schemas)),
            stores: Object.freeze(stores),
          });
          if (typeof handler !== 'function') {
            throw new TypeError('Native GraphQL host adapter must return an HTTP request handler.');
          }
          app.get(path, handler);
          app.post(path, handler);
          break;
        }
        case 'WsDecl': {
          const path = this.nativeServerPath(prefix, child.path, 'A native WebSocket path');
          const registration = await this.requireNativeService('websocket', child.type)({
            path,
            events: this.createNativeServiceHandlers(child.events, serverScope, 'WebSocket declaration'),
          });
          if (!registration || typeof registration !== 'object'
            || typeof registration.handler !== 'function'
            || (registration.close !== undefined && typeof registration.close !== 'function')) {
            throw new TypeError('Native WebSocket host adapter must return { handler, close? }.');
          }
          app.registerUpgrade(path, registration.handler, registration.close ?? null);
          break;
        }
        case 'OpenapiDecl': {
          const path = this.nativeServerPath(prefix, child.path, 'A native OpenAPI path');
          app.registerOpenApi(path, () => this.createNativeOpenApiSpec(app, environment));
          break;
        }
        case 'LimitDecl': {
          const path = this.nativeServerPath(prefix, child.path, 'A native rate-limit path');
          const max = await this.evaluateAsync(child.max, environment);
          const duration = await this.evaluateAsync(child.window, environment);
          app.use(path, this.createNativeRateLimit(max, duration));
          break;
        }
        case 'ValidateDecl': {
          const schema = environment.get(`${child.schemaName}Schema`);
          const path = this.nativeServerPath(prefix, child.path, 'A native validation path');
          app.use(path, (request, response, next) => {
            if (!['post', 'put', 'patch'].includes(request.method)) return next();
            const result = schema.validate(request.body || {});
            if (!result.valid) return response.status(400).json({ errors: result.errors });
            request.body = result.data;
            return next();
          });
          break;
        }
        case 'StaticDecl':
          this.registerNativeStaticFiles(app, child);
          break;
        case 'Middleware':
          if (prefix) app.use(prefix, this.createNativeMiddleware(child, serverScope));
          else app.use(this.createNativeMiddleware(child, serverScope));
          break;
        case 'MiddlewareRef': {
          const handler = environment.get(child.name);
          if (typeof handler !== 'function') {
            throw new TypeError(`Native middleware '${child.name}' must resolve to a function.`);
          }
          if (child.path) {
            app.use(
              this.nativeServerPath(prefix, child.path, 'A native middleware path'),
              handler,
            );
          } else if (prefix) app.use(prefix, handler);
          else app.use(handler);
          break;
        }
        default:
          throw new Error(`Native server does not support '${child.type}' declarations yet.`);
      }
    }
  }

  registerNativeStaticFiles(app, node) {
    const publicPath = this.nativeLiteralString(node.path, 'A native static path').replace(/^\/+|\/+$/g, '');
    if (!publicPath || publicPath.split(/[\\/]/).some(part => part === '.' || part === '..')) {
      throw new Error('Native static paths must name a project-relative directory such as "/public".');
    }
    const routePath = `/${publicPath}/*`;
    const contentTypes = new Map([
      ['.css', 'text/css; charset=utf-8'],
      ['.csv', 'text/csv; charset=utf-8'],
      ['.html', 'text/html; charset=utf-8'],
      ['.js', 'text/javascript; charset=utf-8'],
      ['.json', 'application/json; charset=utf-8'],
      ['.png', 'image/png'],
      ['.svg', 'image/svg+xml'],
      ['.txt', 'text/plain; charset=utf-8'],
      ['.webp', 'image/webp'],
    ]);
    app.get(routePath, async (_request, response) => {
      const request = _request;
      const path = request.params['0'];
      if (!path) return response.status(404).json({ error: 'Not found' });
      let filePath;
      try {
        filePath = await this.resolveIOPath(`${publicPath}/${path}`);
        const details = await stat(filePath);
        if (!details.isFile()) return response.status(404).json({ error: 'Not found' });
        const content = await readFile(filePath);
        response.setHeader('Content-Type', contentTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream');
        return response.send(content);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return response.status(404).json({ error: 'Not found' });
        throw error;
      }
    });
  }

  createNativeAuth(secret, publicPaths, protectedPaths) {
    const validatePattern = pattern => {
      if (!pattern.startsWith('/')) {
        throw new Error(`Native authentication path pattern '${pattern}' must start with '/'.`);
      }
      if (pattern.includes('*') && (!pattern.endsWith('*') || pattern.indexOf('*') !== pattern.length - 1)) {
        throw new Error(`Native authentication path pattern '${pattern}' may only use a trailing '*'.`);
      }
    };
    [...publicPaths, ...protectedPaths].forEach(validatePattern);
    return (request, response, next) => {
      const isPublic = publicPaths.some(pattern => {
        if (!pattern.endsWith('*')) return request.path === pattern;
        const prefix = pattern.slice(0, -1).replace(/\/$/, '');
        return request.path === prefix || request.path.startsWith(`${prefix}/`);
      });
      if (isPublic) return next();
      const authorization = request.headers.authorization;
      if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
        return response.status(401).json({ error: 'No token provided' });
      }
      try {
        request.user = jwtVerify(authorization.slice(7), secret);
      } catch {
        return response.status(403).json({ error: 'Invalid token' });
      }
      return next();
    };
  }

  createNativeCors(origins) {
    const allowAll = origins.includes('*');
    const allowed = new Set(origins);
    return (request, response, next) => {
      const origin = request.headers.origin;
      if (allowAll) {
        response.setHeader('Access-Control-Allow-Origin', '*');
      } else if (origin && allowed.has(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (request.method === 'options') return response.status(204).end();
      return next();
    };
  }

  createNativeCookieParser() {
    return (request, _response, next) => {
      const cookies = Object.create(null);
      const header = request.headers.cookie;
      if (typeof header === 'string') {
        for (const pair of header.split(';')) {
          const separator = pair.indexOf('=');
          if (separator < 1) continue;
          const name = pair.slice(0, separator).trim();
          const value = pair.slice(separator + 1).trim();
          try {
            cookies[name] = decodeURIComponent(value);
          } catch {
            cookies[name] = value;
          }
        }
      }
      request.cookies = cookies;
      return next();
    };
  }

  createNativeRateLimit(maximum, duration) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new RangeError('Native server rate limit must be a positive safe integer.');
    }
    const durationText = String(duration);
    const match = durationText.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) throw new TypeError(`Invalid native server rate-limit duration '${durationText}'.`);
    const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    const windowMs = Number(match[1]) * units[match[2]];
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new RangeError('Native server rate-limit duration is out of range.');
    const requests = new Map();
    return (request, response, next) => {
      const now = Date.now();
      const previous = requests.get(request.ip);
      const entry = previous && now - previous.startedAt < windowMs
        ? previous
        : { startedAt: now, count: 0 };
      entry.count++;
      requests.set(request.ip, entry);
      if (requests.size > 10_000) {
        for (const [address, item] of requests) {
          if (now - item.startedAt >= windowMs) requests.delete(address);
        }
      }
      response.setHeader('X-RateLimit-Limit', maximum);
      response.setHeader('X-RateLimit-Remaining', Math.max(0, maximum - entry.count));
      if (entry.count > maximum) return response.status(429).json({ error: 'Too many requests' });
      return next();
    };
  }

  async executeAsyncScoped(statements, parent) {
    await this.executeAsyncStatements(statements, new Environment(parent));
  }

  async executeAsyncTry(node, environment) {
    try {
      await this.executeAsyncScoped(node.body, environment);
    } catch (error) {
      if (error instanceof ReturnSignal || error instanceof RouteResponseSignal
        || error instanceof BreakSignal || error instanceof ContinueSignal) throw error;
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
      case 'DynamicImport':
        return this.evaluateDynamicImport(node, environment);
      case 'Number':
      case 'Bool':
      case 'Null':
      case 'Identifier':
      case 'Self':
        return this.evaluate(node, environment);
      case 'RegExp':
        return this.evaluateRegExpLiteral(node.value);
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
        throw unsupportedNodeError('Native async engine', 'expression', node);
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

  evaluateRegExpLiteral(raw) {
    if (typeof raw !== 'string' || raw[0] !== '/') {
      throw new SyntaxError('Invalid native regular-expression literal.');
    }
    const closingSlash = raw.lastIndexOf('/');
    if (closingSlash < 1) throw new SyntaxError('Invalid native regular-expression literal.');
    const pattern = raw.slice(1, closingSlash);
    const flags = raw.slice(closingSlash + 1);
    try {
      return new RegExp(pattern, flags);
    } catch (error) {
      throw new SyntaxError(`Invalid native regular-expression literal: ${error.message}`);
    }
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
      case 'RegExp': return this.evaluateRegExpLiteral(node.value);
      case 'Bool': return node.value;
      case 'Null': return null;
      case 'Yield':
        throw new Error('Yield expressions can only be evaluated while a native generator is running.');
      case 'DynamicImport':
        throw new Error('Native dynamic import requires asynchronous execution; use runNativeAsync or async file execution.');
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
        throw unsupportedNodeError('Native engine', 'expression', node);
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
  const engine = new NaideVM(options);
  return engine.execute(source);
}

export async function runNativeAsync(source, options = {}) {
  const engine = new NaideVM(options);
  return engine.executeAsync(source);
}

export async function runNativeFileAsync(filePath, options = {}) {
  const engine = new NaideVM({ ...options, sourceFile: filePath });
  return engine.executeFileAsync(filePath);
}

export { NaideVM as NativeEngine };
