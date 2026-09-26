import { createHmac, randomUUID, timingSafeEqual, scryptSync, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

// ===== Password Hashing (zero-dep, Node crypto) =====
export function hash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verify(password, stored) {
  const [salt, h] = stored.split(':');
  const hashBuf = Buffer.from(h, 'hex');
  const testBuf = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuf, testBuf);
}

// ===== UUID =====
export function uuid() {
  return randomUUID();
}

// ===== Schema + Validation =====
export function createSchema(name, fieldDefs) {
  const schema = {
    name,
    fields: fieldDefs,
    validate(data) {
      const errors = [];
      const result = {};
      for (const [field, rules] of Object.entries(fieldDefs)) {
        let val = data[field];
        if (rules.auto && rules.type === 'id' && val === undefined) { result[field] = randomUUID(); continue; }
        if (rules.auto && rules.type === 'timestamp' && val === undefined) { result[field] = new Date().toISOString(); continue; }
        if (val === undefined && rules.default !== undefined) val = rules.default;
        if (rules.required && (val === undefined || val === null || val === '')) { errors.push(`${field} is required`); continue; }
        if (val === undefined || val === null) continue;
        if (rules.type === 'string') {
          if (typeof val !== 'string') { errors.push(`${field} must be a string`); continue; }
          if (rules.min !== undefined && val.length < rules.min) errors.push(`${field} must be at least ${rules.min} characters`);
          if (rules.max !== undefined && val.length > rules.max) errors.push(`${field} must be at most ${rules.max} characters`);
          if (rules.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) errors.push(`${field} must be a valid email`);
          if (rules.url && !/^https?:\/\/.+/.test(val)) errors.push(`${field} must be a valid URL`);
          if (rules.match && !rules.match.test(val)) errors.push(`${field} format is invalid`);
        }
        if (rules.type === 'number' || rules.type === 'integer') {
          const n = Number(val);
          if (isNaN(n)) { errors.push(`${field} must be a number`); continue; }
          if (rules.type === 'integer' && !Number.isInteger(n)) errors.push(`${field} must be an integer`);
          if (rules.min !== undefined && n < rules.min) errors.push(`${field} must be at least ${rules.min}`);
          if (rules.max !== undefined && n > rules.max) errors.push(`${field} must be at most ${rules.max}`);
          val = n;
        }
        if (rules.type === 'boolean') val = Boolean(val);
        if (rules.type === 'enum' && !rules.values.includes(val)) errors.push(`${field} must be one of: ${rules.values.join(', ')}`);
        result[field] = val;
      }
      return errors.length > 0 ? { valid: false, errors } : { valid: true, data: result };
    },
    defaults() {
      const d = {};
      for (const [field, rules] of Object.entries(fieldDefs)) {
        if (rules.default !== undefined) d[field] = rules.default;
        if (rules.auto && rules.type === 'id') d[field] = randomUUID();
        if (rules.auto && rules.type === 'timestamp') d[field] = new Date().toISOString();
      }
      return d;
    }
  };
  return schema;
}

// ===== In-Memory Store =====
export function createStore(schema) {
  const items = new Map();
  let _idField = null;
  for (const [f, r] of Object.entries(schema.fields)) {
    if (r.auto && r.type === 'id') { _idField = f; break; }
  }
  const idField = _idField || 'id';

  return {
    getAll() { return [...items.values()]; },
    getById(id) { return items.get(String(id)) || null; },
    count() { return items.size; },
    create(data) {
      const { valid, errors, data: validated } = schema.validate(data);
      if (!valid) return { error: errors };
      const id = validated[idField] || randomUUID();
      validated[idField] = id;
      items.set(String(id), validated);
      return validated;
    },
    update(id, data) {
      const existing = items.get(String(id));
      if (!existing) return null;
      const merged = { ...existing, ...data, [idField]: existing[idField] };
      items.set(String(id), merged);
      return merged;
    },
    delete(id) {
      return items.delete(String(id));
    },
    where(conditions) {
      return [...items.values()].filter(item => {
        for (const [k, v] of Object.entries(conditions)) {
          if (item[k] !== v) return false;
        }
        return true;
      });
    },
    clear() { items.clear(); }
  };
}

// ===== File-Based Persistent Store =====
export function createFileStore(schema, filePath) {
  let _idField = null;
  for (const [f, r] of Object.entries(schema.fields)) {
    if (r.auto && r.type === 'id') { _idField = f; break; }
  }
  const idField = _idField || 'id';

  const dir = dirname(filePath);
  if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const items = new Map();
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    for (const item of data) items.set(String(item[idField] || item.id), item);
  } catch {}

  function save() {
    writeFileSync(filePath, JSON.stringify([...items.values()], null, 2));
  }

  return {
    getAll() { return [...items.values()]; },
    getById(id) { return items.get(String(id)) || null; },
    count() { return items.size; },
    create(data) {
      const { valid, errors, data: validated } = schema.validate(data);
      if (!valid) return { error: errors };
      const id = validated[idField] || randomUUID();
      validated[idField] = id;
      items.set(String(id), validated);
      save();
      return validated;
    },
    update(id, data) {
      const existing = items.get(String(id));
      if (!existing) return null;
      const merged = { ...existing, ...data, [idField]: existing[idField] };
      items.set(String(id), merged);
      save();
      return merged;
    },
    delete(id) {
      const result = items.delete(String(id));
      if (result) save();
      return result;
    },
    where(conditions) {
      return [...items.values()].filter(item => {
        for (const [k, v] of Object.entries(conditions)) {
          if (item[k] !== v) return false;
        }
        return true;
      });
    },
    clear() { items.clear(); save(); }
  };
}

// ===== CRUD Route Registration (with pagination, search, sort) =====
export function registerCrud(app, basePath, schema, store, eventBus) {
  app.get(basePath, (req, res) => {
    let items = store.getAll();

    const q = req.query.q;
    if (q) {
      const lower = q.toLowerCase();
      items = items.filter(item =>
        Object.values(item).some(v =>
          typeof v === 'string' && v.toLowerCase().includes(lower)
        )
      );
    }

    if (req.query.sort) {
      const field = req.query.sort;
      const order = req.query.order === 'desc' ? -1 : 1;
      items.sort((a, b) => {
        if (a[field] < b[field]) return -order;
        if (a[field] > b[field]) return order;
        return 0;
      });
    }

    const total = items.length;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    items = items.slice((page - 1) * limit, page * limit);

    res.json({ data: items, total, page, limit, pages: Math.ceil(total / limit) });
  });

  app.get(`${basePath}/:id`, (req, res) => {
    const item = store.getById(req.params.id);
    if (!item) return res.status(404).json({ error: `${schema.name} not found` });
    res.json(item);
  });

  app.post(basePath, (req, res) => {
    const result = store.create(req.body);
    if (result.error) return res.status(400).json({ errors: result.error });
    if (eventBus) eventBus.emit(`${schema.name}.create`, result);
    res.status(201).json(result);
  });

  app.put(`${basePath}/:id`, (req, res) => {
    const item = store.getById(req.params.id);
    if (!item) return res.status(404).json({ error: `${schema.name} not found` });
    const updated = store.update(req.params.id, req.body);
    if (eventBus) eventBus.emit(`${schema.name}.update`, updated);
    res.json(updated);
  });

  app.delete(`${basePath}/:id`, (req, res) => {
    const item = store.getById(req.params.id);
    if (!item) return res.status(404).json({ error: `${schema.name} not found` });
    store.delete(req.params.id);
    if (eventBus) eventBus.emit(`${schema.name}.delete`, { id: req.params.id });
    res.json({ deleted: true });
  });
}

// ===== JWT Auth =====
function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function jwtSign(payload, secret, expiresIn = '24h') {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const ms = typeof expiresIn === 'number' ? expiresIn : parseMs(expiresIn);
  const body = base64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor((Date.now() + ms) / 1000) }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function jwtVerify(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const sig = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const tokenSigBuf = Buffer.from(parts[2]);
  if (sigBuf.length !== tokenSigBuf.length || !timingSafeEqual(sigBuf, tokenSigBuf)) throw new Error('Invalid signature');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

export function jwtAuth(secret, options = {}) {
  const publicPaths = (options.public || []).map(p => new RegExp('^' + p.replace(/\*/g, '.*') + '$'));
  return (req, res, next) => {
    const isPublic = publicPaths.some(re => re.test(req.path));
    if (isPublic) return next();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    try {
      req.user = jwtVerify(authHeader.slice(7), secret);
      next();
    } catch (e) {
      res.status(403).json({ error: e.message });
    }
  };
}

// ===== CORS Middleware =====
export function corsMiddleware(origins = ['*']) {
  const allowAll = origins.includes('*');
  const originSet = new Set(origins.map(o => o.replace(/^https?:\/\//, '')));
  return (req, res, next) => {
    const reqOrigin = req.headers.origin || '';
    const host = reqOrigin.replace(/^https?:\/\//, '');
    if (allowAll || originSet.has(host)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

// ===== Rate Limiting =====
export function rateLimit(max, window = '1m') {
  const windowMs = parseMs(window);
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs);
  return (req, res, next) => {
    const key = req.ip;
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
    if (count > max) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}

// ===== Env =====
export function loadEnv(spec) {
  const env = {};
  for (const [key, rules] of Object.entries(spec)) {
    let val = process.env[key];
    if (val === undefined && rules.default !== undefined) val = String(rules.default);
    if (rules.required && val === undefined) {
      console.error(`[NAIDE] Missing required env var: ${key}`);
      process.exit(1);
    }
    if (val !== undefined) {
      if (rules.type === 'number' || rules.type === 'integer') val = Number(val);
      if (rules.type === 'boolean') val = val === 'true' || val === '1';
    }
    env[key] = val;
  }
  return env;
}

// ===== Cron / Scheduler =====
export function scheduleEvery(interval, fn) {
  const ms = parseMs(interval);
  const timer = setInterval(async () => {
    try { await fn(); } catch (e) { console.error('[NAIDE Cron]', e.message); }
  }, ms);
  fn();
  return timer;
}

// ===== Event Bus (for watch) =====
export function createEventBus() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    emit(event, data) {
      const fns = listeners.get(event) || [];
      for (const fn of fns) {
        try { fn({ event, data, timestamp: new Date().toISOString() }); } catch (e) { console.error('[NAIDE Event]', e.message); }
      }
    }
  };
}

// ===== HTTP Client (zero-dep, Node 18+ fetch) =====
async function jsonOrText(res) {
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

export const api = {
  async get(url, opts = {}) {
    const res = await fetch(url, { ...opts, method: 'GET' });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, response: res });
    return jsonOrText(res);
  },
  async post(url, body, opts = {}) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...opts.headers }, body: JSON.stringify(body), ...opts });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, response: res });
    return jsonOrText(res);
  },
  async put(url, body, opts = {}) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...opts.headers }, body: JSON.stringify(body), ...opts });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, response: res });
    return jsonOrText(res);
  },
  async del(url, opts = {}) {
    const res = await fetch(url, { method: 'DELETE', ...opts });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, response: res });
    return jsonOrText(res);
  },
  async raw(url, opts = {}) {
    return fetch(url, opts);
  }
};

// ===== Cookie Parser =====
export function cookieParser() {
  return (req, res, next) => {
    req.cookies = {};
    const header = req.headers.cookie;
    if (header) {
      for (const pair of header.split(';')) {
        const idx = pair.indexOf('=');
        if (idx > 0) {
          const k = pair.slice(0, idx).trim();
          const v = pair.slice(idx + 1).trim();
          try { req.cookies[k] = decodeURIComponent(v); } catch { req.cookies[k] = v; }
        }
      }
    }
    next();
  };
}

// ===== Session Middleware (zero-dep, cookie-based) =====
export function sessionMiddleware(secret) {
  const store = new Map();
  const maxAge = 86400000;
  return (req, res, next) => {
    const cookies = req.headers.cookie || '';
    const sidMatch = cookies.match(/(?:^|;\s*)naide_sid=([^;]+)/);
    let sid = sidMatch ? sidMatch[1] : null;
    if (!sid || !store.has(sid)) {
      sid = randomUUID();
      store.set(sid, {});
    }
    req.session = store.get(sid);
    req.sessionId = sid;
    req.session.destroy = () => { store.delete(sid); };
    const origWriteHead = res.writeHead;
    res.writeHead = function(...args) {
      res.setHeader('Set-Cookie', `naide_sid=${sid}; HttpOnly; Path=/; Max-Age=${maxAge / 1000}; SameSite=Lax`);
      origWriteHead.apply(res, args);
    };
    for (const [id, data] of store) {
      if (data.__ts && Date.now() - data.__ts > maxAge) store.delete(id);
    }
    req.session.__ts = Date.now();
    next();
  };
}

// ===== Template Renderer (zero-dep) =====
export function createRenderer(viewsDir) {
  return (name, data = {}) => {
    const filePath = viewsDir.replace(/\/$/, '') + '/' + name + (name.includes('.') ? '' : '.html');
    let template = readFileSync(filePath, 'utf-8');
    template = template.replace(/\{\{\s*each\s+(\w+)\s+in\s+(\w+)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g, (_, item, list, block) => {
      const arr = data[list] || [];
      return arr.map(val => block.replace(new RegExp(`\\{\\{\\s*${item}\\b[^}]*\\}\\}`, 'g'), m => {
        const prop = m.match(/\{\{\s*\w+\.(\w+)\s*\}\}/);
        return prop ? String(val[prop[1]] ?? '') : String(val ?? '');
      })).join('');
    });
    template = template.replace(/\{\{\s*if\s+(\w+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g, (_, key, block) => data[key] ? block : '');
    for (const [key, value] of Object.entries(data)) {
      template = template.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value ?? ''));
    }
    return template;
  };
}

// ===== Cache Middleware (zero-dep) =====
export function cacheMiddleware(duration) {
  const maxAge = parseMs(duration);
  const cache = new Map();
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = req.originalUrl || req.url;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.time < maxAge) {
      res.setHeader('X-Cache', 'HIT');
      const ct = cached.contentType || 'application/json';
      res.setHeader('Content-Type', ct);
      return res.end(cached.body);
    }
    const origEnd = res.end;
    const origJson = res.json ? res.json.bind(res) : null;
    if (origJson) {
      res.json = (data) => {
        cache.set(key, { body: JSON.stringify(data), contentType: 'application/json', time: Date.now() });
        res.setHeader('X-Cache', 'MISS');
        origJson(data);
      };
    }
    const origSend = res.send ? res.send.bind(res) : null;
    if (origSend) {
      res.send = (body) => {
        cache.set(key, { body: String(body), contentType: res.getHeader('content-type'), time: Date.now() });
        res.setHeader('X-Cache', 'MISS');
        origSend(body);
      };
    }
    next();
  };
}

// ===== Upload Middleware (zero-dep multipart parser) =====
export function uploadMiddleware(fieldName, opts = {}) {
  const maxSize = opts.maxSize || 10 * 1024 * 1024;
  return (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) return next();
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
    if (!boundaryMatch) return next();
    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) { req.destroy(); return res.status(413).json({ error: 'File too large' }); }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const { files, fields } = _parseMultipart(buffer, boundary);
        req.files = files;
        req.file = files[fieldName] || files[Object.keys(files)[0]] || null;
        if (!req.body) req.body = {};
        Object.assign(req.body, fields);
        next();
      } catch { res.status(400).json({ error: 'Invalid multipart data' }); }
    });
    req.on('error', () => res.status(400).json({ error: 'Upload failed' }));
  };
}

function _parseMultipart(buffer, boundary) {
  const files = {}, fields = {};
  const delim = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(delim);
  if (start === -1) return { files, fields };
  start += delim.length + 2;
  const endDelim = Buffer.from(`--${boundary}--`);
  while (start < buffer.length) {
    let end = buffer.indexOf(delim, start);
    if (end === -1) break;
    const part = buffer.slice(start, end - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = part.slice(0, headerEnd).toString('utf-8');
      const body = part.slice(headerEnd + 4);
      const nameMatch = header.match(/name="([^"]+)"/);
      if (nameMatch) {
        const filenameMatch = header.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          const ctMatch = header.match(/Content-Type:\s*(.+)/i);
          files[nameMatch[1]] = { filename: filenameMatch[1], contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream', data: body, size: body.length };
        } else {
          fields[nameMatch[1]] = body.toString('utf-8');
        }
      }
    }
    start = end + delim.length;
    if (buffer.slice(end, end + endDelim.length).equals(endDelim)) break;
    start += 2;
  }
  return { files, fields };
}

// ===== SSE Manager (zero-dep) =====
export function createSseManager() {
  const clients = new Set();
  return {
    handler() {
      return (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
        res.write(':\n\n');
        const client = { res, id: randomUUID() };
        clients.add(client);
        req.on('close', () => clients.delete(client));
      };
    },
    send(data, event) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      for (const client of clients) {
        if (event) client.res.write(`event: ${event}\n`);
        client.res.write(`data: ${payload}\n\n`);
      }
    },
    broadcast(data, event) { this.send(data, event); },
    get count() { return clients.size; }
  };
}

// ===== Validate Middleware =====
export function validateMiddleware(schema) {
  return (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const result = schema.validate(req.body || {});
      if (!result.valid) {
        return res.status(400).json({ errors: result.errors });
      }
      req.body = result.data;
    }
    next();
  };
}

// ===== Job Queue (in-memory async) =====
export function createQueue() {
  const handlers = new Map();
  const pending = [];
  let running = false;

  async function process() {
    if (running) return;
    running = true;
    while (pending.length > 0) {
      const { name, data, resolve, reject } = pending.shift();
      const handler = handlers.get(name);
      if (handler) {
        try { await handler(data); resolve(); } catch (e) { console.error('[NAIDE Queue]', e.message); reject(e); }
      } else {
        reject(new Error(`No handler for job: ${name}`));
      }
    }
    running = false;
  }

  return {
    register(name, fn) { handlers.set(name, fn); },
    add(name, data) {
      return new Promise((resolve, reject) => {
        pending.push({ name, data, resolve, reject });
        process();
      });
    },
    get size() { return pending.length; }
  };
}

// ===== OpenAPI Spec Builder =====
export function buildOpenApiSpec(schemas) {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'API', version: '1.0.0' },
    paths: {},
    components: { schemas: {} }
  };
  for (const schema of schemas) {
    const properties = {};
    const required = [];
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      const prop = {};
      switch (fieldDef.type) {
        case 'id': prop.type = 'string'; prop.format = 'uuid'; break;
        case 'string': prop.type = 'string'; break;
        case 'integer': prop.type = 'integer'; break;
        case 'number': prop.type = 'number'; break;
        case 'boolean': prop.type = 'boolean'; break;
        case 'timestamp': prop.type = 'string'; prop.format = 'date-time'; break;
        case 'enum':
          prop.type = 'string';
          if (fieldDef.values) prop.enum = fieldDef.values;
          break;
        default: prop.type = 'string';
      }
      if (fieldDef.min !== undefined) prop.minimum = fieldDef.min;
      if (fieldDef.max !== undefined) prop.maximum = fieldDef.max;
      if (fieldDef.email) prop.format = 'email';
      if (fieldDef.url) prop.format = 'uri';
      properties[fieldName] = prop;
      if (fieldDef.required) required.push(fieldName);
    }
    spec.components.schemas[schema.name] = { type: 'object', properties };
    if (required.length > 0) spec.components.schemas[schema.name].required = required;
  }
  return spec;
}

// ===== AI Integration (zero-dep, Node 18+ fetch) =====
export const ai = {
  async ask(prompt, options = {}) {
    const apiKey = options.key || process.env.AI_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('AI requires API key: set AI_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY env var');
    if (apiKey.startsWith('sk-ant-')) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: options.model || process.env.AI_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: options.maxTokens || 1024,
          system: options.system || undefined,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!res.ok) throw new Error(`AI error: ${res.status}`);
      const data = await res.json();
      return data.content[0].text;
    }
    const baseUrl = options.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const messages = [];
    if (options.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model || process.env.AI_MODEL || 'gpt-4o-mini',
        messages, max_tokens: options.maxTokens || 1024, temperature: options.temperature
      })
    });
    if (!res.ok) throw new Error(`AI error: ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content;
  },

  async json(prompt, schema, options = {}) {
    const schemaStr = typeof schema === 'string' ? schema : JSON.stringify(schema);
    const result = await ai.ask(`${prompt}\n\nRespond ONLY with valid JSON matching: ${schemaStr}`, options);
    try { return JSON.parse(result); } catch {
      const m = result.match(/\{[\s\S]*\}/) || result.match(/\[[\s\S]*\]/);
      if (m) return JSON.parse(m[0]);
      throw new Error('AI did not return valid JSON');
    }
  },

  async stream(prompt, options = {}) {
    const apiKey = options.key || process.env.AI_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('AI requires API key');
    if (apiKey.startsWith('sk-ant-')) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: options.model || process.env.AI_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: options.maxTokens || 1024,
          system: options.system || undefined,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        })
      });
      if (!res.ok) throw new Error(`AI error: ${res.status}`);
      return _sseStream(res, 'anthropic');
    }
    const baseUrl = options.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const messages = [];
    if (options.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model || process.env.AI_MODEL || 'gpt-4o-mini',
        messages, max_tokens: options.maxTokens || 1024, temperature: options.temperature,
        stream: true
      })
    });
    if (!res.ok) throw new Error(`AI error: ${res.status}`);
    return _sseStream(res, 'openai');
  },

  async embed(text, options = {}) {
    const apiKey = options.key || process.env.AI_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('AI embed requires API key (OpenAI-compatible)');
    const baseUrl = options.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const input = Array.isArray(text) ? text : [text];
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model || process.env.AI_EMBED_MODEL || 'text-embedding-3-small',
        input
      })
    });
    if (!res.ok) throw new Error(`AI embed error: ${res.status}`);
    const data = await res.json();
    const embeddings = data.data.map(d => d.embedding);
    return Array.isArray(text) ? embeddings : embeddings[0];
  },

  similarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  },

  async chat(messages, options = {}) {
    const apiKey = options.key || process.env.AI_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('AI requires API key');
    if (apiKey.startsWith('sk-ant-')) {
      const system = messages.find(m => m.role === 'system')?.content;
      const msgs = messages.filter(m => m.role !== 'system');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: options.model || process.env.AI_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: options.maxTokens || 1024,
          system: system || undefined, messages: msgs
        })
      });
      if (!res.ok) throw new Error(`AI error: ${res.status}`);
      const data = await res.json();
      return data.content[0].text;
    }
    const baseUrl = options.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model || process.env.AI_MODEL || 'gpt-4o-mini',
        messages, max_tokens: options.maxTokens || 1024, temperature: options.temperature
      })
    });
    if (!res.ok) throw new Error(`AI error: ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }
};

// ===== SQL Store — SQLite (via better-sqlite3) =====
export function createSqliteStore(db, tableName, schema) {
  const fields = Object.entries(schema.fields);
  const idField = fields.find(([_, r]) => r.auto && r.type === 'id')?.[0] || 'id';

  const columns = fields.map(([name, rules]) => {
    let type = 'TEXT';
    if (rules.type === 'integer') type = 'INTEGER';
    if (rules.type === 'number') type = 'REAL';
    if (rules.type === 'boolean') type = 'INTEGER';
    let col = `"${name}" ${type}`;
    if (rules.auto && rules.type === 'id') col += ' PRIMARY KEY';
    if (rules.required && !(rules.auto && rules.type === 'id')) col += ' NOT NULL';
    if (rules.default !== undefined) {
      const def = typeof rules.default === 'boolean' ? (rules.default ? 1 : 0) :
                  typeof rules.default === 'string' ? `'${rules.default}'` : rules.default;
      col += ` DEFAULT ${def}`;
    }
    return col;
  }).join(', ');

  db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${columns})`);
  migrateSqliteSchema(db, tableName, schema);

  function toRow(data) {
    const row = { ...data };
    for (const [name, rules] of fields) {
      if (rules.type === 'boolean' && name in row) row[name] = row[name] ? 1 : 0;
    }
    return row;
  }

  function fromRow(row) {
    if (!row) return null;
    const result = { ...row };
    for (const [name, rules] of fields) {
      if (rules.type === 'boolean' && name in result) result[name] = !!result[name];
    }
    return result;
  }

  return {
    getAll() { return db.prepare(`SELECT * FROM "${tableName}"`).all().map(fromRow); },
    getById(id) { return fromRow(db.prepare(`SELECT * FROM "${tableName}" WHERE "${idField}" = ?`).get(id)); },
    count() { return db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c; },
    create(data) {
      const { valid, errors, data: validated } = schema.validate(data);
      if (!valid) return { error: errors };
      const row = toRow(validated);
      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(', ');
      db.prepare(`INSERT INTO "${tableName}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`).run(...cols.map(c => row[c]));
      return validated;
    },
    update(id, data) {
      const existing = this.getById(id);
      if (!existing) return null;
      const merged = { ...existing, ...data, [idField]: existing[idField] };
      const row = toRow(merged);
      const sets = Object.keys(row).filter(k => k !== idField).map(k => `"${k}" = ?`).join(', ');
      const vals = Object.keys(row).filter(k => k !== idField).map(k => row[k]);
      db.prepare(`UPDATE "${tableName}" SET ${sets} WHERE "${idField}" = ?`).run(...vals, id);
      return merged;
    },
    delete(id) {
      return db.prepare(`DELETE FROM "${tableName}" WHERE "${idField}" = ?`).run(id).changes > 0;
    },
    where(conditions) {
      const keys = Object.keys(conditions);
      if (keys.length === 0) return this.getAll();
      const where = keys.map(k => `"${k}" = ?`).join(' AND ');
      return db.prepare(`SELECT * FROM "${tableName}" WHERE ${where}`).all(...keys.map(k => conditions[k])).map(fromRow);
    },
    clear() { db.exec(`DELETE FROM "${tableName}"`); }
  };
}

// ===== SSE Stream Parser (for ai.stream) =====
async function* _sseStream(res, provider) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        if (provider === 'anthropic') {
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) yield parsed.delta.text;
        } else {
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        }
      } catch {}
    }
  }
}

// ===== Vector Store (in-memory, cosine similarity) =====
export function createVectorStore() {
  const items = [];

  return {
    add(id, embedding, metadata = {}) {
      const existing = items.findIndex(i => i.id === id);
      if (existing >= 0) items[existing] = { id, embedding, metadata };
      else items.push({ id, embedding, metadata });
    },

    search(queryEmbedding, topK = 5) {
      return items
        .map(item => ({ ...item, score: ai.similarity(queryEmbedding, item.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },

    remove(id) {
      const idx = items.findIndex(i => i.id === id);
      if (idx >= 0) { items.splice(idx, 1); return true; }
      return false;
    },

    get size() { return items.length; },
    clear() { items.length = 0; }
  };
}

// ===== Prompt Template =====
export function createPrompt(template, defaults = {}) {
  return function(vars = {}) {
    const merged = { ...defaults, ...vars };
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      if (key in merged) return String(merged[key]);
      return `{${key}}`;
    });
  };
}

// ===== Schema Migration (auto ALTER TABLE for SQLite) =====
export function migrateSqliteSchema(db, tableName, schema) {
  const fields = Object.entries(schema.fields);
  const info = db.prepare(`PRAGMA table_info("${tableName}")`).all();
  const existing = new Set(info.map(c => c.name));
  let changed = 0;

  for (const [name, rules] of fields) {
    if (!existing.has(name)) {
      let type = 'TEXT';
      if (rules.type === 'integer') type = 'INTEGER';
      if (rules.type === 'number') type = 'REAL';
      if (rules.type === 'boolean') type = 'INTEGER';
      let def = '';
      if (rules.default !== undefined) {
        const d = typeof rules.default === 'boolean' ? (rules.default ? 1 : 0) :
                  typeof rules.default === 'string' ? `'${rules.default}'` : rules.default;
        def = ` DEFAULT ${d}`;
      }
      db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${name}" ${type}${def}`);
      changed++;
    }
  }
  return changed;
}

// ===== Mock / Spy (test utilities) =====
export function createMock(fn) {
  const calls = [];
  let impl = fn || (() => undefined);
  const mock = function(...args) {
    calls.push({ args, timestamp: Date.now() });
    return impl.apply(this, args);
  };
  mock.calls = calls;
  mock.callCount = () => calls.length;
  mock.calledWith = (...expected) => calls.some(c =>
    c.args.length === expected.length && c.args.every((a, i) => a === expected[i])
  );
  mock.returns = (val) => { impl = () => val; return mock; };
  mock.impl = (f) => { impl = f; return mock; };
  mock.reset = () => { calls.length = 0; return mock; };
  return mock;
}

export function createSpy(obj, method) {
  const original = obj[method];
  const mock = createMock(original.bind(obj));
  obj[method] = mock;
  mock.restore = () => { obj[method] = original; };
  return mock;
}

// ===== Plugin System =====
const _plugins = new Map();

export function registerPlugin(name, setup) {
  _plugins.set(name, { name, setup, initialized: false, exports: {} });
}

export function usePlugin(name, options = {}) {
  const plugin = _plugins.get(name);
  if (!plugin) throw new Error(`Plugin not found: ${name}`);
  if (!plugin.initialized) {
    const result = plugin.setup(options);
    if (result && typeof result === 'object') {
      plugin.exports = result;
    }
    plugin.initialized = true;
  }
  return plugin.exports;
}

export function listPlugins() {
  return [..._plugins.keys()];
}

// ===== Helpers =====
function parseMs(str) {
  if (typeof str === 'number') return str;
  const m = str.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!m) return 60000;
  const n = parseInt(m[1]);
  switch (m[2]) {
    case 'ms': return n;
    case 's': return n * 1000;
    case 'm': return n * 60000;
    case 'h': return n * 3600000;
    case 'd': return n * 86400000;
    default: return 60000;
  }
}
