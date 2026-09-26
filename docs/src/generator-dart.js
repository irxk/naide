export class DartGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.imports = new Set();
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.authSecret = null;
    this.dbVar = null;
    this.usesServer = false;
    this.hasTests = false;
    this.hasAsserts = false;
    this.mainBody = [];
    this.topLevel = [];
    this.inFunction = false;
    this.inClass = false;
  }

  generate(ast) {
    this.visitProgram(ast);

    const preamble = [];

    for (const imp of [...this.imports].sort()) {
      preamble.push(imp);
    }

    if (preamble.length > 0) {
      preamble.push('');
    }

    const result = [];
    if (preamble.length > 0) result.push(...preamble);
    if (this.topLevel.length > 0) {
      result.push(...this.topLevel);
      result.push('');
    }
    result.push('void main() async {');
    result.push(...this.mainBody);
    result.push('}');

    return result.join('\n');
  }

  emit(line) {
    const indented = '  '.repeat(this.indent) + line;
    if (this.inFunction || this.inClass) {
      this.mainBody.push(indented);
    } else {
      this.mainBody.push('  ' + indented);
    }
    this.sourceMap.push(this.currentSourceLine);
  }

  emitRaw(line) {
    if (this.inFunction || this.inClass) {
      this.mainBody.push(line);
    } else {
      this.mainBody.push(line);
    }
    this.sourceMap.push(this.currentSourceLine);
  }

  emitTop(line) {
    this.topLevel.push(line);
    this.sourceMap.push(this.currentSourceLine);
  }

  emitTopRaw(line) {
    this.topLevel.push(line);
    this.sourceMap.push(this.currentSourceLine);
  }

  addImport(imp) {
    this.imports.add(imp);
  }

  visitProgram(node) {
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
  }

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
      case 'Break': this.emit('break;'); return;
      case 'Continue': this.emit('continue;'); return;
      case 'Assignment': return this.visitAssignment(node);
      case 'CompoundAssign': return this.visitCompoundAssign(node);
      case 'ExprStatement': this.emit(this.expr(node.expression) + ';'); return;
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
      case 'Destructure': return this.visitDestructure(node);
      case 'ClassDecl': return this.visitClassDecl(node);
      default:
        this.emit(`// unknown: ${node.type}`);
    }
  }

  // ===== Type mapping =====

  mapType(naideType) {
    const map = {
      'str': 'String',
      'string': 'String',
      'int': 'int',
      'integer': 'int',
      'num': 'double',
      'number': 'double',
      'bool': 'bool',
      'boolean': 'bool',
      'list': 'List<dynamic>',
      'map': 'Map<String, dynamic>',
      'any': 'dynamic',
      'json': 'Map<String, dynamic>',
      'void': 'void',
      'auto': 'int',
      'timestamp': 'String',
    };
    return map[naideType] || 'dynamic';
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const alias = node.alias || node.name;
    const dartPkg = this.mapModuleName(raw);
    this.addImport(`import '${dartPkg}';`);
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const dartPkg = this.mapModuleName(raw);
    this.addImport(`import '${dartPkg}';`);
  }

  mapModuleName(name) {
    const clean = name.replace(/^['"]|['"]$/g, '');
    const map = {
      'express': 'package:shelf/shelf.dart',
      'axios': 'package:http/http.dart',
      'lodash': 'dart:collection',
      'moment': 'package:intl/intl.dart',
      'fs': 'dart:io',
      'path': 'package:path/path.dart',
      'crypto': 'dart:convert',
      'uuid': 'package:uuid/uuid.dart',
    };
    return map[clean] || `package:${clean}/${clean}.dart`;
  }

  // ===== Functions =====

  visitFunction(node) {
    const async = node.isAsync ? ' async' : '';
    const returnType = node.isAsync ? 'Future<dynamic>' : 'dynamic';
    const params = node.params.map(p => {
      let s = '';
      if (p.spread) s += 'List<dynamic> ';
      s += p.name;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    const wasInFunction = this.inFunction;
    this.inFunction = true;

    this.emitTop(`${returnType} ${node.name}(${params})${async} {`);
    const savedOutput = this.mainBody;
    this.mainBody = [];
    this.indent++;
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    this.indent--;
    const bodyLines = this.mainBody;
    this.mainBody = savedOutput;
    this.inFunction = wasInFunction;

    for (const line of bodyLines) {
      this.emitTop(line);
    }
    this.emitTop('}');
    this.emitTopRaw('');
  }

  visitReturn(node) {
    if (node.value === null) {
      this.emit('return;');
    } else {
      this.emit(`return ${this.expr(node.value)};`);
    }
  }

  visitReturnStatus(node) {
    this.emit(`// return status ${this.expr(node.statusCode)} with body ${this.expr(node.body)}`);
    this.emit(`return Response.ok(jsonEncode(${this.expr(node.body)}), headers: {'content-type': 'application/json'});`);
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`return Response.found(${val});`);
        break;
      case 'html':
        this.emit(`return Response.ok(${val}, headers: {'content-type': 'text/html'});`);
        break;
      case 'text':
        this.emit(`return Response.ok(${val}, headers: {'content-type': 'text/plain'});`);
        break;
      case 'file':
        this.emit(`return Response.ok(File(${val}).readAsBytesSync());`);
        break;
      default:
        this.emit(`return Response.ok(${val});`);
    }
  }

  // ===== Variables =====

  visitTypedVar(node) {
    const keyword = node.isMut ? 'var' : 'final';
    this.emit(`${keyword} ${node.name} = ${this.expr(node.value)};`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.expr(e)).join(', ');
      this.emit(`final __list = ${value};`);
      node.target.elements.forEach((e, i) => {
        this.emit(`var ${this.expr(e)} = __list[${i}];`);
      });
    } else if (node.target.type === 'Object') {
      const tempVar = '__map';
      this.emit(`final ${tempVar} = ${value};`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`var ${varName} = ${tempVar}['${key}'];`);
      }
    } else {
      this.emit(`${this.expr(node.target)} = ${value};`);
    }
  }

  visitCompoundAssign(node) {
    this.emit(`${this.expr(node.target)} ${node.op} ${this.expr(node.value)};`);
  }

  // ===== Control flow =====

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
      this.emit(`for (var __entry in ${collection}.entries) {`);
      this.indent++;
      this.emit(`var ${node.key} = __entry.key;`);
      this.emit(`var ${node.value} = __entry.value;`);
      for (const stmt of node.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    } else {
      this.emit(`for (var ${node.value} in ${collection}) {`);
      this.indent++;
      for (const stmt of node.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    }
  }

  visitFor(node) {
    const varName = node.varName;
    const start = this.expr(node.start);
    const end = this.expr(node.end);
    this.emit(`for (var ${varName} = ${start}; ${varName} < ${end}; ${varName}++) {`);
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
        this.emit('default:');
      } else {
        this.emit(`case ${this.expr(c.pattern)}:`);
      }
      this.indent++;
      for (const stmt of c.body) this.visitStatement(stmt);
      this.emit('break;');
      this.indent--;
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
      const catchParam = node.catchVar || 'e';
      this.emit(`} catch (${catchParam}) {`);
      this.indent++;
      for (const stmt of node.catchBody) this.visitStatement(stmt);
      this.indent--;
    }

    if (node.ensureBody) {
      this.emit('} finally {');
      this.indent++;
      for (const stmt of node.ensureBody) this.visitStatement(stmt);
      this.indent--;
    }
    this.emit('}');
  }

  // ===== Server (dart:io HttpServer / shelf) =====

  visitServer(node) {
    this.usesServer = true;
    this.addImport("import 'dart:io';");
    this.addImport("import 'dart:convert';");

    this.emit(`final server = await HttpServer.bind('0.0.0.0', ${node.port ? this.expr(node.port) : '3000'});`);
    this.emit(`print('Server running on port \${server.port}');`);
    this.emitRaw('');
    this.emit(`await for (HttpRequest request in server) {`);
    this.indent++;
    this.emit(`final path = request.uri.path;`);
    this.emit(`final method = request.method;`);
    this.emitRaw('');

    const routes = [];
    const errorHandlers = [];

    for (const child of node.routes) {
      if (child.type === 'Route') {
        routes.push(child);
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'StaticDecl') {
        this.emit(`// static files: ${this.rawString(child.path)}`);
      } else if (child.type === 'CorsDecl') {
        this.emit(`request.response.headers.add('Access-Control-Allow-Origin', ${this.expr(child.origins)});`);
        this.emit(`request.response.headers.add('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');`);
        this.emit(`request.response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization');`);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth('app', child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else if (child.type === 'CrudDecl') {
        this.emit(`// CRUD: ${this.rawString(child.path)} for ${child.schemaName}`);
      } else {
        this.visitStatement(child);
      }
    }

    let first = true;
    for (const route of routes) {
      const method = route.method === 'del' ? 'DELETE' : route.method.toUpperCase();
      const path = this.rawString(route.path);
      const keyword = first ? 'if' : '} else if';
      first = false;
      this.emit(`${keyword} (method == '${method}' && path == '${path}') {`);
      this.indent++;
      this.emit('try {');
      this.indent++;
      for (const stmt of route.body) {
        if (stmt.type === 'Return' && stmt.value !== null) {
          this.emit(`request.response.headers.contentType = ContentType.json;`);
          this.emit(`request.response.write(jsonEncode(${this.expr(stmt.value)}));`);
        } else {
          this.visitStatement(stmt);
        }
      }
      this.indent--;
      this.emit('} catch (e) {');
      this.indent++;
      this.emit(`request.response.statusCode = 500;`);
      this.emit(`request.response.write(jsonEncode({'error': e.toString()}));`);
      this.indent--;
      this.emit('}');
      this.indent--;
    }

    if (routes.length > 0) {
      this.emit('} else {');
      this.indent++;
      this.emit(`request.response.statusCode = 404;`);
      this.emit(`request.response.write(jsonEncode({'error': 'Not found'}));`);
      this.indent--;
      this.emit('}');
    }

    this.emit('await request.response.close();');
    this.indent--;
    this.emit('}');
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : "Platform.environment['BOT_TOKEN'] ?? ''";
    this.addImport("import 'dart:io';");
    this.emit(`// Bot: ${node.name} — use a Dart bot library (e.g., nyxx for Discord)`);
    this.emit(`// token: ${tokenExpr}`);
    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        this.emit(`// on ${evtName}`);
        for (const stmt of handler.body) this.visitStatement(stmt);
      } else if (handler.type === 'BotSlashCmd') {
        const cmdName = handler.name.raw || handler.name.parts?.map(p => p.value).join('');
        this.emit(`// slash command: ${cmdName}`);
        for (const stmt of handler.body) this.visitStatement(stmt);
      }
    }
  }

  // ===== Model (class) =====

  visitModel(node) {
    this.models.set(node.name, node);

    const ext = node.parent ? ` extends ${node.parent}` : '';
    this.emitTop(`class ${node.name}${ext} {`);

    const parentModel = node.parent ? this.models.get(node.parent) : null;
    const parentFields = parentModel ? parentModel.fields : [];
    const allFields = [...parentFields, ...node.fields];

    // Fields
    for (const f of node.fields) {
      const dartType = f.fieldType ? this.mapType(f.fieldType) : 'dynamic';
      this.emitTop(`  ${dartType} ${f.name};`);
    }

    if (node.fields.length > 0) {
      this.emitTopRaw('');
    }

    // Constructor
    if (allFields.length > 0) {
      const constructorParams = node.fields.map(f => {
        if (f.defaultValue) return `this.${f.name} = ${this.expr(f.defaultValue)}`;
        return `required this.${f.name}`;
      }).join(', ');

      if (node.parent) {
        const superArgs = parentFields.map(f => `${f.name}: ${f.name}`).join(', ');
        const parentParams = parentFields.map(f => `required super.${f.name}`).join(', ');
        const allParams = [parentParams, constructorParams].filter(s => s).join(', ');
        this.emitTop(`  ${node.name}({${allParams}});`);
      } else {
        this.emitTop(`  ${node.name}({${constructorParams}});`);
      }
      this.emitTopRaw('');
    }

    // Methods
    for (const method of node.methods) {
      const async = method.isAsync ? ' async' : '';
      const returnType = method.isAsync ? 'Future<dynamic>' : 'dynamic';
      const params = method.params.map(p => {
        let s = '';
        if (p.spread) s += 'List<dynamic> ';
        s += p.name;
        if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      const savedOutput = this.mainBody;
      this.mainBody = [];
      const wasInClass = this.inClass;
      this.inClass = true;
      this.indent = 2;
      for (const stmt of method.body) {
        this.visitStatement(stmt);
      }
      const bodyLines = this.mainBody;
      this.mainBody = savedOutput;
      this.inClass = wasInClass;
      this.indent = 0;

      this.emitTop(`  ${returnType} ${method.name}(${params})${async} {`);
      for (const line of bodyLines) {
        this.emitTop(line);
      }
      this.emitTop('  }');
      this.emitTopRaw('');
    }

    this.emitTop('}');
    this.emitTopRaw('');
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    this.emit(`// on ${event}`);
    for (const stmt of node.body) this.visitStatement(stmt);
  }

  // ===== Logging and errors =====

  visitLog(node) {
    const args = node.args.map(a => this.expr(a)).join(', ');
    this.emit(`print(${args});`);
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw Exception(${value});`);
    } else {
      this.emit(`throw ${value};`);
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
    this.emit(`// db sql driver: ${driverRaw}`);
    if (driverRaw === 'sqlite') {
      this.addImport("import 'package:sqflite/sqflite.dart';");
      const conn = node.connection ? this.stringValue(node.connection) : "'data.db'";
      this.emit(`final __db = await openDatabase(${conn});`);
    } else {
      const conn = node.connection ? this.stringValue(node.connection) : "'localhost'";
      this.emit(`// connect to ${driverRaw}: ${conn}`);
    }
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    const exprs = node.expressions.map(e => this.expr(e)).join(', ');
    this.emit(`await Future.wait([${exprs}]);`);
  }

  // ===== Schema =====

  visitSchema(node) {
    this.schemas.set(node.name, node);
    this.emitTop(`class ${node.name} {`);
    for (const field of node.fields) {
      const dartType = this.mapType(field.type);
      const nullable = field.modifiers.some(m => m.name === 'optional') ? '?' : '';
      this.emitTop(`  ${dartType}${nullable} ${field.name};`);
    }
    this.emitTopRaw('');
    const constructorParams = node.fields.map(f => {
      const isRequired = !f.modifiers.some(m => m.name === 'optional') && f.type !== 'auto' && f.type !== 'timestamp';
      if (isRequired) return `required this.${f.name}`;
      return `this.${f.name}`;
    }).join(', ');
    this.emitTop(`  ${node.name}({${constructorParams}});`);
    this.emitTopRaw('');
    this.emitTop(`  Map<String, dynamic> toJson() => {`);
    for (const field of node.fields) {
      this.emitTop(`    '${field.name}': ${field.name},`);
    }
    this.emitTop(`  };`);
    this.emitTop(`}`);
    this.emitTopRaw('');
  }

  // ===== Auth =====

  visitAuth(appName, node) {
    const secret = this.expr(node.secret);
    this.authSecret = secret;
    this.emit(`// auth: JWT secret = ${secret}`);
  }

  // ===== CORS =====

  visitCors(appName, node) {
    const origins = this.expr(node.origins);
    this.emit(`// CORS: allow origins ${origins}`);
  }

  // ===== Rate limit =====

  visitLimit(appName, node) {
    const path = this.rawString(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`// rate limit: ${max} per ${window} on ${path}`);
  }

  // ===== Env =====

  visitEnv(node) {
    this.addImport("import 'dart:io';");
    for (const v of node.vars) {
      let defaultVal = null;
      for (const mod of v.modifiers) {
        if (mod.name === 'default') {
          defaultVal = this.expr(mod.args[0]);
        }
      }
      if (defaultVal !== null) {
        this.emit(`final ${v.name} = Platform.environment['${v.name}'] ?? ${defaultVal};`);
      } else {
        this.emit(`final ${v.name} = Platform.environment['${v.name}'];`);
      }
    }
    this.emitRaw('');
  }

  // ===== Every (scheduler) =====

  visitEvery(node) {
    const interval = this.expr(node.interval);
    this.emit(`// scheduled task every ${interval}`);
    this.emit(`Timer.periodic(Duration(seconds: 60), (_) {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Watch =====

  visitWatch(node) {
    const params = node.params.length > 0 ? node.params.join(', ') : 'event';
    this.emit(`// watch: ${node.eventName}`);
    this.emit(`// handler(${params})`);
    for (const stmt of node.body) this.visitStatement(stmt);
  }

  // ===== Static =====

  visitStatic(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    this.emit(`// static files from: ${raw}`);
  }

  // ===== WebSocket =====

  visitWs(node) {
    this.addImport("import 'dart:io';");
    this.addImport("import 'dart:convert';");
    const path = this.rawString(node.path);
    this.emit(`// WebSocket endpoint: ${path}`);
    for (const evt of (node.events || [])) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      this.emit(`// ws event: ${evtName}`);
      for (const stmt of evt.body) this.visitStatement(stmt);
    }
  }

  // ===== Group =====

  visitGroup(appName, node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`// route group: ${prefix}`);
    for (const child of node.routes) {
      this.visitStatement(child);
    }
  }

  // ===== Error handler =====

  visitErrorHandler(appName, node) {
    this.emit(`// error handler`);
    for (const stmt of node.body) this.visitStatement(stmt);
  }

  // ===== Cookie =====

  visitCookie(appName, node) {
    this.emit(`// cookies enabled`);
  }

  // ===== Upload =====

  visitUpload(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// upload endpoint: ${path}`);
    for (const stmt of node.body) this.visitStatement(stmt);
  }

  // ===== Session =====

  visitSession(appName, node) {
    this.emit(`// session enabled`);
  }

  // ===== View =====

  visitView(appName, node) {
    const dir = this.rawString(node.dir);
    this.emit(`// view templates from: ${dir}`);
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
    this.emit(`// middleware: ${node.name}`);
  }

  // ===== ReturnRender =====

  visitReturnRender(node) {
    const template = this.expr(node.template);
    this.emit(`// render template: ${template}`);
  }

  // ===== Validate =====

  visitValidate(appName, node) {
    this.emit(`// validate: ${node.schemaName}`);
  }

  // ===== Tests =====

  visitTest(node) {
    this.hasTests = true;
    this.addImport("import 'package:test/test.dart';");
    const name = this.generateString(node.name);
    const needsAsync = this.bodyUsesAwait(node.body);
    const asyncPrefix = needsAsync ? ' async' : '';
    this.emit(`test(${name}, ()${asyncPrefix} {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitAssert(node) {
    this.hasAsserts = true;
    this.addImport("import 'package:test/test.dart';");
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`expect(${this.expr(exprNode.left)}, equals(${this.expr(exprNode.right)}));`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`expect(${this.expr(exprNode.left)}, isNot(equals(${this.expr(exprNode.right)})));`);
    } else {
      this.emit(`expect(${this.expr(exprNode)}, isTrue);`);
    }
  }

  // ===== Queue =====

  visitQueue(node) {
    this.emit(`// queue: ${node.name}`);
    for (const job of node.jobs) {
      const name = job.name.raw || job.name.parts?.map(p => p.value).join('');
      this.emit(`// job: ${name}`);
      for (const stmt of job.body) this.visitStatement(stmt);
    }
  }

  // ===== OpenAPI =====

  visitOpenapi(appName, node) {
    this.emit(`// OpenAPI spec endpoint`);
  }

  // ===== ReturnRedirect =====

  visitReturnRedirect(node) {
    this.emit(`// redirect ${this.expr(node.statusCode)} -> ${this.expr(node.url)}`);
  }

  // ===== ReturnDownload =====

  visitReturnDownload(node) {
    this.emit(`// download: ${this.expr(node.filePath)}`);
  }

  // ===== Prompt =====

  visitPrompt(node) {
    this.emit(`// prompt template: ${node.name}`);
    this.emit(`String ${node.name}(Map<String, String> vars) {`);
    this.indent++;
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : lines.join(' + \'\\n\' + ');
    this.emit(`var template = ${template};`);
    this.emit(`vars.forEach((k, v) { template = template.replaceAll('{' + k + '}', v); });`);
    this.emit(`return template;`);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Page =====

  visitPage(node) {
    this.addImport("import 'dart:io';");
    const filename = this.rawString(node.filename);
    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`File('${filename}').writeAsStringSync('''<!DOCTYPE html>`);
    this.emit(`<html lang="en"><head><meta charset="UTF-8">`);
    this.emit(`<meta name="viewport" content="width=device-width, initial-scale=1.0">`);
    this.emit(`<title>${pageTitle}</title>`);
    for (const h of headParts) this.emit(h);
    this.emit(`</head><body>`);
    for (const b of bodyParts) this.emit(b);
    this.emit(`</body></html>''');`);
    this.emitRaw('');
  }

  classifyPageElement(el, head, body, setTitle) {
    const tag = el.tag;
    const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
    const arg1 = el.args[1] ? this.rawString(el.args[1]) : '';
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

  // ===== CLI App =====

  visitCli(node) {
    const desc = node.description ? this.rawString(node.description) : node.name;
    this.addImport("import 'dart:io';");
    this.emit(`// CLI: ${desc}`);
    this.emit(`final args = <String, dynamic>{};`);
    this.emit(`final __argv = Platform.executableArguments;`);

    for (const arg of node.args) {
      const argName = this.rawString(arg.name);
      this.emit(`// arg: --${argName} (${arg.type})`);
    }
    for (const flag of node.flags) {
      const l = this.rawString(flag.long);
      this.emit(`// flag: --${l}`);
    }
    this.emitRaw('');

    if (node.run) {
      for (const stmt of node.run.body) this.visitStatement(stmt);
    }
    this.emitRaw('');
  }

  // ===== Mail =====

  visitMail(node) {
    this.addImport("import 'package:mailer/mailer.dart';");
    this.addImport("import 'package:mailer/smtp_server.dart';");
    const host = this.generateString(node.host);
    const port = this.expr(node.port);
    const user = node.user ? this.expr(node.user) : "Platform.environment['MAIL_USER'] ?? ''";
    const pass = node.pass ? this.expr(node.pass) : "Platform.environment['MAIL_PASS'] ?? ''";
    this.emit(`final smtpServer = SmtpServer(${host}, port: ${port}, username: ${user}, password: ${pass});`);
    this.emitRaw('');
  }

  // ===== Desktop =====

  visitDesktop(node) {
    this.emit(`// Desktop app: ${node.name} — use flutter desktop or dart:ffi`);
    const title = node.title ? this.rawString(node.title) : node.name;
    const width = node.width ? this.expr(node.width) : '800';
    const height = node.height ? this.expr(node.height) : '600';
    this.emit(`// title: ${title}, size: ${width}x${height}`);
    this.emitRaw('');
  }

  // ===== Screen =====

  visitScreen(node) {
    this.emit(`// Screen: ${node.name} — use Flutter widgets`);
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
      this.emit(`// widget: ${tag}('${arg0}')`);
    }
    this.emitRaw('');
  }

  // ===== OAuth =====

  visitOauth(node) {
    const provider = this.rawString(node.provider);
    const clientId = this.expr(node.clientId);
    this.emit(`// OAuth: ${provider}, clientId: ${clientId}`);
    this.emitRaw('');
  }

  // ===== Pay =====

  visitPay(node) {
    const provider = this.rawString(node.provider);
    this.emit(`// Payment: ${provider}`);
    this.emitRaw('');
  }

  // ===== Storage =====

  visitStorage(node) {
    const provider = this.rawString(node.provider);
    const bucket = this.expr(node.bucket);
    this.emit(`// Storage: ${provider}, bucket: ${bucket}`);
    this.emitRaw('');
  }

  // ===== PDF =====

  visitPdf(node) {
    const filename = this.rawString(node.filename);
    this.emit(`// PDF generation: ${filename} — use pdf package`);
    this.addImport("import 'package:pdf/pdf.dart';");
    this.addImport("import 'package:pdf/widgets.dart' as pw;");
    this.addImport("import 'dart:io';");
    this.emit(`final __pdf = pw.Document();`);
    this.emit(`__pdf.addPage(pw.Page(build: (pw.Context context) {`);
    this.indent++;
    this.emit(`return pw.Column(children: [`);
    this.indent++;
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
      if (tag === 'title' || tag === 'h1') {
        this.emit(`pw.Text('${arg0}', style: pw.TextStyle(fontSize: 24, fontWeight: pw.FontWeight.bold)),`);
      } else if (tag === 'h2' || tag === 'heading') {
        this.emit(`pw.Text('${arg0}', style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold)),`);
      } else {
        this.emit(`pw.Text('${arg0}'),`);
      }
    }
    this.indent--;
    this.emit(`]);`);
    this.indent--;
    this.emit(`}));`);
    this.emit(`File('${filename}').writeAsBytesSync(await __pdf.save());`);
    this.emit(`print('Generated: ${filename}');`);
    this.emitRaw('');
  }

  // ===== i18n =====

  visitI18n(node) {
    const defaultLang = node.defaultLang ? this.rawString(node.defaultLang) : 'en';
    this.emit(`// i18n: default language = ${defaultLang}`);
    this.addImport("import 'dart:convert';");
    this.addImport("import 'dart:io';");
    this.emit(`var __i18nLang = '${defaultLang}';`);
    this.emit(`final __i18nData = <String, Map<String, dynamic>>{};`);
    for (const lang of node.langs) {
      const code = this.rawString(lang.code);
      const file = this.rawString(lang.file);
      const dir = this.rawString(node.dir);
      this.emit(`__i18nData['${code}'] = jsonDecode(File('${dir}/${file}').readAsStringSync());`);
    }
    this.emitRaw('');
  }

  // ===== Push =====

  visitPush(node) {
    this.emit(`// Push notifications — use firebase_messaging or web_push package`);
    this.emitRaw('');
  }

  // ===== Search =====

  visitSearch(node) {
    const engine = this.rawString(node.engine);
    this.emit(`// Search engine: ${engine}`);
    this.emitRaw('');
  }

  // ===== Image =====

  visitImage(node) {
    const input = this.expr(node.input);
    this.emit(`// Image processing: ${input} — use image package`);
    this.addImport("import 'package:image/image.dart' as img;");
    this.emit(`var __img = img.decodeImage(File(${input}).readAsBytesSync())!;`);
    for (const op of node.operations) {
      if (op.op === 'resize') {
        this.emit(`__img = img.copyResize(__img, width: ${op.args[0] || 800});`);
      } else if (op.op === 'rotate') {
        this.emit(`__img = img.copyRotate(__img, angle: ${op.args[0] || 90});`);
      } else if (op.op === 'grayscale' || op.op === 'greyscale') {
        this.emit(`__img = img.grayscale(__img);`);
      } else if (op.op === 'flip') {
        this.emit(`__img = img.flipVertical(__img);`);
      } else if (op.op === 'blur') {
        this.emit(`__img = img.gaussianBlur(__img, radius: ${op.args[0] || 5});`);
      } else if (op.op === 'crop') {
        this.emit(`__img = img.copyCrop(__img, x: ${op.args[0] || 0}, y: ${op.args[1] || 0}, width: ${op.args[2] || 100}, height: ${op.args[3] || 100});`);
      }
    }
    const output = node.output ? this.expr(node.output) : input;
    this.emit(`File(${output}).writeAsBytesSync(img.encodePng(__img));`);
    this.emitRaw('');
  }

  // ===== CSV =====

  visitCsv(node) {
    const name = this.rawString(node.name);
    const format = node.format ? this.rawString(node.format) : 'csv';
    this.emit(`// CSV/Excel export: ${name}.${format}`);
    this.emitRaw('');
  }

  // ===== Logging =====

  visitLogging(node) {
    const name = this.rawString(node.name);
    this.addImport("import 'package:logging/logging.dart';");
    this.emit(`final logger = Logger('${name}');`);
    this.emitRaw('');
  }

  // ===== Migrate =====

  visitMigrate(node) {
    const name = this.rawString(node.name);
    this.emit(`// migration: ${name}`);
    this.emitRaw('');
  }

  // ===== gRPC =====

  visitGrpc(node) {
    const name = this.rawString(node.name);
    this.emit(`// gRPC service: ${name}`);
    this.emitRaw('');
  }

  // ===== WebRTC =====

  visitWebrtc(node) {
    this.emit(`// WebRTC signaling server`);
    this.emitRaw('');
  }

  // ===== Blockchain =====

  visitBlockchain(node) {
    const name = this.rawString(node.name);
    this.emit(`// Blockchain: ${name}`);
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
        const op = this.mapUnaryOp(node.op);
        return `${op}${this.expr(node.expr)}`;
      }

      case 'Await':
        return `await ${this.expr(node.expr)}`;

      case 'AwaitAllExpr':
        return `await Future.wait(${this.expr(node.expr)})`;

      case 'Spread':
        return `...${this.expr(node.expr)}`;

      case 'New':
        return this.expr(node.expr);

      case 'TypeOf':
        return `${this.expr(node.expr)}.runtimeType.toString()`;

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
          if (p.type === 'spread') return `...${this.expr(p.value)}`;
          if (p.type === 'shorthand') return `'${p.key}': ${p.key}`;
          const key = typeof p.key === 'string' ? `'${p.key}'` :
                      (p.key.type === 'String' ? this.generateString(p.key.value) :
                       (p.key.type === 'Computed' ? this.expr(p.key.expr) : `'${this.expr(p.key)}'`));
          return `${key}: ${this.expr(p.value)}`;
        }).join(', ');
        return `{${props}}`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        return `(${params}) => ${body}`;
      }

      case 'Lambda': {
        const async = node.isAsync ? ' async' : '';
        const params = node.params.map(p => p.name).join(', ');
        const savedOutput = this.mainBody;
        const savedIndent = this.indent;
        this.mainBody = [];
        this.indent = 0;
        const wasInFunction = this.inFunction;
        this.inFunction = true;
        for (const stmt of node.body) this.visitStatement(stmt);
        const bodyLines = this.mainBody;
        this.mainBody = savedOutput;
        this.indent = savedIndent;
        this.inFunction = wasInFunction;
        return `(${params})${async} { ${bodyLines.join(' ')} }`;
      }

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

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
      'console': 'print',
    };
    return map[name] || name;
  }

  mapBinaryOp(op) {
    const map = {
      '===': '==',
      '!==': '!=',
      '&&': '&&',
      '||': '||',
      'and': '&&',
      'or': '||',
    };
    return map[op] || op;
  }

  mapUnaryOp(op) {
    if (op === 'not') return '!';
    return op;
  }

  mapMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    if (prop === 'length') return `${obj}.length`;
    if (prop === 'toString') return `${obj}.toString`;

    if ((obj === 'request' || obj === 'req') && prop === 'body') return 'request.body';
    if ((obj === 'request' || obj === 'req') && prop === 'query') return 'request.uri.queryParameters';
    if ((obj === 'request' || obj === 'req') && prop === 'params') return 'request.params';
    if ((obj === 'request' || obj === 'req') && prop === 'headers') return 'request.headers';
    if ((obj === 'request' || obj === 'req') && prop === 'method') return 'request.method';
    if ((obj === 'request' || obj === 'req') && prop === 'url') return 'request.uri.toString()';

    if (obj === 'JSON' && prop === 'parse') return 'jsonDecode';
    if (obj === 'JSON' && prop === 'stringify') return 'jsonEncode';

    if (obj === 'Math' && prop === 'floor') return 'floor';
    if (obj === 'Math' && prop === 'ceil') return 'ceil';
    if (obj === 'Math' && prop === 'round') return 'round';
    if (obj === 'Math' && prop === 'abs') return 'abs';
    if (obj === 'Math' && prop === 'min') { this.addImport("import 'dart:math';"); return 'min'; }
    if (obj === 'Math' && prop === 'max') { this.addImport("import 'dart:math';"); return 'max'; }
    if (obj === 'Math' && prop === 'random') { this.addImport("import 'dart:math';"); return 'Random().nextDouble'; }
    if (obj === 'Math' && prop === 'PI') { this.addImport("import 'dart:math';"); return 'pi'; }

    if (obj === 'console' && prop === 'log') return 'print';
    if (obj === 'console' && prop === 'error') return 'print';
    if (obj === 'console' && prop === 'warn') return 'print';

    return `${obj}.${prop}`;
  }

  generateCall(node) {
    const args = node.args.map(a => this.expr(a)).join(', ');

    if (node.callee.type === 'Identifier') {
      const argList = node.args.map(a => this.expr(a));
      const b = this.generateBuiltin(node.callee.name, argList);
      if (b) return b;
    }

    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;
      if (name === 'parseInt') return `int.parse(${args})`;
      if (name === 'parseFloat') return `double.parse(${args})`;
      if (name === 'String') return `${args}.toString()`;
      if (name === 'Number') return `num.parse(${args})`;
      if (name === 'Boolean') return `(${args} == true)`;
      if (name === 'isNaN') return `${args}.isNaN`;
      if (name === 'setTimeout') return `Future.delayed(Duration(milliseconds: ${node.args.length > 1 ? this.expr(node.args[1]) : '0'}), ${this.expr(node.args[0])})`;
      if (name === 'setInterval') return `Timer.periodic(Duration(milliseconds: ${node.args.length > 1 ? this.expr(node.args[1]) : '1000'}), (_) => ${this.expr(node.args[0])}())`;
    }

    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // List methods
      if (prop === 'push') return `${obj}.add(${args})`;
      if (prop === 'pop') return `${obj}.removeLast()`;
      if (prop === 'shift') return `${obj}.removeAt(0)`;
      if (prop === 'unshift') return `${obj}.insert(0, ${args})`;
      if (prop === 'indexOf') return `${obj}.indexOf(${args})`;
      if (prop === 'includes') return `${obj}.contains(${args})`;
      if (prop === 'join') return `${obj}.join(${args})`;
      if (prop === 'slice') return `${obj}.sublist(${args})`;
      if (prop === 'forEach') return `${obj}.forEach(${args})`;
      if (prop === 'map') return `${obj}.map(${args}).toList()`;
      if (prop === 'filter') return `${obj}.where(${args}).toList()`;
      if (prop === 'find') return `${obj}.firstWhere(${args}, orElse: () => null)`;
      if (prop === 'some') return `${obj}.any(${args})`;
      if (prop === 'every') return `${obj}.every(${args})`;
      if (prop === 'reduce') return `${obj}.reduce(${args})`;
      if (prop === 'flat') return `${obj}.expand((x) => x).toList()`;
      if (prop === 'reverse') return `${obj}.reversed.toList()`;
      if (prop === 'sort') return `(List.from(${obj})..sort(${args}))`;
      if (prop === 'concat') return `[...${obj}, ...${args}]`;

      // String methods
      if (prop === 'split') return `${obj}.split(${args})`;
      if (prop === 'trim') return `${obj}.trim()`;
      if (prop === 'trimStart') return `${obj}.trimLeft()`;
      if (prop === 'trimEnd') return `${obj}.trimRight()`;
      if (prop === 'toUpperCase') return `${obj}.toUpperCase()`;
      if (prop === 'toLowerCase') return `${obj}.toLowerCase()`;
      if (prop === 'startsWith') return `${obj}.startsWith(${args})`;
      if (prop === 'endsWith') return `${obj}.endsWith(${args})`;
      if (prop === 'replace') return `${obj}.replaceFirst(${args})`;
      if (prop === 'replaceAll') return `${obj}.replaceAll(${args})`;
      if (prop === 'padStart') return `${obj}.padLeft(${args})`;
      if (prop === 'padEnd') return `${obj}.padRight(${args})`;
      if (prop === 'charAt') return `${obj}[${args}]`;
      if (prop === 'substring') return `${obj}.substring(${args})`;
      if (prop === 'repeat') return `${obj} * ${args}`;

      // Object/Map methods
      if (obj === 'Object' && prop === 'keys') return `${this.expr(node.args[0])}.keys.toList()`;
      if (obj === 'Object' && prop === 'values') return `${this.expr(node.args[0])}.values.toList()`;
      if (obj === 'Object' && prop === 'entries') return `${this.expr(node.args[0])}.entries.toList()`;

      // Array static
      if (obj === 'Array' && prop === 'isArray') return `${args} is List`;
      if (obj === 'Array' && prop === 'from') return `List.from(${args})`;

      // Promise
      if (obj === 'Promise' && prop === 'all') return `Future.wait(${args})`;
      if (obj === 'Promise' && prop === 'resolve') return `Future.value(${args})`;

      // Date
      if (obj === 'Date' && prop === 'now') return `DateTime.now().millisecondsSinceEpoch`;

      // JSON
      if (prop === 'json' && (obj === 'request' || obj === 'req')) {
        this.addImport("import 'dart:convert';");
        return `jsonDecode(await utf8.decoder.bind(request).join())`;
      }
    }

    const callee = this.expr(node.callee);
    return `${callee}(${args})`;
  }

  generateString(strData) {
    if (!strData || !strData.parts) return "''";

    const hasInterpolation = strData.parts.some(p => p.type === 'expr');

    if (!hasInterpolation) {
      const raw = strData.parts.map(p => p.value).join('');
      return `'${raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }

    let result = "'";
    for (const part of strData.parts) {
      if (part.type === 'text') {
        result += part.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$');
      } else {
        const exprCode = part.value;
        if (/^\w+$/.test(exprCode)) {
          result += '$' + exprCode;
        } else {
          result += '${' + exprCode + '}';
        }
      }
    }
    result += "'";
    return result;
  }

  rawString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
  }

  stringValue(strData) {
    if (!strData || !strData.parts) return "''";
    if (strData.raw !== null && strData.raw !== undefined) {
      return `'${strData.raw.replace(/'/g, "\\'")}'`;
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

    const LIST_METHODS = new Set(['filter', 'map', 'reduce', 'find', 'some', 'every', 'sort', 'reverse', 'join']);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier') {
        const name = step.callee.name;
        const args = step.args.map(a => this.expr(a)).join(', ');

        if (name === 'filter') {
          result = `${result}.where(${args}).toList()`;
        } else if (name === 'map') {
          result = `${result}.map(${args}).toList()`;
        } else if (name === 'reduce') {
          result = `${result}.reduce(${args})`;
        } else if (name === 'sort') {
          result = `(List.from(${result})..sort())`;
        } else if (name === 'reverse') {
          result = `${result}.reversed.toList()`;
        } else if (name === 'join') {
          result = `${result}.join(${args})`;
        } else if (name === 'find') {
          result = `${result}.firstWhere(${args}, orElse: () => null)`;
        } else if (name === 'some') {
          result = `${result}.any(${args})`;
        } else if (name === 'every') {
          result = `${result}.every(${args})`;
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
    const saved = this.mainBody;
    const savedIndent = this.indent;
    this.mainBody = [];
    this.indent = 0;
    const wasInFunction = this.inFunction;
    this.inFunction = true;
    this.visitStatement(stmt);
    const result = this.mainBody.join('\n');
    this.mainBody = saved;
    this.indent = savedIndent;
    this.inFunction = wasInFunction;
    return result;
  }

  visitEnum(node) {
    this.emit(`enum ${node.name} {`);
    this.indent++;
    node.values.forEach(v => {
      this.emit(`${v.toLowerCase()},`);
    });
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
  }

  visitSwap(node) {
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    this.emit(`{ final _tmp = ${a}; ${a} = ${b}; ${b} = _tmp; }`);
  }

  visitDestructure(node) {
    const val = this.expr(node.value);
    const keyword = node.isMut ? 'var' : 'final';
    if (node.pattern === 'array') {
      node.names.forEach((n, i) => {
        if (!n.rest) {
          const varName = n.alias || n.name;
          this.emit(`${keyword} ${varName} = ${val}[${i}];`);
        } else {
          this.emit(`${keyword} ${n.name} = ${val}.sublist(${i});`);
        }
      });
    } else {
      for (const n of node.names) {
        if (!n.rest) {
          const varName = n.alias || n.name;
          if (n.defaultValue) {
            this.emit(`${keyword} ${varName} = ${val}['${n.name}'] ?? ${this.expr(n.defaultValue)};`);
          } else {
            this.emit(`${keyword} ${varName} = ${val}['${n.name}'];`);
          }
        }
      }
    }
  }

  visitClassDecl(node) {
    const ext = node.parent ? ` extends ${node.parent}` : '';
    this.emit(`class ${node.name}${ext} {`);
    this.indent++;
    for (const field of node.fields) {
      if (field.defaultValue) {
        this.emit(`var ${field.name} = ${this.expr(field.defaultValue)};`);
      } else {
        this.emit(`dynamic ${field.name};`);
      }
    }
    if (node.init) {
      const params = node.init.params.map(p => `dynamic ${p.name}`).join(', ');
      this.emit(`${node.name}(${params}) {`);
      this.indent++;
      if (node.parent) this.emit('super();');
      for (const stmt of node.init.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    }
    for (const method of node.methods) {
      const params = method.params.map(p => `dynamic ${p.name}`).join(', ');
      const asyncKw = method.isAsync ? 'async ' : '';
      const returnType = method.isAsync ? 'Future<dynamic>' : 'dynamic';
      this.emit(`${returnType} ${method.name}(${params}) ${asyncKw}{`);
      this.indent++;
      if (method.body.length === 0) {
        this.emit('return null;');
      } else {
        for (const stmt of method.body) this.visitStatement(stmt);
      }
      this.indent--;
      this.emit('}');
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  generateBuiltin(name, args) {
    switch (name) {
      case 'len': return `${args[0]}.length`;
      case 'sort': return `(List.from(${args[0]})..sort())`;
      case 'reverse': return `${args[0]}.reversed.toList()`;
      case 'unique': return `${args[0]}.toSet().toList()`;
      case 'upper': return `${args[0]}.toUpperCase()`;
      case 'lower': return `${args[0]}.toLowerCase()`;
      case 'trim': return `${args[0]}.trim()`;
      case 'split': return `${args[0]}.split(${args[1] || '","'})`;
      case 'join': return `${args[0]}.join(${args[1] || '","'})`;
      case 'contains': return `${args[0]}.contains(${args[1]})`;
      case 'replace': return `${args[0]}.replaceAll(${args[1]}, ${args[2]})`;
      case 'keys': return `${args[0]}.keys.toList()`;
      case 'values': return `${args[0]}.values.toList()`;
      case 'entries': return `${args[0]}.entries.toList()`;
      case 'range': return args.length >= 2 ? `List.generate(${args[1]} - ${args[0]}, (i) => i + ${args[0]})` : `List.generate(${args[0]}, (i) => i)`;
      case 'abs': return `${args[0]}.abs()`;
      case 'sqrt': { this.addImport('dart:math'); return `sqrt(${args[0]}.toDouble())`; }
      case 'pow': { this.addImport('dart:math'); return `pow(${args[0]}, ${args[1]})`; }
      case 'ceil': return `${args[0]}.ceil()`;
      case 'floor': return `${args[0]}.floor()`;
      case 'round': return `${args[0]}.round()`;
      case 'sum': return `${args[0]}.reduce((a, b) => a + b)`;
      case 'flat': return `${args[0]}.expand((x) => x).toList()`;
      case 'zip': return `List.generate(${args[0]}.length, (i) => [${args[0]}[i], ${args[1]}[i]])`;
      case 'chunk': return `[for (var i = 0; i < ${args[0]}.length; i += ${args[1]}) ${args[0]}.sublist(i, i + ${args[1]} > ${args[0]}.length ? ${args[0]}.length : i + ${args[1]})]`;
      case 'str': return `${args[0]}.toString()`;
      case 'int': return `int.parse(${args[0]})`;
      case 'float': return `double.parse(${args[0]})`;
      case 'json_parse': { this.addImport('dart:convert'); return `jsonDecode(${args[0]})`; }
      case 'json_str': { this.addImport('dart:convert'); return `jsonEncode(${args[0]})`; }
      case 'now': return `DateTime.now().millisecondsSinceEpoch`;
      case 'time': return `DateTime.now().toIso8601String()`;
      case 'exit': return `exit(${args[0] || '0'})`;
      case 'sleep': return `await Future.delayed(Duration(milliseconds: ${args[0]}))`;
      case 'random': { this.addImport('dart:math'); return args.length >= 2 ? `(Random().nextInt(${args[1]} - ${args[0]} + 1) + ${args[0]})` : `Random().nextDouble()`; }
      case 'read': { this.addImport('dart:io'); return `File(${args[0]}).readAsStringSync()`; }
      case 'write': { this.addImport('dart:io'); return `File(${args[0]}).writeAsStringSync(${args[1]})`; }
      case 'ask': { this.addImport('dart:io'); return `((){stdout.write(${args[0] || '""'}); return stdin.readLineSync() ?? "";}())`; }
      case 'map': return `${args[0]}.map((e) => ${args[1]}(e)).toList()`;
      case 'filter': return `${args[0]}.where((e) => ${args[1]}(e)).toList()`;
      case 'reduce': return `${args[0]}.fold(${args[2] || 'null'}, (acc, e) => ${args[1]}(acc, e))`;
      case 'find': return `${args[0]}.firstWhere((e) => ${args[1]}(e), orElse: () => null)`;
      case 'every': return `${args[0]}.every((e) => ${args[1]}(e))`;
      case 'some': return `${args[0]}.any((e) => ${args[1]}(e))`;
      case 'foreach': return `${args[0]}.forEach((e) => ${args[1]}(e))`;
      default: return null;
    }
  }
}
