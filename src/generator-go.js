export class GoGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.imports = new Set();
    this.models = new Map();
    this.schemas = new Map();
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.authSecret = null;
    this.dbVar = null;
    this.varTypes = new Map();
    this.declaredVars = new Set();
  }

  generate(ast) {
    this.visitProgram(ast);

    const preamble = ['package main', ''];
    if (this.imports.size > 0) {
      preamble.push('import (');
      for (const imp of [...this.imports].sort()) {
        preamble.push(`\t"${imp}"`);
      }
      preamble.push(')');
      preamble.push('');
    }

    this.output.unshift(...preamble);
    return this.output.join('\n');
  }

  emit(line) {
    this.output.push('\t'.repeat(this.indent) + line);
    this.sourceMap.push(this.currentSourceLine);
  }

  emitRaw(line) {
    this.output.push(line);
    this.sourceMap.push(this.currentSourceLine);
  }

  addImport(mod) {
    this.imports.add(mod);
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
      case 'AuthDecl': return this.visitAuth(node);
      case 'CorsDecl': return this.visitCors(node);
      case 'EnvDecl': return this.visitEnv(node);
      case 'TestDecl': return this.visitTest(node);
      case 'AssertStmt': return this.visitAssert(node);
      case 'ErrorHandler': return this.visitErrorHandler(node);
      case 'CrudDecl': return this.visitCrud(node);
      case 'StaticDecl': return this.visitStatic(node);
      case 'LimitDecl': return this.visitLimit(node);
      case 'WsDecl': return this.visitWs(node);
      case 'SessionDecl': return this.visitSession(node);
      case 'CacheDecl': return this.visitCache(node);
      case 'EveryDecl': return this.visitEvery(node);
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
      'str': 'string',
      'string': 'string',
      'int': 'int',
      'integer': 'int',
      'num': 'float64',
      'number': 'float64',
      'float': 'float64',
      'bool': 'bool',
      'boolean': 'bool',
      'list': '[]interface{}',
      'map': 'map[string]interface{}',
      'json': 'interface{}',
      'any': 'interface{}',
      'void': '',
    };
    return map[naideType] || naideType;
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const alias = node.alias || node.name;
    const goModule = this.mapModuleName(raw);
    this.emit(`// import: ${alias} from "${goModule}"`);
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const goModule = this.mapModuleName(raw);
    const names = node.names.map(n => n.alias ? `${n.name} as ${n.alias}` : n.name).join(', ');
    this.emit(`// import { ${names} } from "${goModule}"`);
  }

  mapModuleName(name) {
    const clean = name.replace(/^['"]|['"]$/g, '');
    const map = {
      'express': 'net/http',
      'axios': 'net/http',
      'fs': 'os',
      'path': 'path/filepath',
      'crypto': 'crypto',
      'uuid': 'github.com/google/uuid',
    };
    return map[clean] || clean;
  }

  // ===== Functions =====

  visitFunction(node) {
    const params = node.params.map(p => {
      let s = p.name;
      if (p.type) {
        s += ' ' + this.mapType(p.type);
      } else {
        s += ' interface{}';
      }
      return s;
    }).join(', ');

    const returnType = node.returnType ? ' ' + this.mapType(node.returnType) : '';

    this.emit(`func ${node.name}(${params})${returnType} {`);
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
    this.addImport('encoding/json');
    this.addImport('net/http');
    this.emit(`w.WriteHeader(${this.expr(node.statusCode)})`);
    this.emit(`json.NewEncoder(w).Encode(${this.expr(node.body)})`);
    this.emit('return');
  }

  visitReturnMethod(node) {
    this.addImport('net/http');
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`http.Redirect(w, r, ${val}, http.StatusFound)`);
        break;
      case 'html':
        this.emit(`w.Header().Set("Content-Type", "text/html")`);
        this.emit(`fmt.Fprint(w, ${val})`);
        this.addImport('fmt');
        break;
      case 'text':
        this.emit(`w.Header().Set("Content-Type", "text/plain")`);
        this.emit(`fmt.Fprint(w, ${val})`);
        this.addImport('fmt');
        break;
      case 'file':
        this.emit(`http.ServeFile(w, r, ${val})`);
        break;
      default:
        this.emit(`fmt.Fprint(w, ${val})`);
        this.addImport('fmt');
    }
    this.emit('return');
  }

  // ===== Variables =====

  visitTypedVar(node) {
    const value = this.expr(node.value);
    if (node.varType) {
      const goType = this.mapType(node.varType);
      this.emit(`var ${node.name} ${goType} = ${value}`);
    } else {
      this.emit(`${node.name} := ${value}`);
    }
    this.declaredVars.add(node.name);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      // Go doesn't have destructuring; emit individual assignments
      this.emit(`__tmp := ${value}`);
      node.target.elements.forEach((e, i) => {
        this.emit(`${this.expr(e)} := __tmp[${i}]`);
      });
    } else if (node.target.type === 'Object') {
      this.emit(`__d := ${value}`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`${varName} := __d[${JSON.stringify(key)}]`);
      }
    } else {
      const target = this.expr(node.target);
      if (this.declaredVars.has(target)) {
        this.emit(`${target} = ${value}`);
      } else {
        this.emit(`${target} := ${value}`);
        this.declaredVars.add(target);
      }
    }
  }

  visitCompoundAssign(node) {
    this.emit(`${this.expr(node.target)} ${node.op} ${this.expr(node.value)}`);
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
      this.emit(`for ${node.key}, ${node.value} := range ${collection} {`);
    } else {
      this.emit(`for _, ${node.value} := range ${collection} {`);
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
    this.emit(`for ${varName} := ${start}; ${varName} < ${end}; ${varName}++ {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
  }

  visitWhile(node) {
    this.emit(`for ${this.expr(node.condition)} {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
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
    // Go uses error-returning pattern instead of try/catch.
    // We wrap in a func with deferred recover for panic-based errors.
    this.emit('func() {');
    this.indent++;
    if (node.catchBody) {
      const catchParam = node.catchVar || 'err';
      this.emit('defer func() {');
      this.indent++;
      this.emit(`if r := recover(); r != nil {`);
      this.indent++;
      this.addImport('fmt');
      this.emit(`${catchParam} := fmt.Errorf("%v", r)`);
      for (const stmt of node.catchBody) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
      this.indent--;
      this.emit('}()');
    }
    if (node.ensureBody) {
      this.emit('defer func() {');
      this.indent++;
      for (const stmt of node.ensureBody) this.visitStatement(stmt);
      this.indent--;
      this.emit('}()');
    }
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}()');
  }

  // ===== Server (net/http) =====

  visitServer(node) {
    this.addImport('net/http');
    this.addImport('fmt');
    this.addImport('encoding/json');

    this.emitRaw('');

    // Emit helper function for JSON responses
    this.emit('func jsonResponse(w http.ResponseWriter, data interface{}) {');
    this.indent++;
    this.emit('w.Header().Set("Content-Type", "application/json")');
    this.emit('json.NewEncoder(w).Encode(data)');
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    // Emit middleware
    for (const mid of node.middleware) {
      this.emit(`// middleware`);
    }

    const errorHandlers = [];

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors(child);
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(child);
      } else if (child.type === 'StaticDecl') {
        this.visitStatic(child);
      } else if (child.type === 'LimitDecl') {
        this.visitLimit(child);
      } else if (child.type === 'WsDecl') {
        this.visitWs(child);
      } else if (child.type === 'SessionDecl') {
        this.visitSession(child);
      } else if (child.type === 'CacheDecl') {
        this.visitCache(child);
      } else if (child.type === 'GraphqlDecl') {
        this.emit(`// GraphQL: use github.com/graphql-go/graphql`);
      } else {
        this.visitStatement(child);
      }
    }

    for (const eh of errorHandlers) {
      this.visitErrorHandler(eh);
    }

    const port = node.port ? this.rawExprValue(node.port) : '3000';
    this.emitRaw('');
    this.emit(`func main() {`);
    this.indent++;
    this.emit(`fmt.Println("Server running on port ${port}")`);
    this.emit(`http.ListenAndServe(":${port}", nil)`);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitRoute(route) {
    this.addImport('net/http');
    this.addImport('encoding/json');

    const method = route.method === 'del' ? 'DELETE' : route.method.toUpperCase();
    const path = this.rawString(route.path);

    this.emit(`http.HandleFunc("${path}", func(w http.ResponseWriter, r *http.Request) {`);
    this.indent++;
    if (method !== 'GET') {
      this.emit(`if r.Method != "${method}" {`);
      this.indent++;
      this.emit(`http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)`);
      this.emit('return');
      this.indent--;
      this.emit('}');
    }

    for (const stmt of route.body) {
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`jsonResponse(w, ${this.expr(stmt.value)})`);
        this.emit('return');
      } else {
        this.visitStatement(stmt);
      }
    }

    this.indent--;
    this.emit('})');
    this.emitRaw('');
  }

  visitGroup(node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`// group: ${prefix}`);
    for (const child of node.routes) {
      if (child.type === 'Route') {
        // Prepend group prefix to route path
        const origPath = this.rawString(child.path);
        const fullPath = prefix + origPath;
        this.emit(`http.HandleFunc("${fullPath}", func(w http.ResponseWriter, r *http.Request) {`);
        this.indent++;
        const method = child.method === 'del' ? 'DELETE' : child.method.toUpperCase();
        if (method !== 'GET') {
          this.emit(`if r.Method != "${method}" {`);
          this.indent++;
          this.emit(`http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)`);
          this.emit('return');
          this.indent--;
          this.emit('}');
        }
        for (const stmt of child.body) {
          if (stmt.type === 'Return' && stmt.value !== null) {
            this.emit(`jsonResponse(w, ${this.expr(stmt.value)})`);
            this.emit('return');
          } else {
            this.visitStatement(stmt);
          }
        }
        this.indent--;
        this.emit('})');
        this.emitRaw('');
      } else {
        this.visitStatement(child);
      }
    }
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'os.Getenv("BOT_TOKEN")';
    const botType = this.rawBotType(node.botType);

    if (botType === 'discord') {
      this.emit(`// Discord bot: use github.com/bwmarrin/discordgo`);
      this.emit(`// token: ${tokenExpr}`);
    } else if (botType === 'slack') {
      this.emit(`// Slack bot: use github.com/slack-go/slack`);
      this.emit(`// token: ${tokenExpr}`);
    } else if (botType === 'telegram') {
      this.emit(`// Telegram bot: use github.com/go-telegram-bot-api/telegram-bot-api`);
      this.emit(`// token: ${tokenExpr}`);
    } else if (botType === 'line') {
      this.emit(`// LINE bot: use github.com/line/line-bot-sdk-go`);
      this.emit(`// token: ${tokenExpr}`);
    } else {
      this.emit(`// ${botType} bot: configure appropriate Go library`);
      this.emit(`// token: ${tokenExpr}`);
    }
    this.emitRaw('');

    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        this.emit(`// on "${evtName}":`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emitRaw('');
      } else if (handler.type === 'BotSlashCmd') {
        const cmdName = handler.name.raw || handler.name.parts?.map(p => p.value).join('');
        this.emit(`// slash command "/${cmdName}":`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emitRaw('');
      }
    }
  }

  rawBotType(bt) {
    if (!bt) return 'discord';
    return bt.raw || bt.parts?.map(p => p.value).join('') || 'discord';
  }

  // ===== Model (struct) =====

  visitModel(node) {
    this.models.set(node.name, node);

    this.emit(`type ${node.name} struct {`);
    this.indent++;

    if (node.parent) {
      this.emit(`${node.parent} // embedded parent`);
    }

    for (const f of node.fields) {
      const goType = f.type ? this.mapType(f.type) : 'interface{}';
      const fieldName = f.name.charAt(0).toUpperCase() + f.name.slice(1);
      this.emit(`${fieldName} ${goType} \`json:"${f.name}"\``);
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');

    // Constructor function
    if (node.fields.length > 0) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const params = allFields.map(f => {
        const goType = f.type ? this.mapType(f.type) : 'interface{}';
        return `${f.name} ${goType}`;
      }).join(', ');

      this.emit(`func New${node.name}(${params}) ${node.name} {`);
      this.indent++;
      this.emit(`return ${node.name}{`);
      this.indent++;
      for (const f of node.fields) {
        const fieldName = f.name.charAt(0).toUpperCase() + f.name.slice(1);
        this.emit(`${fieldName}: ${f.name},`);
      }
      this.indent--;
      this.emit('}');
      this.indent--;
      this.emit('}');
      this.emitRaw('');
    }

    // Methods
    for (const method of node.methods) {
      const params = method.params.map(p => {
        const goType = p.type ? this.mapType(p.type) : 'interface{}';
        return `${p.name} ${goType}`;
      }).join(', ');

      const receiver = node.name.charAt(0).toLowerCase();
      this.emit(`func (${receiver} *${node.name}) ${method.name.charAt(0).toUpperCase() + method.name.slice(1)}(${params}) {`);
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
      this.emitRaw('');
    }
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    this.emit(`// on ${event}`);
    this.emit(`func() {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}()');
    this.emitRaw('');
  }

  // ===== Logging and errors =====

  visitLog(node) {
    this.addImport('fmt');
    const args = node.args.map(a => this.expr(a)).join(', ');
    if (node.level === 'warn' || node.level === 'error') {
      this.addImport('log');
      this.emit(`log.Println(${args})`);
    } else {
      this.emit(`fmt.Println(${args})`);
    }
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`panic(${value})`);
    } else {
      this.emit(`panic(${value})`);
    }
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.addImport('database/sql');
    this.emit(`db, err := sql.Open("sqlite3", ${this.expr(node.connectionString)})`);
    this.emit('if err != nil {');
    this.indent++;
    this.emit('panic(err)');
    this.indent--;
    this.emit('}');
    this.emit('defer db.Close()');
    this.dbVar = 'db';
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`// db dir: ${raw}`);
  }

  visitDbSql(node) {
    this.addImport('database/sql');
    const driverRaw = node.driver.raw || node.driver.parts?.map(p => p.value).join('') || 'sqlite';

    if (driverRaw === 'sqlite') {
      this.emit(`// import _ "github.com/mattn/go-sqlite3"`);
      const conn = node.connection ? this.goStringValue(node.connection) : '"data.db"';
      this.emit(`__db, err := sql.Open("sqlite3", ${conn})`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      this.emit(`// import _ "github.com/lib/pq"`);
      const conn = node.connection ? this.goStringValue(node.connection) : 'os.Getenv("DATABASE_URL")';
      this.emit(`__db, err := sql.Open("postgres", ${conn})`);
      this.addImport('os');
    } else {
      const conn = node.connection ? this.goStringValue(node.connection) : '""';
      this.emit(`__db, err := sql.Open("${driverRaw}", ${conn})`);
    }
    this.emit('if err != nil {');
    this.indent++;
    this.emit('panic(err)');
    this.indent--;
    this.emit('}');
    this.emit('defer __db.Close()');
    this.dbVar = '__db';
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    this.addImport('sync');
    this.emit('var wg sync.WaitGroup');
    for (const e of node.expressions) {
      this.emit('wg.Add(1)');
      this.emit('go func() {');
      this.indent++;
      this.emit('defer wg.Done()');
      this.emit(this.expr(e));
      this.indent--;
      this.emit('}()');
    }
    this.emit('wg.Wait()');
  }

  // ===== Schema (struct) =====

  visitSchema(node) {
    this.emit(`type ${node.name} struct {`);
    this.indent++;

    for (const field of node.fields) {
      const goType = this.mapSchemaType(field.type);
      const fieldName = field.name.charAt(0).toUpperCase() + field.name.slice(1);
      const tags = [`json:"${field.name}"`];
      this.emit(`${fieldName} ${goType} \`${tags.join(' ')}\``);
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');

    this.schemas.set(node.name, node);
  }

  mapSchemaType(type) {
    const map = {
      'str': 'string',
      'string': 'string',
      'int': 'int',
      'integer': 'int',
      'num': 'float64',
      'number': 'float64',
      'bool': 'bool',
      'boolean': 'bool',
      'auto': 'int',
      'timestamp': 'string',
      'enum': 'string',
    };
    return map[type] || 'interface{}';
  }

  // ===== Auth =====

  visitAuth(node) {
    const secret = this.expr(node.secret);
    this.authSecret = secret;
    this.emit(`// JWT auth middleware`);
    this.emit(`// secret: ${secret}`);
    this.emit(`// Use github.com/golang-jwt/jwt/v5`);
    this.emitRaw('');
  }

  // ===== CORS =====

  visitCors(node) {
    const origins = this.expr(node.origins);
    this.emit(`// CORS: allow origins ${origins}`);
    this.emit(`// Use github.com/rs/cors`);
    this.emitRaw('');
  }

  // ===== Env =====

  visitEnv(node) {
    this.addImport('os');
    this.emitRaw('');
    for (const v of node.vars) {
      let defaultVal = null;
      for (const mod of v.modifiers) {
        if (mod.name === 'default') {
          defaultVal = this.expr(mod.args[0]);
        }
      }

      if (defaultVal !== null) {
        this.emit(`${v.name} := os.Getenv(${JSON.stringify(v.name)})`);
        this.emit(`if ${v.name} == "" {`);
        this.indent++;
        this.emit(`${v.name} = ${defaultVal}`);
        this.indent--;
        this.emit('}');
      } else {
        this.emit(`${v.name} := os.Getenv(${JSON.stringify(v.name)})`);
      }

      // Type coercion
      if (v.type === 'int') {
        this.addImport('strconv');
        const tmpName = `__${v.name}_int`;
        this.emit(`${tmpName}, _ := strconv.Atoi(${v.name})`);
        this.emit(`_ = ${tmpName} // use ${tmpName} as int`);
      } else if (v.type === 'num') {
        this.addImport('strconv');
        const tmpName = `__${v.name}_float`;
        this.emit(`${tmpName}, _ := strconv.ParseFloat(${v.name}, 64)`);
        this.emit(`_ = ${tmpName} // use ${tmpName} as float64`);
      } else if (v.type === 'bool') {
        this.addImport('strconv');
        const tmpName = `__${v.name}_bool`;
        this.emit(`${tmpName}, _ := strconv.ParseBool(${v.name})`);
        this.emit(`_ = ${tmpName} // use ${tmpName} as bool`);
      }
    }
    this.emitRaw('');
  }

  // ===== Tests =====

  visitTest(node) {
    this.addImport('testing');
    const name = this.rawString(node.name);
    const funcName = 'Test_' + name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');

    this.emit(`func ${funcName}(t *testing.T) {`);
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
    this.addImport('testing');
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`if ${this.expr(exprNode.left)} != ${this.expr(exprNode.right)} {`);
      this.indent++;
      this.emit(`t.Errorf("expected %v, got %v", ${this.expr(exprNode.right)}, ${this.expr(exprNode.left)})`);
      this.indent--;
      this.emit('}');
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`if ${this.expr(exprNode.left)} == ${this.expr(exprNode.right)} {`);
      this.indent++;
      this.emit(`t.Errorf("expected not equal: %v", ${this.expr(exprNode.left)})`);
      this.indent--;
      this.emit('}');
    } else {
      this.emit(`if !(${this.expr(exprNode)}) {`);
      this.indent++;
      this.emit(`t.Errorf("assertion failed: ${this.expr(exprNode)}")`);
      this.indent--;
      this.emit('}');
    }
  }

  // ===== Error handler =====

  visitErrorHandler(node) {
    this.emit(`// error handler`);
    this.emit(`func errorHandler(w http.ResponseWriter, r *http.Request, err error) {`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('http.Error(w, err.Error(), http.StatusInternalServerError)');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== CRUD =====

  visitCrud(node) {
    this.addImport('net/http');
    this.addImport('encoding/json');
    this.addImport('sync');

    const path = this.rawString(node.path);
    const schema = node.schemaName;
    const storeName = `__${schema.toLowerCase()}Store`;
    const mutexName = `__${schema.toLowerCase()}Mu`;

    this.emitRaw('');
    this.emit(`var ${storeName} = make([]${schema}, 0)`);
    this.emit(`var ${mutexName} sync.Mutex`);
    this.emit(`var __${schema.toLowerCase()}ID = 0`);
    this.emitRaw('');

    // List all
    this.emit(`http.HandleFunc("${path}", func(w http.ResponseWriter, r *http.Request) {`);
    this.indent++;
    this.emit('if r.Method == "GET" {');
    this.indent++;
    this.emit(`jsonResponse(w, ${storeName})`);
    this.emit('return');
    this.indent--;
    this.emit('}');

    // Create
    this.emit('if r.Method == "POST" {');
    this.indent++;
    this.emit(`var item ${schema}`);
    this.emit('json.NewDecoder(r.Body).Decode(&item)');
    this.emit(`${mutexName}.Lock()`);
    this.emit(`__${schema.toLowerCase()}ID++`);
    this.emit(`${storeName} = append(${storeName}, item)`);
    this.emit(`${mutexName}.Unlock()`);
    this.emit('w.WriteHeader(http.StatusCreated)');
    this.emit('jsonResponse(w, item)');
    this.emit('return');
    this.indent--;
    this.emit('}');

    this.indent--;
    this.emit('})');
    this.emitRaw('');
  }

  // ===== Static files =====

  visitStatic(node) {
    this.addImport('net/http');
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.emit(`http.Handle("/", http.FileServer(http.Dir(${JSON.stringify(raw)})))`);
    this.emitRaw('');
  }

  // ===== Rate limiting =====

  visitLimit(node) {
    const path = this.rawString(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`// rate limit: ${max} requests per ${window} on ${path}`);
    this.emit(`// Use golang.org/x/time/rate`);
    this.emitRaw('');
  }

  // ===== WebSocket =====

  visitWs(node) {
    this.emit(`// WebSocket: use github.com/gorilla/websocket`);
    const path = this.rawString(node.path);
    this.emit(`// path: ${path}`);
    this.emitRaw('');

    for (const evt of (node.events || [])) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      this.emit(`// ws event: ${evtName}`);
      this.indent++;
      for (const stmt of evt.body) this.visitStatement(stmt);
      this.indent--;
    }
    this.emitRaw('');
  }

  // ===== Session =====

  visitSession(node) {
    this.emit(`// Session: use github.com/gorilla/sessions`);
    this.emitRaw('');
  }

  // ===== Cache =====

  visitCache(node) {
    const path = this.rawString(node.path);
    this.emit(`// cache: ${path}`);
    this.emit(`// Use github.com/patrickmn/go-cache`);
    this.emitRaw('');
  }

  // ===== Every (cron/scheduler) =====

  visitEvery(node) {
    const raw = node.interval?.value?.raw || node.interval?.value?.parts?.map(p => p.value).join('') || '';
    const isCron = /^[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+/.test(raw.trim());

    if (isCron) {
      this.emit(`// Cron: use github.com/robfig/cron/v3`);
      this.emit(`// schedule: ${raw}`);
    } else {
      this.addImport('time');
      const interval = this.expr(node.interval);
      this.emit(`go func() {`);
      this.indent++;
      this.emit(`for {`);
      this.indent++;
      for (const stmt of node.body) this.visitStatement(stmt);
      this.emit(`time.Sleep(${interval})`);
      this.indent--;
      this.emit('}');
      this.indent--;
      this.emit('}()');
    }
    this.emitRaw('');
  }

  // ===== Prompt template =====

  visitPrompt(node) {
    this.addImport('strings');
    const name = node.name;
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : lines.join(` + "\\n" + `);

    this.emit(`func ${name}(vars map[string]string) string {`);
    this.indent++;
    this.emit(`template := ${template}`);
    this.emit('for k, v := range vars {');
    this.indent++;
    this.emit('template = strings.ReplaceAll(template, "{" + k + "}", v)');
    this.indent--;
    this.emit('}');
    this.emit('return template');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Page (HTML generation) =====

  visitPage(node) {
    this.addImport('os');
    const filename = this.rawPageString(node.filename);
    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`func() {`);
    this.indent++;
    this.emit(`f, err := os.Create(${JSON.stringify(filename)})`);
    this.emit('if err != nil { panic(err) }');
    this.emit('defer f.Close()');
    this.addImport('fmt');
    this.emit(`fmt.Fprint(f, \`<!DOCTYPE html>`);
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
    this.emit(`</html>\`)`);
    this.indent--;
    this.emit('}()');
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

  // ===== CLI App =====

  visitCli(node) {
    this.addImport('flag');
    this.addImport('fmt');
    this.emitRaw('');

    const desc = node.description ? this.rawPageString(node.description) : node.name;
    this.emit(`// CLI: ${desc}`);
    this.emitRaw('');

    for (const arg of node.args) {
      const argName = this.rawPageString(arg.name);
      if (arg.type === 'int') {
        this.emit(`var __arg_${argName} = flag.Int(${JSON.stringify(argName)}, 0, ${JSON.stringify(this.rawPageString(arg.description) || argName)})`);
      } else if (arg.type === 'num') {
        this.emit(`var __arg_${argName} = flag.Float64(${JSON.stringify(argName)}, 0, ${JSON.stringify(this.rawPageString(arg.description) || argName)})`);
      } else if (arg.type === 'bool') {
        this.emit(`var __arg_${argName} = flag.Bool(${JSON.stringify(argName)}, false, ${JSON.stringify(this.rawPageString(arg.description) || argName)})`);
      } else {
        this.emit(`var __arg_${argName} = flag.String(${JSON.stringify(argName)}, "", ${JSON.stringify(this.rawPageString(arg.description) || argName)})`);
      }
    }

    for (const fl of node.flags) {
      const l = this.rawPageString(fl.long);
      const desc = fl.description ? this.rawPageString(fl.description) : l;
      this.emit(`var __flag_${l} = flag.Bool(${JSON.stringify(l)}, false, ${JSON.stringify(desc)})`);
    }

    this.emit('flag.Parse()');
    this.emitRaw('');

    if (node.run) {
      for (const stmt of node.run.body) this.visitStatement(stmt);
    }
    this.emitRaw('');
  }

  // ===== Mail =====

  visitMail(node) {
    this.addImport('net/smtp');
    this.emitRaw('');

    const host = this.generateString(node.host);
    const port = this.expr(node.port);
    const user = node.user ? this.expr(node.user) : 'os.Getenv("MAIL_USER")';
    const pass = node.pass ? this.expr(node.pass) : 'os.Getenv("MAIL_PASS")';

    this.emit(`// Mail config`);
    this.emit(`// host: ${host}, port: ${port}`);
    this.emit(`// Use net/smtp.SendMail or github.com/jordan-wright/email`);
    this.emit(`func sendMail(to string, subject string, body string) error {`);
    this.indent++;
    this.emit(`auth := smtp.PlainAuth("", ${user}, ${pass}, ${host})`);
    this.addImport('fmt');
    this.emit(`msg := []byte(fmt.Sprintf("Subject: %s\\r\\n\\r\\n%s", subject, body))`);
    this.emit(`return smtp.SendMail(fmt.Sprintf("%s:%s", ${host}, ${port}), auth, ${user}, []string{to}, msg)`);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Desktop =====

  visitDesktop(node) {
    const title = node.title ? this.rawPageString(node.title) : node.name;
    const width = node.width ? this.expr(node.width) : '800';
    const height = node.height ? this.expr(node.height) : '600';
    this.emit(`// Desktop app: use github.com/nicholasgasior/gowl or github.com/nicholasgasior/fyne`);
    this.emit(`// title: ${JSON.stringify(title)}, width: ${width}, height: ${height}`);
    this.emit(`// Go desktop frameworks: Fyne (github.com/fyne-io/fyne), Wails (github.com/wailsapp/wails)`);
    this.emitRaw('');
  }

  // ===== Screen (mobile) =====

  visitScreen(node) {
    this.emit(`// Mobile screen: ${node.name}`);
    this.emit(`// Go mobile: use golang.org/x/mobile or github.com/nicholasgasior/fyne for cross-platform`);

    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
      this.emit(`// element: <${tag}> ${arg0}`);
    }
    this.emitRaw('');
  }

  // ===== OAuth =====

  visitOauth(node) {
    const provider = this.rawPageString(node.provider);
    const clientId = this.expr(node.clientId);
    const clientSecret = this.expr(node.clientSecret);
    const callback = node.callback ? this.rawPageString(node.callback) : '/auth/callback';

    this.emit(`// OAuth: ${provider}`);
    this.emit(`// Use golang.org/x/oauth2`);
    this.addImport('os');
    this.emit(`// clientID: ${clientId}`);
    this.emit(`// clientSecret: ${clientSecret}`);
    this.emit(`// callback: ${callback}`);
    this.emitRaw('');
  }

  // ===== Pay =====

  visitPay(node) {
    const provider = this.rawPageString(node.provider);
    const secretKey = this.expr(node.secretKey);

    if (provider === 'stripe') {
      this.emit(`// Stripe payments: use github.com/stripe/stripe-go/v76`);
      this.emit(`// secretKey: ${secretKey}`);
    } else {
      this.emit(`// ${provider} payment integration`);
    }
    this.emitRaw('');
  }

  // ===== Storage =====

  visitStorage(node) {
    const provider = this.rawPageString(node.provider);
    const bucket = this.expr(node.bucket);

    if (provider === 's3') {
      this.emit(`// S3 storage: use github.com/aws/aws-sdk-go-v2`);
      this.emit(`// bucket: ${bucket}`);
    } else if (provider === 'gcs') {
      this.emit(`// GCS storage: use cloud.google.com/go/storage`);
      this.emit(`// bucket: ${bucket}`);
    } else {
      this.emit(`// ${provider} storage integration`);
    }
    this.emitRaw('');
  }

  // ===== PDF =====

  visitPdf(node) {
    const filename = this.rawPageString(node.filename);
    this.emit(`// PDF generation: use github.com/jung-kurt/gofpdf`);
    this.emit(`// output: ${filename}`);

    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
      this.emit(`// pdf element: <${tag}> ${arg0}`);
    }
    this.emitRaw('');
  }

  // ===== i18n =====

  visitI18n(node) {
    const dir = this.rawPageString(node.dir);
    const defaultLang = node.defaultLang ? this.rawPageString(node.defaultLang) : 'en';

    this.emit(`// i18n: dir=${dir}, default=${defaultLang}`);
    this.emit(`// Use github.com/nicksnyder/go-i18n/v2`);
    for (const lang of node.langs) {
      const code = this.rawPageString(lang.code);
      const file = this.rawPageString(lang.file);
      this.emit(`// lang: ${code} -> ${file}`);
    }
    this.emitRaw('');
  }

  // ===== Push =====

  visitPush(node) {
    this.emit(`// Push notifications: use github.com/SherClockHolmes/webpush-go`);
    this.emitRaw('');
  }

  // ===== Search =====

  visitSearch(node) {
    const engine = this.rawPageString(node.engine);
    if (engine === 'meilisearch') {
      this.emit(`// Search: Meilisearch - use github.com/meilisearch/meilisearch-go`);
    } else {
      this.emit(`// Search: Elasticsearch - use github.com/elastic/go-elasticsearch/v8`);
    }
    this.emitRaw('');
  }

  // ===== Image =====

  visitImage(node) {
    const input = this.expr(node.input);
    this.emit(`// Image processing: use github.com/disintegration/imaging`);
    this.emit(`// input: ${input}`);

    for (const op of node.operations) {
      this.emit(`// operation: ${op.op}(${(op.args || []).join(', ')})`);
    }
    this.emitRaw('');
  }

  // ===== CSV =====

  visitCsv(node) {
    const name = this.rawPageString(node.name);
    const format = node.format ? this.rawPageString(node.format) : 'csv';
    const output = node.output ? this.rawPageString(node.output) : `${name}.${format}`;

    if (format === 'xlsx' || format === 'excel') {
      this.emit(`// Excel export: use github.com/xuri/excelize/v2`);
    } else {
      this.addImport('encoding/csv');
      this.addImport('os');
      this.emit(`// CSV export: ${output}`);
    }
    this.emit(`// output: ${output}`);
    this.emitRaw('');
  }

  // ===== Logging =====

  visitLogging(node) {
    this.addImport('log');
    const name = this.rawPageString(node.name);
    const level = node.level ? this.rawPageString(node.level) : 'info';
    const file = node.file ? this.rawPageString(node.file) : null;

    this.emit(`// Logger: ${name} (level: ${level})`);
    this.emit(`// Use log/slog for structured logging or github.com/sirupsen/logrus`);
    if (file) {
      this.addImport('os');
      this.emit(`__logFile, err := os.OpenFile(${JSON.stringify(file)}, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)`);
      this.emit('if err != nil { panic(err) }');
      this.emit(`defer __logFile.Close()`);
      this.emit(`logger := log.New(__logFile, "", log.LstdFlags)`);
    } else {
      this.emit(`logger := log.Default()`);
    }
    this.emit(`_ = logger`);
    this.emitRaw('');
  }

  // ===== DB Migration =====

  visitMigrate(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// DB Migration: ${name}`);
    this.emit(`// Use github.com/golang-migrate/migrate/v4`);

    this.emit(`// up:`);
    this.indent++;
    for (const stmt of node.up) this.visitStatement(stmt);
    this.indent--;

    this.emit(`// down:`);
    this.indent++;
    for (const stmt of node.down) this.visitStatement(stmt);
    this.indent--;
    this.emitRaw('');
  }

  // ===== gRPC =====

  visitGrpc(node) {
    const name = this.rawPageString(node.name);
    const port = node.port ? this.expr(node.port) : '50051';

    this.emit(`// gRPC server: ${name}`);
    this.emit(`// Use google.golang.org/grpc`);
    this.emit(`// port: ${port}`);

    for (const rpc of node.rpcs) {
      this.emit(`// rpc ${rpc.method}:`);
      this.indent++;
      for (const stmt of rpc.body) this.visitStatement(stmt);
      this.indent--;
    }
    this.emitRaw('');
  }

  // ===== WebRTC =====

  visitWebrtc(node) {
    const name = this.rawPageString(node.name);
    this.emit(`// WebRTC: ${name}`);
    this.emit(`// Use github.com/pion/webrtc/v3`);

    for (const evt of node.events) {
      this.emit(`// event: ${evt.event}`);
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

    this.emit(`// Blockchain: ${name}`);
    this.emit(`// Use github.com/ethereum/go-ethereum`);
    this.emit(`// provider: ${provider}`);
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
      case 'Self': return 'self'; // receiver in methods
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
        // Go doesn't have await; it uses goroutines. Just emit the expression.
        return this.expr(node.expr);

      case 'AwaitAllExpr':
        return this.expr(node.expr);

      case 'Spread':
        return `${this.expr(node.expr)}...`;

      case 'New':
        return this.expr(node.expr);

      case 'TypeOf':
        this.addImport('fmt');
        return `fmt.Sprintf("%T", ${this.expr(node.expr)})`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

      case 'OptionalAccess':
        // Go doesn't have ?. — just access directly
        return `${this.expr(node.object)}.${node.property.charAt(0).toUpperCase() + node.property.slice(1)}`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array': {
        const elements = node.elements.map(e => this.expr(e)).join(', ');
        return `[]interface{}{${elements}}`;
      }

      case 'Object': {
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `// spread: ${this.expr(p.value)}`;
          const key = p.type === 'shorthand' ? p.key :
                      (typeof p.key === 'string' ? p.key :
                       (p.key.type === 'String' ? this.rawString(p.key.value) :
                        (p.key.type === 'Computed' ? this.expr(p.key.expr) : this.expr(p.key))));
          const val = p.type === 'shorthand' ? p.key : this.expr(p.value);
          return `${JSON.stringify(key)}: ${val}`;
        }).join(', ');
        return `map[string]interface{}{${props}}`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => `${p.name} interface{}`).join(', ');
        const body = this.expr(node.body);
        return `func(${params}) interface{} { return ${body} }`;
      }

      case 'Lambda': {
        const params = node.params.map(p => `${p.name} interface{}`).join(', ');
        const bodyLines = [];
        const savedOutput = this.output;
        const savedIndent = this.indent;
        this.output = bodyLines;
        this.indent = 0;
        for (const stmt of node.body) this.visitStatement(stmt);
        this.output = savedOutput;
        this.indent = savedIndent;
        return `func(${params}) { ${bodyLines.join(' ')} }`;
      }

      case 'Ternary': {
        // Go doesn't have ternary. Use an IIFE.
        const cond = this.expr(node.condition);
        const consequent = this.expr(node.consequent);
        const alternate = this.expr(node.alternate);
        return `func() interface{} { if ${cond} { return ${consequent} }; return ${alternate} }()`;
      }

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
      'console': 'fmt',
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

    // Map common JS properties to Go equivalents
    if (prop === 'length') return `len(${obj})`;
    if (prop === 'toString') return `fmt.Sprint(${obj})`;

    // Request properties for net/http
    if ((obj === 'request' || obj === 'req' || obj === 'r') && prop === 'body') return 'r.Body';
    if ((obj === 'request' || obj === 'req' || obj === 'r') && prop === 'query') return 'r.URL.Query()';
    if ((obj === 'request' || obj === 'req' || obj === 'r') && prop === 'params') return 'r.URL.Query()';
    if ((obj === 'request' || obj === 'req' || obj === 'r') && prop === 'headers') return 'r.Header';
    if ((obj === 'request' || obj === 'req' || obj === 'r') && prop === 'method') return 'r.Method';
    if ((obj === 'request' || obj === 'req' || obj === 'r') && prop === 'url') return 'r.URL.String()';

    // JSON
    if (obj === 'JSON' && prop === 'parse') return 'json.Unmarshal';
    if (obj === 'JSON' && prop === 'stringify') return 'json.Marshal';

    // Math
    if (obj === 'Math' && prop === 'floor') { this.addImport('math'); return 'math.Floor'; }
    if (obj === 'Math' && prop === 'ceil') { this.addImport('math'); return 'math.Ceil'; }
    if (obj === 'Math' && prop === 'round') { this.addImport('math'); return 'math.Round'; }
    if (obj === 'Math' && prop === 'abs') { this.addImport('math'); return 'math.Abs'; }
    if (obj === 'Math' && prop === 'min') { this.addImport('math'); return 'math.Min'; }
    if (obj === 'Math' && prop === 'max') { this.addImport('math'); return 'math.Max'; }
    if (obj === 'Math' && prop === 'random') { this.addImport('math/rand'); return 'rand.Float64'; }
    if (obj === 'Math' && prop === 'PI') { this.addImport('math'); return 'math.Pi'; }

    // console methods
    if (obj === 'console' && prop === 'log') { this.addImport('fmt'); return 'fmt.Println'; }
    if (obj === 'console' && prop === 'error') { this.addImport('log'); return 'log.Println'; }
    if (obj === 'console' && prop === 'warn') { this.addImport('log'); return 'log.Println'; }

    // Capitalize first letter for Go exported fields
    const goProp = prop.charAt(0).toUpperCase() + prop.slice(1);
    return `${obj}.${goProp}`;
  }

  generateCall(node) {
    if (node.callee.type === 'Identifier') {
      const argList = node.args.map(a => this.expr(a));
      const b = this.generateBuiltin(node.callee.name, argList);
      if (b) return b;
    }

    const args = node.args.map(a => this.expr(a)).join(', ');

    // Map common JS global functions to Go
    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;

      if (name === 'parseInt') { this.addImport('strconv'); return `func() int { v, _ := strconv.Atoi(${args}); return v }()`; }
      if (name === 'parseFloat') { this.addImport('strconv'); return `func() float64 { v, _ := strconv.ParseFloat(${args}, 64); return v }()`; }
      if (name === 'String') { this.addImport('fmt'); return `fmt.Sprint(${args})`; }
      if (name === 'Number') { this.addImport('strconv'); return `func() float64 { v, _ := strconv.ParseFloat(fmt.Sprint(${args}), 64); return v }()`; }
      if (name === 'Boolean') return `(${args}) != nil && (${args}) != false && (${args}) != 0`;
    }

    // Map common method calls
    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // Array/slice methods
      if (prop === 'push') return `${obj} = append(${obj}, ${args})`;
      if (prop === 'join') { this.addImport('strings'); return `strings.Join(${obj}, ${args})`; }
      if (prop === 'includes') return `/* contains: */ func() bool { for _, v := range ${obj} { if v == ${args} { return true } }; return false }()`;
      if (prop === 'indexOf') return `/* indexOf: */ func() int { for i, v := range ${obj} { if v == ${args} { return i } }; return -1 }()`;
      if (prop === 'reverse') { this.addImport('slices'); return `slices.Reverse(${obj})`; }
      if (prop === 'sort') { this.addImport('sort'); return `sort.Slice(${obj}, func(i, j int) bool { return ${obj}[i] < ${obj}[j] })`; }

      // String methods
      if (prop === 'split') { this.addImport('strings'); return `strings.Split(${obj}, ${args})`; }
      if (prop === 'trim') { this.addImport('strings'); return `strings.TrimSpace(${obj})`; }
      if (prop === 'trimStart') { this.addImport('strings'); return `strings.TrimLeft(${obj}, " ")`; }
      if (prop === 'trimEnd') { this.addImport('strings'); return `strings.TrimRight(${obj}, " ")`; }
      if (prop === 'toUpperCase') { this.addImport('strings'); return `strings.ToUpper(${obj})`; }
      if (prop === 'toLowerCase') { this.addImport('strings'); return `strings.ToLower(${obj})`; }
      if (prop === 'startsWith') { this.addImport('strings'); return `strings.HasPrefix(${obj}, ${args})`; }
      if (prop === 'endsWith') { this.addImport('strings'); return `strings.HasSuffix(${obj}, ${args})`; }
      if (prop === 'replace') { this.addImport('strings'); return `strings.Replace(${obj}, ${args}, 1)`; }
      if (prop === 'replaceAll') { this.addImport('strings'); return `strings.ReplaceAll(${obj}, ${args})`; }
      if (prop === 'charAt') return `string(${obj}[${args}])`;
      if (prop === 'repeat') { this.addImport('strings'); return `strings.Repeat(${obj}, ${args})`; }

      // Object methods
      if (obj === 'Object' && prop === 'keys') return `/* Object.keys */ func() []string { keys := make([]string, 0); for k := range ${args} { keys = append(keys, k) }; return keys }()`;

      // Promise / concurrency
      if (obj === 'Promise' && prop === 'all') return `/* Promise.all: use sync.WaitGroup */ ${args}`;
      if (obj === 'Promise' && prop === 'resolve') return args;

      // Date
      if (obj === 'Date' && prop === 'now') { this.addImport('time'); return 'time.Now().UnixMilli()'; }
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

    // Use fmt.Sprintf for interpolation
    this.addImport('fmt');
    let format = '';
    const args = [];

    for (const part of strData.parts) {
      if (part.type === 'text') {
        format += part.value.replace(/%/g, '%%').replace(/"/g, '\\"');
      } else {
        format += '%v';
        args.push(part.value);
      }
    }

    if (args.length === 0) {
      return `"${format}"`;
    }

    return `fmt.Sprintf("${format}", ${args.join(', ')})`;
  }

  rawString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
  }

  rawPageString(strData) {
    if (!strData) return '';
    if (strData.raw !== null && strData.raw !== undefined) return strData.raw;
    if (strData.parts) return strData.parts.map(p => p.value).join('');
    return '';
  }

  goStringValue(strData) {
    if (!strData || !strData.parts) return '""';
    if (strData.raw !== null && strData.raw !== undefined) {
      return JSON.stringify(strData.raw);
    }
    return this.generateString(strData);
  }

  rawExprValue(node) {
    if (!node) return '';
    if (node.type === 'Number') return node.value;
    if (node.type === 'String') return this.rawString(node.value);
    return this.expr(node);
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
    this.emit(`type ${node.name} int`);
    this.emit(`const (`);
    this.indent++;
    node.values.forEach((v, i) => {
      if (i === 0) {
        this.emit(`${v} ${node.name} = iota`);
      } else {
        this.emit(`${v}`);
      }
    });
    this.indent--;
    this.emit(`)`);
    this.emitRaw('');
  }

  visitSwap(node) {
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    this.emit(`${a}, ${b} = ${b}, ${a}`);
  }

  generateBuiltin(name, args) {
    switch (name) {
      case 'len': return `len(${args[0]})`;
      case 'str': { this.addImport('strconv'); return `strconv.Itoa(${args[0]})`; }
      case 'int': { this.addImport('strconv'); return `func() int { v, _ := strconv.Atoi(${args[0]}); return v }()`; }
      case 'float': { this.addImport('strconv'); return `func() float64 { v, _ := strconv.ParseFloat(${args[0]}, 64); return v }()`; }
      case 'upper': { this.addImport('strings'); return `strings.ToUpper(${args[0]})`; }
      case 'lower': { this.addImport('strings'); return `strings.ToLower(${args[0]})`; }
      case 'trim': { this.addImport('strings'); return `strings.TrimSpace(${args[0]})`; }
      case 'split': { this.addImport('strings'); return `strings.Split(${args[0]}, ${args[1] || '","'})`; }
      case 'join': { this.addImport('strings'); return `strings.Join(${args[0]}, ${args[1] || '","'})`; }
      case 'contains': { this.addImport('strings'); return `strings.Contains(${args[0]}, ${args[1]})`; }
      case 'replace': { this.addImport('strings'); return `strings.ReplaceAll(${args[0]}, ${args[1]}, ${args[2]})`; }
      case 'abs': { this.addImport('math'); return `math.Abs(${args[0]})`; }
      case 'sqrt': { this.addImport('math'); return `math.Sqrt(${args[0]})`; }
      case 'pow': { this.addImport('math'); return `math.Pow(${args[0]}, ${args[1]})`; }
      case 'ceil': { this.addImport('math'); return `math.Ceil(${args[0]})`; }
      case 'floor': { this.addImport('math'); return `math.Floor(${args[0]})`; }
      case 'round': { this.addImport('math'); return `math.Round(${args[0]})`; }
      case 'exit': { this.addImport('os'); return `os.Exit(${args[0] || '0'})`; }
      case 'sleep': { this.addImport('time'); return `time.Sleep(time.Duration(${args[0]}) * time.Millisecond)`; }
      case 'now': { this.addImport('time'); return `time.Now().UnixMilli()`; }
      case 'time': { this.addImport('time'); return `time.Now().Format(time.RFC3339)`; }
      case 'json_parse': { this.addImport('encoding/json'); return `func() interface{} { var v interface{}; json.Unmarshal([]byte(${args[0]}), &v); return v }()`; }
      case 'json_str': { this.addImport('encoding/json'); return `func() string { b, _ := json.Marshal(${args[0]}); return string(b) }()`; }
      case 'random': { this.addImport('math/rand'); return args.length >= 2 ? `rand.Intn(${args[1]}-${args[0]}+1)+${args[0]}` : `rand.Float64()`; }
      case 'sort': { this.addImport('sort'); return `func() []int { s := make([]int, len(${args[0]})); copy(s, ${args[0]}); sort.Ints(s); return s }()`; }
      case 'reverse': return `func() []interface{} { s := make([]interface{}, len(${args[0]})); copy(s, ${args[0]}); for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 { s[i], s[j] = s[j], s[i] }; return s }()`;
      default: return null;
    }
  }
}
