import { Generator } from './generator.js';

export class BunGenerator extends Generator {
  constructor(options = {}) {
    super(options);
    this.usesBunServe = false;
    this.routes = [];
    this.corsOrigin = null;
    this.serverName = 'app';
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
        this.visitAuth(node.name, child);
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

  emitBunServe(node, errorHandlers) {
    const port = node.port ? this.expr(node.port) : '3000';

    this.emitRaw('');
    this.emit(`const server = Bun.serve({`);
    this.indent++;
    this.emit(`port: ${port},`);
    this.emit(`async fetch(req) {`);
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

    for (const route of this.routes) {
      this.emitBunRoute(route);
    }

    this.emit(`return new Response(JSON.stringify({ error: 'Not Found' }), {`);
    this.indent++;
    this.emit(`status: 404,`);
    this.emit(`headers: { 'Content-Type': 'application/json'${this.corsOrigin ? ', ...corsHeaders' : ''} },`);
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
