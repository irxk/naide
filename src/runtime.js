import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

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

// ===== CRUD Route Registration =====
export function registerCrud(app, basePath, schema, store, eventBus) {
  app.get(basePath, (_req, res) => {
    res.json(store.getAll());
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
