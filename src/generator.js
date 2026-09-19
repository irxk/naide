export class Generator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.usesExpress = false;
    this.models = new Map();
    this.runtimeImports = new Set();
    this.schemas = new Map();
    this.needsEventBus = false;
    this.runtimePath = options.runtimePath || 'naidejs/runtime';
    this.dbDir = null;
    this.authSecret = null;
    this.hasWs = false;
    this.wsNodes = [];
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

    if (this.needsEventBus) {
      preamble.push('const __eventBus = createEventBus();');
      preamble.push('');
    }

    if (preamble.length > 0) {
      this.output.unshift(...preamble);
    }

    return this.output.join('\n');
  }

  emit(line) {
    this.output.push('  '.repeat(this.indent) + line);
  }

  emitRaw(line) {
    this.output.push(line);
  }

  visitProgram(node) {
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
  }

  visitStatement(node) {
    switch (node.type) {
      case 'Use': return this.visitUse(node);
      case 'UseDestructured': return this.visitUseDestructured(node);
      case 'Function': return this.visitFunction(node);
      case 'Return': return this.visitReturn(node);
      case 'ReturnStatus': return this.visitReturnStatus(node);
      case 'ReturnMethod': return this.visitReturnMethod(node);
      case 'TypedVar': return this.visitTypedVar(node);
      case 'If': return this.visitIf(node);
      case 'Each': return this.visitEach(node);
      case 'For': return this.visitFor(node);
      case 'While': return this.visitWhile(node);
      case 'Match': return this.visitMatch(node);
      case 'Try': return this.visitTry(node);
      case 'Server': return this.visitServer(node);
      case 'Model': return this.visitModel(node);
      case 'On': return this.visitOn(node);
      case 'Log': return this.visitLog(node);
      case 'Throw': return this.visitThrow(node);
      case 'Break': this.emit('break;'); return;
      case 'Continue': this.emit('continue;'); return;
      case 'Assignment': return this.visitAssignment(node);
      case 'CompoundAssign': return this.visitCompoundAssign(node);
      case 'ExprStatement': this.emit(this.expr(node.expression) + ';'); return;
      case 'DbConnect': return this.visitDbConnect(node);
      case 'DbDir': return this.visitDbDir(node);
      case 'AwaitAll': return this.visitAwaitAllStatement(node);
      case 'SchemaDecl': return this.visitSchema(node);
      case 'CrudDecl': return this.visitCrudTopLevel(node);
      case 'AuthDecl': return this.visitAuthTopLevel(node);
      case 'CorsDecl': return this.visitCorsTopLevel(node);
      case 'LimitDecl': return this.visitLimitTopLevel(node);
      case 'EnvDecl': return this.visitEnv(node);
      case 'EveryDecl': return this.visitEvery(node);
      case 'WatchDecl': return this.visitWatch(node);
      case 'StaticDecl': return this.visitStaticTopLevel(node);
      case 'WsDecl': return this.visitWsTopLevel(node);
      case 'GroupDecl': return this.visitGroupTopLevel(node);
      case 'ErrorHandler': return this.visitErrorHandlerTopLevel(node);
      case 'CookieDecl': return this.visitCookieTopLevel(node);
      case 'UploadDecl': return this.visitUploadTopLevel(node);
      case 'SessionDecl': return this.visitSessionTopLevel(node);
      case 'ViewDecl': return this.visitViewTopLevel(node);
      case 'SseDecl': return this.visitSseTopLevel(node);
      case 'CacheDecl': return this.visitCacheTopLevel(node);
      case 'MiddlewareRef': return this.visitMiddlewareRefTopLevel(node);
      case 'ReturnRender': return this.visitReturnRender(node);
      default:
        this.emit(`/* unknown: ${node.type} */`);
    }
  }

  visitUse(node) {
    const source = node.source ? this.stringValue(node.source) : `'${node.name}'`;
    const alias = node.alias || node.name;
    if (source.includes('express')) this.usesExpress = true;
    this.emit(`import ${alias} from ${source};`);
  }

  visitUseDestructured(node) {
    const source = this.stringValue(node.source);
    const names = node.names.map(n => n.alias ? `${n.name} as ${n.alias}` : n.name).join(', ');
    this.emit(`import { ${names} } from ${source};`);
  }

  visitFunction(node) {
    const exp = node.isPublic ? 'export ' : '';
    const async = node.isAsync ? 'async ' : '';
    const params = node.params.map(p => {
      let s = p.spread ? '...' : '';
      s += p.name;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    this.emit(`${exp}${async}function ${node.name}(${params}) {`);
    this.indent++;
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitReturn(node) {
    if (node.value === null) {
      this.emit('return;');
    } else {
      this.emit(`return ${this.expr(node.value)};`);
    }
  }

  visitReturnStatus(node) {
    this.emit(`return res.status(${this.expr(node.statusCode)}).json(${this.expr(node.body)});`);
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`return res.redirect(${val});`);
        break;
      case 'html':
        this.emit(`return res.type('html').send(${val});`);
        break;
      case 'text':
        this.emit(`return res.type('text').send(${val});`);
        break;
      case 'file':
        this.emit(`return res.sendFile(${val});`);
        break;
      default:
        this.emit(`return res.${node.method}(${val});`);
    }
  }

  visitTypedVar(node) {
    const keyword = node.isMut ? 'let' : 'const';
    const exp = node.isPublic ? 'export ' : '';
    this.emit(`${exp}${keyword} ${node.name} = ${this.expr(node.value)};`);
  }

  visitAssignment(node) {
    const target = this.expr(node.target);
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.expr(e)).join(', ');
      this.emit(`const [${names}] = ${value};`);
    } else if (node.target.type === 'Object') {
      const names = node.target.properties.map(p => {
        if (p.type === 'shorthand') return p.key;
        return `${p.key}: ${this.expr(p.value)}`;
      }).join(', ');
      this.emit(`const { ${names} } = ${value};`);
    } else {
      this.emit(`${target} = ${value};`);
    }
  }

  visitCompoundAssign(node) {
    this.emit(`${this.expr(node.target)} ${node.op} ${this.expr(node.value)};`);
  }

  visitIf(node) {
    this.emit(`if (${this.expr(node.condition)}) {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;

    for (const elif of node.elifs) {
      this.emit(`} else if (${this.expr(elif.condition)}) {`);
      this.indent++;
      for (const stmt of elif.body) this.visitStatement(stmt);
      this.indent--;
    }

    if (node.elseBody) {
      this.emit('} else {');
      this.indent++;
      for (const stmt of node.elseBody) this.visitStatement(stmt);
      this.indent--;
    }
    this.emit('}');
  }

  visitEach(node) {
    const collection = this.expr(node.collection);
    if (node.key) {
      this.emit(`for (const [${node.key}, ${node.value}] of Object.entries(${collection})) {`);
    } else {
      this.emit(`for (const ${node.value} of ${collection}) {`);
    }
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  visitFor(node) {
    const varName = node.varName;
    const start = this.expr(node.start);
    const end = this.expr(node.end);
    this.emit(`for (let ${varName} = ${start}; ${varName} < ${end}; ${varName}++) {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  visitWhile(node) {
    this.emit(`while (${this.expr(node.condition)}) {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  visitMatch(node) {
    this.emit(`switch (${this.expr(node.value)}) {`);
    this.indent++;
    for (const c of node.cases) {
      if (c.pattern.type === 'DefaultPattern') {
        this.emit('default: {');
      } else {
        this.emit(`case ${this.expr(c.pattern)}: {`);
      }
      this.indent++;
      for (const stmt of c.body) this.visitStatement(stmt);
      this.emit('break;');
      this.indent--;
      this.emit('}');
    }
    this.indent--;
    this.emit('}');
  }

  visitTry(node) {
    this.emit('try {');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    if (node.catchBody) {
      const catchParam = node.catchVar || '_err';
      this.emit(`} catch (${catchParam}) {`);
      this.indent++;
      for (const stmt of node.catchBody) this.visitStatement(stmt);
      this.indent--;
    }
    this.emit('}');
  }

  visitServer(node) {
    const hasWs = node.routes.some(r => r.type === 'WsDecl');

    this.emit(`import express from 'express';`);
    if (hasWs) {
      this.emit(`import { WebSocketServer } from 'ws';`);
    }
    this.emitRaw('');
    this.emit(`const ${node.name} = express();`);
    this.emit(`${node.name}.use(express.json());`);
    this.emit(`${node.name}.use(express.urlencoded({ extended: true }));`);
    this.emitRaw('');

    for (const mid of node.middleware) {
      this.emit(`${node.name}.use(${this.generateMiddleware(mid)});`);
      this.emitRaw('');
    }

    const wsNodes = [];
    const errorHandlers = [];

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(node.name, child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(node.name, child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(node.name, child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors(node.name, child);
      } else if (child.type === 'LimitDecl') {
        this.visitLimit(node.name, child);
      } else if (child.type === 'StaticDecl') {
        this.visitStatic(node.name, child);
      } else if (child.type === 'WsDecl') {
        wsNodes.push(child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(node.name, child);
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'CookieDecl') {
        this.visitCookie(node.name, child);
      } else if (child.type === 'UploadDecl') {
        this.visitUpload(node.name, child);
      } else if (child.type === 'SessionDecl') {
        this.visitSession(node.name, child);
      } else if (child.type === 'ViewDecl') {
        this.visitView(node.name, child);
      } else if (child.type === 'SseDecl') {
        this.visitSse(node.name, child);
      } else if (child.type === 'CacheDecl') {
        this.visitCache(node.name, child);
      } else if (child.type === 'MiddlewareRef') {
        this.visitMiddlewareRef(node.name, child);
      } else {
        this.visitStatement(child);
      }
    }

    for (const eh of errorHandlers) {
      this.visitErrorHandler(node.name, eh);
    }

    const port = node.port ? this.expr(node.port) : '3000';
    this.emitRaw('');
    if (hasWs) {
      this.emit(`const __server = ${node.name}.listen(${port}, () => {`);
    } else {
      this.emit(`${node.name}.listen(${port}, () => {`);
    }
    this.indent++;
    this.emit(`console.log(\`Server running on port \${${port}}\`);`);
    this.indent--;
    this.emit('});');

    for (const wsNode of wsNodes) {
      this.emitRaw('');
      this.visitWs(wsNode);
    }
  }

  visitRoute(appName, route) {
    const method = route.method === 'del' ? 'delete' : route.method;
    const path = this.stringValue(route.path);
    const params = route.params.length > 0 ? route.params.join(', ') : 'req, res';

    const needsAsync = this.bodyUsesAwait(route.body);
    const asyncPrefix = needsAsync ? 'async ' : '';

    this.emit(`${appName}.${method}(${path}, ${asyncPrefix}(${params}) => {`);
    this.indent++;

    const hasRes = params.includes('res');

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        if (hasRes || params === 'req, res') {
          this.emit(`res.json(${this.expr(stmt.value)});`);
        } else {
          this.emit(`return ${this.expr(stmt.value)};`);
        }
      } else {
        this.visitStatement(stmt);
      }
    }

    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  generateMiddleware(mid) {
    const params = mid.params.join(', ');
    let code = `(${params}) => {\n`;
    for (const stmt of mid.body) {
      code += '    ' + this.statementToString(stmt) + '\n';
    }
    code += '  }';
    return code;
  }

  visitModel(node) {
    this.models.set(node.name, node);

    const exp = node.isPublic ? 'export ' : '';
    const ext = node.parent ? ` extends ${node.parent}` : '';
    this.emit(`${exp}class ${node.name}${ext} {`);
    this.indent++;

    if (node.fields.length > 0 || node.parent) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const constructorParams = allFields.map(f => {
        if (f.defaultValue) return `${f.name} = ${this.expr(f.defaultValue)}`;
        return f.name;
      }).join(', ');

      this.emit(`constructor(${constructorParams}) {`);
      this.indent++;
      if (node.parent) {
        const superArgs = parentFields.map(f => f.name).join(', ');
        this.emit(`super(${superArgs});`);
      }
      for (const f of node.fields) {
        this.emit(`this.${f.name} = ${f.name};`);
      }
      this.indent--;
      this.emit('}');
      this.emitRaw('');
    }

    for (const method of node.methods) {
      const async = method.isAsync ? 'async ' : '';
      const params = method.params.map(p => {
        let s = p.spread ? '...' : '';
        s += p.name;
        if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      this.emit(`${async}${method.name}(${params}) {`);
      this.indent++;
      for (const stmt of method.body) {
        this.visitStatement(stmt);
      }
      this.indent--;
      this.emit('}');
      this.emitRaw('');
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitOn(node) {
    const event = this.expr(node.event);
    if (node.event.type === 'MemberAccess') {
      const obj = this.expr(node.event.object);
      const evt = node.event.property;
      this.emit(`${obj}.on('${evt}', () => {`);
    } else {
      this.emit(`${event}(() => {`);
    }
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
  }

  visitLog(node) {
    const method = node.level === 'log' ? 'log' : node.level;
    const args = node.args.map(a => this.expr(a)).join(', ');
    this.emit(`console.${method}(${args});`);
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw new Error(${value});`);
    } else {
      this.emit(`throw ${value};`);
    }
  }

  visitDbConnect(node) {
    this.emit(`const db = new Database(${this.expr(node.connectionString)});`);
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.dbDir = raw.endsWith('/') ? raw : raw + '/';
  }

  visitAwaitAllStatement(node) {
    const exprs = node.expressions.map(e => this.expr(e)).join(', ');
    this.emit(`await Promise.all([${exprs}]);`);
  }

  // ===== High-level features =====

  visitSchema(node) {
    this.runtimeImports.add('createSchema');
    if (this.dbDir) {
      this.runtimeImports.add('createFileStore');
    } else {
      this.runtimeImports.add('createStore');
    }

    this.emit(`const ${node.name}Schema = createSchema('${node.name}', {`);
    this.indent++;

    for (const field of node.fields) {
      const props = [];

      switch (field.type) {
        case 'auto':
          props.push("type: 'id'", 'auto: true');
          break;
        case 'timestamp':
          props.push("type: 'timestamp'");
          break;
        case 'str':
          props.push("type: 'string'");
          break;
        case 'int':
          props.push("type: 'integer'");
          break;
        case 'num':
          props.push("type: 'number'");
          break;
        case 'bool':
          props.push("type: 'boolean'");
          break;
        case 'enum':
          if (field.enumValues) {
            const vals = field.enumValues.map(v => this.expr(v)).join(', ');
            props.push("type: 'enum'", `values: [${vals}]`);
          } else {
            props.push("type: 'enum'");
          }
          break;
        default:
          props.push(`type: '${field.type}'`);
          break;
      }

      for (const mod of field.modifiers) {
        switch (mod.name) {
          case 'required': props.push('required: true'); break;
          case 'optional': props.push('required: false'); break;
          case 'unique': props.push('unique: true'); break;
          case 'email': props.push('email: true'); break;
          case 'url': props.push('url: true'); break;
          case 'auto': props.push('auto: true'); break;
          case 'min': props.push(`min: ${this.expr(mod.args[0])}`); break;
          case 'max': props.push(`max: ${this.expr(mod.args[0])}`); break;
          case 'default': props.push(`default: ${this.expr(mod.args[0])}`); break;
        }
      }

      this.emit(`${field.name}: { ${props.join(', ')} },`);
    }

    this.indent--;
    this.emit('});');
    if (this.dbDir) {
      this.emit(`const ${node.name}Store = createFileStore(${node.name}Schema, '${this.dbDir}${node.name}.json');`);
    } else {
      this.emit(`const ${node.name}Store = createStore(${node.name}Schema);`);
    }
    this.emitRaw('');

    this.schemas.set(node.name, node);
  }

  visitCrud(appName, node) {
    this.runtimeImports.add('registerCrud');
    this.needsEventBus = true;

    const path = this.stringValue(node.path);
    this.emit(`registerCrud(${appName}, ${path}, ${node.schemaName}Schema, ${node.schemaName}Store, __eventBus);`);
    this.emitRaw('');
  }

  visitCrudTopLevel(node) {
    this.visitCrud('app', node);
  }

  visitAuth(appName, node) {
    this.runtimeImports.add('jwtAuth');

    const secret = this.expr(node.secret);
    this.authSecret = secret;

    this.emit(`const __authSecret = ${secret};`);

    const options = [];
    if (node.publicPaths.length > 0) {
      const paths = node.publicPaths.map(p => this.stringValue(p)).join(', ');
      options.push(`public: [${paths}]`);
    }
    const optStr = options.length > 0 ? `, { ${options.join(', ')} }` : '';

    if (node.protectedPaths.length > 0) {
      const path = this.stringValue(node.protectedPaths[0]);
      this.emit(`${appName}.use(${path}, jwtAuth(${secret}${optStr}));`);
    } else {
      this.emit(`${appName}.use(jwtAuth(${secret}${optStr}));`);
    }
    this.emitRaw('');
  }

  visitAuthTopLevel(node) {
    this.visitAuth('app', node);
  }

  visitCors(appName, node) {
    this.runtimeImports.add('corsMiddleware');

    const origins = this.expr(node.origins);
    if (node.origins.type === 'String') {
      this.emit(`${appName}.use(corsMiddleware([${origins}]));`);
    } else {
      this.emit(`${appName}.use(corsMiddleware(${origins}));`);
    }
    this.emitRaw('');
  }

  visitCorsTopLevel(node) {
    this.visitCors('app', node);
  }

  visitLimit(appName, node) {
    this.runtimeImports.add('rateLimit');

    const path = this.stringValue(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`${appName}.use(${path}, rateLimit(${max}, ${window}));`);
    this.emitRaw('');
  }

  visitLimitTopLevel(node) {
    this.visitLimit('app', node);
  }

  visitStatic(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.emit(`${appName}.use(express.static(${JSON.stringify(raw)}));`);
    this.emitRaw('');
  }

  visitStaticTopLevel(node) {
    this.visitStatic('app', node);
  }

  visitWs(node) {
    const path = this.stringValue(node.path);
    this.emit(`const __wss = new WebSocketServer({ server: __server, path: ${path} });`);
    this.emit(`__wss.on('connection', (__ws) => {`);
    this.indent++;
    this.emit(`const send = (d) => __ws.send(typeof d === 'string' ? d : JSON.stringify(d));`);
    this.emit(`const broadcast = (d) => { const m = typeof d === 'string' ? d : JSON.stringify(d); for (const c of __wss.clients) if (c.readyState === 1) c.send(m); };`);

    const connectEvents = node.events.filter(e => {
      const name = e.name.raw || e.name.parts?.map(p => p.value).join('');
      return name === 'connect' || name === 'open';
    });
    const otherEvents = node.events.filter(e => {
      const name = e.name.raw || e.name.parts?.map(p => p.value).join('');
      return name !== 'connect' && name !== 'open';
    });

    for (const evt of connectEvents) {
      this.emitRaw('');
      for (const stmt of evt.body) this.visitStatement(stmt);
    }

    for (const evt of otherEvents) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      this.emitRaw('');

      if (evtName === 'message') {
        const needsAsync = this.bodyUsesAwait(evt.body);
        const asyncPrefix = needsAsync ? 'async ' : '';
        this.emit(`__ws.on('message', ${asyncPrefix}(__raw) => {`);
        this.indent++;
        const dataParam = evt.params[0] || 'data';
        this.emit(`const ${dataParam} = JSON.parse(__raw);`);
        for (const stmt of evt.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('});');
      } else {
        const params = evt.params.length > 0 ? evt.params.join(', ') : '';
        const needsAsync = this.bodyUsesAwait(evt.body);
        const asyncPrefix = needsAsync ? 'async ' : '';
        this.emit(`__ws.on('${evtName}', ${asyncPrefix}(${params}) => {`);
        this.indent++;
        for (const stmt of evt.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('});');
      }
    }

    this.indent--;
    this.emit('});');
  }

  visitWsTopLevel(node) {
    this.visitWs(node);
  }

  visitGroup(appName, node) {
    const prefix = this.stringValue(node.prefix);
    this.groupCounter = (this.groupCounter || 0) + 1;
    const routerName = `__router${this.groupCounter}`;
    this.emit(`const ${routerName} = express.Router();`);

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(routerName, child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(routerName, child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(routerName, child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(routerName, child);
      } else {
        this.visitStatement(child);
      }
    }

    this.emit(`${appName}.use(${prefix}, ${routerName});`);
    this.emitRaw('');
  }

  visitGroupTopLevel(node) {
    this.visitGroup('app', node);
  }

  visitErrorHandler(appName, node) {
    const params = node.params.join(', ');
    this.emit(`${appName}.use((${params}, next) => {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitErrorHandlerTopLevel(node) {
    this.visitErrorHandler('app', node);
  }

  visitCookie(appName, node) {
    this.runtimeImports.add('cookieParser');
    this.emit(`${appName}.use(cookieParser());`);
    this.emitRaw('');
  }

  visitCookieTopLevel(node) {
    this.visitCookie('app', node);
  }

  visitUpload(appName, node) {
    this.runtimeImports.add('uploadMiddleware');
    const path = this.stringValue(node.path);
    const field = this.stringValue(node.fieldName);
    const params = node.params.length > 0 ? node.params.join(', ') : 'req, res';
    const needsAsync = this.bodyUsesAwait(node.body);
    const asyncPrefix = needsAsync ? 'async ' : '';
    this.emit(`${appName}.post(${path}, uploadMiddleware(${field}), ${asyncPrefix}(${params}) => {`);
    this.indent++;
    for (const stmt of node.body) {
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`res.json(${this.expr(stmt.value)});`);
      } else {
        this.visitStatement(stmt);
      }
    }
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitUploadTopLevel(node) {
    this.visitUpload('app', node);
  }

  visitSession(appName, node) {
    this.runtimeImports.add('sessionMiddleware');
    const secret = this.expr(node.secret);
    this.emit(`${appName}.use(sessionMiddleware(${secret}));`);
    this.emitRaw('');
  }

  visitSessionTopLevel(node) {
    this.visitSession('app', node);
  }

  visitView(appName, node) {
    this.runtimeImports.add('createRenderer');
    const dir = this.stringValue(node.dir);
    this.emit(`const __render = createRenderer(${dir});`);
    this.emitRaw('');
  }

  visitViewTopLevel(node) {
    this.visitView('app', node);
  }

  visitSse(appName, node) {
    this.runtimeImports.add('createSseManager');
    const path = this.stringValue(node.path);
    this.emit(`const sse = createSseManager();`);
    this.emit(`${appName}.get(${path}, sse.handler());`);
    this.emitRaw('');
  }

  visitSseTopLevel(node) {
    this.visitSse('app', node);
  }

  visitCache(appName, node) {
    this.runtimeImports.add('cacheMiddleware');
    const path = this.stringValue(node.path);
    const duration = this.expr(node.duration);
    this.emit(`${appName}.use(${path}, cacheMiddleware(${duration}));`);
    this.emitRaw('');
  }

  visitCacheTopLevel(node) {
    this.visitCache('app', node);
  }

  visitMiddlewareRef(appName, node) {
    if (node.path) {
      this.emit(`${appName}.use(${this.stringValue(node.path)}, ${node.name});`);
    } else {
      this.emit(`${appName}.use(${node.name});`);
    }
    this.emitRaw('');
  }

  visitMiddlewareRefTopLevel(node) {
    this.visitMiddlewareRef('app', node);
  }

  visitReturnRender(node) {
    const template = this.expr(node.template);
    const data = node.data ? this.expr(node.data) : '{}';
    this.emit(`return res.type('html').send(__render(${template}, ${data}));`);
  }

  visitEnv(node) {
    this.runtimeImports.add('loadEnv');

    const names = node.vars.map(v => v.name);
    this.emit(`const { ${names.join(', ')} } = loadEnv({`);
    this.indent++;

    for (const v of node.vars) {
      const props = [];

      switch (v.type) {
        case 'str': props.push("type: 'string'"); break;
        case 'int': props.push("type: 'integer'"); break;
        case 'num': props.push("type: 'number'"); break;
        case 'bool': props.push("type: 'boolean'"); break;
        default: props.push(`type: '${v.type}'`); break;
      }

      for (const mod of v.modifiers) {
        switch (mod.name) {
          case 'required': props.push('required: true'); break;
          case 'default': props.push(`default: ${this.expr(mod.args[0])}`); break;
        }
      }

      this.emit(`${v.name}: { ${props.join(', ')} },`);
    }

    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitEvery(node) {
    this.runtimeImports.add('scheduleEvery');

    const interval = this.expr(node.interval);
    const needsAsync = this.bodyUsesAwait(node.body);
    const asyncPrefix = needsAsync ? 'async ' : '';

    this.emit(`scheduleEvery(${interval}, ${asyncPrefix}() => {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitWatch(node) {
    this.needsEventBus = true;

    const params = node.params.length > 0 ? node.params.join(', ') : 'event';
    const needsAsync = this.bodyUsesAwait(node.body);
    const asyncPrefix = needsAsync ? 'async ' : '';

    this.emit(`__eventBus.on('${node.eventName}', ${asyncPrefix}(${params}) => {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Expression generation =====

  expr(node) {
    if (!node) return 'undefined';

    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return this.generateString(node.value);
      case 'Bool': return node.value ? 'true' : 'false';
      case 'Null': return 'null';
      case 'Self': return 'this';
      case 'Identifier': return node.name;

      case 'Binary':
        return `(${this.expr(node.left)} ${node.op} ${this.expr(node.right)})`;

      case 'Unary':
        return `${node.op}${this.expr(node.expr)}`;

      case 'Await':
        return `await ${this.expr(node.expr)}`;

      case 'AwaitAllExpr':
        return `await Promise.all(${this.expr(node.expr)})`;

      case 'Spread':
        return `...${this.expr(node.expr)}`;

      case 'New':
        return `new ${this.expr(node.expr)}`;

      case 'MemberAccess':
        return `${this.expr(node.object)}.${node.property}`;

      case 'OptionalAccess':
        return `${this.expr(node.object)}?.${node.property}`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array':
        return `[${node.elements.map(e => this.expr(e)).join(', ')}]`;

      case 'Object': {
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `...${this.expr(p.value)}`;
          if (p.type === 'shorthand') return p.key;
          if (typeof p.key === 'string') return `${p.key}: ${this.expr(p.value)}`;
          if (p.key.type === 'String') return `${this.generateString(p.key.value)}: ${this.expr(p.value)}`;
          if (p.key.type === 'Computed') return `[${this.expr(p.key.expr)}]: ${this.expr(p.value)}`;
          return `${this.expr(p.key)}: ${this.expr(p.value)}`;
        }).join(', ');
        return `{ ${props} }`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        const wrappedBody = node.body.type === 'Object' ? `(${body})` : body;
        if (node.params.length === 1) return `${params} => ${wrappedBody}`;
        return `(${params}) => ${wrappedBody}`;
      }

      case 'Lambda': {
        const async = node.isAsync ? 'async ' : '';
        const params = node.params.map(p => p.name).join(', ');
        const bodyLines = [];
        const savedOutput = this.output;
        const savedIndent = this.indent;
        this.output = bodyLines;
        this.indent = 0;
        for (const stmt of node.body) this.visitStatement(stmt);
        this.output = savedOutput;
        this.indent = savedIndent;
        return `${async}function(${params}) { ${bodyLines.join(' ')} }`;
      }

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `/* expr:${node.type} */`;
    }
  }

  generateCall(node) {
    const AUTO_IMPORT = { 'hash': 'hash', 'verify': 'verify', 'uuid': 'uuid' };

    if (node.callee.type === 'Identifier' && AUTO_IMPORT[node.callee.name]) {
      const runtimeFn = AUTO_IMPORT[node.callee.name];
      this.runtimeImports.add(runtimeFn);
      return `${runtimeFn}(${node.args.map(a => this.expr(a)).join(', ')})`;
    }

    if (node.callee.type === 'Identifier' && node.callee.name === 'sign') {
      this.runtimeImports.add('jwtSign');
      const args = node.args.map(a => this.expr(a));
      if (args.length === 1 && this.authSecret) {
        return `jwtSign(${args[0]}, __authSecret)`;
      }
      return `jwtSign(${args.join(', ')})`;
    }

    if (node.callee.type === 'MemberAccess' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'api') {
      this.runtimeImports.add('api');
    }

    if (node.callee.type === 'MemberAccess' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'auth') {
      if (node.callee.property === 'sign') {
        this.runtimeImports.add('jwtSign');
        const args = node.args.map(a => this.expr(a));
        if (args.length === 1 && this.authSecret) {
          return `jwtSign(${args[0]}, __authSecret)`;
        }
        return `jwtSign(${args.join(', ')})`;
      }
      if (node.callee.property === 'verify') {
        this.runtimeImports.add('jwtVerify');
        return `jwtVerify(${node.args.map(a => this.expr(a)).join(', ')})`;
      }
    }

    return `${this.expr(node.callee)}(${node.args.map(a => this.expr(a)).join(', ')})`;
  }

  generateString(strData) {
    if (!strData || !strData.parts) return '""';

    const hasInterpolation = strData.parts.some(p => p.type === 'expr');

    if (!hasInterpolation) {
      const raw = strData.parts.map(p => p.value).join('');
      return JSON.stringify(raw);
    }

    let result = '`';
    for (const part of strData.parts) {
      if (part.type === 'text') {
        result += part.value.replace(/`/g, '\\`').replace(/\$/g, '\\$');
      } else {
        const exprCode = part.value.replace(/\bself\b/g, 'this');
        result += '${' + exprCode + '}';
      }
    }
    result += '`';
    return result;
  }

  stringValue(strData) {
    if (!strData || !strData.parts) return '""';
    if (strData.raw !== null && strData.raw !== undefined) {
      return JSON.stringify(strData.raw);
    }
    return this.generateString(strData);
  }

  generatePipe(node) {
    const steps = [];
    let current = node;
    while (current.type === 'Pipe') {
      steps.unshift(current.right);
      current = current.left;
    }
    steps.unshift(current);

    const ARRAY_METHODS = new Set(['filter', 'map', 'reduce', 'find', 'findIndex', 'some', 'every', 'flat', 'flatMap', 'sort', 'reverse', 'slice', 'splice', 'join', 'includes', 'indexOf', 'forEach']);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier' && ARRAY_METHODS.has(step.callee.name)) {
        const args = step.args.map(a => this.expr(a)).join(', ');
        result = `${result}.${step.callee.name}(${args})`;
      } else if (step.type === 'Identifier' && ARRAY_METHODS.has(step.name)) {
        result = `${result}.${step.name}()`;
      } else if (step.type === 'Call') {
        const callee = this.expr(step.callee);
        const args = step.args.map(a => this.expr(a)).join(', ');
        result = `${callee}(${result}${args ? ', ' + args : ''})`;
      } else if (step.type === 'Identifier') {
        result = `${step.name}(${result})`;
      } else {
        result = `(${this.expr(step)})(${result})`;
      }
    }
    return result;
  }

  bodyUsesAwait(body) {
    for (const stmt of body) {
      if (this.stmtUsesAwait(stmt)) return true;
    }
    return false;
  }

  stmtUsesAwait(node) {
    if (!node) return false;
    const json = JSON.stringify(node);
    return json.includes('"Await"') || json.includes('"AwaitAll"');
  }

  statementToString(stmt) {
    const saved = this.output;
    const savedIndent = this.indent;
    this.output = [];
    this.indent = 0;
    this.visitStatement(stmt);
    const result = this.output.join('\n');
    this.output = saved;
    this.indent = savedIndent;
    return result;
  }
}
