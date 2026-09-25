export class RustGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.uses = new Set();
    this.models = new Map();
    this.schemas = new Map();
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.hasAsync = false;
    this.hasTests = false;
    this.hasAsserts = false;
    this.authSecret = null;
    this.dbVar = null;
    this.hasMain = false;
    this.topLevelStatements = [];
  }

  generate(ast) {
    // First pass: collect all statements
    this.visitProgram(ast);

    const preamble = [];

    // Emit use statements
    for (const u of this.uses) {
      preamble.push(`use ${u};`);
    }

    if (preamble.length > 0) {
      preamble.push('');
    }

    // Wrap top-level code in main if needed
    const body = this.output.join('\n');

    if (preamble.length > 0) {
      return preamble.join('\n') + '\n' + body;
    }

    return body;
  }

  emit(line) {
    this.output.push('    '.repeat(this.indent) + line);
    this.sourceMap.push(this.currentSourceLine);
  }

  emitRaw(line) {
    this.output.push(line);
    this.sourceMap.push(this.currentSourceLine);
  }

  addUse(path) {
    this.uses.add(path);
  }

  mapType(naideType) {
    const map = {
      'str': 'String',
      'string': 'String',
      'int': 'i64',
      'integer': 'i64',
      'num': 'f64',
      'number': 'f64',
      'float': 'f64',
      'bool': 'bool',
      'boolean': 'bool',
      'list': 'Vec<Box<dyn std::any::Any>>',
      'map': 'std::collections::HashMap<String, Box<dyn std::any::Any>>',
      'any': 'Box<dyn std::any::Any>',
      'json': 'serde_json::Value',
      'void': '()',
      'auto': 'u64',
      'timestamp': 'String',
      'enum': 'String',
    };
    return map[naideType] || 'Box<dyn std::any::Any>';
  }

  rawString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
  }

  generateString(strData) {
    if (!strData || !strData.parts) return '""';

    const hasInterpolation = strData.parts.some(p => p.type === 'expr');

    if (!hasInterpolation) {
      const raw = strData.parts.map(p => p.value).join('');
      return JSON.stringify(raw);
    }

    // Use format! macro for interpolation
    let fmtStr = '';
    const args = [];
    for (const part of strData.parts) {
      if (part.type === 'text') {
        fmtStr += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/{/g, '{{').replace(/}/g, '}}');
      } else {
        fmtStr += '{}';
        const exprCode = part.value.replace(/\bself\b/g, 'self');
        args.push(exprCode);
      }
    }

    if (args.length === 0) {
      return `"${fmtStr}"`;
    }
    return `format!("${fmtStr}", ${args.join(', ')})`;
  }

  stringValue(strData) {
    if (!strData || !strData.parts) return '""';
    if (strData.raw !== null && strData.raw !== undefined) {
      return JSON.stringify(strData.raw);
    }
    return this.generateString(strData);
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
      case 'ExprStatement': this.emit(`${this.expr(node.expression)};`); return;
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
        this.emit(`/* unknown: ${node.type} */`);
    }
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const alias = node.alias || node.name;
    const crateMap = {
      'express': 'actix_web',
      'axios': 'reqwest',
      'lodash': 'itertools',
      'moment': 'chrono',
      'fs': 'std::fs',
      'path': 'std::path',
      'crypto': 'ring',
      'uuid': 'uuid',
    };
    const clean = raw.replace(/^['"]|['"]$/g, '');
    const mapped = crateMap[clean] || clean;
    if (alias !== mapped && alias !== node.name) {
      this.emit(`use ${mapped} as ${alias};`);
    } else {
      this.emit(`use ${mapped};`);
    }
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const clean = raw.replace(/^['"]|['"]$/g, '');
    const crateMap = {
      'express': 'actix_web',
      'axios': 'reqwest',
    };
    const mapped = crateMap[clean] || clean;
    const names = node.names.map(n => {
      if (n.alias) return `${n.name} as ${n.alias}`;
      return n.name;
    }).join(', ');
    this.emit(`use ${mapped}::{${names}};`);
  }

  // ===== Functions =====

  visitFunction(node) {
    const pub = node.isPublic ? 'pub ' : '';
    const asyncKw = node.isAsync ? 'async ' : '';
    if (node.isAsync) this.hasAsync = true;

    const params = node.params.map(p => {
      let s = '';
      if (p.spread) s += ''; // Rust doesn't have spread params directly
      s += p.name;
      if (p.type) {
        s += `: ${this.mapType(p.type)}`;
      }
      if (p.defaultValue) {
        // Rust doesn't have default params; add a comment
        s += ` /* = ${this.expr(p.defaultValue)} */`;
      }
      return s;
    }).join(', ');

    const retType = node.returnType ? ` -> ${this.mapType(node.returnType)}` : '';
    this.emit(`${pub}${asyncKw}fn ${node.name}(${params})${retType} {`);
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
    this.addUse('actix_web::HttpResponse');
    this.emit(`return HttpResponse::build(actix_web::http::StatusCode::from_u16(${this.expr(node.statusCode)}).unwrap()).json(${this.expr(node.body)});`);
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.addUse('actix_web::HttpResponse');
        this.emit(`return HttpResponse::Found().append_header(("Location", ${val})).finish();`);
        break;
      case 'html':
        this.addUse('actix_web::HttpResponse');
        this.emit(`return HttpResponse::Ok().content_type("text/html").body(${val});`);
        break;
      case 'text':
        this.addUse('actix_web::HttpResponse');
        this.emit(`return HttpResponse::Ok().content_type("text/plain").body(${val});`);
        break;
      case 'file':
        this.addUse('actix_files::NamedFile');
        this.emit(`return NamedFile::open(${val})?.into_response(&req);`);
        break;
      default:
        this.emit(`return HttpResponse::Ok().json(${val});`);
    }
  }

  // ===== Variables =====

  visitTypedVar(node) {
    const keyword = node.isMut ? 'let mut' : 'let';
    const typeAnnotation = node.varType ? `: ${this.mapType(node.varType)}` : '';
    this.emit(`${keyword} ${node.name}${typeAnnotation} = ${this.expr(node.value)};`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.expr(e)).join(', ');
      this.emit(`let (${names}) = ${value};`);
    } else if (node.target.type === 'Object') {
      // Rust doesn't have object destructuring; emit individual field access
      const tempVar = '__d';
      this.emit(`let ${tempVar} = ${value};`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`let ${varName} = ${tempVar}[${JSON.stringify(key)}].clone();`);
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
    this.emit(`if ${this.expr(node.condition)} {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;

    for (const elif of node.elifs) {
      this.emit(`} else if ${this.expr(elif.condition)} {`);
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
      this.emit(`for (${node.key}, ${node.value}) in ${collection}.iter().enumerate() {`);
    } else {
      this.emit(`for ${node.value} in &${collection} {`);
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
    this.emit(`for ${varName} in ${start}..${end} {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  visitWhile(node) {
    this.emit(`while ${this.expr(node.condition)} {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  visitMatch(node) {
    this.emit(`match ${this.expr(node.value)} {`);
    this.indent++;
    for (const c of node.cases) {
      if (c.pattern.type === 'DefaultPattern') {
        this.emit('_ => {');
      } else {
        this.emit(`${this.expr(c.pattern)} => {`);
      }
      this.indent++;
      for (const stmt of c.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('},');
    }
    this.indent--;
    this.emit('}');
  }

  visitTry(node) {
    // Rust uses Result/match instead of try/catch
    this.emit('match (|| -> Result<(), Box<dyn std::error::Error>> {');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.emit('Ok(())');
    this.indent--;
    this.emit('})() {');
    this.indent++;
    if (node.catchBody) {
      const catchParam = node.catchVar || 'e';
      this.emit(`Err(${catchParam}) => {`);
      this.indent++;
      for (const stmt of node.catchBody) this.visitStatement(stmt);
      this.indent--;
      this.emit('},');
    }
    this.emit('Ok(_) => {},');
    this.indent--;
    this.emit('}');

    if (node.ensureBody) {
      this.emit('// finally:');
      for (const stmt of node.ensureBody) this.visitStatement(stmt);
    }
  }

  // ===== Server (actix-web) =====

  visitServer(node) {
    this.hasAsync = true;
    this.addUse('actix_web::{web, App, HttpServer, HttpRequest, HttpResponse}');
    this.addUse('serde::{Deserialize, Serialize}');
    this.addUse('serde_json');

    const routeHandlers = [];
    const errorHandlers = [];

    // Emit route handler functions
    for (const child of node.routes) {
      if (child.type === 'Route') {
        const funcName = this.routeFuncName(child.method, child.path);
        routeHandlers.push({ funcName, child });
        this.visitRouteHandler(funcName, child);
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(node.name, child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(node.name, child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors(node.name, child);
      } else if (child.type === 'StaticDecl') {
        this.visitStatic(node.name, child);
      } else if (child.type === 'WsDecl') {
        this.emit('// TODO: WebSocket support - use actix-web-actors crate');
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(node.name, child);
      } else if (child.type === 'SessionDecl') {
        this.visitSession(node.name, child);
      } else if (child.type === 'CacheDecl') {
        this.visitCache(node.name, child);
      } else if (child.type === 'GraphqlDecl') {
        this.visitGraphql(node.name, child);
      } else if (child.type === 'LimitDecl') {
        this.visitLimit(node.name, child);
      } else {
        this.visitStatement(child);
      }
    }

    for (const eh of errorHandlers) {
      this.visitErrorHandler(node.name, eh);
    }

    const port = node.port ? this.expr(node.port) : '3000';

    this.emitRaw('');
    this.emit('#[actix_web::main]');
    this.emit('async fn main() -> std::io::Result<()> {');
    this.indent++;
    this.emit(`println!("Server running on port ${port}");`);
    this.emit('HttpServer::new(|| {');
    this.indent++;
    this.emit('App::new()');
    this.indent++;

    for (const { funcName, child } of routeHandlers) {
      const method = child.method === 'del' ? 'delete' : child.method;
      const path = this.rawString(child.path);
      this.emit(`.route("${path}", web::${method}().to(${funcName}))`);
    }

    this.indent--;
    this.indent--;
    this.emit('})');
    this.emit(`.bind(format!("0.0.0.0:{}", ${port}))?`);
    this.emit('.run()');
    this.emit('.await');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitRouteHandler(funcName, route) {
    const needsAsync = this.bodyUsesAwait(route.body);
    const asyncPrefix = needsAsync ? 'async ' : '';

    this.emit(`${asyncPrefix}fn ${funcName}(req: HttpRequest, body: web::Json<serde_json::Value>) -> HttpResponse {`);
    this.indent++;

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`HttpResponse::Ok().json(${this.expr(stmt.value)})`);
      } else {
        this.visitStatement(stmt);
      }
    }

    if (route.body.length === 0) {
      this.emit('HttpResponse::Ok().finish()');
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  routeFuncName(method, pathData) {
    const raw = this.rawString(pathData);
    const clean = raw.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return `handle_${method}_${clean || 'root'}`;
  }

  // ===== Model (struct + impl) =====

  visitModel(node) {
    this.models.set(node.name, node);
    this.addUse('serde::{Deserialize, Serialize}');

    const pub = node.isPublic ? 'pub ' : '';
    this.emitRaw('');
    this.emit('#[derive(Debug, Clone, Serialize, Deserialize)]');
    this.emit(`${pub}struct ${node.name} {`);
    this.indent++;
    for (const f of node.fields) {
      const fieldType = f.type ? this.mapType(f.type) : 'String';
      this.emit(`pub ${f.name}: ${fieldType},`);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    if (node.methods.length > 0) {
      this.emit(`impl ${node.name} {`);
      this.indent++;

      // Constructor (new)
      if (node.fields.length > 0) {
        const ctorParams = node.fields.map(f => {
          const fieldType = f.type ? this.mapType(f.type) : 'String';
          return `${f.name}: ${fieldType}`;
        }).join(', ');

        this.emit(`pub fn new(${ctorParams}) -> Self {`);
        this.indent++;
        this.emit(`Self {`);
        this.indent++;
        for (const f of node.fields) {
          this.emit(`${f.name},`);
        }
        this.indent--;
        this.emit('}');
        this.indent--;
        this.emit('}');
        this.emitRaw('');
      }

      for (const method of node.methods) {
        const asyncKw = method.isAsync ? 'async ' : '';
        if (method.isAsync) this.hasAsync = true;

        const params = method.params.map(p => {
          let s = p.name;
          if (p.type) s += `: ${this.mapType(p.type)}`;
          return s;
        }).join(', ');

        const selfParam = params ? `&self, ${params}` : '&self';
        const retType = method.returnType ? ` -> ${this.mapType(method.returnType)}` : '';

        this.emit(`pub ${asyncKw}fn ${method.name}(${selfParam})${retType} {`);
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
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    this.emit(`// on ${event}`);
    this.emit('{');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  // ===== Logging and errors =====

  visitLog(node) {
    const args = node.args.map(a => this.expr(a));
    if (args.length === 0) {
      this.emit('println!();');
      return;
    }
    if (args.length === 1) {
      if (node.level === 'error') {
        this.emit(`eprintln!("{:?}", ${args[0]});`);
      } else {
        this.emit(`println!("{:?}", ${args[0]});`);
      }
    } else {
      const fmtPlaceholders = args.map(() => '{:?}').join(' ');
      if (node.level === 'error') {
        this.emit(`eprintln!("${fmtPlaceholders}", ${args.join(', ')});`);
      } else {
        this.emit(`println!("${fmtPlaceholders}", ${args.join(', ')});`);
      }
    }
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`panic!(${value});`);
    } else {
      this.emit(`panic!("{:?}", ${value});`);
    }
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.emit(`// TODO: Database connection - use sqlx or diesel crate`);
    this.emit(`// let db = connect(${this.expr(node.connectionString)});`);
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`// db dir: ${raw}`);
  }

  visitDbSql(node) {
    const driverRaw = node.driver.raw || node.driver.parts?.map(p => p.value).join('') || 'sqlite';
    const conn = node.connection ? this.stringValue(node.connection) : '"data.db"';

    if (driverRaw === 'sqlite') {
      this.emit(`// TODO: SQLite - use rusqlite crate`);
      this.emit(`// let db = rusqlite::Connection::open(${conn}).unwrap();`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      this.emit(`// TODO: PostgreSQL - use sqlx or tokio-postgres crate`);
      this.emit(`// let pool = sqlx::PgPool::connect(${conn}).await.unwrap();`);
    }
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    const exprs = node.expressions.map(e => this.expr(e));
    this.addUse('futures::future::join_all');
    this.emit(`let __results = join_all(vec![${exprs.join(', ')}]).await;`);
  }

  // ===== Schema (struct with derive) =====

  visitSchema(node) {
    this.addUse('serde::{Deserialize, Serialize}');

    this.emitRaw('');
    this.emit('#[derive(Debug, Clone, Serialize, Deserialize)]');
    this.emit(`pub struct ${node.name} {`);
    this.indent++;

    for (const field of node.fields) {
      const rustType = this.mapType(field.type);
      const isOptional = field.modifiers.some(m => m.name === 'optional');
      const finalType = isOptional ? `Option<${rustType}>` : rustType;
      this.emit(`pub ${field.name}: ${finalType},`);
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');

    this.schemas.set(node.name, node);
  }

  // ===== CRUD =====

  visitCrud(appName, node) {
    const path = this.rawString(node.path);
    const schema = node.schemaName;

    this.emit(`// TODO: CRUD endpoints for ${schema} at ${path}`);
    this.emit(`// Use actix-web routes with a store (e.g., Arc<Mutex<Vec<${schema}>>>)`);
    this.emitRaw('');
  }

  // ===== Auth =====

  visitAuth(appName, node) {
    const secret = this.expr(node.secret);
    this.authSecret = secret;

    this.emit(`// TODO: JWT Auth middleware - use actix-web middleware + jsonwebtoken crate`);
    this.emit(`let __auth_secret: &str = ${secret};`);
    this.emitRaw('');
  }

  // ===== CORS =====

  visitCors(appName, node) {
    this.addUse('actix_cors::Cors');
    const origins = this.expr(node.origins);
    this.emit(`// CORS configured with origin: ${origins}`);
    this.emit(`// Add .wrap(Cors::default().allowed_origin(${origins})) to App`);
    this.emitRaw('');
  }

  // ===== Rate limit =====

  visitLimit(appName, node) {
    const path = this.rawString(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`// TODO: Rate limit ${max} requests per ${window} on ${path}`);
    this.emit(`// Use actix-governor crate`);
    this.emitRaw('');
  }

  // ===== Env =====

  visitEnv(node) {
    this.addUse('std::env');

    this.emitRaw('');
    for (const v of node.vars) {
      let defaultVal = null;
      for (const mod of v.modifiers) {
        if (mod.name === 'default') {
          defaultVal = this.expr(mod.args[0]);
        }
      }

      if (defaultVal !== null) {
        this.emit(`let ${v.name} = env::var("${v.name}").unwrap_or_else(|_| ${defaultVal}.to_string());`);
      } else {
        const isRequired = v.modifiers.some(m => m.name === 'required');
        if (isRequired) {
          this.emit(`let ${v.name} = env::var("${v.name}").expect("${v.name} is required");`);
        } else {
          this.emit(`let ${v.name} = env::var("${v.name}").ok();`);
        }
      }

      // Type coercion
      if (v.type === 'int') {
        this.emit(`let ${v.name}: i64 = ${v.name}.parse().unwrap_or(0);`);
      } else if (v.type === 'num') {
        this.emit(`let ${v.name}: f64 = ${v.name}.parse().unwrap_or(0.0);`);
      } else if (v.type === 'bool') {
        this.emit(`let ${v.name}: bool = matches!(${v.name}.to_lowercase().as_str(), "true" | "1" | "yes");`);
      }
    }
    this.emitRaw('');
  }

  // ===== Every (scheduler/cron) =====

  visitEvery(node) {
    const interval = this.expr(node.interval);
    this.emit(`// TODO: Scheduled task every ${interval} - use tokio-cron-scheduler crate`);
    this.emit('// scheduler.add(Job::new(interval, |_uuid, _l| {');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('// }));');
    this.emitRaw('');
  }

  // ===== Watch (event) =====

  visitWatch(node) {
    const params = node.params.length > 0 ? node.params.join(', ') : 'event';
    this.emit(`// TODO: Event watcher for "${node.eventName}" - use tokio::sync::broadcast`);
    this.emit(`// rx.recv() -> |${params}| {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('// }');
    this.emitRaw('');
  }

  // ===== Static files =====

  visitStatic(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.addUse('actix_files');
    this.emit(`// Static files: .service(actix_files::Files::new("/", ${JSON.stringify(raw)}).show_files_listing())`);
    this.emitRaw('');
  }

  // ===== WebSocket =====

  visitWs(node) {
    this.emit('// TODO: WebSocket support - use actix-web-actors crate');
    this.emit('// See https://actix.rs/docs/websockets/');
    this.emitRaw('');
  }

  // ===== Group (route scope) =====

  visitGroup(appName, node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`// Route group: web::scope("${prefix}")`);
    this.emit(`// .service(web::scope("${prefix}")`);
    this.indent++;
    for (const child of node.routes) {
      if (child.type === 'Route') {
        const funcName = this.routeFuncName(child.method, child.path);
        const method = child.method === 'del' ? 'delete' : child.method;
        const path = this.rawString(child.path);
        this.emit(`// .route("${path}", web::${method}().to(${funcName}))`);
        this.visitRouteHandler(funcName, child);
      } else {
        this.visitStatement(child);
      }
    }
    this.indent--;
    this.emit('// )');
    this.emitRaw('');
  }

  // ===== Error handler =====

  visitErrorHandler(appName, node) {
    this.emit('// Error handler middleware');
    this.emit('// App::new().app_data(web::JsonConfig::default().error_handler(|err, _req| {');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('// }))');
    this.emitRaw('');
  }

  // ===== Cookie =====

  visitCookie(appName, node) {
    this.emit('// TODO: Cookie support - use actix-web cookie features');
    this.emitRaw('');
  }

  // ===== Upload =====

  visitUpload(appName, node) {
    const path = this.rawString(node.path);
    const field = this.rawString(node.fieldName);
    this.emit(`// TODO: File upload at ${path} (field: ${field}) - use actix-multipart crate`);
    this.emitRaw('');
  }

  // ===== Session =====

  visitSession(appName, node) {
    this.emit('// TODO: Session support - use actix-session crate');
    this.emitRaw('');
  }

  // ===== View =====

  visitView(appName, node) {
    const dir = this.stringValue(node.dir);
    this.emit(`// TODO: Template rendering from ${dir} - use tera or askama crate`);
    this.emitRaw('');
  }

  // ===== SSE =====

  visitSse(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// TODO: Server-Sent Events at ${path} - use actix-web-lab SSE`);
    this.emitRaw('');
  }

  // ===== Cache =====

  visitCache(appName, node) {
    const path = this.rawString(node.path);
    const duration = this.expr(node.duration);
    this.emit(`// TODO: Cache ${path} for ${duration} - use actix-web middleware`);
    this.emitRaw('');
  }

  // ===== Middleware ref =====

  visitMiddlewareRef(appName, node) {
    if (node.path) {
      this.emit(`// middleware: ${node.name} on ${this.rawString(node.path)}`);
    } else {
      this.emit(`// middleware: ${node.name}`);
    }
    this.emitRaw('');
  }

  // ===== Render =====

  visitReturnRender(node) {
    const template = this.expr(node.template);
    const data = node.data ? this.expr(node.data) : '{}';
    this.emit(`// TODO: render template ${template} with data ${data}`);
    this.emit(`return HttpResponse::Ok().content_type("text/html").body(format!("rendered: {}", ${template}));`);
  }

  // ===== Redirect =====

  visitReturnRedirect(node) {
    this.addUse('actix_web::HttpResponse');
    this.emit(`return HttpResponse::build(actix_web::http::StatusCode::from_u16(${this.expr(node.statusCode)}).unwrap()).append_header(("Location", ${this.expr(node.url)})).finish();`);
  }

  // ===== Download =====

  visitReturnDownload(node) {
    this.emit(`// TODO: File download - use actix-files NamedFile`);
    this.emit(`// NamedFile::open(${this.expr(node.filePath)})`);
  }

  // ===== Validate =====

  visitValidate(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// TODO: Validation middleware on ${path} for ${node.schemaName} - use validator crate`);
    this.emitRaw('');
  }

  // ===== Test =====

  visitTest(node) {
    this.hasTests = true;
    const name = this.rawString(node.name);
    const funcName = `test_${name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}`;
    const needsAsync = this.bodyUsesAwait(node.body);

    this.emit('#[test]');
    if (needsAsync) {
      this.emit(`async fn ${funcName}() {`);
    } else {
      this.emit(`fn ${funcName}() {`);
    }
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Assert =====

  visitAssert(node) {
    this.hasAsserts = true;
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`assert_eq!(${this.expr(exprNode.left)}, ${this.expr(exprNode.right)});`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`assert_ne!(${this.expr(exprNode.left)}, ${this.expr(exprNode.right)});`);
    } else {
      this.emit(`assert!(${this.expr(exprNode)});`);
    }
  }

  // ===== Queue =====

  visitQueue(node) {
    this.emit(`// TODO: Job queue "${node.name}" - use tokio tasks or lapin (RabbitMQ) crate`);
    for (const job of node.jobs) {
      const jobName = this.generateString(job.name);
      this.emit(`// Job: ${jobName}`);
      this.indent++;
      for (const stmt of job.body) this.visitStatement(stmt);
      this.indent--;
    }
    this.emitRaw('');
  }

  // ===== OpenAPI =====

  visitOpenapi(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// TODO: OpenAPI spec at ${path} - use utoipa crate`);
    this.emitRaw('');
  }

  // ===== Prompt (template) =====

  visitPrompt(node) {
    const name = node.name;
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : `vec![${lines.join(', ')}].join("\\n")`;

    this.emit(`fn ${name}(vars: &std::collections::HashMap<String, String>) -> String {`);
    this.indent++;
    this.emit(`let mut template = ${template}.to_string();`);
    this.emit('for (k, v) in vars {');
    this.indent++;
    this.emit('template = template.replace(&format!("{{{}}}", k), v);');
    this.indent--;
    this.emit('}');
    this.emit('template');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'std::env::var("BOT_TOKEN").unwrap()';
    const botType = this.rawBotType(node.botType);

    this.emit(`// TODO: ${botType} bot "${node.name}" - use serenity (Discord) / teloxide (Telegram) crate`);
    this.emit(`// Token: ${tokenExpr}`);

    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        this.emit(`// on "${evtName}":`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
      } else if (handler.type === 'BotSlashCmd') {
        const cmdName = handler.name.raw || handler.name.parts?.map(p => p.value).join('');
        this.emit(`// slash command "/${cmdName}":`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
      }
    }
    this.emitRaw('');
  }

  rawBotType(bt) {
    if (!bt) return 'discord';
    return bt.raw || bt.parts?.map(p => p.value).join('') || 'discord';
  }

  // ===== Page (HTML generation) =====

  visitPage(node) {
    const filename = this.rawPageString(node.filename);
    this.addUse('std::fs');

    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`let __html = format!(r#"<!DOCTYPE html>`);
    this.emit(`<html lang="en">`);
    this.emit(`<head>`);
    this.emit(`<meta charset="UTF-8">`);
    this.emit(`<meta name="viewport" content="width=device-width, initial-scale=1.0">`);
    this.emit(`<title>{}</title>`);
    for (const h of headParts) this.emit(h);
    this.emit(`</head>`);
    this.emit(`<body>`);
    for (const b of bodyParts) this.emit(b);
    this.emit(`</body>`);
    this.emit(`</html>"#, ${JSON.stringify(pageTitle)});`);
    this.emit(`fs::write(${JSON.stringify(filename)}, __html).expect("Failed to write file");`);
    this.emit(`println!("Generated: ${filename}");`);
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
    if (tag === 'input') { body.push(`<input type="${arg0}" name="${arg1}" placeholder="${arg1}">`); return; }

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
    this.addUse('std::env');
    this.addUse('std::collections::HashMap');

    const name = node.name;
    const desc = node.description ? this.rawPageString(node.description) : name;

    this.emit(`fn main() {`);
    this.indent++;
    this.emit(`let __argv: Vec<String> = env::args().skip(1).collect();`);
    this.emit(`let mut args: HashMap<String, String> = HashMap::new();`);
    this.emitRaw('');

    this.emit(`if __argv.contains(&"--help".to_string()) || __argv.contains(&"-h".to_string()) {`);
    this.indent++;
    this.emit(`println!(${JSON.stringify(desc)});`);
    this.emit(`println!("Options:");`);
    for (const arg of node.args) {
      const argName = this.rawPageString(arg.name);
      const argDesc = arg.description ? this.rawPageString(arg.description) : '';
      this.emit(`println!("  --${argName} <${arg.type}>  ${argDesc}");`);
    }
    for (const flag of node.flags) {
      const s = this.rawPageString(flag.short);
      const l = this.rawPageString(flag.long);
      const d = flag.description ? this.rawPageString(flag.description) : '';
      this.emit(`println!("  -${s}, --${l}  ${d}");`);
    }
    this.emit(`std::process::exit(0);`);
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');

    this.emit(`let mut __i = 0;`);
    this.emit(`while __i < __argv.len() {`);
    this.indent++;
    for (const arg of node.args) {
      const argName = this.rawPageString(arg.name);
      this.emit(`if __argv[__i] == "--${argName}" {`);
      this.indent++;
      this.emit(`__i += 1;`);
      this.emit(`if __i < __argv.len() { args.insert("${argName}".to_string(), __argv[__i].clone()); }`);
      this.indent--;
      this.emit(`}`);
    }
    for (const flag of node.flags) {
      const s = this.rawPageString(flag.short);
      const l = this.rawPageString(flag.long);
      this.emit(`if __argv[__i] == "-${s}" || __argv[__i] == "--${l}" {`);
      this.indent++;
      this.emit(`args.insert("${l}".to_string(), "true".to_string());`);
      this.indent--;
      this.emit(`}`);
    }
    this.emit(`__i += 1;`);
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');

    if (node.run) {
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

    this.emit(`// TODO: Email - use lettre crate`);
    this.emit(`// let mailer = SmtpTransport::relay(${host})`);
    this.emit(`//     .unwrap()`);
    this.emit(`//     .port(${port})`);
    this.emit(`//     .build();`);
    this.emitRaw('');
  }

  // ===== GraphQL =====

  visitGraphql(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// TODO: GraphQL at ${path} - use async-graphql + actix-web integration`);
    this.emitRaw('');
  }

  // ===== Desktop (Tauri) =====

  visitDesktop(node) {
    const title = node.title ? this.rawPageString(node.title) : node.name;
    const width = node.width ? this.expr(node.width) : '800';
    const height = node.height ? this.expr(node.height) : '600';

    this.emit(`// TODO: Desktop app "${title}" - use Tauri framework`);
    this.emit(`// tauri::Builder::default()`);
    this.emit(`//     .run(tauri::generate_context!())`);
    this.emit(`//     .expect("error running tauri app");`);
    this.emit(`// Window size: ${width}x${height}`);
    this.emitRaw('');
  }

  // ===== Screen (mobile/UI) =====

  visitScreen(node) {
    this.emit(`// TODO: Mobile screen "${node.name}" - use Dioxus or egui crate`);
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
      this.emit(`// ${tag}: ${arg0}`);
    }
    this.emitRaw('');
  }

  // ===== OAuth =====

  visitOauth(node) {
    const provider = this.rawPageString(node.provider);
    const clientId = this.expr(node.clientId);
    const clientSecret = this.expr(node.clientSecret);
    const callback = node.callback ? this.rawPageString(node.callback) : '/auth/callback';

    this.emit(`// TODO: OAuth (${provider}) - use oauth2 crate`);
    this.emit(`// let client = BasicClient::new(`);
    this.emit(`//     ClientId::new(${clientId}.to_string()),`);
    this.emit(`//     Some(ClientSecret::new(${clientSecret}.to_string())),`);
    this.emit(`//     AuthUrl::new("...").unwrap(),`);
    this.emit(`//     Some(TokenUrl::new("...").unwrap()),`);
    this.emit(`// );`);
    this.emit(`// Callback: ${callback}`);
    this.emitRaw('');
  }

  // ===== Pay (Stripe) =====

  visitPay(node) {
    const provider = this.rawPageString(node.provider);
    const secretKey = this.expr(node.secretKey);

    this.emit(`// TODO: Payment (${provider}) - use stripe-rust crate`);
    this.emit(`// let client = stripe::Client::new(${secretKey});`);
    this.emitRaw('');
  }

  // ===== Storage (S3) =====

  visitStorage(node) {
    const provider = this.rawPageString(node.provider);
    const bucket = this.expr(node.bucket);

    if (provider === 's3') {
      this.emit(`// TODO: S3 storage - use aws-sdk-s3 crate`);
      this.emit(`// let config = aws_config::load_from_env().await;`);
      this.emit(`// let s3_client = aws_sdk_s3::Client::new(&config);`);
      this.emit(`// Bucket: ${bucket}`);
    } else if (provider === 'gcs') {
      this.emit(`// TODO: GCS storage - use cloud-storage crate`);
      this.emit(`// Bucket: ${bucket}`);
    } else {
      this.emit(`// TODO: ${provider} storage integration`);
    }
    this.emitRaw('');
  }

  // ===== PDF =====

  visitPdf(node) {
    const filename = this.rawPageString(node.filename);

    this.emit(`// TODO: PDF generation "${filename}" - use printpdf or genpdf crate`);
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
      this.emit(`// ${tag}: ${arg0}`);
    }
    this.emitRaw('');
  }

  // ===== i18n =====

  visitI18n(node) {
    const dir = this.rawPageString(node.dir);
    const defaultLang = node.defaultLang ? this.rawPageString(node.defaultLang) : 'en';

    this.addUse('std::collections::HashMap');
    this.addUse('std::fs');

    this.emit(`// i18n setup: ${dir}, default: ${defaultLang}`);
    this.emit(`let mut __i18n_data: HashMap<String, serde_json::Value> = HashMap::new();`);
    for (const lang of node.langs) {
      const code = this.rawPageString(lang.code);
      const file = this.rawPageString(lang.file);
      this.emit(`__i18n_data.insert("${code}".to_string(), serde_json::from_str(&fs::read_to_string("${dir}/${file}").unwrap()).unwrap());`);
    }
    this.emit(`let mut __i18n_lang = "${defaultLang}".to_string();`);
    this.emitRaw('');
  }

  // ===== Push =====

  visitPush(node) {
    const publicKey = this.expr(node.publicKey);
    const privateKey = this.expr(node.privateKey);

    this.emit(`// TODO: Push notifications - use web-push crate`);
    this.emit(`// VAPID public key: ${publicKey}`);
    this.emit(`// VAPID private key: ${privateKey}`);
    this.emitRaw('');
  }

  // ===== Search =====

  visitSearch(node) {
    const engine = this.rawPageString(node.engine);
    const host = this.expr(node.host);

    if (engine === 'meilisearch') {
      this.emit(`// TODO: Meilisearch - use meilisearch-sdk crate`);
      this.emit(`// let client = meilisearch_sdk::Client::new(${host}, api_key);`);
    } else {
      this.emit(`// TODO: Elasticsearch - use elasticsearch crate`);
      this.emit(`// let client = Elasticsearch::new(Transport::single_node(${host}).unwrap());`);
    }
    this.emitRaw('');
  }

  // ===== Image =====

  visitImage(node) {
    const input = this.expr(node.input);
    const output = node.output ? this.expr(node.output) : input;

    this.emit(`// TODO: Image processing - use image crate`);
    this.emit(`// let mut img = image::open(${input}).unwrap();`);

    for (const op of node.operations) {
      if (op.op === 'resize') {
        const w = op.args[0] || 800;
        const h = op.args[1] || 600;
        this.emit(`// img = img.resize(${w}, ${h}, image::imageops::FilterType::Lanczos3);`);
      } else if (op.op === 'crop') {
        const l = op.args[0] || 0, t = op.args[1] || 0, w = op.args[2] || 100, h = op.args[3] || 100;
        this.emit(`// img = img.crop(${l}, ${t}, ${w}, ${h});`);
      } else if (op.op === 'rotate') {
        this.emit(`// img = img.rotate${op.args[0] || 90}();`);
      } else if (op.op === 'blur') {
        this.emit(`// img = img.blur(${op.args[0] || 5.0});`);
      } else if (op.op === 'grayscale' || op.op === 'greyscale') {
        this.emit(`// img = img.grayscale();`);
      } else if (op.op === 'flip') {
        this.emit(`// img = img.flipv();`);
      }
    }

    this.emit(`// img.save(${output}).unwrap();`);
    this.emit(`// println!("Processed: {}", ${output});`);
    this.emitRaw('');
  }

  // ===== CSV/Excel =====

  visitCsv(node) {
    const name = this.rawPageString(node.name);
    const format = node.format ? this.rawPageString(node.format) : 'csv';
    const output = node.output ? this.rawPageString(node.output) : `${name}.${format}`;

    if (format === 'xlsx' || format === 'excel') {
      this.emit(`// TODO: Excel export "${output}" - use rust_xlsxwriter or calamine crate`);
    } else {
      this.emit(`// TODO: CSV export "${output}" - use csv crate`);
      this.emit(`// let mut wtr = csv::Writer::from_path("${output}").unwrap();`);
    }
    this.emitRaw('');
  }

  // ===== Logging =====

  visitLogging(node) {
    const name = this.rawPageString(node.name);
    const level = node.level ? this.rawPageString(node.level) : 'info';
    const file = node.file ? this.rawPageString(node.file) : null;

    this.addUse('log');
    this.emit(`// Logging: "${name}" at level ${level} - use env_logger or tracing crate`);
    this.emit(`// env_logger::Builder::new().filter_level(log::LevelFilter::${level.charAt(0).toUpperCase() + level.slice(1)}).init();`);
    if (file) {
      this.emit(`// File logging to: ${file} - use fern or tracing-appender crate`);
    }
    this.emitRaw('');
  }

  // ===== DB Migration =====

  visitMigrate(node) {
    const name = this.rawPageString(node.name);

    this.emit(`// TODO: DB Migration "${name}" - use sqlx::migrate! or diesel migrations`);
    this.emit(`// Up:`);
    this.indent++;
    for (const stmt of node.up) this.visitStatement(stmt);
    this.indent--;
    this.emit(`// Down:`);
    this.indent++;
    for (const stmt of node.down) this.visitStatement(stmt);
    this.indent--;
    this.emitRaw('');
  }

  // ===== gRPC =====

  visitGrpc(node) {
    const name = this.rawPageString(node.name);
    const port = node.port ? this.expr(node.port) : '50051';

    this.emit(`// TODO: gRPC server "${name}" on port ${port} - use tonic crate`);
    for (const rpc of node.rpcs) {
      this.emit(`// RPC: ${rpc.method}`);
      this.indent++;
      for (const stmt of rpc.body) this.visitStatement(stmt);
      this.indent--;
    }
    this.emitRaw('');
  }

  // ===== WebRTC =====

  visitWebrtc(node) {
    const name = this.rawPageString(node.name);
    const stun = node.stun ? this.rawPageString(node.stun) : 'stun:stun.l.google.com:19302';

    this.emit(`// TODO: WebRTC "${name}" - use webrtc crate`);
    this.emit(`// STUN server: ${stun}`);
    for (const evt of node.events) {
      this.emit(`// Event: ${evt.event}`);
      this.indent++;
      for (const stmt of evt.body) this.visitStatement(stmt);
      this.indent--;
    }
    this.emitRaw('');
  }

  // ===== Blockchain =====

  visitBlockchain(node) {
    const name = this.rawPageString(node.name);
    const provider = node.provider ? this.expr(node.provider) : '"http://localhost:8545"';

    this.emit(`// TODO: Blockchain "${name}" - use ethers-rs or web3 crate`);
    this.emit(`// Provider: ${provider}`);
    this.emitRaw('');
  }

  // ===== Expression generation =====

  expr(node) {
    if (!node) return 'None';

    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return this.generateString(node.value);
      case 'Bool': return node.value ? 'true' : 'false';
      case 'Null': return 'None';
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
        const op = this.mapUnaryOp(node.op);
        return `${op}${this.expr(node.expr)}`;
      }

      case 'Await':
        this.hasAsync = true;
        return `${this.expr(node.expr)}.await`;

      case 'AwaitAllExpr':
        this.hasAsync = true;
        this.addUse('futures::future::join_all');
        return `join_all(${this.expr(node.expr)}).await`;

      case 'Spread':
        // Rust doesn't have spread; pass through
        return `/* spread */ ${this.expr(node.expr)}`;

      case 'New':
        return this.expr(node.expr);

      case 'TypeOf':
        return `std::any::type_name_of_val(&${this.expr(node.expr)})`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

      case 'OptionalAccess':
        return `${this.expr(node.object)}.as_ref().map(|v| &v.${node.property})`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array':
        return `vec![${node.elements.map(e => this.expr(e)).join(', ')}]`;

      case 'Object': {
        this.addUse('serde_json::json');
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `/* spread: ${this.expr(p.value)} */`;
          if (p.type === 'shorthand') return `"${p.key}": ${p.key}`;
          const key = typeof p.key === 'string' ? JSON.stringify(p.key) :
                      (p.key.type === 'String' ? this.generateString(p.key.value) :
                       (p.key.type === 'Computed' ? this.expr(p.key.expr) : `"${this.expr(p.key)}"`));
          return `${key}: ${this.expr(p.value)}`;
        }).join(', ');
        return `json!({${props}})`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        if (node.params.length === 1) return `|${params}| ${body}`;
        return `|${params}| ${body}`;
      }

      case 'Lambda': {
        const asyncKw = node.isAsync ? '/* async */ ' : '';
        const params = node.params.map(p => p.name).join(', ');
        const bodyLines = [];
        const savedOutput = this.output;
        const savedIndent = this.indent;
        this.output = bodyLines;
        this.indent = 0;
        for (const stmt of node.body) this.visitStatement(stmt);
        this.output = savedOutput;
        this.indent = savedIndent;
        return `${asyncKw}|${params}| { ${bodyLines.join(' ')} }`;
      }

      case 'Ternary':
        return `if ${this.expr(node.condition)} { ${this.expr(node.consequent)} } else { ${this.expr(node.alternate)} }`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `/* expr:${node.type} */`;
    }
  }

  mapIdentifier(name) {
    const map = {
      'null': 'None',
      'undefined': 'None',
      'true': 'true',
      'false': 'false',
      'this': 'self',
      'console': 'println!',
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
      '**': '.pow',
      'instanceof': '/* instanceof */',
      'in': '/* in */',
    };
    return map[op] || op;
  }

  mapUnaryOp(op) {
    if (op === '!' || op === 'not') return '!';
    return op;
  }

  mapMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    // Map common JS properties to Rust
    if (prop === 'length') return `${obj}.len()`;
    if (prop === 'toString') return `${obj}.to_string()`;

    // Request mapping for actix-web
    if ((obj === 'request' || obj === 'req') && prop === 'body') return 'body.into_inner()';
    if ((obj === 'request' || obj === 'req') && prop === 'query') return 'req.query_string()';
    if ((obj === 'request' || obj === 'req') && prop === 'params') return 'req.match_info()';
    if ((obj === 'request' || obj === 'req') && prop === 'headers') return 'req.headers()';
    if ((obj === 'request' || obj === 'req') && prop === 'method') return 'req.method()';
    if ((obj === 'request' || obj === 'req') && prop === 'url') return 'req.uri()';

    // JSON methods
    if (obj === 'JSON' && prop === 'parse') return 'serde_json::from_str';
    if (obj === 'JSON' && prop === 'stringify') return 'serde_json::to_string';

    // Math methods
    if (obj === 'Math' && prop === 'floor') return 'f64::floor';
    if (obj === 'Math' && prop === 'ceil') return 'f64::ceil';
    if (obj === 'Math' && prop === 'round') return 'f64::round';
    if (obj === 'Math' && prop === 'abs') return 'f64::abs';
    if (obj === 'Math' && prop === 'min') return 'f64::min';
    if (obj === 'Math' && prop === 'max') return 'f64::max';
    if (obj === 'Math' && prop === 'random') return 'rand::random::<f64>';
    if (obj === 'Math' && prop === 'PI') return 'std::f64::consts::PI';

    // console methods
    if (obj === 'console' && prop === 'log') return 'println!';
    if (obj === 'console' && prop === 'error') return 'eprintln!';
    if (obj === 'console' && prop === 'warn') return 'eprintln!';

    // Date
    if (obj === 'Date' && prop === 'now') {
      this.addUse('std::time::{SystemTime, UNIX_EPOCH}');
      return 'SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis';
    }

    return `${obj}.${prop}`;
  }

  generateCall(node) {
    if (node.callee.type === 'Identifier') {
      const argList = node.args.map(a => this.expr(a));
      const b = this.generateBuiltin(node.callee.name, argList);
      if (b) return b;
    }

    const args = node.args.map(a => this.expr(a)).join(', ');

    // Map common JS global functions to Rust
    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;

      if (name === 'parseInt') return `${args}.parse::<i64>().unwrap_or(0)`;
      if (name === 'parseFloat') return `${args}.parse::<f64>().unwrap_or(0.0)`;
      if (name === 'String') return `${args}.to_string()`;
      if (name === 'Number') return `${args}.parse::<f64>().unwrap_or(0.0)`;
      if (name === 'Boolean') return `(${args} != 0)`;
      if (name === 'isNaN') return `${args}.is_nan()`;
      if (name === 'setTimeout') return `/* setTimeout */ tokio::time::sleep(std::time::Duration::from_millis(${args}))`;
      if (name === 'setInterval') return `/* setInterval - use tokio::spawn with loop */`;
    }

    // Map common method calls
    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // Vec/array methods
      if (prop === 'push') return `${obj}.push(${args})`;
      if (prop === 'pop') return `${obj}.pop()`;
      if (prop === 'shift') return `${obj}.remove(0)`;
      if (prop === 'unshift') return `${obj}.insert(0, ${args})`;
      if (prop === 'indexOf') return `${obj}.iter().position(|x| *x == ${args}).unwrap_or(usize::MAX)`;
      if (prop === 'includes') return `${obj}.contains(&${args})`;
      if (prop === 'join') return `${obj}.join(${args})`;
      if (prop === 'slice') return `${obj}[${args}].to_vec()`;
      if (prop === 'forEach') return `${obj}.iter().for_each(${args})`;
      if (prop === 'map') return `${obj}.iter().map(${args}).collect::<Vec<_>>()`;
      if (prop === 'filter') return `${obj}.iter().filter(${args}).cloned().collect::<Vec<_>>()`;
      if (prop === 'find') return `${obj}.iter().find(${args})`;
      if (prop === 'some') return `${obj}.iter().any(${args})`;
      if (prop === 'every') return `${obj}.iter().all(${args})`;
      if (prop === 'reduce') return `${obj}.iter().fold(Default::default(), ${args})`;
      if (prop === 'flat') return `${obj}.into_iter().flatten().collect::<Vec<_>>()`;
      if (prop === 'reverse') { return `{ let mut __r = ${obj}.clone(); __r.reverse(); __r }`; }
      if (prop === 'sort') { return `{ let mut __s = ${obj}.clone(); __s.sort(); __s }`; }
      if (prop === 'concat') return `[${obj}.as_slice(), ${args}.as_slice()].concat()`;

      // String methods
      if (prop === 'split') return `${obj}.split(${args}).collect::<Vec<&str>>()`;
      if (prop === 'trim') return `${obj}.trim()`;
      if (prop === 'trimStart') return `${obj}.trim_start()`;
      if (prop === 'trimEnd') return `${obj}.trim_end()`;
      if (prop === 'toUpperCase') return `${obj}.to_uppercase()`;
      if (prop === 'toLowerCase') return `${obj}.to_lowercase()`;
      if (prop === 'startsWith') return `${obj}.starts_with(${args})`;
      if (prop === 'endsWith') return `${obj}.ends_with(${args})`;
      if (prop === 'replace') return `${obj}.replace(${args})`;
      if (prop === 'replaceAll') return `${obj}.replace(${args})`;
      if (prop === 'padStart') return `format!("{:>width$}", ${obj}, width = ${args})`;
      if (prop === 'padEnd') return `format!("{:<width$}", ${obj}, width = ${args})`;
      if (prop === 'charAt') return `${obj}.chars().nth(${args})`;
      if (prop === 'substring') return `&${obj}[${args}]`;
      if (prop === 'repeat') return `${obj}.repeat(${args})`;

      // Object/HashMap methods
      if (obj === 'Object' && prop === 'keys') return `${args}.keys().collect::<Vec<_>>()`;
      if (obj === 'Object' && prop === 'values') return `${args}.values().collect::<Vec<_>>()`;
      if (obj === 'Object' && prop === 'entries') return `${args}.iter().collect::<Vec<_>>()`;

      // Array static
      if (obj === 'Array' && prop === 'isArray') return `/* Array.isArray check */`;
      if (obj === 'Array' && prop === 'from') return `${args}.into_iter().collect::<Vec<_>>()`;

      // Promise -> tokio
      if (obj === 'Promise' && prop === 'all') {
        this.addUse('futures::future::join_all');
        return `join_all(${args}).await`;
      }
      if (obj === 'Promise' && prop === 'resolve') return `async { ${args} }`;

      // Date
      if (obj === 'Date' && prop === 'now') {
        this.addUse('std::time::{SystemTime, UNIX_EPOCH}');
        return 'SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64';
      }

      // console calls with arguments
      if (obj === 'console' || (node.callee.object.type === 'Identifier' && node.callee.object.name === 'console')) {
        if (prop === 'log') return `println!("{:?}", ${args})`;
        if (prop === 'error') return `eprintln!("{:?}", ${args})`;
        if (prop === 'warn') return `eprintln!("{:?}", ${args})`;
      }
    }

    const callee = this.expr(node.callee);
    // Handle println!/eprintln! macro calls
    if (callee === 'println!' || callee === 'eprintln!') {
      return `${callee}("{:?}", ${args})`;
    }
    return `${callee}(${args})`;
  }

  generatePipe(node) {
    const steps = [];
    let current = node;
    while (current.type === 'Pipe') {
      steps.unshift(current.right);
      current = current.left;
    }
    steps.unshift(current);

    const ITER_METHODS = new Set(['filter', 'map', 'reduce', 'find', 'some', 'every', 'sort', 'reverse', 'join', 'flat']);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier') {
        const name = step.callee.name;
        const args = step.args.map(a => this.expr(a)).join(', ');

        if (name === 'filter') {
          result = `${result}.into_iter().filter(${args}).collect::<Vec<_>>()`;
        } else if (name === 'map') {
          result = `${result}.into_iter().map(${args}).collect::<Vec<_>>()`;
        } else if (name === 'reduce') {
          result = `${result}.into_iter().fold(Default::default(), ${args})`;
        } else if (name === 'sort') {
          result = `{ let mut __s = ${result}; __s.sort(); __s }`;
        } else if (name === 'reverse') {
          result = `{ let mut __r = ${result}; __r.reverse(); __r }`;
        } else if (name === 'join') {
          result = `${result}.join(${args})`;
        } else if (name === 'find') {
          result = `${result}.into_iter().find(${args})`;
        } else if (name === 'some') {
          result = `${result}.iter().any(${args})`;
        } else if (name === 'every') {
          result = `${result}.iter().all(${args})`;
        } else if (name === 'flat') {
          result = `${result}.into_iter().flatten().collect::<Vec<_>>()`;
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

  // ===== Utility =====

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
    this.emit(`#[derive(Debug, Clone, Copy, PartialEq)]`);
    this.emit(`enum ${node.name} {`);
    this.indent++;
    node.values.forEach(v => {
      this.emit(`${v},`);
    });
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
  }

  visitSwap(node) {
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    this.emit(`std::mem::swap(&mut ${a}, &mut ${b});`);
  }

  generateBuiltin(name, args) {
    switch (name) {
      case 'len': return `${args[0]}.len()`;
      case 'str': return `${args[0]}.to_string()`;
      case 'int': return `${args[0]}.parse::<i64>().unwrap_or(0)`;
      case 'float': return `${args[0]}.parse::<f64>().unwrap_or(0.0)`;
      case 'upper': return `${args[0]}.to_uppercase()`;
      case 'lower': return `${args[0]}.to_lowercase()`;
      case 'trim': return `${args[0]}.trim().to_string()`;
      case 'split': return `${args[0]}.split(${args[1] || '","'}).collect::<Vec<&str>>()`;
      case 'join': return `${args[0]}.join(${args[1] || '","'})`;
      case 'contains': return `${args[0]}.contains(${args[1]})`;
      case 'replace': return `${args[0]}.replace(${args[1]}, ${args[2]})`;
      case 'sort': return `{ let mut v = ${args[0]}.clone(); v.sort(); v }`;
      case 'reverse': return `{ let mut v = ${args[0]}.clone(); v.reverse(); v }`;
      case 'abs': return `${args[0]}.abs()`;
      case 'sqrt': return `(${args[0]} as f64).sqrt()`;
      case 'pow': return `(${args[0]} as f64).powi(${args[1]} as i32)`;
      case 'ceil': return `(${args[0]} as f64).ceil()`;
      case 'floor': return `(${args[0]} as f64).floor()`;
      case 'round': return `(${args[0]} as f64).round()`;
      case 'sum': return `${args[0]}.iter().sum::<i64>()`;
      case 'unique': return `{ let mut v = ${args[0]}.clone(); v.sort(); v.dedup(); v }`;
      case 'exit': return `std::process::exit(${args[0] || '0'})`;
      case 'sleep': return `std::thread::sleep(std::time::Duration::from_millis(${args[0]} as u64))`;
      case 'now': return `std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64`;
      case 'random': return args.length >= 2 ? `rand::thread_rng().gen_range(${args[0]}..=${args[1]})` : `rand::random::<f64>()`;
      case 'keys': return `${args[0]}.keys().cloned().collect::<Vec<_>>()`;
      case 'values': return `${args[0]}.values().cloned().collect::<Vec<_>>()`;
      case 'range': return args.length >= 2 ? `(${args[0]}..${args[1]}).collect::<Vec<_>>()` : `(0..${args[0]}).collect::<Vec<_>>()`;
      case 'flat': return `${args[0]}.into_iter().flatten().collect::<Vec<_>>()`;
      default: return null;
    }
  }
}
