export class CGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.includes = new Set();
    this.typedefs = [];
    this.functions = [];
    this.mainBody = [];
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.inFunction = false;
    this.inMain = false;
  }

  generate(ast) {
    this.includes.add('<stdio.h>');
    this.includes.add('<stdlib.h>');

    this.visitProgram(ast);

    const out = [];

    // Preamble: #includes
    for (const inc of [...this.includes].sort()) {
      out.push(`#include ${inc}`);
    }
    out.push('');

    // Typedefs / structs
    if (this.typedefs.length > 0) {
      out.push(...this.typedefs);
      out.push('');
    }

    // Function declarations
    if (this.functions.length > 0) {
      out.push(...this.functions);
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
      this.functions.push(indented);
    } else {
      this.mainBody.push(indented);
    }
    this.sourceMap.push(this.currentSourceLine);
  }

  emitRaw(line) {
    if (this.inFunction) {
      this.functions.push(line);
    } else {
      this.mainBody.push(line);
    }
    this.sourceMap.push(this.currentSourceLine);
  }

  emitTypedef(line) {
    this.typedefs.push(line);
  }

  visitProgram(node) {
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
  }

  // ===== Type mapping =====

  mapType(naideType) {
    const map = {
      'str': 'const char*',
      'string': 'const char*',
      'int': 'int',
      'integer': 'int',
      'num': 'double',
      'number': 'double',
      'float': 'double',
      'bool': 'int',
      'boolean': 'int',
      'list': 'void**',
      'map': '/* map */ void*',
      'any': 'void*',
      'void': 'void',
      'json': 'const char*',
      'auto': 'int',
      'timestamp': 'long',
    };
    return map[naideType] || 'void*';
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
    const retType = node.returnType ? this.mapType(node.returnType) : 'void';
    const params = node.params.map(p => {
      const type = p.type ? this.mapType(p.type) : 'void*';
      return `${type} ${p.name}`;
    }).join(', ');

    const savedInFunction = this.inFunction;
    this.inFunction = true;

    this.emit(`${retType} ${node.name}(${params || 'void'}) {`);
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
    this.emit(`/* return status ${this.expr(node.statusCode)} with body */`);
    this.emit(`printf("Status: %s\\n", ${this.expr(node.body)});`);
  }

  visitReturnMethod(node) {
    this.emit(`/* return ${node.method}: ${this.expr(node.value)} */`);
  }

  // ===== Variables =====

  visitTypedVar(node) {
    const type = node.varType ? this.mapType(node.varType) : this.inferCType(node.value);
    this.emit(`${type} ${node.name} = ${this.expr(node.value)};`);
  }

  inferCType(valueNode) {
    if (!valueNode) return 'void*';
    switch (valueNode.type) {
      case 'Number':
        return valueNode.value.includes('.') ? 'double' : 'int';
      case 'String': return 'const char*';
      case 'Bool': return 'int';
      case 'Null': return 'void*';
      case 'Array': return 'void**';
      default: return 'void*';
    }
  }

  visitAssignment(node) {
    const value = this.expr(node.value);
    if (node.target.type === 'Array') {
      this.emit(`/* destructuring not supported in C */`);
      this.emit(`/* ${this.expr(node.target)} = ${value} */`);
    } else if (node.target.type === 'Object') {
      this.emit(`/* object destructuring not supported in C */`);
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
    this.emit(`/* each: iterate over ${collection} */`);
    this.emit(`/* C requires manual iteration with known size */`);
    this.emit(`for (int __i = 0; /* __i < length */; __i++) {`);
    this.indent++;
    if (node.key) {
      this.emit(`int ${node.key} = __i;`);
    }
    this.emit(`void* ${node.value} = ${collection}[__i];`);
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
    this.emit('/* C has no try/catch - use error codes or setjmp/longjmp */');
    this.emit('/* try { */');
    for (const stmt of node.body) this.visitStatement(stmt);
    if (node.catchBody) {
      const catchParam = node.catchVar || 'err';
      this.emit(`/* } catch (${catchParam}) { */`);
      for (const stmt of node.catchBody) this.visitStatement(stmt);
    }
    if (node.ensureBody) {
      this.emit('/* } finally { */');
      for (const stmt of node.ensureBody) this.visitStatement(stmt);
    }
    this.emit('/* } */');
  }

  // ===== Model (struct) =====

  visitModel(node) {
    this.models.set(node.name, node);

    let structDef = `typedef struct {\n`;
    for (const f of node.fields) {
      const type = f.type ? this.mapType(f.type) : 'void*';
      structDef += `    ${type} ${f.name};\n`;
    }
    structDef += `} ${node.name};`;
    this.emitTypedef(structDef);
    this.emitTypedef('');

    // Generate method stubs as standalone functions
    for (const method of node.methods) {
      const retType = method.returnType ? this.mapType(method.returnType) : 'void';
      const params = method.params.map(p => {
        const type = p.type ? this.mapType(p.type) : 'void*';
        return `${type} ${p.name}`;
      });
      params.unshift(`${node.name}* self`);

      const savedInFunction = this.inFunction;
      this.inFunction = true;

      this.emit(`${retType} ${node.name}_${method.name}(${params.join(', ')}) {`);
      this.indent++;
      for (const stmt of method.body) {
        this.visitStatement(stmt);
      }
      this.indent--;
      this.emit('}');
      this.emitRaw('');

      this.inFunction = savedInFunction;
    }
  }

  // ===== Log =====

  visitLog(node) {
    this.includes.add('<stdio.h>');
    const args = node.args.map(a => this.expr(a));
    if (args.length === 1) {
      const arg = args[0];
      if (node.args[0] && node.args[0].type === 'String') {
        this.emit(`printf(${arg});`);
        this.emit(`printf("\\n");`);
      } else {
        this.emit(`printf("%s\\n", ${arg});`);
      }
    } else {
      // Multiple args: print each separated by space
      const fmtParts = args.map(() => '%s').join(' ');
      this.emit(`printf("${fmtParts}\\n", ${args.join(', ')});`);
    }
  }

  visitThrow(node) {
    this.includes.add('<stdio.h>');
    this.includes.add('<stdlib.h>');
    this.emit(`fprintf(stderr, "Error: %s\\n", ${this.expr(node.value)});`);
    this.emit('exit(1);');
  }

  // ===== Events =====

  visitOn(node) {
    this.emit(`/* on event: ${this.expr(node.event)} */`);
    this.emit(`/* C has no built-in event system - use callbacks or signal handlers */`);
  }

  // ===== Server =====

  visitServer(node) {
    this.emit('/* HTTP server: use libmicrohttpd or libevent */');
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

    this.emit(`printf("Server ${node.name} would run on port %s\\n", "${port}");`);
    this.emitRaw('');
  }

  // ===== Bot =====

  visitBot(node) {
    this.emit('/* Bot: C has no built-in bot framework */');
    this.emit(`/* TODO: bot "${node.name}" - implement with libcurl for API calls */`);
    this.emitRaw('');
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.emit(`/* db connect: ${this.expr(node.connectionString)} */`);
    this.emit('/* TODO: use libpq (PostgreSQL) or sqlite3 C API */');
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`/* db dir: ${raw} */`);
  }

  visitDbSql(node) {
    this.emit('/* db sql: use sqlite3 C API */');
    this.emit('/* #include <sqlite3.h> */');
    this.emit('/* sqlite3 *__db; */');
    this.emit('/* sqlite3_open("data.db", &__db); */');
  }

  visitAwaitAll(node) {
    this.emit('/* await all: C has no async/await - use pthreads */');
    for (const e of node.expressions) {
      this.emit(`${this.expr(e)};`);
    }
  }

  // ===== Domain features (comment stubs) =====

  visitSchema(node) {
    this.schemas.set(node.name, node);
    let structDef = `typedef struct {\n`;
    for (const f of node.fields) {
      const type = this.mapType(f.type);
      structDef += `    ${type} ${f.name};\n`;
    }
    structDef += `} ${node.name};`;
    this.emitTypedef(structDef);
    this.emitTypedef('');
  }

  visitCrud(node) {
    this.emit(`/* TODO: CRUD for "${node.schemaName}" - implement with HTTP library */`);
  }

  visitAuth(node) {
    this.emit('/* TODO: auth - use libcurl + JWT C library (libjwt) */');
  }

  visitCors(node) {
    this.emit('/* TODO: CORS - set headers in HTTP response */');
  }

  visitLimit(node) {
    this.emit('/* TODO: rate limiting - implement with token bucket algorithm */');
  }

  visitEnv(node) {
    this.includes.add('<stdlib.h>');
    for (const v of node.vars) {
      this.emit(`const char* ${v.name} = getenv("${v.name}");`);
    }
    this.emitRaw('');
  }

  visitEvery(node) {
    this.emit('/* TODO: scheduled task - use timer_create or sleep loop */');
    this.includes.add('<unistd.h>');
  }

  visitWatch(node) {
    this.emit(`/* TODO: watch event "${node.eventName}" - use callback pattern */`);
  }

  visitStatic(node) {
    this.emit('/* TODO: static files - use HTTP library to serve files */');
  }

  visitWs(node) {
    this.emit('/* TODO: WebSocket - use libwebsockets */');
  }

  visitGroup(node) {
    this.emit('/* TODO: route group - implement with HTTP library */');
  }

  visitErrorHandler(node) {
    this.emit('/* TODO: error handler - use errno and custom error codes */');
  }

  visitCookie(node) {
    this.emit('/* TODO: cookies - set via HTTP headers */');
  }

  visitUpload(node) {
    this.emit('/* TODO: file upload - use multipart form parser */');
  }

  visitSession(node) {
    this.emit('/* TODO: sessions - implement with in-memory hash map */');
  }

  visitView(node) {
    this.emit('/* TODO: view engine - use string templates */');
  }

  visitSse(node) {
    this.emit('/* TODO: Server-Sent Events - use chunked HTTP response */');
  }

  visitCache(node) {
    this.emit('/* TODO: caching - use in-memory hash map or memcached C client */');
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
    this.includes.add('<assert.h>');
    const name = this.rawString(node.name);
    const funcName = `test_${name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const savedInFunction = this.inFunction;
    this.inFunction = true;

    this.emit(`void ${funcName}(void) {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    this.inFunction = savedInFunction;
  }

  visitAssert(node) {
    this.includes.add('<assert.h>');
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
    this.emit(`/* TODO: queue "${node.name}" - use POSIX message queues or custom implementation */`);
  }

  visitOpenapi(node) {
    this.emit('/* TODO: OpenAPI spec - generate JSON manually */');
  }

  visitReturnRedirect(node) {
    this.emit(`/* TODO: redirect to ${this.expr(node.url)} */`);
  }

  visitReturnDownload(node) {
    this.emit(`/* TODO: download file ${this.expr(node.filePath)} */`);
  }

  visitPrompt(node) {
    this.emit(`/* TODO: prompt template "${node.name}" - use printf with format strings */`);
  }

  visitPage(node) {
    this.emit('/* TODO: page generation - use fprintf to write HTML file */');
  }

  visitCli(node) {
    this.includes.add('<string.h>');
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
    this.emit('/* TODO: mail - use libcurl for SMTP */');
  }

  visitDesktop(node) {
    this.emit(`/* TODO: desktop app "${node.name}" - use GTK or SDL2 */`);
  }

  visitScreen(node) {
    this.emit(`/* TODO: mobile screen "${node.name}" - not applicable in C */`);
  }

  visitOauth(node) {
    this.emit('/* TODO: OAuth - use libcurl for HTTP requests + libjwt */');
  }

  visitPay(node) {
    this.emit('/* TODO: payment - use libcurl for Stripe API */');
  }

  visitStorage(node) {
    this.emit('/* TODO: cloud storage - use AWS SDK for C or libcurl */');
  }

  visitPdf(node) {
    this.emit('/* TODO: PDF generation - use libharu (libHPDF) */');
  }

  visitI18n(node) {
    this.emit('/* TODO: i18n - use gettext or custom key-value lookup */');
  }

  visitPush(node) {
    this.emit('/* TODO: push notifications - use libcurl for web push API */');
  }

  visitSearch(node) {
    this.emit('/* TODO: search - use libcurl for Elasticsearch/Meilisearch API */');
  }

  visitImage(node) {
    this.emit('/* TODO: image processing - use stb_image or ImageMagick C API */');
  }

  visitCsv(node) {
    this.emit('/* TODO: CSV - use fprintf for writing, custom parser for reading */');
  }

  visitLogging(node) {
    this.emit('/* TODO: logging - use syslog or custom file logger */');
  }

  visitMigrate(node) {
    this.emit('/* TODO: DB migration - use sqlite3 C API */');
  }

  visitGrpc(node) {
    this.emit('/* TODO: gRPC - use grpc-c library */');
  }

  visitWebrtc(node) {
    this.emit('/* TODO: WebRTC - use libdatachannel */');
  }

  visitBlockchain(node) {
    this.emit('/* TODO: blockchain - use libcurl for JSON-RPC */');
  }

  // ===== Expression generation =====

  expr(node) {
    if (!node) return 'NULL';

    switch (node.type) {
      case 'Number': return node.value;

      case 'String': return this.generateString(node.value);

      case 'Bool': return node.value ? '1' : '0';

      case 'Null': return 'NULL';

      case 'Self': return 'self';

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
        return `/* await */ ${this.expr(node.expr)}`;

      case 'AwaitAllExpr':
        return `/* await all */ ${this.expr(node.expr)}`;

      case 'Spread':
        return `/* spread */ ${this.expr(node.expr)}`;

      case 'New': {
        // In C, allocate with malloc
        this.includes.add('<stdlib.h>');
        return `/* new */ malloc(sizeof(${this.expr(node.expr)}))`;
      }

      case 'TypeOf':
        return `/* typeof */ "unknown"`;

      case 'MemberAccess':
        return this.generateMemberAccess(node);

      case 'OptionalAccess':
        return `(${this.expr(node.object)} ? ${this.expr(node.object)}->${node.property} : NULL)`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array':
        // C doesn't have array literals in expressions easily
        return `/* array */ NULL`;

      case 'Object':
        return `/* object literal */ NULL`;

      case 'ArrowFn':
        return `/* function pointer */ NULL`;

      case 'Lambda':
        return `/* lambda */ NULL`;

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `/* expr:${node.type} */ 0`;
    }
  }

  mapIdentifier(name) {
    const map = {
      'null': 'NULL',
      'undefined': 'NULL',
      'true': '1',
      'false': '0',
      'this': 'self',
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
      this.includes.add('<string.h>');
      return `strlen(${obj})`;
    }

    // Struct member access: use -> for pointers, . for values
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
      if (name === 'parseInt') return `atoi(${args})`;
      if (name === 'parseFloat') return `atof(${args})`;
      if (name === 'toString') { this.includes.add('<stdio.h>'); return `/* toString */ ${args}`; }
    }

    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // String methods
      if (prop === 'split') { this.includes.add('<string.h>'); return `strtok(${obj}, ${args})`; }
      if (prop === 'indexOf') { this.includes.add('<string.h>'); return `strstr(${obj}, ${args})`; }
      if (prop === 'includes') { this.includes.add('<string.h>'); return `(strstr(${obj}, ${args}) != NULL)`; }
      if (prop === 'toUpperCase') { return `/* toUpperCase: iterate and toupper */ ${obj}`; }
      if (prop === 'toLowerCase') { return `/* toLowerCase: iterate and tolower */ ${obj}`; }
      if (prop === 'trim') { return `/* trim: custom implementation */ ${obj}`; }
      if (prop === 'replace') { return `/* replace: custom implementation */ ${obj}`; }
      if (prop === 'substring') { return `/* substring: pointer arithmetic */ ${obj}`; }

      // Console methods
      if (obj === 'console' && prop === 'log') {
        this.includes.add('<stdio.h>');
        return `printf("%s\\n", ${args})`;
      }
      if (obj === 'console' && prop === 'error') {
        this.includes.add('<stdio.h>');
        return `fprintf(stderr, "%s\\n", ${args})`;
      }

      // Math methods
      if (obj === 'Math' && prop === 'floor') { this.includes.add('<math.h>'); return `floor(${args})`; }
      if (obj === 'Math' && prop === 'ceil') { this.includes.add('<math.h>'); return `ceil(${args})`; }
      if (obj === 'Math' && prop === 'round') { this.includes.add('<math.h>'); return `round(${args})`; }
      if (obj === 'Math' && prop === 'abs') { this.includes.add('<stdlib.h>'); return `abs(${args})`; }
      if (obj === 'Math' && prop === 'sqrt') { this.includes.add('<math.h>'); return `sqrt(${args})`; }
      if (obj === 'Math' && prop === 'pow') { this.includes.add('<math.h>'); return `pow(${args})`; }
      if (obj === 'Math' && prop === 'random') { this.includes.add('<stdlib.h>'); return `((double)rand() / RAND_MAX)`; }
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

    // C has no string interpolation; emit printf-style format
    // Return the format string part only; caller must handle arguments
    let fmt = '"';
    const fmtArgs = [];
    for (const part of strData.parts) {
      if (part.type === 'text') {
        fmt += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      } else {
        fmt += '%s';
        fmtArgs.push(part.value);
      }
    }
    fmt += '"';

    if (fmtArgs.length > 0) {
      // Return as a comment-annotated format; for printf usage
      return `${fmt} /* args: ${fmtArgs.join(', ')} */`;
    }
    return fmt;
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

  visitEnum(node) {
    this.emit(`typedef enum {`);
    this.indent++;
    node.values.forEach((v, i) => {
      this.emit(`${node.name}_${v} = ${i},`);
    });
    this.indent--;
    this.emit(`} ${node.name};`);
    this.emitRaw('');
  }

  visitSwap(node) {
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    const tmp = `_tmp_${a.replace(/[^a-zA-Z0-9]/g, '')}`;
    this.emit(`{ typeof(${a}) ${tmp} = ${a}; ${a} = ${b}; ${b} = ${tmp}; }`);
  }

  generateBuiltin(name, args) {
    switch (name) {
      case 'len': return `(sizeof(${args[0]}) / sizeof(${args[0]}[0]))`;
      case 'abs': return `abs(${args[0]})`;
      case 'sqrt': { this.includes.add('<math.h>'); return `sqrt(${args[0]})`; }
      case 'pow': { this.includes.add('<math.h>'); return `pow(${args[0]}, ${args[1]})`; }
      case 'ceil': { this.includes.add('<math.h>'); return `ceil(${args[0]})`; }
      case 'floor': { this.includes.add('<math.h>'); return `floor(${args[0]})`; }
      case 'round': { this.includes.add('<math.h>'); return `round(${args[0]})`; }
      case 'exit': { this.includes.add('<stdlib.h>'); return `exit(${args[0] || '0'})`; }
      case 'str': return `snprintf(_buf, sizeof(_buf), "%d", ${args[0]})`;
      case 'int': { this.includes.add('<stdlib.h>'); return `atoi(${args[0]})`; }
      case 'float': { this.includes.add('<stdlib.h>'); return `atof(${args[0]})`; }
      case 'upper': { this.includes.add('<ctype.h>'); return `toupper(${args[0]})`; }
      case 'lower': { this.includes.add('<ctype.h>'); return `tolower(${args[0]})`; }
      case 'sleep': { this.includes.add('<unistd.h>'); return `usleep(${args[0]} * 1000)`; }
      case 'now': { this.includes.add('<time.h>'); return `(long long)time(NULL) * 1000`; }
      case 'random': { this.includes.add('<stdlib.h>'); return args.length >= 2 ? `(rand() % (${args[1]} - ${args[0]} + 1) + ${args[0]})` : `rand()`; }
      default: return null;
    }
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
    const savedFunctions = this.functions;
    const savedMain = this.mainBody;
    const savedIndent = this.indent;
    this.functions = [];
    this.mainBody = [];
    this.indent = 0;
    this.inFunction = false;
    this.visitStatement(stmt);
    const result = this.mainBody.join('\n');
    this.functions = savedFunctions;
    this.mainBody = savedMain;
    this.indent = savedIndent;
    this.inFunction = saved;
    return result;
  }
}
