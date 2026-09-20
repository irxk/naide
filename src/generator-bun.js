import { Generator } from './generator.js';

export class BunGenerator extends Generator {
  constructor(options = {}) {
    super(options);
    this.usesBunServe = false;
    this.routes = [];
    this.corsOrigin = null;
    this.serverName = 'app';
    this.bunAuthSecret = null;
    this.bunAuthPaths = [];
    this.staticDir = null;
    this.wsHandlers = [];
    this.crudEntries = [];
  }

  generate(ast) {
    this.visitProgram(ast);

    const preamble = [];

    if (this.needsEventBus) {
      this.runtimeImports.add('createEventBus');
    }

    if (this.runtimeImports.size > 0) {
      const imports = [...this.runtimeImports].join(', ');
      preamble.push(`import { ${imports} } from '${this.runtimePath}';`);
      preamble.push('');
    }

    if (this.hasTests) {
      preamble.push("import { test, expect } from 'bun:test';");
      preamble.push('');
    }

    if (this.needsEventBus) {
      preamble.push('const __eventBus = createEventBus();');
      preamble.push('');
    }

    if (preamble.length > 0) {
      this.output.unshift(...preamble);
    }

    return this.output.join('\n');
  }

  visitServer(node) {
    this.usesBunServe = true;
    this.serverName = node.name;

    const errorHandlers = [];

    for (const mid of node.middleware) {
      this.visitStatement(mid);
    }

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.collectRoute(child);
      } else if (child.type === 'CorsDecl') {
        this.visitBunCors(child);
      } else if (child.type === 'AuthDecl') {
        this.visitBunAuth(child);
      } else if (child.type === 'CrudDecl') {
        this.visitBunCrud(child);
      } else if (child.type === 'StaticDecl') {
        this.visitBunStatic(child);
      } else if (child.type === 'WsDecl') {
        this.wsHandlers.push(child);
      } else if (child.type === 'LimitDecl') {
        // rate limiting handled at app level for Bun
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'GroupDecl') {
        this.visitBunGroup(child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else {
        this.visitStatement(child);
      }
    }

    this.emitBunServe(node, errorHandlers);
  }

  collectRoute(route) {
    this.routes.push({ ...route, prefix: '' });
  }

  visitBunCors(node) {
    this.corsOrigin = this.stringValue(node.origins);
  }

  visitBunGroup(node) {
    const prefix = this.rawString(node.prefix);
    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.routes.push({ ...child, prefix });
      } else {
        this.visitStatement(child);
      }
    }
  }

  rawString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
  }

  visitBunAuth(node) {
    this.bunAuthSecret = this.expr(node.secret);
    if (node.protectedPaths.length > 0) {
      this.bunAuthPaths = node.protectedPaths.map(p => this.rawString(p));
    }
  }

  visitBunCrud(node) {
    const path = this.rawString(node.path);
    this.crudEntries.push({ path, schema: node.schemaName });
  }

  visitBunStatic(node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.staticDir = raw;
  }

  emitBunServe(node, errorHandlers) {
    const port = node.port ? this.expr(node.port) : '3000';
    const ch = this.corsOrigin ? ', ...corsHeaders' : '';

    if (this.bunAuthSecret) {
      this.emitRaw('');
      this.emit(`const __authSecret = ${this.bunAuthSecret};`);
      this.emit(`function __verifyJwt(req) {`);
      this.indent++;
      this.emit(`const auth = req.headers.get('Authorization') || '';`);
      this.emit(`const token = auth.replace('Bearer ', '');`);
      this.emit(`if (!token) return null;`);
      this.emit(`try {`);
      this.indent++;
      this.emit(`const [,payload] = token.split('.');`);
      this.emit(`return JSON.parse(atob(payload));`);
      this.indent--;
      this.emit(`} catch { return null; }`);
      this.indent--;
      this.emit(`}`);
    }

    if (this.crudEntries.length > 0) {
      this.emitRaw('');
      for (const crud of this.crudEntries) {
        this.emit(`const __${crud.schema.toLowerCase()}Store = [];`);
        this.emit(`let __${crud.schema.toLowerCase()}Id = 1;`);
      }
    }

    this.emitRaw('');
    this.emit(`const server = Bun.serve({`);
    this.indent++;
    this.emit(`port: ${port},`);

    if (this.wsHandlers.length > 0) {
      this.emit(`websocket: {`);
      this.indent++;
      for (const ws of this.wsHandlers) {
        this.emitBunWsHandlers(ws);
      }
      this.indent--;
      this.emit(`},`);
    }

    this.emit(`async fetch(req${this.wsHandlers.length > 0 ? ', server' : ''}) {`);
    this.indent++;
    this.emit(`const url = new URL(req.url);`);
    this.emit(`const path = url.pathname;`);
    this.emit(`const method = req.method;`);
    this.emitRaw('');

    if (this.corsOrigin) {
      this.emit(`const corsHeaders = {`);
      this.indent++;
      this.emit(`'Access-Control-Allow-Origin': ${this.corsOrigin},`);
      this.emit(`'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',`);
      this.emit(`'Access-Control-Allow-Headers': 'Content-Type, Authorization',`);
      this.indent--;
      this.emit(`};`);
      this.emitRaw('');
      this.emit(`if (method === 'OPTIONS') {`);
      this.indent++;
      this.emit(`return new Response(null, { status: 204, headers: corsHeaders });`);
      this.indent--;
      this.emit(`}`);
      this.emitRaw('');
    }

    if (this.bunAuthSecret && this.bunAuthPaths.length > 0) {
      for (const p of this.bunAuthPaths) {
        const pattern = p.replace(/\*/g, '');
        this.emit(`if (path.startsWith(${JSON.stringify(pattern)})) {`);
        this.indent++;
        this.emit(`const user = __verifyJwt(req);`);
        this.emit(`if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json'${ch} } });`);
        this.indent--;
        this.emit(`}`);
        this.emitRaw('');
      }
    } else if (this.bunAuthSecret) {
      this.emit(`const user = __verifyJwt(req);`);
      this.emit(`if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json'${ch} } });`);
      this.emitRaw('');
    }

    if (this.wsHandlers.length > 0) {
      for (const ws of this.wsHandlers) {
        const wsPath = this.rawString(ws.path);
        this.emit(`if (path === ${JSON.stringify(wsPath)} && server.upgrade(req)) return;`);
      }
      this.emitRaw('');
    }

    if (this.staticDir) {
      this.emit(`const file = Bun.file(${JSON.stringify(this.staticDir)} + path);`);
      this.emit(`if (await file.exists()) return new Response(file);`);
      this.emitRaw('');
    }

    for (const crud of this.crudEntries) {
      this.emitBunCrud(crud);
    }

    for (const route of this.routes) {
      this.emitBunRoute(route);
    }

    this.emit(`return new Response(JSON.stringify({ error: 'Not Found' }), {`);
    this.indent++;
    this.emit(`status: 404,`);
    this.emit(`headers: { 'Content-Type': 'application/json'${ch} },`);
    this.indent--;
    this.emit(`});`);

    this.indent--;
    this.emit(`},`);

    if (errorHandlers.length > 0) {
      this.emit(`error(err) {`);
      this.indent++;
      this.emit(`return new Response(JSON.stringify({ error: err.message }), {`);
      this.indent++;
      this.emit(`status: 500,`);
      this.emit(`headers: { 'Content-Type': 'application/json' },`);
      this.indent--;
      this.emit(`});`);
      this.indent--;
      this.emit(`},`);
    }

    this.indent--;
    this.emit(`});`);
    this.emitRaw('');
    this.emit(`console.log(\`Server running on port \${server.port}\`);`);
  }

  emitBunCrud(crud) {
    const store = `__${crud.schema.toLowerCase()}Store`;
    const idVar = `__${crud.schema.toLowerCase()}Id`;
    const ch = this.corsOrigin ? ', ...corsHeaders' : '';
    const jsonH = `{ 'Content-Type': 'application/json'${ch} }`;

    this.emit(`if (method === 'GET' && path === ${JSON.stringify(crud.path)}) {`);
    this.indent++;
    this.emit(`return new Response(JSON.stringify(${store}), { headers: ${jsonH} });`);
    this.indent--;
    this.emit(`}`);

    const idMatch = `path.match(/^${crud.path.replace(/\//g, '\\/')}\\/(\\w+)$/)`;
    this.emit(`if (method === 'GET' && ${idMatch}) {`);
    this.indent++;
    this.emit(`const id = ${idMatch}[1];`);
    this.emit(`const item = ${store}.find(i => String(i.id) === id);`);
    this.emit(`if (!item) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: ${jsonH} });`);
    this.emit(`return new Response(JSON.stringify(item), { headers: ${jsonH} });`);
    this.indent--;
    this.emit(`}`);

    this.emit(`if (method === 'POST' && path === ${JSON.stringify(crud.path)}) {`);
    this.indent++;
    this.emit(`const body = await req.json();`);
    this.emit(`const item = { id: ${idVar}++, ...body };`);
    this.emit(`${store}.push(item);`);
    this.emit(`return new Response(JSON.stringify(item), { status: 201, headers: ${jsonH} });`);
    this.indent--;
    this.emit(`}`);

    this.emit(`if (method === 'PUT' && ${idMatch}) {`);
    this.indent++;
    this.emit(`const id = ${idMatch}[1];`);
    this.emit(`const idx = ${store}.findIndex(i => String(i.id) === id);`);
    this.emit(`if (idx === -1) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: ${jsonH} });`);
    this.emit(`const body = await req.json();`);
    this.emit(`${store}[idx] = { ...${store}[idx], ...body };`);
    this.emit(`return new Response(JSON.stringify(${store}[idx]), { headers: ${jsonH} });`);
    this.indent--;
    this.emit(`}`);

    this.emit(`if (method === 'DELETE' && ${idMatch}) {`);
    this.indent++;
    this.emit(`const id = ${idMatch}[1];`);
    this.emit(`const idx = ${store}.findIndex(i => String(i.id) === id);`);
    this.emit(`if (idx === -1) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: ${jsonH} });`);
    this.emit(`${store}.splice(idx, 1);`);
    this.emit(`return new Response(JSON.stringify({ deleted: true }), { headers: ${jsonH} });`);
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
  }

  emitBunWsHandlers(ws) {
    const events = ws.events || [];

    const messageEvt = events.find(e => {
      const name = e.name.raw || e.name.parts?.map(p => p.value).join('');
      return name === 'message';
    });
    const openEvt = events.find(e => {
      const name = e.name.raw || e.name.parts?.map(p => p.value).join('');
      return name === 'connect' || name === 'open';
    });
    const closeEvt = events.find(e => {
      const name = e.name.raw || e.name.parts?.map(p => p.value).join('');
      return name === 'close';
    });

    if (messageEvt) {
      this.emit(`message(ws, message) {`);
      this.indent++;
      const dataParam = messageEvt.params[0] || 'data';
      this.emit(`const ${dataParam} = JSON.parse(message);`);
      this.emit(`const send = (d) => ws.send(typeof d === 'string' ? d : JSON.stringify(d));`);
      for (const stmt of messageEvt.body) this.visitStatement(stmt);
      this.indent--;
      this.emit(`},`);
    }

    if (openEvt) {
      this.emit(`open(ws) {`);
      this.indent++;
      for (const stmt of openEvt.body) this.visitStatement(stmt);
      this.indent--;
      this.emit(`},`);
    }

    if (closeEvt) {
      this.emit(`close(ws) {`);
      this.indent++;
      for (const stmt of closeEvt.body) this.visitStatement(stmt);
      this.indent--;
      this.emit(`},`);
    }
  }

  emitBunRoute(route) {
    const method = route.method === 'del' ? 'DELETE' : route.method.toUpperCase();
    const rawPath = this.rawString(route.path);
    const fullPath = route.prefix ? route.prefix + rawPath : rawPath;

    const hasParams = /:(\w+)/.test(fullPath);
    const hasTryCatch = route.body.some(s => s.type === 'Try');
    const needsBody = ['POST', 'PUT', 'PATCH'].includes(method);
    const routeIdx = this.routes.indexOf(route);

    if (hasParams) {
      const paramNames = [];
      const regexPath = fullPath.replace(/:(\w+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      });
      this.emit(`const __match${routeIdx} = path.match(/^${regexPath.replace(/\//g, '\\/')}$/);`);
      this.emit(`if (method === '${method}' && __match${routeIdx}) {`);
      this.indent++;

      if (!hasTryCatch) {
        this.emit('try {');
        this.indent++;
      }

      this.emit(`const params = { ${paramNames.map((n, i) => `${n}: __match${routeIdx}[${i + 1}]`).join(', ')} };`);
      if (needsBody) {
        this.emit(`const body = await req.json().catch(() => null);`);
      }

      this.emitBunRouteBody(route.body);

      if (!hasTryCatch) {
        this.indent--;
        this.emit(`} catch (__err) {`);
        this.indent++;
        this.emit(`return new Response(JSON.stringify({ error: __err.message }), {`);
        this.indent++;
        this.emit(`status: 500,`);
        this.emit(`headers: { 'Content-Type': 'application/json'${this.corsOrigin ? ', ...corsHeaders' : ''} },`);
        this.indent--;
        this.emit(`});`);
        this.indent--;
        this.emit(`}`);
      }

      this.indent--;
      this.emit(`}`);
      this.emitRaw('');
    } else {
      this.emit(`if (method === '${method}' && path === ${JSON.stringify(fullPath)}) {`);
      this.indent++;

      if (!hasTryCatch) {
        this.emit('try {');
        this.indent++;
      }

      if (needsBody) {
        this.emit(`const body = await req.json().catch(() => null);`);
      }

      this.emitBunRouteBody(route.body);

      if (!hasTryCatch) {
        this.indent--;
        this.emit(`} catch (__err) {`);
        this.indent++;
        this.emit(`return new Response(JSON.stringify({ error: __err.message }), {`);
        this.indent++;
        this.emit(`status: 500,`);
        this.emit(`headers: { 'Content-Type': 'application/json'${this.corsOrigin ? ', ...corsHeaders' : ''} },`);
        this.indent--;
        this.emit(`});`);
        this.indent--;
        this.emit(`}`);
      }

      this.indent--;
      this.emit(`}`);
      this.emitRaw('');
    }
  }

  emitBunRouteBody(body) {
    for (const stmt of body) {
      if (stmt.type === 'Return' && stmt.value !== null) {
        const val = this.expr(stmt.value);
        this.emit(`return new Response(JSON.stringify(${val}), {`);
        this.indent++;
        this.emit(`headers: { 'Content-Type': 'application/json'${this.corsOrigin ? ', ...corsHeaders' : ''} },`);
        this.indent--;
        this.emit(`});`);
      } else if (stmt.type === 'ReturnStatus') {
        const val = this.expr(stmt.body);
        const status = this.expr(stmt.statusCode);
        this.emit(`return new Response(JSON.stringify(${val}), {`);
        this.indent++;
        this.emit(`status: ${status},`);
        this.emit(`headers: { 'Content-Type': 'application/json'${this.corsOrigin ? ', ...corsHeaders' : ''} },`);
        this.indent--;
        this.emit(`});`);
      } else if (stmt.type === 'ReturnMethod') {
        const val = this.expr(stmt.value);
        switch (stmt.method) {
          case 'html':
            this.emit(`return new Response(${val}, {`);
            this.indent++;
            this.emit(`headers: { 'Content-Type': 'text/html'${this.corsOrigin ? ', ...corsHeaders' : ''} },`);
            this.indent--;
            this.emit(`});`);
            break;
          case 'text':
            this.emit(`return new Response(${val}, {`);
            this.indent++;
            this.emit(`headers: { 'Content-Type': 'text/plain'${this.corsOrigin ? ', ...corsHeaders' : ''} },`);
            this.indent--;
            this.emit(`});`);
            break;
          case 'redirect':
            this.emit(`return Response.redirect(${val}, 302);`);
            break;
          case 'file':
            this.emit(`return new Response(Bun.file(${val}));`);
            break;
          default:
            this.emit(`return new Response(${val});`);
        }
      } else {
        this.visitStatement(stmt);
      }
    }
  }

  visitTest(node) {
    this.hasTests = true;
    const name = this.stringValue(node.name);
    this.emit(`test(${name}, () => {`);
    this.indent++;
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }
}
