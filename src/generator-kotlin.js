export class KotlinGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.usesKtor = false;
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

    for (const imp of this.imports) {
      preamble.push(`import ${imp}`);
    }

    if (this.hasTests) {
      this.addImport('kotlin.test.Test');
      this.addImport('kotlin.test.assertEquals');
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
      'bool': 'Boolean',
      'boolean': 'Boolean',
      'list': 'MutableList<Any>',
      'map': 'MutableMap<String, Any>',
      'any': 'Any',
      'void': 'Unit',
      'auto': 'Int',
      'timestamp': 'String',
    };
    return map[naideType] || 'Any';
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const alias = node.alias || node.name;
    const mapped = this.mapModuleName(raw);
    if (alias !== mapped) {
      this.emit(`import ${mapped} as ${alias}`);
    } else {
      this.emit(`import ${mapped}`);
    }
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const mapped = this.mapModuleName(raw);
    for (const n of node.names) {
      if (n.alias) {
        this.emit(`import ${mapped}.${n.name} as ${n.alias}`);
      } else {
        this.emit(`import ${mapped}.${n.name}`);
      }
    }
  }

  mapModuleName(name) {
    const clean = name.replace(/^['"]|['"]$/g, '');
    const map = {
      'express': 'io.ktor.server.netty',
      'axios': 'io.ktor.client',
      'fs': 'java.io.File',
      'path': 'java.nio.file.Paths',
      'crypto': 'java.security.MessageDigest',
      'uuid': 'java.util.UUID',
    };
    return map[clean] || clean;
  }

  // ===== Functions =====

  visitFunction(node) {
    const async = node.isAsync ? 'suspend ' : '';
    const params = node.params.map(p => {
      let s = '';
      if (p.spread) s += 'vararg ';
      s += `${p.name}: Any`;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    this.emit(`${async}fun ${node.name}(${params}) {`);
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
    this.emit(`call.respond(HttpStatusCode.fromValue(${this.expr(node.statusCode)}), ${this.expr(node.body)})`);
    this.emit('return');
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`call.respondRedirect(${val})`);
        break;
      case 'html':
        this.emit(`call.respondText(${val}, ContentType.Text.Html)`);
        break;
      case 'text':
        this.emit(`call.respondText(${val})`);
        break;
      case 'file':
        this.emit(`call.respondFile(File(${val}))`);
        break;
      default:
        this.emit(`call.respond(${val})`);
    }
    this.emit('return');
  }

  // ===== Variables =====

  visitTypedVar(node) {
    const keyword = node.isMut ? 'var' : 'val';
    this.emit(`${keyword} ${node.name} = ${this.expr(node.value)}`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.expr(e));
      this.emit(`val (__tmp) = ${value}`);
      names.forEach((n, i) => {
        this.emit(`val ${n} = __tmp[${i}]`);
      });
    } else if (node.target.type === 'Object') {
      const tempVar = '__d';
      this.emit(`val ${tempVar} = ${value}`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`val ${varName} = ${tempVar}["${key}"]`);
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
    this.emit(`if (${this.expr(node.condition)}) {`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;

    for (const elif of node.elifs) {
      this.emit(`} else if (${this.expr(elif.condition)}) {`);
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
      this.emit(`for ((${node.key}, ${node.value}) in ${collection}) {`);
    } else {
      this.emit(`for (${node.value} in ${collection}) {`);
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
    this.emit(`for (${varName} in ${start} until ${end}) {`);
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
    this.emit(`while (${this.expr(node.condition)}) {`);
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
    this.emit(`when (${this.expr(node.value)}) {`);
    this.indent++;
    for (const c of node.cases) {
      if (c.pattern.type === 'DefaultPattern') {
        this.emit('else -> {');
      } else {
        this.emit(`${this.expr(c.pattern)} -> {`);
      }
      this.indent++;
      for (const stmt of c.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    }
    this.indent--;
    this.emit('}');
  }

  visitTry(node) {
    this.emit('try {');
    this.indent++;
    if (node.body.length === 0) {
      this.emit('// empty');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;

    if (node.catchBody) {
      const catchParam = node.catchVar || 'e';
      this.emit(`} catch (${catchParam}: Exception) {`);
      this.indent++;
      if (node.catchBody.length === 0) {
        this.emit('// empty');
      } else {
        for (const stmt of node.catchBody) this.visitStatement(stmt);
      }
      this.indent--;
    }

    if (node.ensureBody) {
      this.emit('} finally {');
      this.indent++;
      if (node.ensureBody.length === 0) {
        this.emit('// empty');
      } else {
        for (const stmt of node.ensureBody) this.visitStatement(stmt);
      }
      this.indent--;
    }
    this.emit('}');
  }

  // ===== Server (Ktor) =====

  visitServer(node) {
    this.usesKtor = true;
    this.addImport('io.ktor.server.engine.*');
    this.addImport('io.ktor.server.netty.*');
    this.addImport('io.ktor.server.routing.*');
    this.addImport('io.ktor.server.response.*');
    this.addImport('io.ktor.server.request.*');
    this.addImport('io.ktor.http.*');
    this.addImport('io.ktor.serialization.kotlinx.json.*');
    this.addImport('io.ktor.server.plugins.contentnegotiation.*');

    const port = node.port ? this.expr(node.port) : '3000';

    this.emitRaw('');
    this.emit(`fun main() {`);
    this.indent++;
    this.emit(`embeddedServer(Netty, port = ${port}) {`);
    this.indent++;
    this.emit('install(ContentNegotiation) {');
    this.indent++;
    this.emit('json()');
    this.indent--;
    this.emit('}');

    for (const mid of node.middleware) {
      this.emit(`// middleware: custom`);
    }

    this.emit('routing {');
    this.indent++;

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

    this.indent--;
    this.emit('}');

    for (const eh of errorHandlers) {
      this.visitErrorHandler(node.name, eh);
    }

    this.indent--;
    this.emit('}.start(wait = true)');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitRoute(appName, route) {
    const method = route.method === 'del' ? 'delete' : route.method;
    const path = this.rawString(route.path);

    this.emit(`${method}("${path}") {`);
    this.indent++;

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`call.respond(${this.expr(stmt.value)})`);
      } else {
        this.visitStatement(stmt);
      }
    }

    this.indent--;
    this.emit('}');
  }

  visitGroup(appName, node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`route("${prefix}") {`);
    this.indent++;

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(appName, child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(appName, child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(appName, child);
      } else {
        this.visitStatement(child);
      }
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitErrorHandler(appName, node) {
    this.emit('// error handler');
    this.emit('install(StatusPages) {');
    this.indent++;
    this.emit('exception<Throwable> { call, cause ->');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    if (node.body.length === 0) {
      this.emit('call.respondText("Internal Server Error", status = HttpStatusCode.InternalServerError)');
    }
    this.indent--;
    this.emit('}');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Model =====

  visitModel(node) {
    this.models.set(node.name, node);

    const ext = node.parent ? ` : ${node.parent}()` : '';
    const parentModel = node.parent ? this.models.get(node.parent) : null;
    const parentFields = parentModel ? parentModel.fields : [];
    const allFields = [...parentFields, ...node.fields];

    const isSimple = node.methods.length === 0;

    if (isSimple && allFields.length > 0) {
      const params = allFields.map(f => {
        const type = this.mapType(f.type || 'any');
        if (f.defaultValue) return `val ${f.name}: ${type} = ${this.expr(f.defaultValue)}`;
        return `val ${f.name}: ${type}`;
      }).join(', ');
      this.emit(`data class ${node.name}(${params})`);
    } else {
      this.emit(`class ${node.name}${ext} {`);
      this.indent++;

      for (const f of node.fields) {
        const type = this.mapType(f.type || 'any');
        if (f.defaultValue) {
          this.emit(`var ${f.name}: ${type} = ${this.expr(f.defaultValue)}`);
        } else {
          this.emit(`var ${f.name}: ${type} = ${this.defaultForType(f.type || 'any')}`);
        }
      }

      if (allFields.length > 0 && node.methods.length > 0) {
        this.emitRaw('');
        const consParams = allFields.map(f => {
          const type = this.mapType(f.type || 'any');
          return `${f.name}: ${type}`;
        }).join(', ');
        this.emit(`constructor(${consParams}) {`);
        this.indent++;
        for (const f of node.fields) {
          this.emit(`this.${f.name} = ${f.name}`);
        }
        this.indent--;
        this.emit('}');
      }

      for (const method of node.methods) {
        this.emitRaw('');
        const async = method.isAsync ? 'suspend ' : '';
        const params = method.params.map(p => {
          let s = '';
          if (p.spread) s += 'vararg ';
          s += `${p.name}: Any`;
          if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
          return s;
        }).join(', ');

        this.emit(`${async}fun ${method.name}(${params}) {`);
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

  defaultForType(type) {
    const map = {
      'str': '""',
      'string': '""',
      'int': '0',
      'integer': '0',
      'num': '0.0',
      'number': '0.0',
      'bool': 'false',
      'boolean': 'false',
      'list': 'mutableListOf()',
      'map': 'mutableMapOf()',
    };
    return map[type] || 'null';
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    this.emit(`// on ${event}`);
    this.emit(`fun __on${event.replace(/\./g, '_')}() {`);
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
    if (node.level === 'warn' || node.level === 'error') {
      this.emit(`System.err.println(${args})`);
    } else {
      this.emit(`println(${args})`);
    }
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw Exception(${value})`);
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
    const conn = node.connection ? this.ktStringValue(node.connection) : '"data.db"';

    if (driverRaw === 'sqlite') {
      this.addImport('java.sql.DriverManager');
      this.emit(`val __db = DriverManager.getConnection("jdbc:sqlite:" + ${conn})`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      this.addImport('java.sql.DriverManager');
      this.emit(`val __db = DriverManager.getConnection(${conn})`);
    }
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    this.addImport('kotlinx.coroutines.*');
    const exprs = node.expressions.map(e => `async { ${this.expr(e)} }`).join(', ');
    this.emit(`awaitAll(${exprs})`);
  }

  // ===== Schema =====

  visitSchema(node) {
    this.emit(`data class ${node.name}(`);
    this.indent++;
    for (let i = 0; i < node.fields.length; i++) {
      const f = node.fields[i];
      const type = this.mapType(f.type);
      const nullable = f.modifiers.some(m => m.name === 'optional') || f.type === 'auto' || f.type === 'timestamp';
      const suffix = nullable ? '?' : '';
      const defaultVal = this.schemaDefault(f);
      const comma = i < node.fields.length - 1 ? ',' : '';
      if (defaultVal !== null) {
        this.emit(`val ${f.name}: ${type}${suffix} = ${defaultVal}${comma}`);
      } else {
        this.emit(`val ${f.name}: ${type}${suffix}${comma}`);
      }
    }
    this.indent--;
    this.emit(')');
    this.emitRaw('');

    this.schemas.set(node.name, node);
  }

  schemaDefault(fieldNode) {
    for (const mod of fieldNode.modifiers) {
      if (mod.name === 'default') {
        return this.expr(mod.args[0]);
      }
    }
    if (fieldNode.modifiers.some(m => m.name === 'optional')) return 'null';
    if (fieldNode.type === 'auto') return 'null';
    if (fieldNode.type === 'timestamp') return 'null';
    return null;
  }

  // ===== CORS =====

  visitCors(appName, node) {
    this.addImport('io.ktor.server.plugins.cors.routing.*');
    const origins = this.expr(node.origins);
    this.emit('install(CORS) {');
    this.indent++;
    this.emit(`allowHost(${origins})`);
    this.emit('allowHeader(HttpHeaders.ContentType)');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Auth =====

  visitAuth(appName, node) {
    const secret = this.expr(node.secret);
    this.authSecret = secret;
    this.emit(`val __authSecret = ${secret}`);
    this.emit('// JWT auth middleware');
    this.emit(`// Protected paths use __authSecret for token verification`);
    this.emitRaw('');
  }

  // ===== Static =====

  visitStatic(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.addImport('io.ktor.server.http.content.*');
    this.emit(`staticResources("/", "${raw}")`);
    this.emitRaw('');
  }

  // ===== CRUD =====

  visitCrud(appName, node) {
    const path = this.rawString(node.path);
    const schema = node.schemaName;
    const store = `__${schema.toLowerCase()}Store`;

    this.emitRaw('');
    this.emit(`val ${store} = mutableListOf<${schema}>()`);
    this.emit(`var __${schema.toLowerCase()}Id = 1`);
    this.emitRaw('');

    this.emit(`route("${path}") {`);
    this.indent++;
    this.emit('get {');
    this.indent++;
    this.emit(`call.respond(${store})`);
    this.indent--;
    this.emit('}');
    this.emit('post {');
    this.indent++;
    this.emit(`val item = call.receive<${schema}>()`);
    this.emit(`${store}.add(item)`);
    this.emit('call.respond(HttpStatusCode.Created, item)');
    this.indent--;
    this.emit('}');
    this.emit('get("{id}") {');
    this.indent++;
    this.emit('val id = call.parameters["id"]');
    this.emit(`val item = ${store}.find { it.toString().contains(id ?: "") }`);
    this.emit('if (item != null) call.respond(item) else call.respond(HttpStatusCode.NotFound)');
    this.indent--;
    this.emit('}');
    this.emit('delete("{id}") {');
    this.indent++;
    this.emit('val id = call.parameters["id"]');
    this.emit(`${store}.removeIf { it.toString().contains(id ?: "") }`);
    this.emit('call.respond(mapOf("deleted" to true))');
    this.indent--;
    this.emit('}');
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
    this.addImport('io.ktor.server.websocket.*');
    this.addImport('io.ktor.websocket.*');
    const path = this.rawString(node.path);

    this.emit('install(WebSockets)');
    this.emit(`webSocket("${path}") {`);
    this.indent++;

    for (const evt of node.events || []) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      if (evtName === 'connect' || evtName === 'open') {
        this.emit('// on connect');
        for (const stmt of evt.body) this.visitStatement(stmt);
      } else if (evtName === 'message') {
        const param = evt.params[0] || 'data';
        this.emit(`for (frame in incoming) {`);
        this.indent++;
        this.emit(`if (frame is Frame.Text) {`);
        this.indent++;
        this.emit(`val ${param} = frame.readText()`);
        for (const stmt of evt.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('}');
        this.indent--;
        this.emit('}');
      } else if (evtName === 'close') {
        this.emit('// on close');
        for (const stmt of evt.body) this.visitStatement(stmt);
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
        this.emit(`val ${v.name} = System.getenv("${v.name}") ?: ${defaultVal}`);
      } else {
        this.emit(`val ${v.name} = System.getenv("${v.name}")`);
      }

      if (v.type === 'int') {
        this.emit(`val ${v.name}Int = ${v.name}?.toIntOrNull()`);
      } else if (v.type === 'num') {
        this.emit(`val ${v.name}Num = ${v.name}?.toDoubleOrNull()`);
      } else if (v.type === 'bool') {
        this.emit(`val ${v.name}Bool = ${v.name}?.lowercase() in listOf("true", "1", "yes")`);
      }
    }
    this.emitRaw('');
  }

  // ===== Tests =====

  visitTest(node) {
    this.hasTests = true;
    this.addImport('kotlin.test.Test');
    const name = this.rawString(node.name);
    const funcName = `test_${name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}`;

    this.emit(`@Test`);
    this.emit(`fun ${funcName}() {`);
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
    this.addImport('kotlin.test.assertEquals');
    this.addImport('kotlin.test.assertTrue');
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`assertEquals(${this.expr(exprNode.right)}, ${this.expr(exprNode.left)})`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`assertTrue(${this.expr(exprNode.left)} != ${this.expr(exprNode.right)})`);
    } else {
      this.emit(`assertTrue(${this.expr(exprNode)})`);
    }
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'System.getenv("BOT_TOKEN")';
    const botType = this.rawBotType(node.botType);

    this.emit(`// ${botType} bot: ${node.name}`);
    this.emit(`val __botToken = ${tokenExpr}`);

    if (botType === 'discord') {
      this.addImport('net.dv8tion.jda.api.*');
      this.emit(`// Discord bot using JDA`);
      this.emit(`val ${node.name} = JDABuilder.createDefault(__botToken).build()`);
    } else if (botType === 'telegram') {
      this.emit(`// Telegram bot`);
    } else if (botType === 'slack') {
      this.emit(`// Slack bot`);
    } else {
      this.emit(`// ${botType} bot`);
    }

    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        this.emit(`// on ${evtName}`);
        this.emit(`fun handle_${evtName}() {`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('}');
      } else if (handler.type === 'BotSlashCmd') {
        const cmdName = handler.name.raw || handler.name.parts?.map(p => p.value).join('');
        this.emit(`// slash command: /${cmdName}`);
        this.emit(`fun cmd_${cmdName}() {`);
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
    this.emit(`post("${path}") {`);
    this.indent++;
    this.emit('val multipart = call.receiveMultipart()');
    this.emit('// handle file upload');
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Session =====

  visitSession(appName, node) {
    this.addImport('io.ktor.server.sessions.*');
    this.emit('install(Sessions) {');
    this.indent++;
    this.emit('// configure sessions');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== View =====

  visitView(appName, node) {
    const dir = this.rawString(node.dir);
    this.emit(`// view engine: templates from "${dir}"`);
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
    this.emit(`call.respondText(renderTemplate(${template}), ContentType.Text.Html)`);
    this.emit('return');
  }

  visitReturnRedirect(node) {
    this.emit(`call.respondRedirect(${this.expr(node.url)})`);
    this.emit('return');
  }

  visitReturnDownload(node) {
    this.emit(`call.respondFile(File(${this.expr(node.filePath)}))`);
    this.emit('return');
  }

  // ===== Validate =====

  visitValidate(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// validate: ${path} against ${node.schemaName}`);
  }

  // ===== Queue =====

  visitQueue(node) {
    this.emit(`// queue: ${node.name}`);
    this.emit(`object ${node.name} {`);
    this.indent++;
    for (const job of node.jobs) {
      const params = job.params.length > 0 ? job.params.join(', ') : 'data';
      this.emit(`fun ${this.rawString(job.name)}(${params}: Any) {`);
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
    this.emit(`fun ${name}(vars: Map<String, Any> = emptyMap()): String {`);
    this.indent++;
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : lines.join(' + "\\n" + ');
    this.emit(`var template = ${template}`);
    this.emit(`for ((k, v) in vars) {`);
    this.indent++;
    this.emit('template = template.replace("{$k}", v.toString())');
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
    this.addImport('java.io.File');

    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`File("${filename}").writeText("""`);
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
    this.emit(`""".trimIndent())`);
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

    this.emit('fun main(args: Array<String>) {');
    this.indent++;
    this.emit(`val parsedArgs = mutableMapOf<String, Any>()`);
    this.emit('var i = 0');
    this.emit('while (i < args.size) {');
    this.indent++;
    this.emit('when (args[i]) {');
    this.indent++;
    this.emit('"--help", "-h" -> {');
    this.indent++;
    this.emit(`println("${desc}")`);
    this.emit('return');
    this.indent--;
    this.emit('}');
    for (const arg of node.args) {
      const argName = this.rawPageString(arg.name);
      const coerce = arg.type === 'int' ? 'args[++i].toInt()' :
                     arg.type === 'num' ? 'args[++i].toDouble()' :
                     arg.type === 'bool' ? 'true' : 'args[++i]';
      this.emit(`"--${argName}" -> parsedArgs["${argName}"] = ${coerce}`);
    }
    for (const flag of node.flags) {
      const s = this.rawPageString(flag.short);
      const l = this.rawPageString(flag.long);
      this.emit(`"-${s}", "--${l}" -> parsedArgs["${l}"] = true`);
    }
    this.indent--;
    this.emit('}');
    this.emit('i++');
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    if (node.run) {
      const runParam = node.run.params.length > 0 ? node.run.params[0] : 'parsedArgs';
      if (runParam !== 'parsedArgs') {
        this.emit(`val ${runParam} = parsedArgs`);
      }
      for (const stmt of node.run.body) this.visitStatement(stmt);
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Mail =====

  visitMail(node) {
    const host = this.generateString(node.host);
    const port = this.expr(node.port);
    const user = node.user ? this.expr(node.user) : 'System.getenv("MAIL_USER")';
    const pass = node.pass ? this.expr(node.pass) : 'System.getenv("MAIL_PASS")';

    this.addImport('javax.mail.*');
    this.addImport('javax.mail.internet.*');
    this.emit(`val mailProps = Properties().apply {`);
    this.indent++;
    this.emit(`put("mail.smtp.host", ${host})`);
    this.emit(`put("mail.smtp.port", ${port})`);
    this.emit(`put("mail.smtp.auth", "true")`);
    this.emit(`put("mail.smtp.starttls.enable", "true")`);
    this.indent--;
    this.emit('}');
    this.emit(`val mailSession = Session.getInstance(mailProps, object : Authenticator() {`);
    this.indent++;
    this.emit(`override fun getPasswordAuthentication() = PasswordAuthentication(${user}, ${pass})`);
    this.indent--;
    this.emit('})');
    this.emitRaw('');
  }

  // ===== Desktop =====

  visitDesktop(node) {
    const title = node.title ? this.rawPageString(node.title) : node.name;
    const width = node.width ? this.expr(node.width) : '800';
    const height = node.height ? this.expr(node.height) : '600';

    this.addImport('javax.swing.*');
    this.emit(`fun main() {`);
    this.indent++;
    this.emit(`val frame = JFrame("${title}")`);
    this.emit(`frame.setSize(${width}, ${height})`);
    this.emit('frame.defaultCloseOperation = JFrame.EXIT_ON_CLOSE');
    this.emit('frame.isVisible = true');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Screen =====

  visitScreen(node) {
    this.emit(`// Mobile screen: ${node.name}`);
    this.emit(`// Use Jetpack Compose or similar for mobile UI`);
    this.emit(`@Composable`);
    this.emit(`fun ${node.name}() {`);
    this.indent++;
    this.emit('Column(modifier = Modifier.padding(16.dp)) {');
    this.indent++;
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
      if (tag === 'text') {
        this.emit(`Text("${arg0}")`);
      } else if (tag === 'button') {
        this.emit(`Button(onClick = { /* action */ }) { Text("${arg0}") }`);
      } else if (tag === 'input') {
        this.emit(`TextField(value = "", onValueChange = {}, label = { Text("${arg0}") })`);
      } else {
        this.emit(`Text("${arg0}")`);
      }
    }
    this.indent--;
    this.emit('}');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Every (scheduler) =====

  visitEvery(node) {
    const interval = this.expr(node.interval);
    this.addImport('java.util.Timer');
    this.addImport('kotlin.concurrent.timerTask');

    this.emit(`Timer().scheduleAtFixedRate(timerTask {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit(`}, 0, ${interval})`);
    this.emitRaw('');
  }

  // ===== Watch =====

  visitWatch(node) {
    const params = node.params.length > 0 ? node.params.join(', ') : 'event';
    this.emit(`// watch: ${node.eventName}`);
    this.emit(`fun __onWatch_${node.eventName}(${params}: Any) {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== OAuth =====

  visitOauth(node) {
    const provider = this.rawPageString(node.provider);
    this.emit(`// OAuth: ${provider}`);
    this.emit(`// Configure OAuth via Ktor or Spring Security`);
    this.emitRaw('');
  }

  // ===== Pay =====

  visitPay(node) {
    const provider = this.rawPageString(node.provider);
    this.emit(`// Payment: ${provider}`);
    this.emit(`// Use Stripe Java SDK or equivalent`);
    this.emitRaw('');
  }

  // ===== Storage =====

  visitStorage(node) {
    const provider = this.rawPageString(node.provider);
    this.emit(`// Storage: ${provider}`);
    this.emit(`// Use AWS SDK for Kotlin or equivalent`);
    this.emitRaw('');
  }

  // ===== PDF =====

  visitPdf(node) {
    const filename = this.rawPageString(node.filename);
    this.emit(`// PDF generation: ${filename}`);
    this.emit(`// Use iText or Apache PDFBox`);
    this.emitRaw('');
  }

  // ===== i18n =====

  visitI18n(node) {
    const defaultLang = node.defaultLang ? this.rawPageString(node.defaultLang) : 'en';
    this.emit(`// i18n: default language = ${defaultLang}`);
    this.emit(`// Use ResourceBundle for internationalization`);
    this.emitRaw('');
  }

  // ===== Push =====

  visitPush(node) {
    this.emit('// Push notifications');
    this.emit('// Use Firebase Admin SDK for Kotlin/JVM');
    this.emitRaw('');
  }

  // ===== Search =====

  visitSearch(node) {
    const engine = this.rawPageString(node.engine);
    this.emit(`// Search: ${engine}`);
    this.emit(`// Use Meilisearch or Elasticsearch Java client`);
    this.emitRaw('');
  }

  // ===== Image =====

  visitImage(node) {
    const input = this.expr(node.input);
    this.emit(`// Image processing: ${input}`);
    this.emit(`// Use javax.imageio or thumbnailator`);
    this.emitRaw('');
  }

  // ===== CSV =====

  visitCsv(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// CSV/Excel export: ${name}`);
    this.emit(`// Use Apache POI or opencsv`);
    this.emitRaw('');
  }

  // ===== Logging =====

  visitLogging(node) {
    const name = this.rawPageString(node.name);
    const level = node.level ? this.rawPageString(node.level) : 'INFO';
    this.addImport('org.slf4j.LoggerFactory');
    this.emit(`val logger = LoggerFactory.getLogger("${name}")`);
    this.emit(`// log level: ${level}`);
    this.emitRaw('');
  }

  // ===== Migrate =====

  visitMigrate(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// Migration: ${name}`);
    this.emit(`// Use Flyway or Liquibase`);
    this.emitRaw('');
  }

  // ===== gRPC =====

  visitGrpc(node) {
    const name = this.rawPageString(node.name);
    const port = node.port ? this.expr(node.port) : '50051';
    this.emit(`// gRPC service: ${name} on port ${port}`);
    this.emit(`// Use grpc-kotlin`);
    this.emitRaw('');
  }

  // ===== WebRTC =====

  visitWebrtc(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// WebRTC: ${name}`);
    this.emit(`// Use Ktor WebSocket for signaling`);
    this.emitRaw('');
  }

  // ===== Blockchain =====

  visitBlockchain(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// Blockchain: ${name}`);
    this.emit(`// Use web3j for Ethereum integration`);
    this.emitRaw('');
  }

  // ===== Expression generation =====

  expr(node) {
    if (!node) return 'null';

    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return this.generateString(node.value);
      case 'Bool': return node.value ? 'true' : 'false';
      case 'Null': return 'null';
      case 'Self': return 'this';
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
        return this.expr(node.expr);

      case 'AwaitAllExpr': {
        this.addImport('kotlinx.coroutines.*');
        return `awaitAll(${this.expr(node.expr)})`;
      }

      case 'Spread':
        return `*${this.expr(node.expr)}`;

      case 'New':
        return this.expr(node.expr);

      case 'TypeOf':
        return `${this.expr(node.expr)}::class.simpleName`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

      case 'OptionalAccess':
        return `${this.expr(node.object)}?.${node.property}`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array':
        return `mutableListOf(${node.elements.map(e => this.expr(e)).join(', ')})`;

      case 'Object': {
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `// spread: ${this.expr(p.value)}`;
          const key = p.type === 'shorthand' ? p.key :
                      (typeof p.key === 'string' ? p.key :
                       (p.key.type === 'String' ? this.rawString(p.key.value) :
                        (p.key.type === 'Computed' ? this.expr(p.key.expr) : this.expr(p.key))));
          const val = p.type === 'shorthand' ? p.key : this.expr(p.value);
          return `"${key}" to ${val}`;
        }).join(', ');
        return `mapOf(${props})`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        return `{ ${params} -> ${body} }`;
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
        return `{ ${params} -> ${bodyLines.join('; ')} }`;
      }

      case 'Ternary':
        return `(if (${this.expr(node.condition)}) ${this.expr(node.consequent)} else ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `null /* expr:${node.type} */`;
    }
  }

  mapIdentifier(name) {
    const map = {
      'null': 'null',
      'undefined': 'null',
      'true': 'true',
      'false': 'false',
      'this': 'this',
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
      '**': '.pow(',
      'instanceof': 'is',
      'in': 'in',
    };
    return map[op] || op;
  }

  mapMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    if (prop === 'length') return `${obj}.size`;
    if (prop === 'toString') return `${obj}.toString()`;

    if (obj === 'console' && prop === 'log') return 'println';
    if (obj === 'console' && prop === 'error') return 'System.err.println';
    if (obj === 'console' && prop === 'warn') return 'System.err.println';

    if (obj === 'JSON' && prop === 'parse') return 'Json.decodeFromString';
    if (obj === 'JSON' && prop === 'stringify') return 'Json.encodeToString';

    if (obj === 'Math' && prop === 'floor') return 'kotlin.math.floor';
    if (obj === 'Math' && prop === 'ceil') return 'kotlin.math.ceil';
    if (obj === 'Math' && prop === 'round') return 'kotlin.math.round';
    if (obj === 'Math' && prop === 'abs') return 'kotlin.math.abs';
    if (obj === 'Math' && prop === 'min') return 'minOf';
    if (obj === 'Math' && prop === 'max') return 'maxOf';
    if (obj === 'Math' && prop === 'random') return 'Math.random';
    if (obj === 'Math' && prop === 'PI') return 'kotlin.math.PI';

    return `${obj}.${prop}`;
  }

  generateCall(node) {
    const args = node.args.map(a => this.expr(a)).join(', ');

    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;
      if (name === 'parseInt') return `(${args}).toInt()`;
      if (name === 'parseFloat') return `(${args}).toDouble()`;
      if (name === 'String') return `(${args}).toString()`;
      if (name === 'Number') return `(${args}).toDouble()`;
      if (name === 'Boolean') return `(${args}).toBoolean()`;
      if (name === 'isNaN') return `(${args}).isNaN()`;
    }

    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      if (prop === 'push') return `${obj}.add(${args})`;
      if (prop === 'pop') return `${obj}.removeAt(${obj}.size - 1)`;
      if (prop === 'shift') return `${obj}.removeAt(0)`;
      if (prop === 'includes') return `${obj}.contains(${args})`;
      if (prop === 'indexOf') return `${obj}.indexOf(${args})`;
      if (prop === 'join') return `${obj}.joinToString(${args})`;
      if (prop === 'slice') return `${obj}.subList(${args})`;
      if (prop === 'forEach') return `${obj}.forEach { ${args} }`;
      if (prop === 'map') return `${obj}.map { ${args} }`;
      if (prop === 'filter') return `${obj}.filter { ${args} }`;
      if (prop === 'find') return `${obj}.find { ${args} }`;
      if (prop === 'some') return `${obj}.any { ${args} }`;
      if (prop === 'every') return `${obj}.all { ${args} }`;
      if (prop === 'reduce') return `${obj}.reduce { acc, it -> ${args} }`;
      if (prop === 'reverse') return `${obj}.reversed()`;
      if (prop === 'sort') return `${obj}.sorted()`;
      if (prop === 'flat') return `${obj}.flatten()`;
      if (prop === 'concat') return `${obj} + ${args}`;

      if (prop === 'split') return `${obj}.split(${args})`;
      if (prop === 'trim') return `${obj}.trim()`;
      if (prop === 'trimStart') return `${obj}.trimStart()`;
      if (prop === 'trimEnd') return `${obj}.trimEnd()`;
      if (prop === 'toUpperCase') return `${obj}.uppercase()`;
      if (prop === 'toLowerCase') return `${obj}.lowercase()`;
      if (prop === 'startsWith') return `${obj}.startsWith(${args})`;
      if (prop === 'endsWith') return `${obj}.endsWith(${args})`;
      if (prop === 'replace') return `${obj}.replace(${args})`;
      if (prop === 'replaceAll') return `${obj}.replace(${args})`;
      if (prop === 'padStart') return `${obj}.padStart(${args})`;
      if (prop === 'padEnd') return `${obj}.padEnd(${args})`;
      if (prop === 'charAt') return `${obj}[${args}]`;
      if (prop === 'substring') return `${obj}.substring(${args})`;
      if (prop === 'repeat') return `${obj}.repeat(${args})`;

      if (obj === 'Object' && prop === 'keys') return `${args}.keys.toList()`;
      if (obj === 'Object' && prop === 'values') return `${args}.values.toList()`;
      if (obj === 'Object' && prop === 'entries') return `${args}.entries.toList()`;

      if (obj === 'Array' && prop === 'isArray') return `${args} is List<*>`;
      if (obj === 'Array' && prop === 'from') return `${args}.toList()`;

      if (obj === 'Promise' && prop === 'all') return `awaitAll(${args})`;

      if (obj === 'Date' && prop === 'now') return 'System.currentTimeMillis()';
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
        result += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
      } else {
        const exprCode = part.value.replace(/\bself\b/g, 'this');
        result += '${' + exprCode + '}';
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

  ktStringValue(strData) {
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
          result = `${result}.reduce { acc, it -> ${args} }`;
        } else if (name === 'sort') {
          result = `${result}.sorted()`;
        } else if (name === 'reverse') {
          result = `${result}.reversed()`;
        } else if (name === 'join') {
          result = `${result}.joinToString(${args})`;
        } else if (name === 'flat') {
          result = `${result}.flatten()`;
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
}
