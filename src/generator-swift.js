export class SwiftGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.usesVapor = false;
    this.imports = new Set();
    this.hasTests = false;
    this.hasAsserts = false;
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.authSecret = null;
    this.dbVar = null;
  }

  generate(ast) {
    this.visitProgram(ast);

    const preamble = [];

    // Always import Foundation
    this.addImport('Foundation');

    for (const imp of this.imports) {
      preamble.push(`import ${imp}`);
    }

    if (this.hasTests) {
      preamble.push('import XCTest');
    }

    if (preamble.length > 0) {
      preamble.push('');
      this.output.unshift(...preamble);
    }

    return this.output.join('\n');
  }

  emit(line) {
    this.output.push('    '.repeat(this.indent) + line);
    this.sourceMap.push(this.currentSourceLine);
  }

  emitRaw(line) {
    this.output.push(line);
    this.sourceMap.push(this.currentSourceLine);
  }

  addImport(path) {
    this.imports.add(path);
  }

  visitProgram(node) {
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
  }

  // ===== Statement dispatcher =====

  visitStatement(node) {
    if (node._line) this.currentSourceLine = node._line;
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
      case 'Bot': return this.visitBot(node);
      case 'Model': return this.visitModel(node);
      case 'On': return this.visitOn(node);
      case 'Log': return this.visitLog(node);
      case 'Throw': return this.visitThrow(node);
      case 'Break': this.emit('break'); return;
      case 'Continue': this.emit('continue'); return;
      case 'Assignment': return this.visitAssignment(node);
      case 'CompoundAssign': return this.visitCompoundAssign(node);
      case 'ExprStatement': this.emit(this.expr(node.expression)); return;
      case 'DbConnect': return this.visitDbConnect(node);
      case 'DbDir': return this.visitDbDir(node);
      case 'DbSql': return this.visitDbSql(node);
      case 'AwaitAll': return this.visitAwaitAllStatement(node);
      case 'SchemaDecl': return this.visitSchema(node);
      case 'CrudDecl': return this.visitCrud('app', node);
      case 'AuthDecl': return this.visitAuth('app', node);
      case 'CorsDecl': return this.visitCors('app', node);
      case 'LimitDecl': return this.visitLimit('app', node);
      case 'EnvDecl': return this.visitEnv(node);
      case 'EveryDecl': return this.visitEvery(node);
      case 'WatchDecl': return this.visitWatch(node);
      case 'StaticDecl': return this.visitStatic('app', node);
      case 'WsDecl': return this.visitWs(node);
      case 'GroupDecl': return this.visitGroup('app', node);
      case 'ErrorHandler': return this.visitErrorHandler('app', node);
      case 'CookieDecl': return this.visitCookie('app', node);
      case 'UploadDecl': return this.visitUpload('app', node);
      case 'SessionDecl': return this.visitSession('app', node);
      case 'ViewDecl': return this.visitView('app', node);
      case 'SseDecl': return this.visitSse('app', node);
      case 'CacheDecl': return this.visitCache('app', node);
      case 'MiddlewareRef': return this.visitMiddlewareRef('app', node);
      case 'ReturnRender': return this.visitReturnRender(node);
      case 'ValidateDecl': return this.visitValidate('app', node);
      case 'TestDecl': return this.visitTest(node);
      case 'AssertStmt': return this.visitAssert(node);
      case 'QueueDecl': return this.visitQueue(node);
      case 'OpenapiDecl': return this.visitOpenapi('app', node);
      case 'ReturnRedirect': return this.visitReturnRedirect(node);
      case 'ReturnDownload': return this.visitReturnDownload(node);
      case 'PromptDecl': return this.visitPrompt(node);
      case 'Page': return this.visitPage(node);
      case 'CliApp': return this.visitCli(node);
      case 'MailConfig': return this.visitMail(node);
      case 'DesktopApp': return this.visitDesktop(node);
      case 'Screen': return this.visitScreen(node);
      case 'OauthDecl': return this.visitOauth(node);
      case 'PayDecl': return this.visitPay(node);
      case 'StorageDecl': return this.visitStorage(node);
      case 'PdfDecl': return this.visitPdf(node);
      case 'I18nDecl': return this.visitI18n(node);
      case 'PushDecl': return this.visitPush(node);
      case 'SearchDecl': return this.visitSearch(node);
      case 'ImageDecl': return this.visitImage(node);
      case 'CsvDecl': return this.visitCsv(node);
      case 'LoggingDecl': return this.visitLogging(node);
      case 'MigrateDecl': return this.visitMigrate(node);
      case 'GrpcDecl': return this.visitGrpc(node);
      case 'WebrtcDecl': return this.visitWebrtc(node);
      case 'BlockchainDecl': return this.visitBlockchain(node);
      case 'EnumDecl': return this.visitEnum(node);
      case 'Swap': return this.visitSwap(node);
      default:
        this.emit(`// unknown: ${node.type}`);
    }
  }

  // ===== Type mapping =====

  mapType(naideType) {
    const map = {
      'str': 'String',
      'string': 'String',
      'int': 'Int',
      'integer': 'Int',
      'num': 'Double',
      'number': 'Double',
      'bool': 'Bool',
      'boolean': 'Bool',
      'list': '[Any]',
      'map': '[String: Any]',
      'any': 'Any',
      'void': 'Void',
      'auto': 'Int',
      'timestamp': 'String',
    };
    return map[naideType] || 'Any';
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const mapped = this.mapModuleName(raw);
    this.addImport(mapped);
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const mapped = this.mapModuleName(raw);
    this.addImport(mapped);
    // Swift doesn't have selective imports; the full module is imported
  }

  mapModuleName(name) {
    const clean = name.replace(/^['"]|['"]$/g, '');
    const map = {
      'express': 'Vapor',
      'axios': 'AsyncHTTPClient',
      'fs': 'Foundation',
      'path': 'Foundation',
      'crypto': 'CryptoKit',
      'uuid': 'Foundation',
    };
    return map[clean] || clean;
  }

  // ===== Functions =====

  visitFunction(node) {
    const async = node.isAsync ? ' async' : '';
    const params = node.params.map(p => {
      let s = '';
      if (p.spread) s += '_ ';
      s += `${p.name}: Any`;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    this.emit(`func ${node.name}(${params})${async} {`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) {
        this.visitStatement(stmt);
      }
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitReturn(node) {
    if (node.value === null) {
      this.emit('return');
    } else {
      this.emit(`return ${this.expr(node.value)}`);
    }
  }

  visitReturnStatus(node) {
    this.emit(`return Response(status: .custom(code: UInt(${this.expr(node.statusCode)}), reasonPhrase: ""), body: .init(string: ${this.expr(node.body)}))`);
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`return req.redirect(to: ${val})`);
        break;
      case 'html':
        this.emit(`return Response(status: .ok, headers: ["Content-Type": "text/html"], body: .init(string: ${val}))`);
        break;
      case 'text':
        this.emit(`return ${val}`);
        break;
      case 'file':
        this.emit(`return req.fileio.streamFile(at: ${val})`);
        break;
      default:
        this.emit(`return ${val}`);
    }
  }

  // ===== Variables =====

  visitTypedVar(node) {
    const keyword = node.isMut ? 'var' : 'let';
    this.emit(`${keyword} ${node.name} = ${this.expr(node.value)}`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.expr(e));
      this.emit(`let __tmp = ${value}`);
      names.forEach((n, i) => {
        this.emit(`let ${n} = __tmp[${i}]`);
      });
    } else if (node.target.type === 'Object') {
      const tempVar = '__d';
      this.emit(`let ${tempVar} = ${value}`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`let ${varName} = ${tempVar}["${key}"]`);
      }
    } else {
      this.emit(`${this.expr(node.target)} = ${value}`);
    }
  }

  visitCompoundAssign(node) {
    this.emit(`${this.expr(node.target)} ${node.op} ${this.expr(node.value)}`);
  }

  // ===== Control flow =====

  visitIf(node) {
    this.emit(`if ${this.expr(node.condition)} {`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;

    for (const elif of node.elifs) {
      this.emit(`} else if ${this.expr(elif.condition)} {`);
      this.indent++;
      if (elif.body.length === 0) {
        this.emit('// empty');
      } else {
        for (const stmt of elif.body) this.visitStatement(stmt);
      }
      this.indent--;
    }

    if (node.elseBody) {
      this.emit('} else {');
      this.indent++;
      if (node.elseBody.length === 0) {
        this.emit('// empty');
      } else {
        for (const stmt of node.elseBody) this.visitStatement(stmt);
      }
      this.indent--;
    }
    this.emit('}');
  }

  visitEach(node) {
    const collection = this.expr(node.collection);
    if (node.key) {
      this.emit(`for (${node.key}, ${node.value}) in ${collection}.enumerated() {`);
    } else {
      this.emit(`for ${node.value} in ${collection} {`);
    }
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('}');
  }

  visitFor(node) {
    const varName = node.varName;
    const start = this.expr(node.start);
    const end = this.expr(node.end);
    this.emit(`for ${varName} in ${start}..<${end} {`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('}');
  }

  visitWhile(node) {
    this.emit(`while ${this.expr(node.condition)} {`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('}');
  }

  visitMatch(node) {
    this.emit(`switch ${this.expr(node.value)} {`);
    for (const c of node.cases) {
      if (c.pattern.type === 'DefaultPattern') {
        this.emit('default:');
      } else {
        this.emit(`case ${this.expr(c.pattern)}:`);
      }
      this.indent++;
      for (const stmt of c.body) this.visitStatement(stmt);
      this.indent--;
    }
    this.emit('}');
  }

  visitTry(node) {
    this.emit('do {');
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) {
        // Wrap potential throwing calls with try
        this.visitStatement(stmt);
      }
    }
    this.indent--;

    if (node.catchBody) {
      const catchParam = node.catchVar || 'error';
      this.emit(`} catch let ${catchParam} {`);
      this.indent++;
      if (node.catchBody.length === 0) {
        this.emit('// empty');
      } else {
        for (const stmt of node.catchBody) this.visitStatement(stmt);
      }
      this.indent--;
    }

    // Swift doesn't have finally; use defer pattern instead
    if (node.ensureBody) {
      this.emit('} // finally equivalent:');
      // Emit the ensure body outside the do-catch
      for (const stmt of node.ensureBody) this.visitStatement(stmt);
    } else {
      this.emit('}');
    }
  }

  // ===== Server (Vapor) =====

  visitServer(node) {
    this.usesVapor = true;
    this.addImport('Vapor');

    const port = node.port ? this.expr(node.port) : '3000';

    this.emitRaw('');
    this.emit('let app = try Application(.detect())');
    this.emitRaw('');

    for (const mid of node.middleware) {
      this.emit('// middleware');
    }

    const errorHandlers = [];
    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(node.name, child);
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors(node.name, child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(node.name, child);
      } else if (child.type === 'StaticDecl') {
        this.visitStatic(node.name, child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(node.name, child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(node.name, child);
      } else if (child.type === 'WsDecl') {
        this.visitWs(child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else if (child.type === 'GraphqlDecl') {
        this.emit(`// GraphQL: ${this.rawString(child.path)}`);
      } else {
        this.visitStatement(child);
      }
    }

    for (const eh of errorHandlers) {
      this.visitErrorHandler(node.name, eh);
    }

    this.emitRaw('');
    this.emit(`app.http.server.configuration.port = ${port}`);
    this.emit('try app.run()');
    this.emitRaw('');
  }

  visitRoute(appName, route) {
    const method = route.method === 'del' ? 'delete' : route.method;
    const path = this.rawString(route.path);
    const pathParts = path.split('/').filter(p => p).map(p => {
      if (p.startsWith(':')) return `":${p.slice(1)}"`;
      return `"${p}"`;
    }).join(', ');

    const needsAsync = this.bodyUsesAwait(route.body);
    const asyncPrefix = needsAsync ? ' async' : '';

    this.emit(`app.${method}(${pathParts || '""'}) { req${asyncPrefix} -> String in`);
    this.indent++;

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`return ${this.expr(stmt.value)}`);
      } else {
        this.visitStatement(stmt);
      }
    }

    if (route.body.length === 0) {
      this.emit('return ""');
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitGroup(appName, node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`let ${prefix.replace(/\//g, '_').replace(/^_/, '')}Routes = app.grouped("${prefix}")`);

    for (const child of node.routes) {
      if (child.type === 'Route') {
        const method = child.method === 'del' ? 'delete' : child.method;
        const path = this.rawString(child.path);
        this.emit(`${prefix.replace(/\//g, '_').replace(/^_/, '')}Routes.${method}("${path}") { req -> String in`);
        this.indent++;
        for (const stmt of child.body) {
          if (stmt.type === 'Return' && stmt.value !== null) {
            this.emit(`return ${this.expr(stmt.value)}`);
          } else {
            this.visitStatement(stmt);
          }
        }
        if (child.body.length === 0) this.emit('return ""');
        this.indent--;
        this.emit('}');
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(appName, child);
      } else {
        this.visitStatement(child);
      }
    }
    this.emitRaw('');
  }

  visitErrorHandler(appName, node) {
    this.emit('// error handler');
    this.emit('struct CustomErrorMiddleware: Middleware {');
    this.indent++;
    this.emit('func respond(to request: Request, chainingTo next: Responder) -> EventLoopFuture<Response> {');
    this.indent++;
    this.emit('return next.respond(to: request).flatMapError { error in');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    if (node.body.length === 0) {
      this.emit('return request.eventLoop.makeFailedFuture(error)');
    }
    this.indent--;
    this.emit('}');
    this.indent--;
    this.emit('}');
    this.indent--;
    this.emit('}');
    this.emit('app.middleware.use(CustomErrorMiddleware())');
    this.emitRaw('');
  }

  // ===== Model =====

  visitModel(node) {
    this.models.set(node.name, node);

    const parentModel = node.parent ? this.models.get(node.parent) : null;
    const parentFields = parentModel ? parentModel.fields : [];
    const allFields = [...parentFields, ...node.fields];
    const ext = node.parent ? `: ${node.parent}` : '';
    const isSimple = node.methods.length === 0 && !node.parent;

    if (isSimple && allFields.length > 0) {
      // Use struct for simple models
      this.emit(`struct ${node.name}: Codable {`);
      this.indent++;
      for (const f of allFields) {
        const type = this.mapType(f.type || 'any');
        if (f.defaultValue) {
          this.emit(`var ${f.name}: ${type} = ${this.expr(f.defaultValue)}`);
        } else {
          this.emit(`var ${f.name}: ${type}`);
        }
      }
      this.indent--;
      this.emit('}');
    } else {
      this.emit(`class ${node.name}${ext} {`);
      this.indent++;

      for (const f of node.fields) {
        const type = this.mapType(f.type || 'any');
        if (f.defaultValue) {
          this.emit(`var ${f.name}: ${type} = ${this.expr(f.defaultValue)}`);
        } else {
          this.emit(`var ${f.name}: ${type}`);
        }
      }

      if (allFields.length > 0) {
        this.emitRaw('');
        const initParams = allFields.map(f => {
          const type = this.mapType(f.type || 'any');
          if (f.defaultValue) return `${f.name}: ${type} = ${this.expr(f.defaultValue)}`;
          return `${f.name}: ${type}`;
        }).join(', ');

        this.emit(`init(${initParams}) {`);
        this.indent++;
        if (node.parent) {
          const superArgs = parentFields.map(f => `${f.name}: ${f.name}`).join(', ');
          this.emit(`super.init(${superArgs})`);
        }
        for (const f of node.fields) {
          this.emit(`self.${f.name} = ${f.name}`);
        }
        this.indent--;
        this.emit('}');
      }

      for (const method of node.methods) {
        this.emitRaw('');
        const async = method.isAsync ? ' async' : '';
        const params = method.params.map(p => {
          let s = `${p.name}: Any`;
          if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
          return s;
        }).join(', ');

        this.emit(`func ${method.name}(${params})${async} {`);
        this.indent++;
        if (method.body.length === 0) {
          this.emit('// empty');
        } else {
          for (const stmt of method.body) {
            this.visitStatement(stmt);
          }
        }
        this.indent--;
        this.emit('}');
      }

      this.indent--;
      this.emit('}');
    }
    this.emitRaw('');
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    this.emit(`// on ${event}`);
    this.emit(`func __on${event.replace(/\./g, '_')}() {`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Logging and errors =====

  visitLog(node) {
    const args = node.args.map(a => this.expr(a)).join(', ');
    this.emit(`print(${args})`);
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw NSError(domain: "", code: 0, userInfo: [NSLocalizedDescriptionKey: ${value}])`);
    } else {
      this.emit(`throw ${value}`);
    }
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.emit(`// db connect: ${this.expr(node.connectionString)}`);
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`// db dir: ${raw}`);
  }

  visitDbSql(node) {
    const driverRaw = node.driver.raw || node.driver.parts?.map(p => p.value).join('') || 'sqlite';
    const conn = node.connection ? this.swiftStringValue(node.connection) : '"data.db"';

    if (driverRaw === 'sqlite') {
      this.addImport('SQLite');
      this.emit(`let __db = try Connection(${conn})`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      this.addImport('PostgresKit');
      this.emit(`// PostgreSQL connection: ${conn}`);
    }
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    const exprs = node.expressions.map(e => this.expr(e));
    this.emit(`async let __results = (${exprs.join(', ')})`);
    this.emit(`_ = try await __results`);
  }

  // ===== Schema =====

  visitSchema(node) {
    this.emit(`struct ${node.name}: Codable {`);
    this.indent++;
    for (const f of node.fields) {
      const type = this.mapType(f.type);
      const nullable = f.modifiers.some(m => m.name === 'optional') || f.type === 'auto' || f.type === 'timestamp';
      const suffix = nullable ? '?' : '';
      const defaultVal = this.schemaDefault(f);
      if (defaultVal !== null) {
        this.emit(`var ${f.name}: ${type}${suffix} = ${defaultVal}`);
      } else {
        this.emit(`var ${f.name}: ${type}${suffix}`);
      }
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    this.schemas.set(node.name, node);
  }

  schemaDefault(fieldNode) {
    for (const mod of fieldNode.modifiers) {
      if (mod.name === 'default') {
        return this.expr(mod.args[0]);
      }
    }
    if (fieldNode.modifiers.some(m => m.name === 'optional')) return 'nil';
    if (fieldNode.type === 'auto') return 'nil';
    if (fieldNode.type === 'timestamp') return 'nil';
    return null;
  }

  // ===== CORS =====

  visitCors(appName, node) {
    const origins = this.expr(node.origins);
    this.emit('let corsConfig = CORSMiddleware.Configuration(');
    this.indent++;
    this.emit(`allowedOrigin: .custom(${origins}),`);
    this.emit('allowedMethods: [.GET, .POST, .PUT, .DELETE, .PATCH, .OPTIONS],');
    this.emit('allowedHeaders: [.accept, .authorization, .contentType, .origin]');
    this.indent--;
    this.emit(')');
    this.emit('app.middleware.use(CORSMiddleware(configuration: corsConfig))');
    this.emitRaw('');
  }

  // ===== Auth =====

  visitAuth(appName, node) {
    const secret = this.expr(node.secret);
    this.authSecret = secret;
    this.emit(`let __authSecret = ${secret}`);
    this.emit('// JWT auth middleware');
    this.emit('// Configure JWT verification with __authSecret');
    this.emitRaw('');
  }

  // ===== Static =====

  visitStatic(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.emit(`app.middleware.use(FileMiddleware(publicDirectory: "${raw}"))`);
    this.emitRaw('');
  }

  // ===== CRUD =====

  visitCrud(appName, node) {
    const path = this.rawString(node.path);
    const schema = node.schemaName;
    const store = `__${schema.toLowerCase()}Store`;

    this.emitRaw('');
    this.emit(`var ${store}: [${schema}] = []`);
    this.emitRaw('');

    this.emit(`app.get("${path}") { req -> [${schema}] in`);
    this.indent++;
    this.emit(`return ${store}`);
    this.indent--;
    this.emit('}');

    this.emit(`app.post("${path}") { req -> ${schema} in`);
    this.indent++;
    this.emit(`let item = try req.content.decode(${schema}.self)`);
    this.emit(`${store}.append(item)`);
    this.emit('return item');
    this.indent--;
    this.emit('}');

    this.emit(`app.get("${path}", ":id") { req -> ${schema} in`);
    this.indent++;
    this.emit('guard let id = req.parameters.get("id") else { throw Abort(.badRequest) }');
    this.emit(`guard let item = ${store}.first(where: { "\\($0)" .contains(id) }) else { throw Abort(.notFound) }`);
    this.emit('return item');
    this.indent--;
    this.emit('}');

    this.emit(`app.delete("${path}", ":id") { req -> String in`);
    this.indent++;
    this.emit('guard let id = req.parameters.get("id") else { throw Abort(.badRequest) }');
    this.emit(`${store}.removeAll(where: { "\\($0)".contains(id) })`);
    this.emit('return "{\\"deleted\\": true}"');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Rate Limit =====

  visitLimit(appName, node) {
    const path = this.rawString(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`// rate limit: ${max} requests per ${window} on ${path}`);
  }

  // ===== WebSocket =====

  visitWs(node) {
    const path = this.rawString(node.path);

    this.emit(`app.webSocket("${path}") { req, ws in`);
    this.indent++;

    for (const evt of node.events || []) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      if (evtName === 'connect' || evtName === 'open') {
        this.emit('// on connect');
        for (const stmt of evt.body) this.visitStatement(stmt);
      } else if (evtName === 'message') {
        const param = evt.params[0] || 'data';
        this.emit(`ws.onText { ws, ${param} in`);
        this.indent++;
        for (const stmt of evt.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('}');
      } else if (evtName === 'close') {
        this.emit('ws.onClose.whenComplete { _ in');
        this.indent++;
        for (const stmt of evt.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('}');
      }
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Env =====

  visitEnv(node) {
    this.emitRaw('');
    for (const v of node.vars) {
      let defaultVal = null;
      for (const mod of v.modifiers) {
        if (mod.name === 'default') {
          defaultVal = this.expr(mod.args[0]);
        }
      }

      if (defaultVal !== null) {
        this.emit(`let ${v.name} = ProcessInfo.processInfo.environment["${v.name}"] ?? ${defaultVal}`);
      } else {
        this.emit(`let ${v.name} = ProcessInfo.processInfo.environment["${v.name}"]`);
      }

      if (v.type === 'int') {
        this.emit(`let ${v.name}Int = Int(${v.name} ?? "")`);
      } else if (v.type === 'num') {
        this.emit(`let ${v.name}Num = Double(${v.name} ?? "")`);
      } else if (v.type === 'bool') {
        this.emit(`let ${v.name}Bool = ["true", "1", "yes"].contains(${v.name}?.lowercased() ?? "")`);
      }
    }
    this.emitRaw('');
  }

  // ===== Tests =====

  visitTest(node) {
    this.hasTests = true;
    this.addImport('XCTest');
    const name = this.rawString(node.name);
    const funcName = `test${name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}`;

    this.emit(`func ${funcName}() {`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty test');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitAssert(node) {
    this.hasAsserts = true;
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`XCTAssertEqual(${this.expr(exprNode.left)}, ${this.expr(exprNode.right)})`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`XCTAssertNotEqual(${this.expr(exprNode.left)}, ${this.expr(exprNode.right)})`);
    } else {
      this.emit(`XCTAssertTrue(${this.expr(exprNode)})`);
    }
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'ProcessInfo.processInfo.environment["BOT_TOKEN"] ?? ""';
    const botType = this.rawBotType(node.botType);

    this.emit(`// ${botType} bot: ${node.name}`);
    this.emit(`let __botToken = ${tokenExpr}`);

    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        this.emit(`// on ${evtName}`);
        this.emit(`func handle_${evtName}() {`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('}');
      } else if (handler.type === 'BotSlashCmd') {
        const cmdName = handler.name.raw || handler.name.parts?.map(p => p.value).join('');
        this.emit(`// slash command: /${cmdName}`);
        this.emit(`func cmd_${cmdName}() {`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('}');
      }
    }
    this.emitRaw('');
  }

  rawBotType(bt) {
    if (!bt) return 'discord';
    return bt.raw || bt.parts?.map(p => p.value).join('') || 'discord';
  }

  // ===== Cookie =====

  visitCookie(appName, node) {
    this.emit('// cookie support enabled');
  }

  // ===== Upload =====

  visitUpload(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`app.on(.POST, "${path}") { req -> String in`);
    this.indent++;
    this.emit('// handle file upload');
    for (const stmt of node.body) this.visitStatement(stmt);
    if (node.body.length === 0) this.emit('return "ok"');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Session =====

  visitSession(appName, node) {
    this.emit('app.middleware.use(app.sessions.middleware)');
    this.emitRaw('');
  }

  // ===== View =====

  visitView(appName, node) {
    const dir = this.rawString(node.dir);
    this.emit(`// view engine: templates from "${dir}"`);
    this.emit('app.views.use(.leaf)');
    this.emitRaw('');
  }

  // ===== SSE =====

  visitSse(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// SSE endpoint: ${path}`);
  }

  // ===== Cache =====

  visitCache(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// cache: ${path}`);
  }

  // ===== MiddlewareRef =====

  visitMiddlewareRef(appName, node) {
    if (node.path) {
      this.emit(`// middleware "${node.name}" on ${this.rawString(node.path)}`);
    } else {
      this.emit(`// middleware "${node.name}"`);
    }
  }

  // ===== Return variants =====

  visitReturnRender(node) {
    const template = this.expr(node.template);
    this.emit(`return try await req.view.render(${template})`);
  }

  visitReturnRedirect(node) {
    this.emit(`return req.redirect(to: ${this.expr(node.url)})`);
  }

  visitReturnDownload(node) {
    this.emit(`return req.fileio.streamFile(at: ${this.expr(node.filePath)})`);
  }

  // ===== Validate =====

  visitValidate(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// validate: ${path} against ${node.schemaName}`);
  }

  // ===== Queue =====

  visitQueue(node) {
    this.emit(`// queue: ${node.name}`);
    this.emit(`struct ${node.name} {`);
    this.indent++;
    for (const job of node.jobs) {
      const name = this.rawString(job.name);
      const params = job.params.length > 0 ? job.params.join(', ') : 'data';
      this.emit(`static func ${name}(${params}: Any) {`);
      this.indent++;
      for (const stmt of job.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== OpenAPI =====

  visitOpenapi(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// OpenAPI spec at ${path}`);
  }

  // ===== Prompt =====

  visitPrompt(node) {
    const name = node.name;
    this.emit(`func ${name}(vars: [String: Any] = [:]) -> String {`);
    this.indent++;
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : lines.join(' + "\\n" + ');
    this.emit(`var template = ${template}`);
    this.emit(`for (k, v) in vars {`);
    this.indent++;
    this.emit('template = template.replacingOccurrences(of: "{\\(k)}", with: "\\(v)")');
    this.indent--;
    this.emit('}');
    this.emit('return template');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Page =====

  visitPage(node) {
    const filename = this.rawPageString(node.filename);

    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`let __html = """`);
    this.emit(`<!DOCTYPE html>`);
    this.emit(`<html lang="en">`);
    this.emit(`<head>`);
    this.emit(`<meta charset="UTF-8">`);
    this.emit(`<meta name="viewport" content="width=device-width, initial-scale=1.0">`);
    this.emit(`<title>${pageTitle}</title>`);
    for (const h of headParts) this.emit(h);
    this.emit(`</head>`);
    this.emit(`<body>`);
    for (const b of bodyParts) this.emit(b);
    this.emit(`</body>`);
    this.emit(`</html>`);
    this.emit(`"""`);
    this.emit(`try __html.write(toFile: "${filename}", atomically: true, encoding: .utf8)`);
    this.emitRaw('');
  }

  classifyPageElement(el, head, body, setTitle) {
    const tag = el.tag;
    const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
    const arg1 = el.args[1] ? this.rawPageString(el.args[1]) : '';
    if (tag === 'title') { setTitle(arg0); return; }
    if (tag === 'style' || tag === 'link') { head.push(`<link rel="stylesheet" href="${arg0}">`); return; }
    if (tag === 'meta') { head.push(`<meta name="${arg0}" content="${arg1}">`); return; }
    if (tag === 'script') { body.push(`<script src="${arg0}"></script>`); return; }
    if (tag === 'img') { body.push(`<img src="${arg0}" alt="${arg1}">`); return; }
    if (tag === 'a') { body.push(`<a href="${arg0}">${arg1}</a>`); return; }
    if (tag === 'input') { body.push(`<input type="${arg0}" name="${arg1}">`); return; }
    if (el.children && el.children.length > 0) {
      const cls = arg0 ? ` class="${arg0}"` : '';
      body.push(`<${tag}${cls}>`);
      for (const child of el.children) this.classifyPageElement(child, head, body, setTitle);
      body.push(`</${tag}>`);
    } else {
      body.push(`<${tag}>${arg0}</${tag}>`);
    }
  }

  rawPageString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
  }

  // ===== CLI App =====

  visitCli(node) {
    const desc = node.description ? this.rawPageString(node.description) : node.name;

    this.addImport('Foundation');
    this.emit(`// CLI: ${desc}`);
    this.emit('let __argv = CommandLine.arguments.dropFirst()');
    this.emit('var parsedArgs: [String: Any] = [:]');
    this.emit('var i = 0');
    this.emit('while i < __argv.count {');
    this.indent++;
    this.emit('let arg = Array(__argv)[i]');
    this.emit('switch arg {');
    this.emit('case "--help", "-h":');
    this.indent++;
    this.emit(`print("${desc}")`);
    this.emit('exit(0)');
    this.indent--;
    for (const arg of node.args) {
      const argName = this.rawPageString(arg.name);
      this.emit(`case "--${argName}":`);
      this.indent++;
      this.emit('i += 1');
      if (arg.type === 'int') {
        this.emit(`parsedArgs["${argName}"] = Int(Array(__argv)[i]) ?? 0`);
      } else if (arg.type === 'num') {
        this.emit(`parsedArgs["${argName}"] = Double(Array(__argv)[i]) ?? 0.0`);
      } else if (arg.type === 'bool') {
        this.emit(`parsedArgs["${argName}"] = true`);
      } else {
        this.emit(`parsedArgs["${argName}"] = Array(__argv)[i]`);
      }
      this.indent--;
    }
    for (const flag of node.flags) {
      const s = this.rawPageString(flag.short);
      const l = this.rawPageString(flag.long);
      this.emit(`case "-${s}", "--${l}":`);
      this.indent++;
      this.emit(`parsedArgs["${l}"] = true`);
      this.indent--;
    }
    this.emit('default: break');
    this.emit('}');
    this.emit('i += 1');
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    if (node.run) {
      const runParam = node.run.params.length > 0 ? node.run.params[0] : 'parsedArgs';
      if (runParam !== 'parsedArgs') {
        this.emit(`let ${runParam} = parsedArgs`);
      }
      for (const stmt of node.run.body) this.visitStatement(stmt);
    }
    this.emitRaw('');
  }

  // ===== Mail =====

  visitMail(node) {
    this.emit('// Mail configuration');
    this.emit('// Use SwiftSMTP or similar library');
    this.emitRaw('');
  }

  // ===== Desktop =====

  visitDesktop(node) {
    const title = node.title ? this.rawPageString(node.title) : node.name;
    const width = node.width ? this.expr(node.width) : '800';
    const height = node.height ? this.expr(node.height) : '600';

    this.addImport('AppKit');
    this.emit('let app = NSApplication.shared');
    this.emit(`let window = NSWindow(contentRect: NSMakeRect(0, 0, ${width}, ${height}),`);
    this.indent++;
    this.emit('styleMask: [.titled, .closable, .miniaturizable, .resizable],');
    this.emit('backing: .buffered, defer: false)');
    this.indent--;
    this.emit(`window.title = "${title}"`);
    this.emit('window.makeKeyAndOrderFront(nil)');
    this.emit('app.run()');
    this.emitRaw('');
  }

  // ===== Screen =====

  visitScreen(node) {
    this.addImport('SwiftUI');
    this.emit(`struct ${node.name}: View {`);
    this.indent++;
    this.emit('var body: some View {');
    this.indent++;
    this.emit('VStack(spacing: 16) {');
    this.indent++;
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
      if (tag === 'text') {
        this.emit(`Text("${arg0}")`);
      } else if (tag === 'button') {
        this.emit(`Button("${arg0}") { /* action */ }`);
      } else if (tag === 'input') {
        this.emit(`TextField("${arg0}", text: .constant(""))`);
      } else if (tag === 'image') {
        this.emit(`Image("${arg0}")`);
      } else {
        this.emit(`Text("${arg0}")`);
      }
    }
    this.indent--;
    this.emit('}.padding()');
    this.indent--;
    this.emit('}');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Every (scheduler) =====

  visitEvery(node) {
    const interval = this.expr(node.interval);
    this.emit(`Timer.scheduledTimer(withTimeInterval: ${interval}, repeats: true) { _ in`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Watch =====

  visitWatch(node) {
    const params = node.params.length > 0 ? node.params.join(', ') : 'event';
    this.emit(`// watch: ${node.eventName}`);
    this.emit(`func __onWatch_${node.eventName}(${params}: Any) {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Domain features (comment stubs) =====

  visitOauth(node) {
    const provider = this.rawPageString(node.provider);
    this.emit(`// OAuth: ${provider}`);
    this.emit('// Use AuthenticationServices or OAuthSwift');
    this.emitRaw('');
  }

  visitPay(node) {
    const provider = this.rawPageString(node.provider);
    this.emit(`// Payment: ${provider}`);
    this.emit('// Use Stripe Swift SDK or StoreKit');
    this.emitRaw('');
  }

  visitStorage(node) {
    const provider = this.rawPageString(node.provider);
    this.emit(`// Storage: ${provider}`);
    this.emit('// Use AWS SDK for Swift or similar');
    this.emitRaw('');
  }

  visitPdf(node) {
    const filename = this.rawPageString(node.filename);
    this.emit(`// PDF generation: ${filename}`);
    this.emit('// Use PDFKit framework');
    this.emitRaw('');
  }

  visitI18n(node) {
    const defaultLang = node.defaultLang ? this.rawPageString(node.defaultLang) : 'en';
    this.emit(`// i18n: default language = ${defaultLang}`);
    this.emit('// Use NSLocalizedString and Localizable.strings');
    this.emitRaw('');
  }

  visitPush(node) {
    this.emit('// Push notifications');
    this.emit('// Use APNs via APNS library or UserNotifications');
    this.emitRaw('');
  }

  visitSearch(node) {
    const engine = this.rawPageString(node.engine);
    this.emit(`// Search: ${engine}`);
    this.emit('// Use MeiliSearch or Elasticsearch Swift client');
    this.emitRaw('');
  }

  visitImage(node) {
    const input = this.expr(node.input);
    this.emit(`// Image processing: ${input}`);
    this.emit('// Use Core Image or SwiftGD');
    this.emitRaw('');
  }

  visitCsv(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// CSV/Excel export: ${name}`);
    this.emit('// Use SwiftCSV or similar');
    this.emitRaw('');
  }

  visitLogging(node) {
    const name = this.rawPageString(node.name);
    const level = node.level ? this.rawPageString(node.level) : 'info';
    this.addImport('os');
    this.emit(`let logger = Logger(subsystem: "${name}", category: "default")`);
    this.emit(`// log level: ${level}`);
    this.emitRaw('');
  }

  visitMigrate(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// Migration: ${name}`);
    this.emit('// Use Fluent migrations');
    this.emitRaw('');
  }

  visitGrpc(node) {
    const name = this.rawPageString(node.name);
    const port = node.port ? this.expr(node.port) : '50051';
    this.emit(`// gRPC service: ${name} on port ${port}`);
    this.emit('// Use grpc-swift');
    this.emitRaw('');
  }

  visitWebrtc(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// WebRTC: ${name}`);
    this.emit('// Use WebRTC.framework');
    this.emitRaw('');
  }

  visitBlockchain(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// Blockchain: ${name}`);
    this.emit('// Use web3swift for Ethereum integration');
    this.emitRaw('');
  }

  // ===== Expression generation =====

  expr(node) {
    if (!node) return 'nil';

    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return this.generateString(node.value);
      case 'Bool': return node.value ? 'true' : 'false';
      case 'Null': return 'nil';
      case 'Self': return 'self';
      case 'Identifier': return this.mapIdentifier(node.name);

      case 'Binary': {
        const op = this.mapBinaryOp(node.op);
        const l = this.expr(node.left);
        const r = this.expr(node.right);
        const simple = node.left.type !== 'Binary' && node.right.type !== 'Binary';
        return simple ? `${l} ${op} ${r}` : `(${l} ${op} ${r})`;
      }

      case 'Unary': {
        const op = node.op === '!' ? '!' : node.op;
        return `${op}${this.expr(node.expr)}`;
      }

      case 'Await':
        return `await ${this.expr(node.expr)}`;

      case 'AwaitAllExpr':
        return `await ${this.expr(node.expr)}`;

      case 'Spread':
        return this.expr(node.expr);

      case 'New':
        return this.expr(node.expr);

      case 'TypeOf':
        return `type(of: ${this.expr(node.expr)})`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

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
          if (p.type === 'spread') return `// spread: ${this.expr(p.value)}`;
          const key = p.type === 'shorthand' ? p.key :
                      (typeof p.key === 'string' ? p.key :
                       (p.key.type === 'String' ? this.rawString(p.key.value) :
                        (p.key.type === 'Computed' ? this.expr(p.key.expr) : this.expr(p.key))));
          const val = p.type === 'shorthand' ? p.key : this.expr(p.value);
          return `"${key}": ${val}`;
        }).join(', ');
        return `[${props}]`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        return `{ ${params} in ${body} }`;
      }

      case 'Lambda': {
        const params = node.params.map(p => p.name).join(', ');
        const bodyLines = [];
        const savedOutput = this.output;
        const savedIndent = this.indent;
        this.output = bodyLines;
        this.indent = 0;
        for (const stmt of node.body) this.visitStatement(stmt);
        this.output = savedOutput;
        this.indent = savedIndent;
        return `{ ${params} in ${bodyLines.join('; ')} }`;
      }

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `nil /* expr:${node.type} */`;
    }
  }

  mapIdentifier(name) {
    const map = {
      'null': 'nil',
      'undefined': 'nil',
      'true': 'true',
      'false': 'false',
      'this': 'self',
    };
    return map[name] || name;
  }

  mapBinaryOp(op) {
    const map = {
      '===': '==',
      '!==': '!=',
      '==': '==',
      '!=': '!=',
      '&&': '&&',
      '||': '||',
      'and': '&&',
      'or': '||',
      '>': '>',
      '<': '<',
      '>=': '>=',
      '<=': '<=',
      '+': '+',
      '-': '-',
      '*': '*',
      '/': '/',
      '%': '%',
      '**': 'pow(',
      'instanceof': 'is',
      'in': '~=',
    };
    return map[op] || op;
  }

  mapMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    if (prop === 'length') return `${obj}.count`;
    if (prop === 'toString') return `String(${obj})`;

    if (obj === 'console' && prop === 'log') return 'print';
    if (obj === 'console' && prop === 'error') return 'print';
    if (obj === 'console' && prop === 'warn') return 'print';

    if (obj === 'JSON' && prop === 'parse') return 'JSONDecoder().decode';
    if (obj === 'JSON' && prop === 'stringify') return 'JSONEncoder().encode';

    if (obj === 'Math' && prop === 'floor') return 'floor';
    if (obj === 'Math' && prop === 'ceil') return 'ceil';
    if (obj === 'Math' && prop === 'round') return 'round';
    if (obj === 'Math' && prop === 'abs') return 'abs';
    if (obj === 'Math' && prop === 'min') return 'min';
    if (obj === 'Math' && prop === 'max') return 'max';
    if (obj === 'Math' && prop === 'random') return 'Double.random';
    if (obj === 'Math' && prop === 'PI') return 'Double.pi';

    return `${obj}.${prop}`;
  }

  generateCall(node) {
    if (node.callee.type === 'Identifier') {
      const argList = node.args.map(a => this.expr(a));
      const b = this.generateBuiltin(node.callee.name, argList);
      if (b) return b;
    }

    const args = node.args.map(a => this.expr(a)).join(', ');

    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;
      if (name === 'parseInt') return `Int(${args})`;
      if (name === 'parseFloat') return `Double(${args})`;
      if (name === 'String') return `String(${args})`;
      if (name === 'Number') return `Double(${args})`;
      if (name === 'Boolean') return `Bool(${args})`;
      if (name === 'isNaN') return `(${args}).isNaN`;
    }

    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // Array/list methods
      if (prop === 'push') return `${obj}.append(${args})`;
      if (prop === 'pop') return `${obj}.removeLast()`;
      if (prop === 'shift') return `${obj}.removeFirst()`;
      if (prop === 'includes') return `${obj}.contains(${args})`;
      if (prop === 'indexOf') return `(${obj}.firstIndex(of: ${args}) ?? -1)`;
      if (prop === 'join') return `${obj}.joined(separator: ${args})`;
      if (prop === 'slice') return `Array(${obj}[${args}])`;
      if (prop === 'forEach') return `${obj}.forEach { ${args} }`;
      if (prop === 'map') return `${obj}.map { ${args} }`;
      if (prop === 'filter') return `${obj}.filter { ${args} }`;
      if (prop === 'find') return `${obj}.first { ${args} }`;
      if (prop === 'some') return `${obj}.contains { ${args} }`;
      if (prop === 'every') return `${obj}.allSatisfy { ${args} }`;
      if (prop === 'reduce') return `${obj}.reduce(${args})`;
      if (prop === 'reverse') return `${obj}.reversed()`;
      if (prop === 'sort') return `${obj}.sorted()`;
      if (prop === 'flat') return `${obj}.flatMap { $0 }`;
      if (prop === 'concat') return `${obj} + ${args}`;

      // String methods
      if (prop === 'split') return `${obj}.components(separatedBy: ${args})`;
      if (prop === 'trim') return `${obj}.trimmingCharacters(in: .whitespaces)`;
      if (prop === 'trimStart') return `${obj}.drop(while: { $0.isWhitespace })`;
      if (prop === 'trimEnd') return `String(${obj}.reversed().drop(while: { $0.isWhitespace }).reversed())`;
      if (prop === 'toUpperCase') return `${obj}.uppercased()`;
      if (prop === 'toLowerCase') return `${obj}.lowercased()`;
      if (prop === 'startsWith') return `${obj}.hasPrefix(${args})`;
      if (prop === 'endsWith') return `${obj}.hasSuffix(${args})`;
      if (prop === 'replace') return `${obj}.replacingOccurrences(of: ${args})`;
      if (prop === 'replaceAll') return `${obj}.replacingOccurrences(of: ${args})`;
      if (prop === 'charAt') return `String(${obj}[${obj}.index(${obj}.startIndex, offsetBy: ${args})])`;
      if (prop === 'substring') return `String(${obj}.prefix(${args}))`;
      if (prop === 'repeat') return `String(repeating: ${obj}, count: ${args})`;
      if (prop === 'padStart') return `${obj}.padding(toLength: ${args}, withPad: " ", startingAt: 0)`;

      // Object methods
      if (obj === 'Object' && prop === 'keys') return `Array(${args}.keys)`;
      if (obj === 'Object' && prop === 'values') return `Array(${args}.values)`;

      // Array static
      if (obj === 'Array' && prop === 'isArray') return `${args} is [Any]`;

      // Date
      if (obj === 'Date' && prop === 'now') return 'Date().timeIntervalSince1970 * 1000';
    }

    const callee = this.expr(node.callee);
    return `${callee}(${args})`;
  }

  generateString(strData) {
    if (!strData || !strData.parts) return '""';

    const hasInterpolation = strData.parts.some(p => p.type === 'expr');

    if (!hasInterpolation) {
      const raw = strData.parts.map(p => p.value).join('');
      return JSON.stringify(raw);
    }

    let result = '"';
    for (const part of strData.parts) {
      if (part.type === 'text') {
        result += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      } else {
        const exprCode = part.value.replace(/\bself\b/g, 'self');
        result += '\\(' + exprCode + ')';
      }
    }
    result += '"';
    return result;
  }

  rawString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
  }

  swiftStringValue(strData) {
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

    const COLLECTION_METHODS = new Set(['filter', 'map', 'reduce', 'find', 'some', 'every', 'sort', 'reverse', 'join', 'flat']);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier') {
        const name = step.callee.name;
        const args = step.args.map(a => this.expr(a)).join(', ');

        if (name === 'filter') {
          result = `${result}.filter { ${args} }`;
        } else if (name === 'map') {
          result = `${result}.map { ${args} }`;
        } else if (name === 'reduce') {
          result = `${result}.reduce(${args})`;
        } else if (name === 'sort') {
          result = `${result}.sorted()`;
        } else if (name === 'reverse') {
          result = `${result}.reversed()`;
        } else if (name === 'join') {
          result = `${result}.joined(separator: ${args})`;
        } else if (name === 'flat') {
          result = `${result}.flatMap { $0 }`;
        } else {
          result = `${name}(${result}${args ? ', ' + args : ''})`;
        }
      } else if (step.type === 'Identifier') {
        result = `${step.name}(${result})`;
      } else if (step.type === 'Call') {
        const callee = this.expr(step.callee);
        const args = step.args.map(a => this.expr(a)).join(', ');
        result = `${callee}(${result}${args ? ', ' + args : ''})`;
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

  visitEnum(node) {
    this.emit(`enum ${node.name}: Int, CaseIterable {`);
    this.indent++;
    node.values.forEach((v, i) => {
      this.emit(`case ${v.toLowerCase()} = ${i}`);
    });
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
  }

  visitSwap(node) {
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    this.emit(`swap(&${a}, &${b})`);
  }

  generateBuiltin(name, args) {
    switch (name) {
      case 'len': return `${args[0]}.count`;
      case 'sort': return `${args[0]}.sorted()`;
      case 'reverse': return `${args[0]}.reversed()`;
      case 'unique': return `Array(Set(${args[0]}))`;
      case 'upper': return `${args[0]}.uppercased()`;
      case 'lower': return `${args[0]}.lowercased()`;
      case 'trim': return `${args[0]}.trimmingCharacters(in: .whitespacesAndNewlines)`;
      case 'split': return `${args[0]}.components(separatedBy: ${args[1] || '","'})`;
      case 'join': return `${args[0]}.joined(separator: ${args[1] || '","'})`;
      case 'contains': return `${args[0]}.contains(${args[1]})`;
      case 'replace': return `${args[0]}.replacingOccurrences(of: ${args[1]}, with: ${args[2]})`;
      case 'keys': return `Array(${args[0]}.keys)`;
      case 'values': return `Array(${args[0]}.values)`;
      case 'range': return args.length >= 2 ? `Array(${args[0]}..<${args[1]})` : `Array(0..<${args[0]})`;
      case 'abs': return `abs(${args[0]})`;
      case 'sqrt': { this.addImport('Foundation'); return `sqrt(Double(${args[0]}))`; }
      case 'pow': { this.addImport('Foundation'); return `pow(Double(${args[0]}), Double(${args[1]}))`; }
      case 'ceil': { this.addImport('Foundation'); return `ceil(Double(${args[0]}))`; }
      case 'floor': { this.addImport('Foundation'); return `floor(Double(${args[0]}))`; }
      case 'round': { this.addImport('Foundation'); return `round(Double(${args[0]}))`; }
      case 'sum': return `${args[0]}.reduce(0, +)`;
      case 'flat': return `${args[0]}.flatMap { $0 }`;
      case 'zip': return `Array(zip(${args[0]}, ${args[1]}))`;
      case 'chunk': return `stride(from: 0, to: ${args[0]}.count, by: ${args[1]}).map { Array(${args[0]}[$0..<min($0+${args[1]}, ${args[0]}.count)]) }`;
      case 'str': return `String(${args[0]})`;
      case 'int': return `Int(${args[0]}) ?? 0`;
      case 'float': return `Double(${args[0]}) ?? 0.0`;
      case 'json_parse': { this.addImport('Foundation'); return `try? JSONSerialization.jsonObject(with: ${args[0]}.data(using: .utf8)!, options: [])`; }
      case 'json_str': { this.addImport('Foundation'); return `String(data: try! JSONSerialization.data(withJSONObject: ${args[0]}), encoding: .utf8)!`; }
      case 'now': { this.addImport('Foundation'); return `Int(Date().timeIntervalSince1970 * 1000)`; }
      case 'time': { this.addImport('Foundation'); return `ISO8601DateFormatter().string(from: Date())`; }
      case 'exit': { this.addImport('Foundation'); return `exit(${args[0] || '0'})`; }
      case 'sleep': { this.addImport('Foundation'); return `Thread.sleep(forTimeInterval: Double(${args[0]}) / 1000.0)`; }
      case 'random': return args.length >= 2 ? `Int.random(in: ${args[0]}...${args[1]})` : `Double.random(in: 0...1)`;
      case 'read': return `try! String(contentsOfFile: ${args[0]})`;
      case 'write': return `try! ${args[1]}.write(toFile: ${args[0]}, atomically: true, encoding: .utf8)`;
      default: return null;
    }
  }
}
