export class JavaGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.imports = new Set();
    this.className = options.className || 'App';
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.inClass = false;
    this.models = new Map();
    this.schemas = new Map();
    this.authSecret = null;
    this.hasMain = false;
    this.mainBody = [];
    this.topLevelMethods = [];
    this.topLevelFields = [];
  }

  generate(ast) {
    // First pass: collect all statements
    this.visitProgram(ast);

    // Build final output with imports, class wrapper, and main method
    const preamble = [];
    for (const imp of this.imports) {
      preamble.push(`import ${imp};`);
    }
    if (this.imports.size > 0) preamble.push('');

    this.output.unshift(...preamble);

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

  addImport(imp) {
    this.imports.add(imp);
  }

  // ===== Type Mapping =====

  mapType(naideType) {
    const map = {
      'str': 'String',
      'string': 'String',
      'int': 'int',
      'integer': 'int',
      'num': 'double',
      'number': 'double',
      'float': 'double',
      'bool': 'boolean',
      'boolean': 'boolean',
      'list': 'List<Object>',
      'map': 'Map<String, Object>',
      'json': 'Object',
      'any': 'Object',
      'void': 'void',
      'auto': 'int',
      'timestamp': 'String',
    };
    return map[naideType] || 'Object';
  }

  mapTypeBoxed(naideType) {
    const map = {
      'str': 'String',
      'string': 'String',
      'int': 'Integer',
      'integer': 'Integer',
      'num': 'Double',
      'number': 'Double',
      'float': 'Double',
      'bool': 'Boolean',
      'boolean': 'Boolean',
      'list': 'List<Object>',
      'map': 'Map<String, Object>',
      'json': 'Object',
      'any': 'Object',
      'void': 'Void',
      'auto': 'Integer',
      'timestamp': 'String',
    };
    return map[naideType] || 'Object';
  }

  // ===== Program =====

  visitProgram(node) {
    // Wrap everything in a class
    this.emit(`public class ${this.className} {`);
    this.indent++;
    this.inClass = true;

    let hasMainContent = false;
    const mainStatements = [];
    const classLevelStatements = [];

    for (const stmt of node.body) {
      if (this.isClassLevel(stmt)) {
        classLevelStatements.push(stmt);
      } else {
        mainStatements.push(stmt);
        hasMainContent = true;
      }
    }

    // Emit class-level declarations first (functions, models)
    for (const stmt of classLevelStatements) {
      this.visitStatement(stmt);
    }

    // Wrap remaining statements in main method
    if (hasMainContent) {
      this.emitRaw('');
      this.emit('public static void main(String[] args) {');
      this.indent++;
      for (const stmt of mainStatements) {
        this.visitStatement(stmt);
      }
      this.indent--;
      this.emit('}');
    }

    this.indent--;
    this.emit('}');
    this.inClass = false;
  }

  isClassLevel(node) {
    return node.type === 'Function' ||
           node.type === 'Model' ||
           node.type === 'Server' ||
           node.type === 'Bot' ||
           node.type === 'SchemaDecl' ||
           node.type === 'Use' ||
           node.type === 'UseDestructured';
  }

  // ===== Statement Dispatcher =====

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
      case 'CrudDecl': return this.visitCrud(node);
      case 'AuthDecl': return this.visitAuth(node);
      case 'CorsDecl': return this.visitCors(node);
      case 'LimitDecl': return this.visitLimit(node);
      case 'EnvDecl': return this.visitEnv(node);
      case 'EveryDecl': return this.visitEvery(node);
      case 'WatchDecl': return this.visitWatch(node);
      case 'StaticDecl': return this.visitStatic(node);
      case 'WsDecl': return this.visitWs(node);
      case 'GroupDecl': return this.visitGroup(node);
      case 'ErrorHandler': return this.visitErrorHandler(node);
      case 'CookieDecl': return this.visitCookie(node);
      case 'UploadDecl': return this.visitUpload(node);
      case 'SessionDecl': return this.visitSession(node);
      case 'ViewDecl': return this.visitView(node);
      case 'SseDecl': return this.visitSse(node);
      case 'CacheDecl': return this.visitCache(node);
      case 'MiddlewareRef': return this.visitMiddlewareRef(node);
      case 'ReturnRender': return this.visitReturnRender(node);
      case 'ValidateDecl': return this.visitValidate(node);
      case 'TestDecl': return this.visitTest(node);
      case 'AssertStmt': return this.visitAssert(node);
      case 'QueueDecl': return this.visitQueue(node);
      case 'OpenapiDecl': return this.visitOpenapi(node);
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
        this.emit(`/* unknown: ${node.type} */`);
    }
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const javaImport = this.mapModuleName(raw);
    if (javaImport) {
      this.addImport(javaImport);
    }
    this.emit(`// use ${raw}`);
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const names = node.names.map(n => n.name).join(', ');
    const javaImport = this.mapModuleName(raw);
    if (javaImport) {
      this.addImport(javaImport);
    }
    this.emit(`// use { ${names} } from ${raw}`);
  }

  mapModuleName(name) {
    const clean = name.replace(/^['"]|['"]$/g, '');
    const map = {
      'express': 'com.sun.net.httpserver.*',
      'fs': 'java.io.*',
      'path': 'java.nio.file.*',
      'crypto': 'java.security.*',
      'http': 'java.net.http.*',
      'uuid': 'java.util.UUID',
      'axios': 'java.net.http.*',
    };
    return map[clean] || null;
  }

  // ===== Functions =====

  visitFunction(node) {
    const params = node.params.map(p => {
      let s = '';
      if (p.spread) s += 'Object... ';
      else s += 'Object ';
      s += p.name;
      return s;
    }).join(', ');

    const returnType = node.returnType ? this.mapType(node.returnType) : 'Object';
    const modifier = this.inClass ? 'public static' : 'public';

    this.emit(`${modifier} ${returnType} ${node.name}(${params}) {`);
    this.indent++;
    if (node.body.length === 0) {
      if (returnType !== 'void') this.emit('return null;');
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
      this.emit('return;');
    } else {
      this.emit(`return ${this.expr(node.value)};`);
    }
  }

  visitReturnStatus(node) {
    this.emit(`// return status ${this.expr(node.statusCode)}: ${this.expr(node.body)}`);
    this.emit(`exchange.sendResponseHeaders(${this.expr(node.statusCode)}, 0);`);
    this.emit(`try (var os = exchange.getResponseBody()) { os.write(${this.expr(node.body)}.toString().getBytes()); }`);
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`exchange.getResponseHeaders().set("Location", ${val});`);
        this.emit(`exchange.sendResponseHeaders(302, -1);`);
        break;
      case 'html':
        this.emit(`exchange.getResponseHeaders().set("Content-Type", "text/html");`);
        this.emit(`exchange.sendResponseHeaders(200, 0);`);
        this.emit(`try (var os = exchange.getResponseBody()) { os.write(${val}.toString().getBytes()); }`);
        break;
      case 'text':
        this.emit(`exchange.getResponseHeaders().set("Content-Type", "text/plain");`);
        this.emit(`exchange.sendResponseHeaders(200, 0);`);
        this.emit(`try (var os = exchange.getResponseBody()) { os.write(${val}.toString().getBytes()); }`);
        break;
      case 'file':
        this.emit(`// sendFile: ${val}`);
        this.emit(`var __fileBytes = java.nio.file.Files.readAllBytes(java.nio.file.Path.of(${val}));`);
        this.emit(`exchange.sendResponseHeaders(200, __fileBytes.length);`);
        this.emit(`try (var os = exchange.getResponseBody()) { os.write(__fileBytes); }`);
        break;
      default:
        this.emit(`// return ${node.method}: ${val}`);
        this.emit(`exchange.sendResponseHeaders(200, 0);`);
        this.emit(`try (var os = exchange.getResponseBody()) { os.write(${val}.toString().getBytes()); }`);
    }
  }

  // ===== Variables =====

  visitTypedVar(node) {
    const javaType = node.naideType ? this.mapType(node.naideType) : 'var';
    this.emit(`${javaType} ${node.name} = ${this.expr(node.value)};`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      // Java doesn't have destructuring; emit indexed assignments
      const tempVar = '__arr';
      this.emit(`var ${tempVar} = ${value};`);
      node.target.elements.forEach((e, i) => {
        this.emit(`var ${this.expr(e)} = ${tempVar}[${i}];`);
      });
    } else if (node.target.type === 'Object') {
      const tempVar = '__map';
      this.emit(`var ${tempVar} = ${value};`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`var ${varName} = ${tempVar}.get(${JSON.stringify(key)});`);
      }
    } else {
      this.emit(`${this.expr(node.target)} = ${value};`);
    }
  }

  visitCompoundAssign(node) {
    this.emit(`${this.expr(node.target)} ${node.op} ${this.expr(node.value)};`);
  }

  // ===== Control Flow =====

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
      this.addImport('java.util.Map');
      this.emit(`for (var __entry : ((Map<?, ?>) ${collection}).entrySet()) {`);
      this.indent++;
      this.emit(`var ${node.key} = __entry.getKey();`);
      this.emit(`var ${node.value} = __entry.getValue();`);
      for (const stmt of node.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    } else {
      this.emit(`for (var ${node.value} : ${collection}) {`);
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
    this.emit(`for (int ${varName} = ${start}; ${varName} < ${end}; ${varName}++) {`);
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
      const catchParam = node.catchVar || 'e';
      this.emit(`} catch (Exception ${catchParam}) {`);
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

  // ===== Server (HttpServer) =====

  visitServer(node) {
    this.addImport('com.sun.net.httpserver.HttpServer');
    this.addImport('com.sun.net.httpserver.HttpExchange');
    this.addImport('java.net.InetSocketAddress');
    this.addImport('java.io.OutputStream');
    this.addImport('java.io.InputStream');
    this.addImport('java.nio.charset.StandardCharsets');

    const port = node.port ? this.expr(node.port) : '3000';

    this.emit(`HttpServer ${node.name} = HttpServer.create(new InetSocketAddress(${port}), 0);`);
    this.emitRaw('');

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(node.name, child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrudRoute(node.name, child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors(child);
      } else if (child.type === 'StaticDecl') {
        this.visitStaticRoute(node.name, child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroupRoute(node.name, child);
      } else if (child.type === 'ErrorHandler') {
        this.visitErrorHandler(child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else if (child.type === 'WsDecl') {
        this.emit(`// TODO: WebSocket - use Java-WebSocket library`);
      } else if (child.type === 'GraphqlDecl') {
        this.emit(`// TODO: GraphQL - use graphql-java library`);
      } else {
        this.visitStatement(child);
      }
    }

    this.emitRaw('');
    this.emit(`${node.name}.setExecutor(null);`);
    this.emit(`${node.name}.start();`);
    this.emit(`System.out.println("Server running on port " + ${port});`);
    this.emitRaw('');
  }

  visitRoute(appName, route) {
    const method = route.method === 'del' ? 'DELETE' : route.method.toUpperCase();
    const path = this.rawString(route.path);

    this.emit(`${appName}.createContext("${path}", exchange -> {`);
    this.indent++;
    this.emit(`if ("${method}".equals(exchange.getRequestMethod())) {`);
    this.indent++;

    // Read request body
    this.emit(`String __reqBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);`);

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`String __response = String.valueOf(${this.expr(stmt.value)});`);
        this.emit(`exchange.sendResponseHeaders(200, __response.getBytes().length);`);
        this.emit(`try (OutputStream os = exchange.getResponseBody()) { os.write(__response.getBytes()); }`);
      } else {
        this.visitStatement(stmt);
      }
    }

    this.indent--;
    this.emit('} else {');
    this.indent++;
    this.emit('exchange.sendResponseHeaders(405, -1);');
    this.indent--;
    this.emit('}');
    this.emit('exchange.close();');
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitGroupRoute(appName, node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`// Group: ${prefix}`);
    for (const child of node.routes) {
      if (child.type === 'Route') {
        // Prepend group prefix to route path
        const origPath = this.rawString(child.path);
        const fullPath = prefix + origPath;
        const modifiedRoute = { ...child, path: { raw: fullPath, parts: [{ type: 'text', value: fullPath }] } };
        this.visitRoute(appName, modifiedRoute);
      } else {
        this.visitStatement(child);
      }
    }
  }

  visitCrudRoute(appName, node) {
    const path = this.rawString(node.path);
    const schema = node.schemaName;
    this.addImport('java.util.ArrayList');
    this.addImport('java.util.Map');
    this.addImport('java.util.HashMap');

    this.emit(`// CRUD for ${schema} at ${path}`);
    this.emit(`var ${schema.toLowerCase()}Store = new ArrayList<Map<String, Object>>();`);
    this.emit(`final int[] ${schema.toLowerCase()}IdCounter = {1};`);
    this.emitRaw('');

    this.emit(`${appName}.createContext("${path}", exchange -> {`);
    this.indent++;
    this.emit(`String method = exchange.getRequestMethod();`);
    this.emit(`String __body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);`);
    this.emit(`String response = "{}";`);
    this.emit(`int status = 200;`);
    this.emitRaw('');
    this.emit(`if ("GET".equals(method)) {`);
    this.indent++;
    this.emit(`response = ${schema.toLowerCase()}Store.toString();`);
    this.indent--;
    this.emit(`} else if ("POST".equals(method)) {`);
    this.indent++;
    this.emit(`var item = new HashMap<String, Object>();`);
    this.emit(`item.put("id", ${schema.toLowerCase()}IdCounter[0]++);`);
    this.emit(`${schema.toLowerCase()}Store.add(item);`);
    this.emit(`response = item.toString();`);
    this.emit(`status = 201;`);
    this.indent--;
    this.emit(`} else if ("DELETE".equals(method)) {`);
    this.indent++;
    this.emit(`${schema.toLowerCase()}Store.clear();`);
    this.emit(`response = "{\\"deleted\\": true}";`);
    this.indent--;
    this.emit('}');
    this.emit(`exchange.sendResponseHeaders(status, response.getBytes().length);`);
    this.emit(`try (OutputStream os = exchange.getResponseBody()) { os.write(response.getBytes()); }`);
    this.emit('exchange.close();');
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitStaticRoute(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.addImport('java.nio.file.Files');
    this.addImport('java.nio.file.Path');

    this.emit(`${appName}.createContext("/", exchange -> {`);
    this.indent++;
    this.emit(`String filePath = "${raw}" + exchange.getRequestURI().getPath();`);
    this.emit(`Path path = Path.of(filePath);`);
    this.emit(`if (Files.exists(path)) {`);
    this.indent++;
    this.emit(`byte[] bytes = Files.readAllBytes(path);`);
    this.emit(`exchange.sendResponseHeaders(200, bytes.length);`);
    this.emit(`try (OutputStream os = exchange.getResponseBody()) { os.write(bytes); }`);
    this.indent--;
    this.emit('} else {');
    this.indent++;
    this.emit('exchange.sendResponseHeaders(404, -1);');
    this.indent--;
    this.emit('}');
    this.emit('exchange.close();');
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'System.getenv("BOT_TOKEN")';
    const botType = this.rawBotType(node.botType);
    this.emit(`// TODO: ${botType} bot - use JDA (Discord), TelegramBots, or Slack SDK for Java`);
    this.emit(`// Token: ${tokenExpr}`);
    this.emitRaw('');

    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        this.emit(`// Bot event: ${evtName}`);
      } else if (handler.type === 'BotSlashCmd') {
        const cmdName = handler.name.raw || handler.name.parts?.map(p => p.value).join('');
        this.emit(`// Bot slash command: /${cmdName}`);
      }
    }
    this.emitRaw('');
  }

  rawBotType(bt) {
    if (!bt) return 'discord';
    return bt.raw || bt.parts?.map(p => p.value).join('') || 'discord';
  }

  // ===== Model (Class) =====

  visitModel(node) {
    this.models.set(node.name, node);

    const ext = node.parent ? ` extends ${node.parent}` : '';
    this.emit(`public static class ${node.name}${ext} {`);
    this.indent++;

    // Fields
    for (const f of node.fields) {
      const javaType = f.naideType ? this.mapType(f.naideType) : 'Object';
      if (f.defaultValue) {
        this.emit(`private ${javaType} ${f.name} = ${this.expr(f.defaultValue)};`);
      } else {
        this.emit(`private ${javaType} ${f.name};`);
      }
    }

    if (node.fields.length > 0) this.emitRaw('');

    // Constructor
    if (node.fields.length > 0 || node.parent) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const constructorParams = allFields.map(f => {
        const javaType = f.naideType ? this.mapType(f.naideType) : 'Object';
        return `${javaType} ${f.name}`;
      }).join(', ');

      this.emit(`public ${node.name}(${constructorParams}) {`);
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

      // Getters and setters
      for (const f of node.fields) {
        const javaType = f.naideType ? this.mapType(f.naideType) : 'Object';
        const capName = f.name.charAt(0).toUpperCase() + f.name.slice(1);
        this.emit(`public ${javaType} get${capName}() { return this.${f.name}; }`);
        this.emit(`public void set${capName}(${javaType} ${f.name}) { this.${f.name} = ${f.name}; }`);
        this.emitRaw('');
      }
    }

    // Methods
    for (const method of node.methods) {
      const returnType = method.returnType ? this.mapType(method.returnType) : 'Object';
      const params = method.params.map(p => {
        if (p.spread) return `Object... ${p.name}`;
        return `Object ${p.name}`;
      }).join(', ');

      this.emit(`public ${returnType} ${method.name}(${params}) {`);
      this.indent++;
      if (method.body.length === 0) {
        if (returnType !== 'void') this.emit('return null;');
      } else {
        for (const stmt of method.body) {
          this.visitStatement(stmt);
        }
      }
      this.indent--;
      this.emit('}');
      this.emitRaw('');
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    this.emit(`// on ${event}`);
    this.emit(`/* Event handler: */ {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  // ===== Logging =====

  visitLog(node) {
    const args = node.args.map(a => this.expr(a));
    if (args.length === 1) {
      this.emit(`System.out.println(${args[0]});`);
    } else {
      this.emit(`System.out.println(${args.join(' + " " + ')});`);
    }
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw new RuntimeException(${value});`);
    } else {
      this.emit(`throw (RuntimeException) ${value};`);
    }
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.addImport('java.sql.Connection');
    this.addImport('java.sql.DriverManager');
    this.emit(`Connection db = DriverManager.getConnection(${this.expr(node.connectionString)});`);
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`// db dir: ${raw}`);
  }

  visitDbSql(node) {
    this.addImport('java.sql.Connection');
    this.addImport('java.sql.DriverManager');
    this.addImport('java.sql.Statement');
    this.addImport('java.sql.ResultSet');
    const driverRaw = node.driver.raw || node.driver.parts?.map(p => p.value).join('') || 'sqlite';

    if (driverRaw === 'sqlite') {
      const conn = node.connection ? this.stringValue(node.connection) : '"jdbc:sqlite:data.db"';
      this.emit(`Connection __db = DriverManager.getConnection(${conn});`);
      this.emit(`__db.createStatement().execute("PRAGMA journal_mode=WAL");`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      const conn = node.connection ? this.stringValue(node.connection) : 'System.getenv("DATABASE_URL")';
      this.emit(`Connection __db = DriverManager.getConnection(${conn});`);
    }
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    this.addImport('java.util.concurrent.CompletableFuture');
    const exprs = node.expressions.map(e => this.expr(e)).join(', ');
    this.emit(`CompletableFuture.allOf(${exprs}).join();`);
  }

  // ===== Schema =====

  visitSchema(node) {
    this.emit(`// Schema: ${node.name}`);
    this.emit(`public static class ${node.name} {`);
    this.indent++;
    for (const field of node.fields) {
      const javaType = this.mapType(field.type);
      this.emit(`private ${javaType} ${field.name};`);
    }
    if (node.fields.length > 0) {
      this.emitRaw('');
      // Constructor
      const params = node.fields.map(f => `${this.mapType(f.type)} ${f.name}`).join(', ');
      this.emit(`public ${node.name}(${params}) {`);
      this.indent++;
      for (const f of node.fields) {
        this.emit(`this.${f.name} = ${f.name};`);
      }
      this.indent--;
      this.emit('}');
      this.emitRaw('');
      // Getters
      for (const f of node.fields) {
        const cap = f.name.charAt(0).toUpperCase() + f.name.slice(1);
        this.emit(`public ${this.mapType(f.type)} get${cap}() { return this.${f.name}; }`);
        this.emit(`public void set${cap}(${this.mapType(f.type)} ${f.name}) { this.${f.name} = ${f.name}; }`);
      }
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
    this.schemas.set(node.name, node);
  }

  // ===== High-level features (stubs for Java) =====

  visitCrud(node) {
    const path = this.rawString(node.path);
    this.emit(`// TODO: CRUD for ${node.schemaName} at ${path} - use Spring Data or manual routes`);
  }

  visitAuth(node) {
    const secret = this.expr(node.secret);
    this.authSecret = secret;
    this.emit(`// TODO: Auth middleware - use JWT library (io.jsonwebtoken)`);
    this.emit(`String __authSecret = ${secret};`);
    this.emitRaw('');
  }

  visitCors(node) {
    const origins = this.expr(node.origins);
    this.emit(`// TODO: CORS - set Access-Control-Allow-Origin: ${origins}`);
  }

  visitLimit(node) {
    const path = this.rawString(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`// TODO: Rate limit ${path}: ${max} requests per ${window}`);
  }

  visitStatic(node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    this.emit(`// TODO: Serve static files from ${raw}`);
  }

  visitWs(node) {
    this.emit(`// TODO: WebSocket - use Java-WebSocket library`);
  }

  visitGroup(node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`// TODO: Route group ${prefix}`);
    for (const child of node.routes) {
      this.visitStatement(child);
    }
  }

  visitErrorHandler(node) {
    this.emit(`// Error handler`);
    this.emit(`/* error handler */ {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  visitCookie(node) {
    this.emit('// TODO: Cookie support - use HttpCookie');
  }

  visitUpload(node) {
    const path = this.rawString(node.path);
    this.emit(`// TODO: File upload at ${path} - use Apache Commons FileUpload`);
  }

  visitSession(node) {
    this.emit('// TODO: Session support - use HttpSession or custom implementation');
  }

  visitView(node) {
    const dir = this.rawString(node.dir);
    this.emit(`// TODO: View engine for templates in ${dir} - use Thymeleaf or Freemarker`);
  }

  visitSse(node) {
    const path = this.rawString(node.path);
    this.emit(`// TODO: Server-Sent Events at ${path}`);
  }

  visitCache(node) {
    const path = this.rawString(node.path);
    const duration = this.expr(node.duration);
    this.emit(`// TODO: Cache ${path} for ${duration}`);
  }

  visitMiddlewareRef(node) {
    this.emit(`// Middleware: ${node.name}`);
  }

  visitReturnRender(node) {
    const template = this.expr(node.template);
    this.emit(`// TODO: Render template ${template} - use Thymeleaf`);
  }

  visitReturnRedirect(node) {
    this.emit(`exchange.getResponseHeaders().set("Location", ${this.expr(node.url)});`);
    this.emit(`exchange.sendResponseHeaders(${this.expr(node.statusCode)}, -1);`);
  }

  visitReturnDownload(node) {
    this.addImport('java.nio.file.Files');
    this.addImport('java.nio.file.Path');
    this.emit(`exchange.getResponseHeaders().set("Content-Disposition", "attachment; filename=\\"" + ${this.expr(node.filename)} + "\\"");`);
    this.emit(`byte[] __dlBytes = Files.readAllBytes(Path.of(${this.expr(node.filePath)}));`);
    this.emit(`exchange.sendResponseHeaders(200, __dlBytes.length);`);
    this.emit(`try (OutputStream os = exchange.getResponseBody()) { os.write(__dlBytes); }`);
  }

  visitValidate(node) {
    const path = this.rawString(node.path);
    this.emit(`// TODO: Validate ${path} against ${node.schemaName}Schema`);
  }

  // ===== Tests =====

  visitTest(node) {
    const name = this.rawString(node.name);
    const funcName = 'test_' + name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');

    this.emit(`// @Test`);
    this.emit(`public static void ${funcName}() {`);
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
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`assert ${this.expr(exprNode.left)}.equals(${this.expr(exprNode.right)}) : "Assertion failed";`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`assert !${this.expr(exprNode.left)}.equals(${this.expr(exprNode.right)}) : "Assertion failed";`);
    } else {
      this.emit(`assert (boolean) (${this.expr(exprNode)}) : "Assertion failed";`);
    }
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
        this.emit(`String __env_${v.name} = System.getenv("${v.name}");`);
        this.emit(`var ${v.name} = __env_${v.name} != null ? __env_${v.name} : ${defaultVal};`);
      } else {
        this.emit(`var ${v.name} = System.getenv("${v.name}");`);
      }

      // Type coercion
      if (v.type === 'int') {
        this.emit(`int ${v.name}Val = ${v.name} != null ? Integer.parseInt(${v.name}.toString()) : 0;`);
      } else if (v.type === 'num') {
        this.emit(`double ${v.name}Val = ${v.name} != null ? Double.parseDouble(${v.name}.toString()) : 0.0;`);
      } else if (v.type === 'bool') {
        this.emit(`boolean ${v.name}Val = "true".equalsIgnoreCase(String.valueOf(${v.name}));`);
      }
    }
    this.emitRaw('');
  }

  // ===== Every (scheduled) =====

  visitEvery(node) {
    this.addImport('java.util.Timer');
    this.addImport('java.util.TimerTask');
    const interval = this.expr(node.interval);

    this.emit(`new Timer().scheduleAtFixedRate(new TimerTask() {`);
    this.indent++;
    this.emit(`@Override`);
    this.emit(`public void run() {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.indent--;
    this.emit(`}, 0, ${interval});  // interval in ms`);
    this.emitRaw('');
  }

  visitWatch(node) {
    const params = node.params.length > 0 ? node.params.join(', ') : 'event';
    this.emit(`// watch "${node.eventName}"`);
    this.emit(`/* event watcher */ {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Queue =====

  visitQueue(node) {
    this.addImport('java.util.concurrent.ExecutorService');
    this.addImport('java.util.concurrent.Executors');
    this.emit(`ExecutorService ${node.name} = Executors.newFixedThreadPool(4);`);
    for (const job of node.jobs) {
      const jobName = this.generateString(job.name);
      this.emit(`// Job: ${jobName}`);
    }
    this.emitRaw('');
  }

  // ===== Prompt =====

  visitPrompt(node) {
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : lines.join(' + "\\n" + ');
    this.emit(`// Prompt template: ${node.name}`);
    this.emit(`public static String ${node.name}(Map<String, String> vars) {`);
    this.indent++;
    this.addImport('java.util.Map');
    this.emit(`String template = ${template};`);
    this.emit(`for (var entry : vars.entrySet()) {`);
    this.indent++;
    this.emit(`template = template.replace("{" + entry.getKey() + "}", entry.getValue());`);
    this.indent--;
    this.emit('}');
    this.emit('return template;');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== OpenAPI =====

  visitOpenapi(node) {
    this.emit('// TODO: OpenAPI spec generation - use springdoc-openapi');
  }

  // ===== Page =====

  visitPage(node) {
    const filename = this.rawString(node.filename);
    this.addImport('java.io.FileWriter');
    this.addImport('java.io.IOException');

    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`try (FileWriter __fw = new FileWriter("${filename}")) {`);
    this.indent++;
    this.emit(`__fw.write("<!DOCTYPE html>\\n<html lang=\\"en\\">\\n<head>\\n");`);
    this.emit(`__fw.write("<meta charset=\\"UTF-8\\">\\n");`);
    this.emit(`__fw.write("<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1.0\\">\\n");`);
    this.emit(`__fw.write("<title>${pageTitle}</title>\\n");`);
    for (const h of headParts) {
      this.emit(`__fw.write("${this.escapeJavaString(h)}\\n");`);
    }
    this.emit(`__fw.write("</head>\\n<body>\\n");`);
    for (const b of bodyParts) {
      this.emit(`__fw.write("${this.escapeJavaString(b)}\\n");`);
    }
    this.emit(`__fw.write("</body>\\n</html>\\n");`);
    this.indent--;
    this.emit('} catch (IOException e) { e.printStackTrace(); }');
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

  escapeJavaString(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // ===== CLI App =====

  visitCli(node) {
    const desc = node.description ? this.rawString(node.description) : node.name;
    this.addImport('java.util.HashMap');

    this.emit(`var __cliArgs = new HashMap<String, String>();`);
    this.emit(`// CLI: ${desc}`);
    this.emit(`for (int __i = 0; __i < args.length; __i++) {`);
    this.indent++;
    for (const arg of node.args) {
      const argName = this.rawString(arg.name);
      this.emit(`if ("--${argName}".equals(args[__i]) && __i + 1 < args.length) { __cliArgs.put("${argName}", args[++__i]); continue; }`);
    }
    for (const flag of node.flags) {
      const s = this.rawString(flag.short);
      const l = this.rawString(flag.long);
      this.emit(`if ("-${s}".equals(args[__i]) || "--${l}".equals(args[__i])) { __cliArgs.put("${l}", "true"); continue; }`);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    if (node.run) {
      for (const stmt of node.run.body) this.visitStatement(stmt);
    }
    this.emitRaw('');
  }

  // ===== Mail =====

  visitMail(node) {
    this.addImport('java.util.Properties');
    this.addImport('javax.mail.*');
    this.addImport('javax.mail.internet.*');

    const host = this.generateString(node.host);
    const port = this.expr(node.port);
    const user = node.user ? this.expr(node.user) : 'System.getenv("MAIL_USER")';
    const pass = node.pass ? this.expr(node.pass) : 'System.getenv("MAIL_PASS")';

    this.emit(`// Mail configuration`);
    this.emit(`Properties __mailProps = new Properties();`);
    this.emit(`__mailProps.put("mail.smtp.host", ${host});`);
    this.emit(`__mailProps.put("mail.smtp.port", String.valueOf(${port}));`);
    this.emit(`__mailProps.put("mail.smtp.auth", "true");`);
    this.emit(`__mailProps.put("mail.smtp.starttls.enable", "true");`);
    this.emitRaw('');
  }

  // ===== Desktop =====

  visitDesktop(node) {
    const title = node.title ? this.rawString(node.title) : node.name;
    const width = node.width ? this.expr(node.width) : '800';
    const height = node.height ? this.expr(node.height) : '600';

    this.addImport('javax.swing.*');

    this.emit(`JFrame ${node.name} = new JFrame("${title}");`);
    this.emit(`${node.name}.setSize(${width}, ${height});`);
    this.emit(`${node.name}.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);`);
    this.emit(`${node.name}.setVisible(true);`);
    this.emitRaw('');
  }

  // ===== Screen =====

  visitScreen(node) {
    this.addImport('javax.swing.*');
    this.addImport('java.awt.*');

    this.emit(`// Screen: ${node.name} (Swing)`);
    this.emit(`JPanel ${node.name}Panel = new JPanel();`);
    this.emit(`${node.name}Panel.setLayout(new BoxLayout(${node.name}Panel, BoxLayout.Y_AXIS));`);

    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
      if (tag === 'text') {
        this.emit(`${node.name}Panel.add(new JLabel("${arg0}"));`);
      } else if (tag === 'button') {
        this.emit(`${node.name}Panel.add(new JButton("${arg0}"));`);
      } else if (tag === 'input') {
        this.emit(`${node.name}Panel.add(new JTextField("${arg0}", 20));`);
      } else {
        this.emit(`${node.name}Panel.add(new JLabel("${arg0}"));`);
      }
    }
    this.emitRaw('');
  }

  // ===== Domain-specific stubs =====

  visitOauth(node) {
    const provider = this.rawString(node.provider);
    const clientId = this.expr(node.clientId);
    const clientSecret = this.expr(node.clientSecret);
    this.emit(`// TODO: OAuth (${provider}) - use Spring Security OAuth2 or ScribeJava`);
    this.emit(`// Client ID: ${clientId}`);
    this.emit(`// Client Secret: ${clientSecret}`);
    this.emitRaw('');
  }

  visitPay(node) {
    const provider = this.rawString(node.provider);
    const secretKey = this.expr(node.secretKey);
    this.emit(`// TODO: Payment (${provider}) - use Stripe Java SDK (com.stripe:stripe-java)`);
    this.emit(`// Secret Key: ${secretKey}`);
    this.emitRaw('');
  }

  visitStorage(node) {
    const provider = this.rawString(node.provider);
    const bucket = this.expr(node.bucket);
    if (provider === 's3') {
      this.emit(`// TODO: S3 Storage - use AWS SDK for Java (software.amazon.awssdk:s3)`);
    } else if (provider === 'gcs') {
      this.emit(`// TODO: GCS Storage - use Google Cloud Storage SDK`);
    } else {
      this.emit(`// TODO: ${provider} Storage`);
    }
    this.emit(`// Bucket: ${bucket}`);
    this.emitRaw('');
  }

  visitPdf(node) {
    const filename = this.rawString(node.filename);
    this.emit(`// TODO: PDF generation (${filename}) - use Apache PDFBox or iText`);
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
      this.emit(`// PDF element: ${tag} "${arg0}"`);
    }
    this.emitRaw('');
  }

  visitI18n(node) {
    const dir = this.rawString(node.dir);
    const defaultLang = node.defaultLang ? this.rawString(node.defaultLang) : 'en';
    this.addImport('java.util.Locale');
    this.addImport('java.util.ResourceBundle');
    this.emit(`// i18n: default=${defaultLang}, dir=${dir}`);
    this.emit(`Locale __locale = Locale.forLanguageTag("${defaultLang}");`);
    this.emit(`// ResourceBundle __bundle = ResourceBundle.getBundle("messages", __locale);`);
    this.emitRaw('');
  }

  visitPush(node) {
    this.emit('// TODO: Push notifications - use Firebase Admin SDK for Java');
    this.emitRaw('');
  }

  visitSearch(node) {
    const engine = this.rawString(node.engine);
    this.emit(`// TODO: Search (${engine}) - use ${engine === 'meilisearch' ? 'Meilisearch Java SDK' : 'Elasticsearch Java client'}`);
    this.emitRaw('');
  }

  visitImage(node) {
    const input = this.expr(node.input);
    const output = node.output ? this.expr(node.output) : input;
    this.addImport('javax.imageio.ImageIO');
    this.addImport('java.awt.image.BufferedImage');
    this.addImport('java.io.File');

    this.emit(`BufferedImage __img = ImageIO.read(new File(${input}));`);
    for (const op of node.operations) {
      if (op.op === 'resize') {
        const w = op.args[0] || 800;
        const h = op.args[1] || 600;
        this.emit(`BufferedImage __resized = new BufferedImage(${w}, ${h}, __img.getType());`);
        this.emit(`__resized.getGraphics().drawImage(__img, 0, 0, ${w}, ${h}, null);`);
        this.emit(`__img = __resized;`);
      } else if (op.op === 'grayscale' || op.op === 'greyscale') {
        this.addImport('java.awt.color.ColorSpace');
        this.addImport('java.awt.image.ColorConvertOp');
        this.emit(`__img = new ColorConvertOp(ColorSpace.getInstance(ColorSpace.CS_GRAY), null).filter(__img, null);`);
      } else {
        this.emit(`// TODO: Image op "${op.op}" - use Java2D or ImageIO`);
      }
    }
    this.emit(`ImageIO.write(__img, "png", new File(${output}));`);
    this.emit(`System.out.println("Processed: " + ${output});`);
    this.emitRaw('');
  }

  visitCsv(node) {
    const name = this.rawString(node.name);
    const format = node.format ? this.rawString(node.format) : 'csv';
    const output = node.output ? this.rawString(node.output) : `${name}.${format}`;
    this.addImport('java.io.FileWriter');

    if (format === 'xlsx' || format === 'excel') {
      this.emit(`// TODO: Excel export (${output}) - use Apache POI`);
    } else {
      this.emit(`// CSV export: ${output}`);
      this.emit(`try (FileWriter __csvWriter = new FileWriter("${output}")) {`);
      this.indent++;
      const columns = node.columns.map(c => this.rawString(c));
      if (columns.length > 0) {
        this.emit(`__csvWriter.write("${columns.join(',')}" + "\\n");`);
      }
      this.emit(`// TODO: Write data rows`);
      this.indent--;
      this.emit('} catch (IOException e) { e.printStackTrace(); }');
    }
    this.emit(`System.out.println("Exported: ${output}");`);
    this.emitRaw('');
  }

  visitLogging(node) {
    this.addImport('java.util.logging.Logger');
    this.addImport('java.util.logging.Level');
    const name = this.rawString(node.name);
    const level = node.level ? this.rawString(node.level).toUpperCase() : 'INFO';
    this.emit(`Logger logger = Logger.getLogger("${name}");`);
    this.emit(`logger.setLevel(Level.${level});`);
    this.emitRaw('');
  }

  visitMigrate(node) {
    const name = this.rawString(node.name);
    this.emit(`// Migration: ${name}`);
    this.emit(`/* migrate up */ {`);
    this.indent++;
    for (const stmt of node.up) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emit(`/* migrate down */ {`);
    this.indent++;
    for (const stmt of node.down) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitGrpc(node) {
    const name = this.rawString(node.name);
    const port = node.port ? this.expr(node.port) : '50051';
    this.emit(`// TODO: gRPC server "${name}" on port ${port} - use io.grpc:grpc-java`);
    for (const rpc of node.rpcs) {
      this.emit(`// RPC: ${rpc.method}`);
    }
    this.emitRaw('');
  }

  visitWebrtc(node) {
    const name = this.rawString(node.name);
    this.emit(`// TODO: WebRTC signaling "${name}" - use Java-WebSocket for signaling server`);
    this.emitRaw('');
  }

  visitBlockchain(node) {
    const name = this.rawString(node.name);
    const provider = node.provider ? this.expr(node.provider) : '"http://localhost:8545"';
    this.emit(`// TODO: Blockchain "${name}" - use web3j (org.web3j:core)`);
    this.emit(`// Provider: ${provider}`);
    this.emitRaw('');
  }

  // ===== Expression Generation =====

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
        const op = node.op === 'not' ? '!' : node.op;
        return `${op}${this.expr(node.expr)}`;
      }

      case 'Await':
        // Java doesn't have await syntax; emit as-is for CompletableFuture
        return `${this.expr(node.expr)}`;

      case 'AwaitAllExpr': {
        this.addImport('java.util.concurrent.CompletableFuture');
        return `CompletableFuture.allOf(${this.expr(node.expr)}).join()`;
      }

      case 'Spread':
        // Java doesn't have spread; just use the array
        return this.expr(node.expr);

      case 'New':
        return `new ${this.expr(node.expr)}`;

      case 'TypeOf':
        return `${this.expr(node.expr)}.getClass().getSimpleName()`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

      case 'OptionalAccess':
        // Java doesn't have ?. — emit a null-safe pattern
        return `(${this.expr(node.object)} != null ? ${this.expr(node.object)}.${node.property} : null)`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array': {
        this.addImport('java.util.List');
        if (node.elements.length === 0) return 'new java.util.ArrayList<>()';
        return `java.util.List.of(${node.elements.map(e => this.expr(e)).join(', ')})`;
      }

      case 'Object': {
        this.addImport('java.util.Map');
        if (node.properties.length === 0) return 'new java.util.HashMap<>()';
        const entries = node.properties.map(p => {
          if (p.type === 'spread') return `/* spread: ${this.expr(p.value)} */`;
          if (p.type === 'shorthand') return `"${p.key}", ${p.key}`;
          const key = typeof p.key === 'string' ? `"${p.key}"` :
                      (p.key.type === 'String' ? this.generateString(p.key.value) : `"${this.expr(p.key)}"`);
          return `${key}, ${this.expr(p.value)}`;
        });
        if (entries.length <= 10) {
          return `Map.of(${entries.join(', ')})`;
        }
        return `Map.of(${entries.slice(0, 10).join(', ')})`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        if (node.params.length === 1) return `${params} -> ${body}`;
        return `(${params}) -> ${body}`;
      }

      case 'Lambda': {
        const params = node.params.map(p => p.name).join(', ');
        return `(${params}) -> { /* lambda body */ }`;
      }

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `/* expr:${node.type} */ null`;
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
      'not': '!',
      '>': '>',
      '<': '<',
      '>=': '>=',
      '<=': '<=',
      '+': '+',
      '-': '-',
      '*': '*',
      '/': '/',
      '%': '%',
      '**': 'Math.pow',
      'instanceof': 'instanceof',
      'in': '/* in */',
    };
    if (op === '**') return '/* ** */';
    return map[op] || op;
  }

  mapMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    // Map common JS properties to Java
    if (prop === 'length') return `${obj}.length`;
    if (prop === 'size') return `${obj}.size()`;
    if (prop === 'toString') return `String.valueOf(${obj})`;

    // console methods
    if (obj === 'console' && prop === 'log') return 'System.out.println';
    if (obj === 'console' && prop === 'error') return 'System.err.println';
    if (obj === 'console' && prop === 'warn') return 'System.err.println';

    // JSON
    if (obj === 'JSON' && prop === 'parse') return '/* JSON.parse */';
    if (obj === 'JSON' && prop === 'stringify') return '/* JSON.stringify */';

    // Math
    if (obj === 'Math') return `Math.${prop}`;

    // Object static
    if (obj === 'Object' && prop === 'keys') return '/* Object.keys */';
    if (obj === 'Object' && prop === 'values') return '/* Object.values */';
    if (obj === 'Object' && prop === 'entries') return '/* Object.entries */';

    // Array static
    if (obj === 'Array' && prop === 'isArray') return '/* Array.isArray */';

    // Date
    if (obj === 'Date' && prop === 'now') return 'System.currentTimeMillis';

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

      if (name === 'parseInt') return `Integer.parseInt(${args})`;
      if (name === 'parseFloat') return `Double.parseDouble(${args})`;
      if (name === 'String') return `String.valueOf(${args})`;
      if (name === 'Number') return `Double.valueOf(${args})`;
      if (name === 'Boolean') return `Boolean.valueOf(${args})`;
      if (name === 'isNaN') return `Double.isNaN(${args})`;
      if (name === 'setTimeout') return `/* setTimeout - use Timer */ null`;
      if (name === 'setInterval') return `/* setInterval - use Timer */ null`;
    }

    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // Array/list methods
      if (prop === 'push') return `${obj}.add(${args})`;
      if (prop === 'pop') return `${obj}.remove(${obj}.size() - 1)`;
      if (prop === 'shift') return `${obj}.remove(0)`;
      if (prop === 'indexOf') return `${obj}.indexOf(${args})`;
      if (prop === 'includes' || prop === 'contains') return `${obj}.contains(${args})`;
      if (prop === 'join') return `String.join(${args}, ${obj})`;
      if (prop === 'forEach') return `${obj}.forEach(${args})`;
      if (prop === 'map') {
        this.addImport('java.util.stream.Collectors');
        return `${obj}.stream().map(${args}).collect(Collectors.toList())`;
      }
      if (prop === 'filter') {
        this.addImport('java.util.stream.Collectors');
        return `${obj}.stream().filter(${args}).collect(Collectors.toList())`;
      }
      if (prop === 'find') return `${obj}.stream().filter(${args}).findFirst().orElse(null)`;
      if (prop === 'some') return `${obj}.stream().anyMatch(${args})`;
      if (prop === 'every') return `${obj}.stream().allMatch(${args})`;
      if (prop === 'reduce') return `${obj}.stream().reduce(${args})`;
      if (prop === 'sort') {
        this.addImport('java.util.Collections');
        return `Collections.sort(${obj})`;
      }
      if (prop === 'reverse') {
        this.addImport('java.util.Collections');
        return `Collections.reverse(${obj})`;
      }
      if (prop === 'flat') return `${obj}.stream().flatMap(java.util.Collection::stream).collect(java.util.stream.Collectors.toList())`;
      if (prop === 'concat') {
        this.addImport('java.util.stream.Stream');
        return `Stream.concat(${obj}.stream(), ${args}.stream()).collect(java.util.stream.Collectors.toList())`;
      }

      // String methods
      if (prop === 'split') return `${obj}.split(${args})`;
      if (prop === 'trim') return `${obj}.trim()`;
      if (prop === 'toUpperCase') return `${obj}.toUpperCase()`;
      if (prop === 'toLowerCase') return `${obj}.toLowerCase()`;
      if (prop === 'startsWith') return `${obj}.startsWith(${args})`;
      if (prop === 'endsWith') return `${obj}.endsWith(${args})`;
      if (prop === 'replace') return `${obj}.replace(${args})`;
      if (prop === 'replaceAll') return `${obj}.replaceAll(${args})`;
      if (prop === 'charAt') return `${obj}.charAt(${args})`;
      if (prop === 'substring') return `${obj}.substring(${args})`;
      if (prop === 'repeat') return `${obj}.repeat(${args})`;
      if (prop === 'padStart') return `String.format("%" + ${args} + "s", ${obj})`;
      if (prop === 'padEnd') return `String.format("%-" + ${args} + "s", ${obj})`;

      // Object methods
      if (obj === 'Object' && prop === 'keys') return `new java.util.ArrayList<>(((Map<?, ?>) ${args}).keySet())`;
      if (obj === 'Object' && prop === 'values') return `new java.util.ArrayList<>(((Map<?, ?>) ${args}).values())`;
      if (obj === 'Object' && prop === 'entries') return `new java.util.ArrayList<>(((Map<?, ?>) ${args}).entrySet())`;

      // Promise
      if (obj === 'Promise' && prop === 'all') {
        this.addImport('java.util.concurrent.CompletableFuture');
        return `CompletableFuture.allOf(${args})`;
      }
      if (obj === 'Promise' && prop === 'resolve') return `CompletableFuture.completedFuture(${args})`;

      // Date
      if (obj === 'Date' && prop === 'now') return 'System.currentTimeMillis()';

      // console
      if (obj === 'console' && prop === 'log') return `System.out.println(${args})`;
      if (obj === 'console' && prop === 'error') return `System.err.println(${args})`;
      if (obj === 'console' && prop === 'warn') return `System.err.println(${args})`;
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

    // Use String.format for interpolation
    let formatStr = '';
    const formatArgs = [];

    for (const part of strData.parts) {
      if (part.type === 'text') {
        formatStr += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
      } else {
        formatStr += '%s';
        const exprCode = part.value.replace(/\bself\b/g, 'this');
        formatArgs.push(exprCode);
      }
    }

    if (formatArgs.length === 0) {
      return `"${formatStr}"`;
    }
    return `String.format("${formatStr}", ${formatArgs.join(', ')})`;
  }

  rawString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
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

    const STREAM_METHODS = new Set(['filter', 'map', 'reduce', 'find', 'some', 'every', 'sort', 'reverse', 'join']);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier') {
        const name = step.callee.name;
        const args = step.args.map(a => this.expr(a)).join(', ');

        if (name === 'filter') {
          this.addImport('java.util.stream.Collectors');
          result = `${result}.stream().filter(${args}).collect(Collectors.toList())`;
        } else if (name === 'map') {
          this.addImport('java.util.stream.Collectors');
          result = `${result}.stream().map(${args}).collect(Collectors.toList())`;
        } else if (name === 'reduce') {
          result = `${result}.stream().reduce(${args})`;
        } else if (name === 'sort') {
          result = `${result}.stream().sorted().collect(java.util.stream.Collectors.toList())`;
        } else if (name === 'reverse') {
          this.addImport('java.util.Collections');
          result = `Collections.reverse(${result})`;
        } else if (name === 'join') {
          result = `String.join(${args}, ${result})`;
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
        result = `(${this.expr(step)}).apply(${result})`;
      }
    }
    return result;
  }

  // ===== Utilities =====

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
    this.emit(`enum ${node.name} {`);
    this.indent++;
    this.emit(node.values.join(', ') + ';');
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
  }

  visitSwap(node) {
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    this.emit(`{ var _tmp = ${a}; ${a} = ${b}; ${b} = _tmp; }`);
  }

  generateBuiltin(name, args) {
    switch (name) {
      case 'len': return `${args[0]}.size()`;
      case 'sort': return `${args[0]}.stream().sorted().collect(java.util.stream.Collectors.toList())`;
      case 'reverse': return `{ var _l = new java.util.ArrayList<>(${args[0]}); java.util.Collections.reverse(_l); return _l; }`;
      case 'contains': return `${args[0]}.contains(${args[1]})`;
      case 'keys': return `new java.util.ArrayList<>(${args[0]}.keySet())`;
      case 'values': return `new java.util.ArrayList<>(${args[0]}.values())`;
      case 'entries': return `new java.util.ArrayList<>(${args[0]}.entrySet())`;
      case 'abs': return `Math.abs(${args[0]})`;
      case 'sqrt': return `Math.sqrt(${args[0]})`;
      case 'pow': return `Math.pow(${args[0]}, ${args[1]})`;
      case 'ceil': return `Math.ceil(${args[0]})`;
      case 'floor': return `Math.floor(${args[0]})`;
      case 'round': return `Math.round(${args[0]})`;
      case 'random': return args.length >= 2 ? `new java.util.Random().nextInt(${args[1]} - ${args[0]} + 1) + ${args[0]}` : `Math.random()`;
      case 'str': return `String.valueOf(${args[0]})`;
      case 'int': return `Integer.parseInt(${args[0]})`;
      case 'float': return `Double.parseDouble(${args[0]})`;
      case 'upper': return `${args[0]}.toUpperCase()`;
      case 'lower': return `${args[0]}.toLowerCase()`;
      case 'trim': return `${args[0]}.trim()`;
      case 'split': return `java.util.Arrays.asList(${args[0]}.split(${args[1] || '","'}))`;
      case 'join': return `String.join(${args[1] || '","'}, ${args[0]})`;
      case 'replace': return `${args[0]}.replace(${args[1]}, ${args[2]})`;
      case 'sum': return `${args[0]}.stream().mapToInt(Integer::intValue).sum()`;
      case 'unique': return `new java.util.ArrayList<>(new java.util.LinkedHashSet<>(${args[0]}))`;
      case 'exit': return `System.exit(${args[0] || '0'})`;
      case 'sleep': return `Thread.sleep(${args[0]})`;
      case 'now': return `System.currentTimeMillis()`;
      case 'time': return `java.time.LocalDateTime.now().toString()`;
      case 'json_parse': return `new com.google.gson.Gson().fromJson(${args[0]}, Object.class)`;
      case 'json_str': return `new com.google.gson.Gson().toJson(${args[0]})`;
      case 'range': return args.length >= 2 ? `java.util.stream.IntStream.range(${args[0]}, ${args[1]}).boxed().collect(java.util.stream.Collectors.toList())` : `java.util.stream.IntStream.range(0, ${args[0]}).boxed().collect(java.util.stream.Collectors.toList())`;
      default: return null;
    }
  }
}
