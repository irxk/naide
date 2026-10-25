import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';

const DEFAULT_BODY_LIMIT = 1_048_576;
const SSE_MAX_EVENT_BYTES = 262_144;
const SSE_MAX_PENDING_BYTES = 1_048_576;
const SSE_HEARTBEAT_INTERVAL = 15_000;
const SESSION_COOKIE = 'naide_sid';
const SESSION_MAX_AGE = 86_400_000;
const SESSION_MAX_COUNT = 10_000;
const SESSION_CLEANUP_INTERVAL = 60_000;

function normalizeMethod(method) {
  return method.toLowerCase() === 'del' ? 'delete' : method.toLowerCase();
}

function routeMatch(routePath, requestPath) {
  const routeParts = routePath.split('/').filter(Boolean);
  const requestParts = requestPath.split('/').filter(Boolean);
  const hasWildcard = routeParts.at(-1) === '*';
  if (hasWildcard ? requestParts.length < routeParts.length - 1 : routeParts.length !== requestParts.length) return null;
  const params = Object.create(null);
  for (let index = 0; index < routeParts.length; index++) {
    const routePart = routeParts[index];
    const requestPart = requestParts[index];
    if (routePart === '*' && index === routeParts.length - 1) {
      try {
        params['0'] = requestParts.slice(index).map(part => decodeURIComponent(part)).join('/');
      } catch {
        return null;
      }
      return params;
    }
    if (routePart.startsWith(':')) {
      try {
        params[routePart.slice(1)] = decodeURIComponent(requestPart);
      } catch {
        return null;
      }
    } else if (routePart !== requestPart) {
      return null;
    }
  }
  return params;
}

function parseQuery(searchParams) {
  const query = Object.create(null);
  for (const [key, value] of searchParams) {
    if (!Object.hasOwn(query, key)) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

async function readRequestBody(request, limit) {
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    request.resume();
    const error = new Error('Request body exceeds the configured size limit.');
    error.statusCode = 413;
    throw error;
  }
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) {
    const error = new Error('Request body exceeds the configured size limit.');
    error.statusCode = 413;
    throw error;
  }
  if (chunks.length === 0) {
    request.rawBody = Buffer.alloc(0);
    return undefined;
  }

  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  const body = Buffer.concat(chunks);
  request.rawBody = body;
  if (contentType === 'multipart/form-data') return body;
  const text = body.toString('utf8');
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    try {
      return JSON.parse(text);
    } catch {
      const error = new Error('Request body contains invalid JSON.');
      error.statusCode = 400;
      throw error;
    }
  }
  if (contentType === 'application/x-www-form-urlencoded') {
    return parseQuery(new URLSearchParams(text));
  }
  return text;
}

function parseMultipartBody(body, contentType, expectedField) {
  const match = String(contentType).match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary || boundary.length > 70 || /[\r\n]/.test(boundary)) {
    const error = new Error('Multipart request has an invalid boundary.');
    error.statusCode = 400;
    throw error;
  }
  if (!Buffer.isBuffer(body)) {
    const error = new Error('Multipart request body is unavailable.');
    error.statusCode = 400;
    throw error;
  }

  const marker = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  const headerSeparator = Buffer.from('\r\n\r\n');
  const files = Object.create(null);
  const fields = Object.create(null);
  let cursor = 0;
  if (!body.subarray(0, marker.length).equals(marker)) {
    const error = new Error('Multipart body does not start with its boundary.');
    error.statusCode = 400;
    throw error;
  }
  cursor = marker.length;

  while (true) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (!body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) {
      const error = new Error('Multipart boundary framing is invalid.');
      error.statusCode = 400;
      throw error;
    }
    cursor += 2;
    const headerEnd = body.indexOf(headerSeparator, cursor);
    if (headerEnd < 0 || headerEnd - cursor > 16_384) {
      const error = new Error('Multipart part headers are invalid or too large.');
      error.statusCode = 400;
      throw error;
    }
    const headerText = body.subarray(cursor, headerEnd).toString('utf8');
    const disposition = headerText.match(/^content-disposition:\s*form-data\s*;(.*)$/im)?.[1];
    const name = disposition?.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    const filename = disposition?.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    if (!name) {
      const error = new Error('Multipart part is missing a field name.');
      error.statusCode = 400;
      throw error;
    }
    const dataStart = headerEnd + headerSeparator.length;
    const nextBoundary = body.indexOf(separator, dataStart);
    if (nextBoundary < 0) {
      const error = new Error('Multipart body is missing its closing boundary.');
      error.statusCode = 400;
      throw error;
    }
    const partData = body.subarray(dataStart, nextBoundary);
    if (filename !== undefined) {
      if (Object.hasOwn(files, name)) {
        const error = new Error(`Multipart request contains duplicate file field '${name}'.`);
        error.statusCode = 400;
        throw error;
      }
      const contentTypeMatch = headerText.match(/^content-type:\s*(.+)$/im);
      files[name] = {
        filename,
        contentType: contentTypeMatch?.[1].trim() || 'application/octet-stream',
        data: partData,
        size: partData.length,
      };
    } else if (Object.hasOwn(fields, name)) {
      const current = fields[name];
      fields[name] = Array.isArray(current) ? [...current, partData.toString('utf8')] : [current, partData.toString('utf8')];
    } else {
      fields[name] = partData.toString('utf8');
    }
    cursor = nextBoundary + separator.length;
  }

  const file = files[expectedField];
  if (!file) {
    const error = new Error(`Multipart request is missing file field '${expectedField}'.`);
    error.statusCode = 400;
    throw error;
  }
  return { file, files, fields };
}

function createResponseFacade(response) {
  let statusCode = 200;
  const facade = {
    get headersSent() { return response.headersSent; },
    get statusCode() { return statusCode; },
    status(code) {
      if (!Number.isInteger(code) || code < 100 || code > 599) {
        throw new RangeError('Response status must be an integer between 100 and 599.');
      }
      statusCode = code;
      return facade;
    },
    set(name, value) {
      response.setHeader(name, String(value));
      return facade;
    },
    getHeader(name) {
      return response.getHeader(name);
    },
    setHeader(name, value) {
      response.setHeader(name, value);
      return facade;
    },
    appendHeader(name, value) {
      response.appendHeader(name, value);
      return facade;
    },
    type(value) {
      const types = {
        html: 'text/html; charset=utf-8',
        json: 'application/json; charset=utf-8',
        text: 'text/plain; charset=utf-8',
      };
      response.setHeader('content-type', types[value] || value);
      return facade;
    },
    json(value) {
      if (response.headersSent) return facade;
      response.statusCode = statusCode;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(value));
      return facade;
    },
    send(value) {
      if (response.headersSent) return facade;
      response.statusCode = statusCode;
      if (Buffer.isBuffer(value) || typeof value === 'string') {
        response.end(value);
      } else {
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(value));
      }
      return facade;
    },
    redirect(location) {
      if (response.headersSent) return facade;
      response.statusCode = statusCode === 200 ? 302 : statusCode;
      response.setHeader('location', String(location));
      response.end();
      return facade;
    },
    end(value) {
      if (response.headersSent) return facade;
      response.statusCode = statusCode;
      response.end(value);
      return facade;
    },
  };
  return facade;
}

export function createNativeSseHub() {
  const clients = new Set();
  let closed = false;
  const heartbeat = setInterval(() => {
    for (const client of clients) write(client, ':\n\n');
  }, SSE_HEARTBEAT_INTERVAL);
  heartbeat.unref?.();

  function remove(client) {
    if (!clients.delete(client)) return;
    client.response.off('drain', client.onDrain);
    client.response.off('close', client.onClose);
    client.response.off('error', client.onClose);
  }

  function write(client, frame) {
    if (!clients.has(client)) return false;
    const bytes = Buffer.byteLength(frame);
    if (client.blocked) {
      if (client.pendingBytes + bytes > SSE_MAX_PENDING_BYTES) {
        client.response.destroy();
        remove(client);
        return false;
      }
      client.pending.push(frame);
      client.pendingBytes += bytes;
      return true;
    }
    if (!client.response.write(frame)) client.blocked = true;
    return true;
  }

  function drain(client) {
    client.blocked = false;
    while (client.pending.length > 0 && !client.blocked) {
      const frame = client.pending.shift();
      client.pendingBytes -= Buffer.byteLength(frame);
      if (!client.response.write(frame)) client.blocked = true;
    }
  }

  function attach(response) {
    if (closed) {
      response.statusCode = 503;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: 'Event stream is shutting down.' }));
      return;
    }
    response.statusCode = 200;
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');
    response.setHeader('x-accel-buffering', 'no');
    response.flushHeaders();
    const client = {
      response,
      blocked: false,
      pending: [],
      pendingBytes: 0,
      onDrain: null,
      onClose: null,
    };
    client.onDrain = () => drain(client);
    client.onClose = () => remove(client);
    clients.add(client);
    response.on('drain', client.onDrain);
    response.on('close', client.onClose);
    response.on('error', client.onClose);
    write(client, 'retry: 3000\n\n');
  }

  function send(data, event) {
    if (closed) throw new Error('Cannot publish to a closed native event stream.');
    if (event !== undefined && (typeof event !== 'string' || !event || /[\r\n\0]/.test(event))) {
      throw new TypeError('Native event names must be non-empty strings without line breaks.');
    }
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    if (typeof payload !== 'string') throw new TypeError('Native event data must be serializable.');
    const normalized = payload.replace(/\r\n|\r/g, '\n');
    const frame = `${event === undefined ? '' : `event: ${event}\n`}`
      + `${normalized.split('\n').map(line => `data: ${line}\n`).join('')}\n`;
    if (Buffer.byteLength(frame) > SSE_MAX_EVENT_BYTES) {
      throw new RangeError(`Native event payload exceeds ${SSE_MAX_EVENT_BYTES} bytes.`);
    }
    for (const client of clients) write(client, frame);
    return clients.size;
  }

  return Object.freeze({
    attach,
    send,
    broadcast(data, event) { return send(data, event); },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const client of [...clients]) {
        client.response.end();
        remove(client);
      }
    },
    get count() { return clients.size; },
  });
}

export function createNativeCacheMiddleware(duration) {
  const durationText = String(duration);
  const match = durationText.match(/^(\d+)(ms|s|m|h|d)$/);
  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const ttl = match ? Number(match[1]) * units[match[2]] : Number(duration);
  if (!Number.isSafeInteger(ttl) || ttl < 1) {
    throw new TypeError(`Invalid native cache duration '${durationText}'.`);
  }
  const entries = new Map();
  const maxEntries = 1000;

  function cacheKey(request) {
    return JSON.stringify([
      request.originalUrl,
      request.headers.authorization || '',
      request.headers.cookie || '',
      request.headers.accept || '',
    ]);
  }

  function prune(now) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
  }

  return (request, response, next) => {
    if (request.method !== 'get') return next();
    const key = cacheKey(request);
    const now = Date.now();
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now) {
      response.status(cached.status);
      if (cached.contentType) response.set('content-type', cached.contentType);
      response.set('x-cache', 'HIT');
      if (cached.kind === 'json') response.json(cached.value);
      else if (cached.kind === 'send') response.send(cached.value);
      else response.end(cached.value);
      return;
    }
    if (cached) entries.delete(key);

    const capture = (kind, value, complete) => {
      const cacheControl = String(response.getHeader('cache-control') || '').toLowerCase();
      if (response.statusCode >= 200 && response.statusCode < 300
        && !response.getHeader('set-cookie') && !cacheControl.includes('no-store')) {
        let storedValue = value;
        if (kind === 'json') {
          try {
            storedValue = JSON.parse(JSON.stringify(value));
          } catch {
            storedValue = undefined;
          }
        }
        if (storedValue !== undefined && !Buffer.isBuffer(storedValue)) {
          prune(Date.now());
          entries.set(key, {
            kind,
            value: storedValue,
            status: response.statusCode,
            contentType: response.getHeader('content-type'),
            expiresAt: Date.now() + ttl,
          });
          response.set('x-cache', 'MISS');
        }
      }
      return complete();
    };

    const json = response.json.bind(response);
    response.json = value => capture('json', value, () => json(value));
    const send = response.send.bind(response);
    response.send = value => capture('send', value, () => send(value));
    const end = response.end.bind(response);
    response.end = value => capture('end', value, () => end(value));
    return next();
  };
}

export function createNativeSessionMiddleware(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new TypeError('Native server sessions require a secret of at least 32 UTF-8 bytes.');
  }
  const sessions = new Map();
  let nextCleanup = 0;
  const sign = id => createHmac('sha256', secret).update(id).digest();
  const serializeCookie = (value, maxAge) =>
    `${SESSION_COOKIE}=${value}; HttpOnly; Secure; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  const pruneExpired = now => {
    for (const [id, entry] of sessions) {
      if (now - entry.lastSeen >= SESSION_MAX_AGE) sessions.delete(id);
    }
  };
  const readSessionId = header => {
    let found = null;
    for (const part of String(header || '').split(';')) {
      const index = part.indexOf('=');
      if (index < 0 || part.slice(0, index).trim() !== SESSION_COOKIE) continue;
      if (found !== null) return null;
      found = part.slice(index + 1).trim();
    }
    if (!found) return null;
    const separator = found.lastIndexOf('.');
    if (separator < 0) return null;
    const id = found.slice(0, separator);
    const signature = Buffer.from(found.slice(separator + 1), 'base64url');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const expected = sign(id);
    return signature.length === expected.length && timingSafeEqual(signature, expected) ? id : null;
  };

  return (request, response, next) => {
    const now = Date.now();
    if (now >= nextCleanup) {
      pruneExpired(now);
      nextCleanup = now + SESSION_CLEANUP_INTERVAL;
    }

    let id = readSessionId(request.headers.cookie);
    let entry = id ? sessions.get(id) : null;
    if (entry && now - entry.lastSeen >= SESSION_MAX_AGE) {
      sessions.delete(id);
      entry = null;
    }
    if (!entry) {
      if (sessions.size >= SESSION_MAX_COUNT) pruneExpired(now);
      if (sessions.size >= SESSION_MAX_COUNT) {
        const error = new Error('Native session capacity is full; retry after existing sessions expire.');
        error.statusCode = 503;
        next(error);
        return;
      }
      id = randomUUID();
      entry = { data: {}, lastSeen: now };
      sessions.set(id, entry);
    }

    entry.lastSeen = now;
    request.session = entry.data;
    request.sessionId = id;
    Object.defineProperty(request.session, 'destroy', {
      configurable: true,
      value: () => {
        sessions.delete(id);
        response.appendHeader('set-cookie', serializeCookie('', 0));
      },
    });
    const signedId = `${id}.${sign(id).toString('base64url')}`;
    response.appendHeader('set-cookie', serializeCookie(signedId, SESSION_MAX_AGE / 1000));
    next();
  };
}

export class NativeHttpApp {
  constructor({ output = console, bodyLimit = DEFAULT_BODY_LIMIT, host = '127.0.0.1' } = {}) {
    if (!Number.isSafeInteger(bodyLimit) || bodyLimit < 1) {
      throw new RangeError('Native HTTP bodyLimit must be a positive safe integer.');
    }
    if (typeof host !== 'string' || host.length === 0) {
      throw new TypeError('Native HTTP host must be a non-empty string.');
    }
    this.output = output;
    this.bodyLimit = bodyLimit;
    this.host = host;
    this.routes = [];
    this.middleware = [];
    this.errorHandlers = [];
    this.sseHubs = new Set();
    this.upgradeHandlers = [];
    this.server = null;
    this.sessionConfigured = false;
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      this[method] = (path, ...handlers) => this.register(method, path, handlers);
    }
  }

  register(method, path, handlers) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError('Native HTTP route paths must start with "/".');
    }
    if (handlers.length === 0 || handlers.some(handler => typeof handler !== 'function')) {
      throw new TypeError(`Native HTTP ${method.toUpperCase()} route requires function handlers.`);
    }
    this.routes.push({ method: normalizeMethod(method), path, handlers });
    return this;
  }

  registerSse(path, hub = createNativeSseHub()) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError('Native event stream paths must start with "/".');
    }
    this.sseHubs.add(hub);
    this.routes.push({ method: 'get', path, handlers: [], sseHub: hub });
    return hub;
  }

  registerOpenApi(path, buildSpec) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError('Native OpenAPI paths must start with "/".');
    }
    if (typeof buildSpec !== 'function') throw new TypeError('Native OpenAPI spec builder must be a function.');
    this.routes.push({
      method: 'get',
      path,
      openapi: true,
      handlers: [(_request, response) => response.json(buildSpec())],
    });
  }

  registerUpgrade(path, handler, close = null) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError('Native protocol upgrade paths must start with "/".');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Native protocol upgrade handlers must be functions.');
    }
    if (close !== null && typeof close !== 'function') {
      throw new TypeError('Native protocol upgrade cleanup must be a function.');
    }
    if (this.upgradeHandlers.some(item => item.path === path)) {
      throw new Error(`A native protocol upgrade handler is already registered for '${path}'.`);
    }
    this.upgradeHandlers.push({ path, handler, close });
    return this;
  }

  use(pathOrHandler, ...handlers) {
    const path = typeof pathOrHandler === 'string' ? pathOrHandler : null;
    const values = path === null ? [pathOrHandler, ...handlers] : handlers;
    if (values.length === 0 || values.some(handler => typeof handler !== 'function')) {
      throw new TypeError('Native HTTP middleware must be functions.');
    }
    this.middleware.push({ path, handlers: values });
    return this;
  }

  useError(handler) {
    if (typeof handler !== 'function') throw new TypeError('Native HTTP error handlers must be functions.');
    this.errorHandlers.push(handler);
  }

  useSession(secret) {
    if (this.sessionConfigured) throw new Error('Only one session declaration is supported per native server.');
    this.use(createNativeSessionMiddleware(secret));
    this.sessionConfigured = true;
    return this;
  }

  async listen(port, host = this.host) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new RangeError('Native HTTP port must be an integer between 0 and 65535.');
    }
    if (this.server) throw new Error('Native HTTP server is already listening.');
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    server.on('upgrade', (request, socket, head) => {
      let path;
      try {
        path = new URL(request.url, 'http://naide.invalid').pathname;
      } catch (error) {
        const report = typeof this.output.error === 'function'
          ? this.output.error
          : typeof this.output.log === 'function'
            ? this.output.log
            : console.error;
        report.call(this.output, 'Native protocol upgrade received an invalid request URL:', error);
        socket.destroy();
        return;
      }
      const registration = this.upgradeHandlers.find(item => item.path === path);
      if (!registration) {
        socket.destroy();
        return;
      }
      Promise.resolve(registration.handler(request, socket, head)).catch(error => {
        try {
          const report = typeof this.output.error === 'function'
            ? this.output.error
            : typeof this.output.log === 'function'
              ? this.output.log
              : console.error;
          report.call(this.output, `Native protocol upgrade failed for '${path}':`, error);
        } finally {
          socket.destroy();
        }
      });
    });
    this.server = server;
    await new Promise((resolve, reject) => {
      const onError = error => {
        server.off('listening', onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    return server;
  }

  async close() {
    for (const hub of this.sseHubs) hub.close();
    this.sseHubs.clear();
    const errors = [];
    for (const registration of this.upgradeHandlers) {
      try {
        await registration.close?.();
      } catch (error) {
        errors.push(error);
      }
    }
    this.upgradeHandlers = [];
    if (this.server?.listening) {
      const server = this.server;
      try {
        await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
      } catch (error) {
        errors.push(error);
      } finally {
        this.server = null;
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Native HTTP server cleanup failed.');
  }

  async handle(request, response) {
    const res = createResponseFacade(response);
    let req = null;
    try {
      const url = new URL(request.url, 'http://naide.invalid');
      const body = await readRequestBody(request, this.bodyLimit);
      req = {
        method: request.method.toLowerCase(),
        path: url.pathname,
        originalUrl: request.url,
        query: parseQuery(url.searchParams),
        params: Object.create(null),
        headers: request.headers,
        rawBody: request.rawBody ?? Buffer.alloc(0),
        body,
        ip: request.socket.remoteAddress,
      };
      const middleware = this.middleware
        .filter(item => {
          if (item.path === null) return true;
          const prefix = item.path.replace(/\*$/, '').replace(/\/$/, '');
          return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
        })
        .flatMap(item => item.handlers);
      const route = this.routes.find(candidate => candidate.method === req.method
        && (req.params = routeMatch(candidate.path, url.pathname)) !== null);

      if (route?.uploadField && String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) {
        const upload = parseMultipartBody(req.body, request.headers['content-type'], route.uploadField);
        req.file = upload.file;
        req.files = upload.files;
        req.body = upload.fields;
      }

      for (const handler of middleware) {
        const next = await this.invokeMiddleware(handler, req, res);
        if (!next || res.headersSent) return;
      }
      if (!route) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      req.params = routeMatch(route.path, url.pathname);
      if (route.sseHub) {
        route.sseHub.attach(response);
        return;
      }
      for (const handler of route.handlers) {
        const next = await this.invokeMiddleware(handler, req, res);
        if (!next || res.headersSent) return;
      }
      if (!res.headersSent) res.status(204).end();
    } catch (error) {
      if (res.headersSent) return;
      let currentError = error;
      for (const handler of this.errorHandlers) {
        try {
          if (await handler(currentError, req, res) || res.headersSent) return;
        } catch (handlerError) {
          currentError = handlerError;
        }
      }
      if (res.headersSent) return;
      const status = Number.isInteger(currentError?.statusCode) ? currentError.statusCode : 500;
      if (status >= 500) this.output.error?.(`Native HTTP request failed: ${currentError.message}`);
      res.status(status).json({ error: status >= 500 ? 'Internal server error' : currentError.message });
    }
  }

  invokeMiddleware(handler, req, res) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const next = error => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(true);
      };
      try {
        const result = handler(req, res, next);
        Promise.resolve(result).then(() => {
          if (!settled) {
            settled = true;
            resolve(res.headersSent ? false : handler.length < 3);
          }
        }, reject);
      } catch (error) {
        reject(error);
      }
    });
  }
}
