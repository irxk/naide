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
