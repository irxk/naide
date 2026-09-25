export class CppGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.includes = new Set();
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.inFunction = false;
    this.preamble = [];
    this.classDefs = [];
    this.functionDefs = [];
    this.mainBody = [];
  }

  generate(ast) {
    this.includes.add('<iostream>');

    this.visitProgram(ast);

    const out = [];

    // Preamble: #includes
    for (const inc of [...this.includes].sort()) {
      out.push(`#include ${inc}`);
    }
    out.push('');
    out.push('using namespace std;');
    out.push('');

    // Class / struct definitions
    if (this.classDefs.length > 0) {
      out.push(...this.classDefs);
      out.push('');
    }

    // Function definitions
    if (this.functionDefs.length > 0) {
      out.push(...this.functionDefs);
      out.push('');
    }

    // Main function wrapping top-level statements
    if (this.mainBody.length > 0) {
      out.push('int main() {');
      out.push(...this.mainBody);
      out.push('    return 0;');
      out.push('}');
    }

    return out.join('\n');
  }

  emit(line) {
    const indented = '    '.repeat(this.indent) + line;
    if (this.inFunction) {
      this.functionDefs.push(indented);
    } else {
      this.mainBody.push(indented);
    }
    this.sourceMap.push(this.currentSourceLine);
  }

  emitRaw(line) {
    if (this.inFunction) {
      this.functionDefs.push(line);
    } else {
      this.mainBody.push(line);
    }
    this.sourceMap.push(this.currentSourceLine);
  }

  emitClass(line) {
    this.classDefs.push(line);
  }

  visitProgram(node) {
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
  }

  // ===== Type mapping =====

  mapType(naideType) {
    const map = {
      'str': 'string',
      'string': 'string',
      'int': 'int',
      'integer': 'int',
      'num': 'double',
      'number': 'double',
      'float': 'double',
      'bool': 'bool',
      'boolean': 'bool',
      'list': 'vector<any>',
      'map': 'map<string, any>',
      'any': 'any',
      'void': 'void',
      'json': 'string',
      'auto': 'int',
      'timestamp': 'long long',
    };
    return map[naideType] || 'auto';
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
      case 'Break': this.emit('break;'); return;
      case 'Continue': this.emit('continue;'); return;
      case 'Assignment': return this.visitAssignment(node);
      case 'CompoundAssign': return this.visitCompoundAssign(node);
      case 'ExprStatement': this.emit(this.expr(node.expression) + ';'); return;
      case 'DbConnect': return this.visitDbConnect(node);
      case 'DbDir': return this.visitDbDir(node);
      case 'DbSql': return this.visitDbSql(node);
      case 'AwaitAll': return this.visitAwaitAll(node);
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
      case 'Destructure': return this.visitDestructure(node);
      case 'ClassDecl': return this.visitClassDecl(node);
      default:
        this.emit(`/* unknown: ${node.type} */`);
    }
  }

  // ===== Imports / Use =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    this.emit(`/* use ${raw} */`);
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const names = node.names.map(n => n.name).join(', ');
    this.emit(`/* use { ${names} } from ${raw} */`);
  }

  // ===== Functions =====

  visitFunction(node) {
    const retType = node.returnType ? this.mapType(node.returnType) : 'auto';
    const params = node.params.map(p => {
      const type = p.type ? this.mapType(p.type) : 'auto';
      let s = '';
      if (p.spread) s += '/* variadic */ ';
      s += `${type} ${p.name}`;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    const savedInFunction = this.inFunction;
    this.inFunction = true;

    // Use void if no return type and function doesn't return values
    const actualRetType = retType === 'auto' ? 'void' : retType;
    this.emit(`${actualRetType} ${node.name}(${params}) {`);
    this.indent++;
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    this.inFunction = savedInFunction;
  }

  visitReturn(node) {
    if (node.value === null) {
      this.emit('return;');
    } else {
      this.emit(`return ${this.expr(node.value)};`);
    }
  }

  visitReturnStatus(node) {
    this.emit(`/* return status ${this.expr(node.statusCode)} */`);
    this.includes.add('<iostream>');
    this.emit(`cout << ${this.expr(node.body)} << endl;`);
  }

  visitReturnMethod(node) {
    this.emit(`/* return ${node.method}: ${this.expr(node.value)} */`);
  }

  // ===== Variables =====

  visitTypedVar(node) {
    const type = node.varType ? this.mapType(node.varType) : 'auto';
    this.emit(`${type} ${node.name} = ${this.expr(node.value)};`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);
    if (node.target.type === 'Array') {
      // C++17 structured bindings
      const names = node.target.elements.map(e => this.expr(e)).join(', ');
      this.emit(`auto [${names}] = ${value};`);
    } else if (node.target.type === 'Object') {
      // No direct object destructuring in C++
      this.emit(`/* object destructuring */`);
      this.emit(`auto __d = ${value};`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`auto ${varName} = __d["${key}"];`);
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
      this.emit(`/* key-value iteration */`);
      this.emit(`for (auto& [${node.key}, ${node.value}] : ${collection}) {`);
    } else {
      this.emit(`for (auto& ${node.value} : ${collection}) {`);
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
    this.includes.add('<stdexcept>');
    this.emit('try {');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    if (node.catchBody) {
      const catchParam = node.catchVar || 'e';
      this.emit(`} catch (const exception& ${catchParam}) {`);
      this.indent++;
      for (const stmt of node.catchBody) this.visitStatement(stmt);
      this.indent--;
    }
    if (node.ensureBody) {
      // C++ has no finally; use RAII or scope guard pattern
      this.emit('} /* finally */ {');
      this.indent++;
      for (const stmt of node.ensureBody) this.visitStatement(stmt);
      this.indent--;
    }
    this.emit('}');
  }

  // ===== Model (class) =====

  visitModel(node) {
    this.models.set(node.name, node);

    const ext = node.parent ? ` : public ${node.parent}` : '';
    let classDef = `class ${node.name}${ext} {\npublic:\n`;

    // Fields
    for (const f of node.fields) {
      const type = f.type ? this.mapType(f.type) : 'auto';
      classDef += `    ${type} ${f.name};\n`;
    }

    // Constructor
    if (node.fields.length > 0 || node.parent) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const ctorParams = allFields.map(f => {
        const type = f.type ? this.mapType(f.type) : 'auto';
        if (f.defaultValue) return `${type} ${f.name} = ${this.expr(f.defaultValue)}`;
        return `${type} ${f.name}`;
      }).join(', ');

      classDef += `\n    ${node.name}(${ctorParams})`;
      if (node.parent) {
        const superArgs = parentFields.map(f => f.name).join(', ');
        classDef += ` : ${node.parent}(${superArgs})`;
        if (node.fields.length > 0) {
          classDef += ', ' + node.fields.map(f => `${f.name}(${f.name})`).join(', ');
        }
      } else if (node.fields.length > 0) {
        classDef += ' : ' + node.fields.map(f => `${f.name}(${f.name})`).join(', ');
      }
      classDef += ' {}\n';
    }

    // Methods
    for (const method of node.methods) {
      const retType = method.returnType ? this.mapType(method.returnType) : 'void';
      const params = method.params.map(p => {
        const type = p.type ? this.mapType(p.type) : 'auto';
        let s = `${type} ${p.name}`;
        if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      classDef += `\n    ${retType} ${method.name}(${params}) {\n`;
      // Generate method body
      const bodyLines = this.generateBodyLines(method.body);
      for (const line of bodyLines) {
        classDef += `        ${line}\n`;
      }
      classDef += '    }\n';
    }

    classDef += '};';
    this.emitClass(classDef);
    this.emitClass('');
  }

  generateBodyLines(body) {
    const savedInFunction = this.inFunction;
    const savedFunctions = this.functionDefs;
    const savedMain = this.mainBody;
    const savedIndent = this.indent;
    this.functionDefs = [];
    this.mainBody = [];
    this.indent = 0;
    this.inFunction = false;
    for (const stmt of body) this.visitStatement(stmt);
    const lines = this.mainBody.map(l => l.trim());
    this.functionDefs = savedFunctions;
    this.mainBody = savedMain;
    this.indent = savedIndent;
    this.inFunction = savedInFunction;
    return lines;
  }

  // ===== Log =====

  visitLog(node) {
    this.includes.add('<iostream>');
    const args = node.args.map(a => this.expr(a));
    if (args.length === 1) {
      this.emit(`cout << ${args[0]} << endl;`);
    } else {
      const chain = args.join(' << " " << ');
      this.emit(`cout << ${chain} << endl;`);
    }
  }

  visitThrow(node) {
    this.includes.add('<stdexcept>');
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw runtime_error(${value});`);
    } else {
      this.emit(`throw ${value};`);
    }
  }

  // ===== Events =====

  visitOn(node) {
    this.emit(`/* on event: ${this.expr(node.event)} */`);
    this.emit(`/* C++ has no built-in event system - use std::function callbacks or signals2 */`);
  }

  // ===== Server =====

  visitServer(node) {
    this.emit('/* HTTP server: use cpp-httplib or Crow */');
    this.emit(`/* server "${node.name}" */`);
    const port = node.port ? this.expr(node.port) : '3000';
    this.emit(`/* port: ${port} */`);

    for (const child of node.routes) {
      if (child.type === 'Route') {
        const method = child.method.toUpperCase();
        const path = this.rawString(child.path);
        this.emit(`/* ${method} ${path} */`);
        this.emit(`/* { */`);
        this.indent++;
        for (const stmt of child.body) this.visitStatement(stmt);
        this.indent--;
        this.emit(`/* } */`);
        this.emitRaw('');
      } else {
        this.visitStatement(child);
      }
    }

    this.emit(`cout << "Server ${node.name} would run on port ${port}" << endl;`);
    this.emitRaw('');
  }

  // ===== Bot =====

  visitBot(node) {
    this.emit('/* Bot: use D++ (DPP) for Discord, or libcurl for API-based bots */');
    this.emit(`/* TODO: bot "${node.name}" */`);
    this.emitRaw('');
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.emit(`/* db connect: ${this.expr(node.connectionString)} */`);
    this.emit('/* TODO: use libpqxx (PostgreSQL), sqlite3 C++ wrapper, or SOCI */');
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`/* db dir: ${raw} */`);
  }

  visitDbSql(node) {
    this.emit('/* db sql: use SQLite C++ wrapper or SOCI */');
    this.emit('/* #include <sqlite3.h> */');
  }

  visitAwaitAll(node) {
    this.includes.add('<future>');
    this.emit('/* async: use std::async and std::future */');
    for (const e of node.expressions) {
      this.emit(`auto __f = std::async(std::launch::async, [&]() { return ${this.expr(e)}; });`);
    }
  }

  // ===== Domain features (comment stubs) =====

  visitSchema(node) {
    this.schemas.set(node.name, node);
    let classDef = `struct ${node.name} {\n`;
    for (const f of node.fields) {
      const type = this.mapType(f.type);
      classDef += `    ${type} ${f.name};\n`;
    }
    classDef += '};';
    this.emitClass(classDef);
    this.emitClass('');
  }

  visitCrud(node) {
    this.emit(`/* TODO: CRUD for "${node.schemaName}" - use cpp-httplib or Crow */`);
  }

  visitAuth(node) {
    this.emit('/* TODO: auth - use jwt-cpp library */');
  }

  visitCors(node) {
    this.emit('/* TODO: CORS - set headers in HTTP response */');
  }

  visitLimit(node) {
    this.emit('/* TODO: rate limiting - implement with token bucket algorithm */');
  }

  visitEnv(node) {
    this.includes.add('<cstdlib>');
    for (const v of node.vars) {
      this.includes.add('<string>');
      this.emit(`const char* __${v.name}_raw = getenv("${v.name}");`);
      if (v.type === 'int') {
        this.emit(`int ${v.name} = __${v.name}_raw ? atoi(__${v.name}_raw) : 0;`);
      } else if (v.type === 'num') {
        this.emit(`double ${v.name} = __${v.name}_raw ? atof(__${v.name}_raw) : 0.0;`);
      } else if (v.type === 'bool') {
        this.includes.add('<cstring>');
        this.emit(`bool ${v.name} = __${v.name}_raw ? (strcmp(__${v.name}_raw, "true") == 0 || strcmp(__${v.name}_raw, "1") == 0) : false;`);
      } else {
        this.emit(`string ${v.name} = __${v.name}_raw ? string(__${v.name}_raw) : "";`);
      }
    }
    this.emitRaw('');
  }

  visitEvery(node) {
    this.emit('/* TODO: scheduled task - use std::thread + std::chrono::sleep_for */');
    this.includes.add('<thread>');
    this.includes.add('<chrono>');
  }

  visitWatch(node) {
    this.emit(`/* TODO: watch event "${node.eventName}" - use std::function callback pattern */`);
  }

  visitStatic(node) {
    this.emit('/* TODO: static files - use cpp-httplib to serve files */');
  }

  visitWs(node) {
    this.emit('/* TODO: WebSocket - use websocketpp or Boost.Beast */');
  }

  visitGroup(node) {
    this.emit('/* TODO: route group - implement with HTTP library */');
  }

  visitErrorHandler(node) {
    this.emit('/* TODO: error handler - use try/catch */');
  }

  visitCookie(node) {
    this.emit('/* TODO: cookies - set via HTTP headers */');
  }

  visitUpload(node) {
    this.emit('/* TODO: file upload - use multipart form parser */');
  }

  visitSession(node) {
    this.emit('/* TODO: sessions - use std::unordered_map for session storage */');
  }

  visitView(node) {
    this.emit('/* TODO: view engine - use inja (Jinja2-like C++ template engine) */');
  }

  visitSse(node) {
    this.emit('/* TODO: Server-Sent Events - use chunked HTTP response */');
  }

  visitCache(node) {
    this.emit('/* TODO: caching - use std::unordered_map with TTL */');
  }

  visitMiddlewareRef(node) {
    this.emit(`/* TODO: middleware "${node.name}" */`);
  }

  visitReturnRender(node) {
    this.emit(`/* TODO: render template ${this.expr(node.template)} */`);
  }

  visitValidate(node) {
    this.emit('/* TODO: validation - implement manually */');
  }

  visitTest(node) {
    this.includes.add('<cassert>');
    const name = this.rawString(node.name);
    const funcName = `test_${name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const savedInFunction = this.inFunction;
    this.inFunction = true;

    this.emit(`void ${funcName}() {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    this.inFunction = savedInFunction;
  }

  visitAssert(node) {
    this.includes.add('<cassert>');
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`assert(${this.expr(exprNode.left)} == ${this.expr(exprNode.right)});`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`assert(${this.expr(exprNode.left)} != ${this.expr(exprNode.right)});`);
    } else {
      this.emit(`assert(${this.expr(exprNode)});`);
    }
  }

  visitQueue(node) {
    this.includes.add('<queue>');
    this.includes.add('<functional>');
    this.emit(`/* TODO: queue "${node.name}" - use std::queue + std::thread */`);
  }

  visitOpenapi(node) {
    this.emit('/* TODO: OpenAPI spec - generate JSON with nlohmann/json */');
  }

  visitReturnRedirect(node) {
    this.emit(`/* TODO: redirect to ${this.expr(node.url)} */`);
  }

  visitReturnDownload(node) {
    this.emit(`/* TODO: download file ${this.expr(node.filePath)} */`);
  }

  visitPrompt(node) {
    this.emit(`/* TODO: prompt template "${node.name}" - use string replacement */`);
  }

  visitPage(node) {
    this.includes.add('<fstream>');
    this.emit('/* TODO: page generation - use std::ofstream to write HTML */');
  }

  visitCli(node) {
    this.includes.add('<string>');
    this.includes.add('<cstring>');
    this.emit('/* CLI argument parsing */');
    this.emit('/* argc and argv available in main() */');

    for (const arg of node.args) {
      const argName = this.rawString(arg.name);
      this.emit(`/* --${argName}: ${arg.type} */`);
    }
    for (const flag of node.flags) {
      const s = this.rawString(flag.short);
      const l = this.rawString(flag.long);
      this.emit(`/* -${s}, --${l} */`);
    }
  }

  visitMail(node) {
    this.emit('/* TODO: mail - use cpp-netlib or libcurl for SMTP */');
  }

  visitDesktop(node) {
    this.emit(`/* TODO: desktop app "${node.name}" - use Qt, wxWidgets, or SDL2 */`);
  }

  visitScreen(node) {
    this.emit(`/* TODO: mobile screen "${node.name}" - not directly applicable in C++ */`);
  }

  visitOauth(node) {
    this.emit('/* TODO: OAuth - use libcurl for HTTP + jwt-cpp */');
  }

  visitPay(node) {
    this.emit('/* TODO: payment - use libcurl for Stripe REST API */');
  }

  visitStorage(node) {
    this.emit('/* TODO: cloud storage - use AWS SDK for C++ */');
  }

  visitPdf(node) {
    this.emit('/* TODO: PDF generation - use libharu or PoDoFo */');
  }

  visitI18n(node) {
    this.emit('/* TODO: i18n - use gettext or std::map-based lookup */');
  }

  visitPush(node) {
    this.emit('/* TODO: push notifications - use libcurl for web push API */');
  }

  visitSearch(node) {
    this.emit('/* TODO: search - use libcurl for Elasticsearch/Meilisearch API */');
  }

  visitImage(node) {
    this.emit('/* TODO: image processing - use OpenCV or stb_image */');
  }

  visitCsv(node) {
    this.includes.add('<fstream>');
    this.includes.add('<sstream>');
    this.emit('/* TODO: CSV - use std::fstream for reading/writing */');
  }

  visitLogging(node) {
    this.emit('/* TODO: logging - use spdlog or custom logger */');
  }

  visitMigrate(node) {
    this.emit('/* TODO: DB migration - use sqlite3 C++ wrapper */');
  }

  visitGrpc(node) {
    this.emit('/* TODO: gRPC - use grpc++ (gRPC C++ library) */');
  }

  visitWebrtc(node) {
    this.emit('/* TODO: WebRTC - use libdatachannel or Google WebRTC C++ */');
  }

  visitBlockchain(node) {
    this.emit('/* TODO: blockchain - use libcurl for JSON-RPC or web3cpp */');
  }

  // ===== Expression generation =====

  expr(node) {
    if (!node) return 'nullptr';

    switch (node.type) {
      case 'Number': return node.value;

      case 'String': return this.generateString(node.value);

      case 'Bool': return node.value ? 'true' : 'false';

      case 'Null': return 'nullptr';

      case 'Self': return 'this';

      case 'Identifier': return this.mapIdentifier(node.name);

      case 'Binary': {
        const op = this.mapBinaryOp(node.op);
        const l = this.expr(node.left);
        const r = this.expr(node.right);
        const simple = node.left.type !== 'Binary' && node.right.type !== 'Binary';
        return simple ? `${l} ${op} ${r}` : `(${l} ${op} ${r})`;
      }

      case 'Unary':
        return `${this.mapUnaryOp(node.op)}${this.expr(node.expr)}`;

      case 'Await':
        // C++ uses futures
        return `/* co_await */ ${this.expr(node.expr)}`;

      case 'AwaitAllExpr':
        return `/* await all */ ${this.expr(node.expr)}`;

      case 'Spread':
        return `/* spread */ ${this.expr(node.expr)}`;

      case 'New':
        return `make_shared<${this.exprTypeName(node.expr)}>(${this.exprCallArgs(node.expr)})`;

      case 'TypeOf':
        this.includes.add('<typeinfo>');
        return `typeid(${this.expr(node.expr)}).name()`;

      case 'MemberAccess':
        return this.generateMemberAccess(node);

      case 'OptionalAccess':
        return `${this.expr(node.object)}.${node.property}`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array': {
        this.includes.add('<vector>');
        this.includes.add('<any>');
        const elems = node.elements.map(e => this.expr(e)).join(', ');
        return `vector<any>{${elems}}`;
      }

      case 'Object': {
        this.includes.add('<map>');
        this.includes.add('<string>');
        this.includes.add('<any>');
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `/* spread: ${this.expr(p.value)} */`;
          if (p.type === 'shorthand') return `{"${p.key}", ${p.key}}`;
          const key = typeof p.key === 'string' ? `"${p.key}"` :
                      (p.key.type === 'String' ? this.generateString(p.key.value) :
                       `"${this.expr(p.key)}"`);
          return `{${key}, ${this.expr(p.value)}}`;
        }).join(', ');
        return `map<string, any>{${props}}`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => `auto ${p.name}`).join(', ');
        const body = this.expr(node.body);
        return `[](${params}) { return ${body}; }`;
      }

      case 'Lambda': {
        const params = node.params.map(p => `auto ${p.name}`).join(', ');
        const bodyLines = this.generateBodyLines(node.body);
        return `[](${params}) { ${bodyLines.join(' ')} }`;
      }

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `/* expr:${node.type} */ nullptr`;
    }
  }

  exprTypeName(node) {
    if (node.type === 'Call') return this.expr(node.callee);
    return this.expr(node);
  }

  exprCallArgs(node) {
    if (node.type === 'Call') return node.args.map(a => this.expr(a)).join(', ');
    return '';
  }

  mapIdentifier(name) {
    const map = {
      'null': 'nullptr',
      'undefined': 'nullptr',
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
      '&&': '&&',
      '||': '||',
      'and': '&&',
      'or': '||',
    };
    return map[op] || op;
  }

  mapUnaryOp(op) {
    if (op === 'not' || op === '!') return '!';
    return op;
  }

  generateMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    // Map common patterns
    if (prop === 'length') {
      return `${obj}.size()`;
    }
    if (prop === 'toString') {
      this.includes.add('<string>');
      return `to_string(${obj})`;
    }

    // Console methods -> cout
    if (obj === 'console' && prop === 'log') {
      return '/* cout << */';
    }

    // Math methods
    if (obj === 'Math' && prop === 'PI') { this.includes.add('<cmath>'); return 'M_PI'; }
    if (obj === 'Math' && prop === 'E') { this.includes.add('<cmath>'); return 'M_E'; }

    // JSON
    if (obj === 'JSON' && prop === 'parse') return '/* JSON parse: use nlohmann/json */';
    if (obj === 'JSON' && prop === 'stringify') return '/* JSON stringify: use nlohmann/json */';

    return `${obj}.${prop}`;
  }

  generateCall(node) {
    const args = node.args.map(a => this.expr(a)).join(', ');

    if (node.callee.type === 'Identifier') {
      const argList = node.args.map(a => this.expr(a));
      const b = this.generateBuiltin(node.callee.name, argList);
      if (b) return b;

      const name = node.callee.name;
      if (name === 'parseInt') return `stoi(${args})`;
      if (name === 'parseFloat') return `stod(${args})`;
      if (name === 'String') { this.includes.add('<string>'); return `to_string(${args})`; }
      if (name === 'Number') return `stod(${args})`;
      if (name === 'Boolean') return `static_cast<bool>(${args})`;
    }

    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // Vector/list methods
      if (prop === 'push') return `${obj}.push_back(${args})`;
      if (prop === 'pop') return `${obj}.pop_back()`;
      if (prop === 'shift') { return `/* shift: erase front */ ${obj}.erase(${obj}.begin())`; }
      if (prop === 'unshift') { return `${obj}.insert(${obj}.begin(), ${args})`; }
      if (prop === 'includes') {
        this.includes.add('<algorithm>');
        return `(find(${obj}.begin(), ${obj}.end(), ${args}) != ${obj}.end())`;
      }
      if (prop === 'indexOf') {
        this.includes.add('<algorithm>');
        return `(find(${obj}.begin(), ${obj}.end(), ${args}) - ${obj}.begin())`;
      }
      if (prop === 'join') {
        this.includes.add('<sstream>');
        return `/* join: use ostringstream */ ""`;
      }
      if (prop === 'reverse') {
        this.includes.add('<algorithm>');
        return `reverse(${obj}.begin(), ${obj}.end())`;
      }
      if (prop === 'sort') {
        this.includes.add('<algorithm>');
        return `sort(${obj}.begin(), ${obj}.end())`;
      }
      if (prop === 'map') return `/* std::transform */ ${obj}`;
      if (prop === 'filter') return `/* std::copy_if */ ${obj}`;
      if (prop === 'forEach') return `/* for (auto& x : ${obj}) */ ${obj}`;
      if (prop === 'find') {
        this.includes.add('<algorithm>');
        return `*find_if(${obj}.begin(), ${obj}.end(), ${args})`;
      }
      if (prop === 'some') {
        this.includes.add('<algorithm>');
        return `any_of(${obj}.begin(), ${obj}.end(), ${args})`;
      }
      if (prop === 'every') {
        this.includes.add('<algorithm>');
        return `all_of(${obj}.begin(), ${obj}.end(), ${args})`;
      }
      if (prop === 'reduce') {
        this.includes.add('<numeric>');
        return `accumulate(${obj}.begin(), ${obj}.end(), 0, ${args})`;
      }
      if (prop === 'flat') return `/* flatten: manual */ ${obj}`;
      if (prop === 'concat') return `/* concat: insert */ ${obj}`;
      if (prop === 'slice') return `/* slice: use iterators */ ${obj}`;

      // String methods
      if (prop === 'split') return `/* split: use istringstream */ ${obj}`;
      if (prop === 'trim') return `/* trim: custom implementation */ ${obj}`;
      if (prop === 'trimStart') return `/* trimStart: custom implementation */ ${obj}`;
      if (prop === 'trimEnd') return `/* trimEnd: custom implementation */ ${obj}`;
      if (prop === 'toUpperCase') {
        this.includes.add('<algorithm>');
        this.includes.add('<cctype>');
        return `/* transform to upper */ ${obj}`;
      }
      if (prop === 'toLowerCase') {
        this.includes.add('<algorithm>');
        this.includes.add('<cctype>');
        return `/* transform to lower */ ${obj}`;
      }
      if (prop === 'startsWith') return `${obj}.starts_with(${args})`;
      if (prop === 'endsWith') return `${obj}.ends_with(${args})`;
      if (prop === 'replace') return `/* replace: use std::regex_replace */ ${obj}`;
      if (prop === 'replaceAll') return `/* replaceAll: use std::regex_replace */ ${obj}`;
      if (prop === 'charAt') return `${obj}[${args}]`;
      if (prop === 'substring') return `${obj}.substr(${args})`;
      if (prop === 'repeat') return `/* repeat: loop append */ ${obj}`;
      if (prop === 'padStart') return `/* padStart: custom */ ${obj}`;
      if (prop === 'padEnd') return `/* padEnd: custom */ ${obj}`;

      // Console methods
      if (obj === 'console' && prop === 'log') {
        this.includes.add('<iostream>');
        return `cout << ${args} << endl, 0`;
      }
      if (obj === 'console' && prop === 'error') {
        this.includes.add('<iostream>');
        return `cerr << ${args} << endl, 0`;
      }

      // Math methods
      if (obj === 'Math' && prop === 'floor') { this.includes.add('<cmath>'); return `floor(${args})`; }
      if (obj === 'Math' && prop === 'ceil') { this.includes.add('<cmath>'); return `ceil(${args})`; }
      if (obj === 'Math' && prop === 'round') { this.includes.add('<cmath>'); return `round(${args})`; }
      if (obj === 'Math' && prop === 'abs') { this.includes.add('<cmath>'); return `abs(${args})`; }
      if (obj === 'Math' && prop === 'sqrt') { this.includes.add('<cmath>'); return `sqrt(${args})`; }
      if (obj === 'Math' && prop === 'pow') { this.includes.add('<cmath>'); return `pow(${args})`; }
      if (obj === 'Math' && prop === 'min') { this.includes.add('<algorithm>'); return `min(${args})`; }
      if (obj === 'Math' && prop === 'max') { this.includes.add('<algorithm>'); return `max(${args})`; }
      if (obj === 'Math' && prop === 'random') {
        this.includes.add('<random>');
        return `(static_cast<double>(rand()) / RAND_MAX)`;
      }

      // Object static methods
      if (obj === 'Object' && prop === 'keys') return `/* keys: iterate map */ ${args}`;
      if (obj === 'Object' && prop === 'values') return `/* values: iterate map */ ${args}`;
      if (obj === 'Object' && prop === 'entries') return `/* entries: iterate map */ ${args}`;

      // Array static
      if (obj === 'Array' && prop === 'isArray') return `/* isArray */ true`;

      // Date
      if (obj === 'Date' && prop === 'now') {
        this.includes.add('<chrono>');
        return `chrono::duration_cast<chrono::milliseconds>(chrono::system_clock::now().time_since_epoch()).count()`;
      }

      // Promise
      if (obj === 'Promise' && prop === 'all') {
        this.includes.add('<future>');
        return `/* Promise.all: use std::future */ ${args}`;
      }
    }

    const callee = this.expr(node.callee);
    return `${callee}(${args})`;
  }

  generateString(strData) {
    if (!strData || !strData.parts) return '""';

    const hasInterpolation = strData.parts.some(p => p.type === 'expr');

    if (!hasInterpolation) {
      const raw = strData.parts.map(p => p.value).join('');
      this.includes.add('<string>');
      return `string(${JSON.stringify(raw)})`;
    }

    // C++ string concatenation for interpolation
    this.includes.add('<string>');
    let parts = [];
    for (const part of strData.parts) {
      if (part.type === 'text') {
        if (part.value) {
          parts.push(`string(${JSON.stringify(part.value)})`);
        }
      } else {
        parts.push(`to_string(${part.value})`);
      }
    }

    if (parts.length === 0) return '""';
    if (parts.length === 1) return parts[0];
    return parts.join(' + ');
  }

  generatePipe(node) {
    const steps = [];
    let current = node;
    while (current.type === 'Pipe') {
      steps.unshift(current.right);
      current = current.left;
    }
    steps.unshift(current);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call') {
        const callee = this.expr(step.callee);
        const args = step.args.map(a => this.expr(a)).join(', ');
        result = `${callee}(${result}${args ? ', ' + args : ''})`;
      } else if (step.type === 'Identifier') {
        result = `${step.name}(${result})`;
      } else {
        result = `/* pipe */ ${this.expr(step)}`;
      }
    }
    return result;
  }

  rawString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
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
    const saved = this.inFunction;
    const savedFunctions = this.functionDefs;
    const savedMain = this.mainBody;
    const savedIndent = this.indent;
    this.functionDefs = [];
    this.mainBody = [];
    this.indent = 0;
    this.inFunction = false;
    this.visitStatement(stmt);
    const result = this.mainBody.join('\n');
    this.functionDefs = savedFunctions;
    this.mainBody = savedMain;
    this.indent = savedIndent;
    this.inFunction = saved;
    return result;
  }

  visitEnum(node) {
    this.emit(`enum class ${node.name} {`);
    this.indent++;
    node.values.forEach((v, i) => {
      this.emit(`${v} = ${i},`);
    });
    this.indent--;
    this.emit(`};`);
    this.emitRaw('');
  }

  visitSwap(node) {
    this.includes.add('<utility>');
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    this.emit(`std::swap(${a}, ${b});`);
  }

  visitDestructure(node) {
    const val = this.expr(node.value);
    if (node.pattern === 'array') {
      if (node.names.every(n => !n.rest && !n.defaultValue)) {
        this.includes.add('<tuple>');
        const names = node.names.map(n => n.alias || n.name).join(', ');
        this.emit(`auto [${names}] = ${val};`);
      } else {
        node.names.forEach((n, i) => {
          if (!n.rest) {
            const varName = n.alias || n.name;
            if (n.defaultValue) {
              this.emit(`auto ${varName} = (${i} < ${val}.size()) ? ${val}[${i}] : ${this.expr(n.defaultValue)};`);
            } else {
              this.emit(`auto ${varName} = ${val}[${i}];`);
            }
          }
        });
      }
    } else {
      for (const n of node.names) {
        if (!n.rest) {
          const varName = n.alias || n.name;
          if (n.defaultValue) {
            this.emit(`auto ${varName} = ${val}.count("${n.name}") ? ${val}["${n.name}"] : ${this.expr(n.defaultValue)};`);
          } else {
            this.emit(`auto ${varName} = ${val}["${n.name}"];`);
          }
        }
      }
    }
  }

  visitClassDecl(node) {
    const ext = node.parent ? ` : public ${node.parent}` : '';
    this.emit(`class ${node.name}${ext} {`);
    this.emit(`public:`);
    this.indent++;
    for (const field of node.fields) {
      if (field.defaultValue) {
        this.emit(`auto ${field.name} = ${this.expr(field.defaultValue)};`);
      }
    }
    if (node.init) {
      const params = node.init.params.map(p => `auto ${p.name}`).join(', ');
      this.emit(`${node.name}(${params}) {`);
      this.indent++;
      if (node.parent) this.emit(`${node.parent}();`);
      for (const stmt of node.init.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    }
    for (const method of node.methods) {
      const params = method.params.map(p => `auto ${p.name}`).join(', ');
      this.emit(`auto ${method.name}(${params}) {`);
      this.indent++;
      if (method.body.length === 0) {
        this.emit('return 0;');
      } else {
        for (const stmt of method.body) this.visitStatement(stmt);
      }
      this.indent--;
      this.emit('}');
    }
    this.indent--;
    this.emit('};');
    this.emitRaw('');
  }

  generateBuiltin(name, args) {
    switch (name) {
      case 'len': return `${args[0]}.size()`;
      case 'sort': { this.includes.add('<algorithm>'); return `([&](){ auto _v = ${args[0]}; std::sort(_v.begin(), _v.end()); return _v; }())`; }
      case 'reverse': { this.includes.add('<algorithm>'); return `([&](){ auto _v = ${args[0]}; std::reverse(_v.begin(), _v.end()); return _v; }())`; }
      case 'contains': return `(std::find(${args[0]}.begin(), ${args[0]}.end(), ${args[1]}) != ${args[0]}.end())`;
      case 'abs': { this.includes.add('<cmath>'); return `std::abs(${args[0]})`; }
      case 'sqrt': { this.includes.add('<cmath>'); return `std::sqrt(${args[0]})`; }
      case 'pow': { this.includes.add('<cmath>'); return `std::pow(${args[0]}, ${args[1]})`; }
      case 'ceil': { this.includes.add('<cmath>'); return `std::ceil(${args[0]})`; }
      case 'floor': { this.includes.add('<cmath>'); return `std::floor(${args[0]})`; }
      case 'round': { this.includes.add('<cmath>'); return `std::round(${args[0]})`; }
      case 'str': return `std::to_string(${args[0]})`;
      case 'int': return `std::stoi(${args[0]})`;
      case 'float': return `std::stof(${args[0]})`;
      case 'upper': { this.includes.add('<algorithm>'); this.includes.add('<cctype>'); return `([&](){ auto _s = ${args[0]}; std::transform(_s.begin(), _s.end(), _s.begin(), ::toupper); return _s; }())`; }
      case 'lower': { this.includes.add('<algorithm>'); this.includes.add('<cctype>'); return `([&](){ auto _s = ${args[0]}; std::transform(_s.begin(), _s.end(), _s.begin(), ::tolower); return _s; }())`; }
      case 'trim': return `([&](){ auto _s = ${args[0]}; _s.erase(0, _s.find_first_not_of(" \\t\\n\\r")); _s.erase(_s.find_last_not_of(" \\t\\n\\r") + 1); return _s; }())`;
      case 'keys': return `([&](){ std::vector<std::string> _k; for (auto& [k,v] : ${args[0]}) _k.push_back(k); return _k; }())`;
      case 'values': return `([&](){ std::vector<auto> _v; for (auto& [k,v] : ${args[0]}) _v.push_back(v); return _v; }())`;
      case 'exit': return `exit(${args[0] || '0'})`;
      case 'sleep': { this.includes.add('<thread>'); this.includes.add('<chrono>'); return `std::this_thread::sleep_for(std::chrono::milliseconds(${args[0]}))`; }
      case 'now': { this.includes.add('<chrono>'); return `std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count()`; }
      case 'random': { this.includes.add('<random>'); return args.length >= 2 ? `([](int a, int b){ std::random_device rd; std::mt19937 gen(rd()); std::uniform_int_distribution<> dis(a,b); return dis(gen); })(${args[0]}, ${args[1]})` : `([]{ std::random_device rd; return rd(); }())`; }
      case 'sum': return `([&](){ auto _v = ${args[0]}; return std::accumulate(_v.begin(), _v.end(), 0); }())`;
      case 'map': { this.includes.add('<algorithm>'); return `([&](){ auto _v = ${args[0]}; std::vector<decltype(${args[1]}(_v[0]))> _r; std::transform(_v.begin(), _v.end(), std::back_inserter(_r), ${args[1]}); return _r; }())`; }
      case 'filter': { this.includes.add('<algorithm>'); return `([&](){ auto _v = ${args[0]}; decltype(_v) _r; std::copy_if(_v.begin(), _v.end(), std::back_inserter(_r), ${args[1]}); return _r; }())`; }
      case 'reduce': { this.includes.add('<numeric>'); return `std::accumulate(${args[0]}.begin(), ${args[0]}.end(), ${args[2] || '0'}, ${args[1]})`; }
      case 'find': { this.includes.add('<algorithm>'); return `(*std::find_if(${args[0]}.begin(), ${args[0]}.end(), ${args[1]}))`; }
      case 'every': { this.includes.add('<algorithm>'); return `std::all_of(${args[0]}.begin(), ${args[0]}.end(), ${args[1]})`; }
      case 'some': { this.includes.add('<algorithm>'); return `std::any_of(${args[0]}.begin(), ${args[0]}.end(), ${args[1]})`; }
      case 'foreach': { this.includes.add('<algorithm>'); return `std::for_each(${args[0]}.begin(), ${args[0]}.end(), ${args[1]})`; }
      default: return null;
    }
  }
}
