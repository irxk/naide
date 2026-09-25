export class RubyGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.usesSinatra = false;
    this.authSecret = null;
    this.dbVar = null;
    this.gems = new Set();
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
  }

  generate(ast) {
    this.visitProgram(ast);

    // Prepend gem requires
    const preamble = [];
    for (const gem of this.gems) {
      preamble.push(`require '${gem}'`);
    }
    if (preamble.length > 0) preamble.push('');

    return [...preamble, ...this.output].join('\n');
  }

  addGem(gem) {
    this.gems.add(gem);
  }

  emit(line) {
    this.output.push('  '.repeat(this.indent) + line);
    this.sourceMap.push(this.currentSourceLine);
  }

  emitRaw(line) {
    this.output.push(line);
    this.sourceMap.push(this.currentSourceLine);
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
      case 'Continue': this.emit('next'); return;
      case 'Assignment': return this.visitAssignment(node);
      case 'CompoundAssign': return this.visitCompoundAssign(node);
      case 'ExprStatement': this.emit(this.expr(node.expression)); return;
      case 'DbConnect': return this.visitDbConnect(node);
      case 'DbDir': return this.visitDbDir(node);
      case 'DbSql': return this.visitDbSql(node);
      case 'AwaitAll': return this.visitAwaitAllStatement(node);
      case 'SchemaDecl': return this.visitSchema(node);
      case 'AuthDecl': return this.visitAuth('app', node);
      case 'CorsDecl': return this.visitCors('app', node);
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
        this.emit(`# unknown: ${node.type}`);
    }
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const alias = node.alias || node.name;
    const clean = raw.replace(/^['"]|['"]$/g, '');
    this.emit(`require_relative '${clean}'`);
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const clean = raw.replace(/^['"]|['"]$/g, '');
    this.emit(`require_relative '${clean}'`);
    this.emit(`# import: ${node.names.map(n => n.name).join(', ')}`);
  }

  // ===== Functions =====

  visitFunction(node) {
    const params = node.params.map(p => {
      let s = '';
      if (p.spread) s += '*';
      s += p.name;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    if (params) {
      this.emit(`def ${node.name}(${params})`);
    } else {
      this.emit(`def ${node.name}`);
    }
    this.indent++;
    if (node.body.length === 0) {
      this.emit('# empty');
    } else {
      for (const stmt of node.body) {
        this.visitStatement(stmt);
      }
    }
    this.indent--;
    this.emit('end');
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
    if (this.usesSinatra) {
      this.emit(`status ${this.expr(node.statusCode)}`);
      this.emit(`json ${this.expr(node.body)}`);
    } else {
      this.emit(`[${this.expr(node.statusCode)}, ${this.expr(node.body)}]`);
    }
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`redirect ${val}`);
        break;
      case 'html':
        this.emit(`content_type :html`);
        this.emit(val);
        break;
      case 'text':
        this.emit(`content_type :text`);
        this.emit(val);
        break;
      case 'file':
        this.emit(`send_file ${val}`);
        break;
      default:
        this.emit(val);
    }
  }

  // ===== Variables =====

  visitTypedVar(node) {
    this.emit(`${node.name} = ${this.expr(node.value)}`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.exprName(e)).join(', ');
      this.emit(`${names} = ${value}`);
    } else if (node.target.type === 'Object') {
      const tempVar = '__d';
      this.emit(`${tempVar} = ${value}`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.exprName(p.value);
        this.emit(`${varName} = ${tempVar}[${JSON.stringify(key)}]`);
      }
    } else {
      this.emit(`${this.exprName(node.target)} = ${value}`);
    }
  }

  visitCompoundAssign(node) {
    this.emit(`${this.exprName(node.target)} ${node.op} ${this.expr(node.value)}`);
  }

  // ===== Control flow =====

  visitIf(node) {
    this.emit(`if ${this.expr(node.condition)}`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;

    for (const elif of node.elifs) {
      this.emit(`elsif ${this.expr(elif.condition)}`);
      this.indent++;
      for (const stmt of elif.body) this.visitStatement(stmt);
      this.indent--;
    }

    if (node.elseBody) {
      this.emit('else');
      this.indent++;
      for (const stmt of node.elseBody) this.visitStatement(stmt);
      this.indent--;
    }
    this.emit('end');
  }

  visitEach(node) {
    const collection = this.expr(node.collection);
    if (node.key) {
      this.emit(`${collection}.each_with_index do |${node.value}, ${node.key}|`);
    } else {
      this.emit(`${collection}.each do |${node.value}|`);
    }
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('end');
  }

  visitFor(node) {
    const start = this.expr(node.start);
    const end = this.expr(node.end);
    this.emit(`(${start}...${end}).each do |${node.varName}|`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('end');
  }

  visitWhile(node) {
    this.emit(`while ${this.expr(node.condition)}`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('end');
  }

  visitMatch(node) {
    this.emit(`case ${this.expr(node.value)}`);
    for (const c of node.cases) {
      if (c.pattern.type === 'DefaultPattern') {
        this.emit('else');
      } else {
        this.emit(`when ${this.expr(c.pattern)}`);
      }
      this.indent++;
      for (const stmt of c.body) this.visitStatement(stmt);
      this.indent--;
    }
    this.emit('end');
  }

  visitTry(node) {
    this.emit('begin');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;

    if (node.catchBody) {
      const catchParam = node.catchVar || 'e';
      this.emit(`rescue => ${catchParam}`);
      this.indent++;
      for (const stmt of node.catchBody) this.visitStatement(stmt);
      this.indent--;
    }

    if (node.ensureBody) {
      this.emit('ensure');
      this.indent++;
      for (const stmt of node.ensureBody) this.visitStatement(stmt);
      this.indent--;
    }
    this.emit('end');
  }

  // ===== Server (Sinatra-style) =====

  visitServer(node) {
    this.usesSinatra = true;
    this.addGem('sinatra');
    this.addGem('sinatra/json');

    this.emit(`# Server: ${node.name}`);
    this.emitRaw('');

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth('app', child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors('app', child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(child);
      } else if (child.type === 'ErrorHandler') {
        this.visitErrorHandler(child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else if (child.type === 'StaticDecl') {
        this.visitStatic(child);
      } else if (child.type === 'SessionDecl') {
        this.visitSession(child);
      } else if (child.type === 'GraphqlDecl') {
        this.visitGraphql(child);
      } else {
        this.visitStatement(child);
      }
    }

    const port = node.port ? this.expr(node.port) : '4567';
    this.emitRaw('');
    this.emit(`set :port, ${port}`);
  }

  visitRoute(route) {
    const method = route.method === 'del' ? 'delete' : route.method;
    const path = this.rubyStringValue(route.path);

    this.emit(`${method} ${path} do`);
    this.indent++;

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`json ${this.expr(stmt.value)}`);
      } else {
        this.visitStatement(stmt);
      }
    }

    this.indent--;
    this.emit('end');
    this.emitRaw('');
  }

  visitGroup(node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`# Route group: ${prefix}`);
    for (const child of node.routes) {
      if (child.type === 'Route') {
        // Prepend prefix to route path
        const origPath = this.rawString(child.path);
        child.path = { parts: [{ type: 'text', value: prefix + origPath }] };
        this.visitRoute(child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(child);
      } else {
        this.visitStatement(child);
      }
    }
    this.emitRaw('');
  }

  // ===== Model (class) =====

  visitModel(node) {
    this.models.set(node.name, node);

    const ext = node.parent ? ` < ${node.parent}` : '';
    this.emit(`class ${node.name}${ext}`);
    this.indent++;

    // attr_accessor for fields
    if (node.fields.length > 0) {
      const attrs = node.fields.map(f => `:${f.name}`).join(', ');
      this.emit(`attr_accessor ${attrs}`);
      this.emitRaw('');
    }

    // Constructor
    if (node.fields.length > 0) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const constructorParams = allFields.map(f => {
        if (f.defaultValue) return `${f.name}: ${this.expr(f.defaultValue)}`;
        return `${f.name}:`;
      }).join(', ');

      this.emit(`def initialize(${constructorParams})`);
      this.indent++;
      if (node.parent) {
        const superArgs = parentFields.map(f => `${f.name}: ${f.name}`).join(', ');
        this.emit(`super(${superArgs})`);
      }
      for (const f of node.fields) {
        this.emit(`@${f.name} = ${f.name}`);
      }
      this.indent--;
      this.emit('end');
      this.emitRaw('');
    }

    // Methods
    for (const method of node.methods) {
      const params = method.params.map(p => {
        let s = '';
        if (p.spread) s += '*';
        s += p.name;
        if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      if (params) {
        this.emit(`def ${method.name}(${params})`);
      } else {
        this.emit(`def ${method.name}`);
      }
      this.indent++;
      if (method.body.length === 0) {
        this.emit('# empty');
      } else {
        for (const stmt of method.body) {
          this.visitStatement(stmt);
        }
      }
      this.indent--;
      this.emit('end');
      this.emitRaw('');
    }

    this.indent--;
    this.emit('end');
    this.emitRaw('');
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    this.emit(`# on ${event}`);
    for (const stmt of node.body) this.visitStatement(stmt);
  }

  // ===== Logging =====

  visitLog(node) {
    const args = node.args.map(a => this.expr(a));
    if (node.level === 'error') {
      this.emit(`$stderr.puts ${args.join(', ')}`);
    } else {
      this.emit(`puts ${args.join(', ')}`);
    }
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`raise ${value}`);
    } else {
      this.emit(`raise ${value}`);
    }
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.addGem('sequel');
    this.dbVar = 'DB';
    this.emit(`DB = Sequel.connect(${this.expr(node.connectionString)})`);
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`# db dir: ${raw}`);
  }

  visitDbSql(node) {
    this.addGem('sequel');
    this.dbVar = 'DB';

    const driverRaw = node.driver.raw || node.driver.parts?.map(p => p.value).join('') || 'sqlite';

    if (driverRaw === 'sqlite') {
      const conn = node.connection ? this.rubyStringValue(node.connection) : '"data.db"';
      this.emit(`DB = Sequel.sqlite(${conn})`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      const conn = node.connection ? this.rubyStringValue(node.connection) : 'ENV["DATABASE_URL"]';
      this.emit(`DB = Sequel.connect(${conn})`);
    } else {
      const conn = node.connection ? this.rubyStringValue(node.connection) : '"localhost"';
      this.emit(`DB = Sequel.connect(${conn})`);
    }
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    this.emit(`# await.all - executing sequentially`);
    for (const e of node.expressions) {
      this.emit(this.expr(e));
    }
  }

  // ===== Schema =====

  visitSchema(node) {
    this.emit(`# Schema: ${node.name}`);
    this.emit(`${node.name} = Struct.new(`);
    this.indent++;
    const fieldNames = node.fields.map(f => `:${f.name}`).join(', ');
    this.emit(`${fieldNames},`);
    this.emit(`keyword_init: true`);
    this.indent--;
    this.emit(')');

    this.schemas.set(node.name, node);
    this.emitRaw('');
  }

  // ===== Auth =====

  visitAuth(appName, node) {
    this.addGem('jwt');
    const secret = this.expr(node.secret);
    this.authSecret = secret;
    this.emit(`AUTH_SECRET = ${secret}`);
    this.emitRaw('');
    this.emit(`helpers do`);
    this.indent++;
    this.emit(`def require_auth`);
    this.indent++;
    this.emit(`token = request.env['HTTP_AUTHORIZATION']&.sub('Bearer ', '')`);
    this.emit(`halt 401, json(error: 'No token provided') unless token`);
    this.emit(`begin`);
    this.indent++;
    this.emit(`JWT.decode(token, AUTH_SECRET, true, algorithm: 'HS256').first`);
    this.indent--;
    this.emit(`rescue JWT::DecodeError`);
    this.indent++;
    this.emit(`halt 401, json(error: 'Invalid token')`);
    this.indent--;
    this.emit(`end`);
    this.indent--;
    this.emit(`end`);
    this.indent--;
    this.emit(`end`);
    this.emitRaw('');
  }

  // ===== CORS =====

  visitCors(appName, node) {
    const origins = this.expr(node.origins);
    this.emit(`before do`);
    this.indent++;
    this.emit(`headers 'Access-Control-Allow-Origin' => ${origins}`);
    this.emit(`headers 'Access-Control-Allow-Methods' => 'GET, POST, PUT, DELETE, OPTIONS'`);
    this.emit(`headers 'Access-Control-Allow-Headers' => 'Content-Type, Authorization'`);
    this.indent--;
    this.emit(`end`);
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
        this.emit(`${v.name} = ENV[${JSON.stringify(v.name)}] || ${defaultVal}`);
      } else {
        this.emit(`${v.name} = ENV[${JSON.stringify(v.name)}]`);
      }

      if (v.type === 'int') {
        this.emit(`${v.name} = ${v.name}.to_i`);
      } else if (v.type === 'num') {
        this.emit(`${v.name} = ${v.name}.to_f`);
      }
    }
    this.emitRaw('');
  }

  // ===== Tests =====

  visitTest(node) {
    this.addGem('minitest/autorun');
    const name = this.rawString(node.name);
    const funcName = `test_${name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}`;

    this.emit(`# Test: ${name}`);
    this.emit(`def ${funcName}`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('# empty test');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emit('end');
    this.emitRaw('');
  }

  visitAssert(node) {
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`assert_equal ${this.expr(exprNode.right)}, ${this.expr(exprNode.left)}`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`refute_equal ${this.expr(exprNode.right)}, ${this.expr(exprNode.left)}`);
    } else {
      this.emit(`assert ${this.expr(exprNode)}`);
    }
  }

  // ===== CRUD =====

  visitCrud(node) {
    const path = this.rawString(node.path);
    const schema = node.schemaName;
    this.emit(`# CRUD for ${schema} at ${path}`);
    this.emit(`get '${path}' do`);
    this.indent++;
    this.emit(`json []`);
    this.indent--;
    this.emit('end');
    this.emit(`get '${path}/:id' do`);
    this.indent++;
    this.emit(`json({ id: params[:id] })`);
    this.indent--;
    this.emit('end');
    this.emit(`post '${path}' do`);
    this.indent++;
    this.emit(`data = JSON.parse(request.body.read)`);
    this.emit(`status 201`);
    this.emit(`json data`);
    this.indent--;
    this.emit('end');
    this.emit(`put '${path}/:id' do`);
    this.indent++;
    this.emit(`data = JSON.parse(request.body.read)`);
    this.emit(`json data.merge(id: params[:id])`);
    this.indent--;
    this.emit('end');
    this.emit(`delete '${path}/:id' do`);
    this.indent++;
    this.emit(`json({ deleted: true })`);
    this.indent--;
    this.emit('end');
    this.emitRaw('');
  }

  // ===== Static =====

  visitStatic(node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    this.emit(`set :public_folder, '${raw}'`);
  }

  // ===== Rate limit =====

  visitLimit(node) {
    const path = this.rawString(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`# Rate limit: ${max} requests per ${window} on ${path}`);
  }

  // ===== WebSocket =====

  visitWs(node) {
    this.emit(`# WebSocket - use faye-websocket gem`);
    const path = this.rubyStringValue(node.path);
    this.emit(`# ws path: ${path}`);
    for (const evt of (node.events || [])) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      this.emit(`# on ${evtName}`);
    }
    this.emitRaw('');
  }

  // ===== Session =====

  visitSession(node) {
    this.emit(`enable :sessions`);
    this.emitRaw('');
  }

  // ===== Cache =====

  visitCache(node) {
    const path = this.rawString(node.path);
    this.emit(`# Cache: ${path}`);
  }

  // ===== Error handler =====

  visitErrorHandler(node) {
    this.emit(`error do`);
    this.indent++;
    this.emit(`status 500`);
    this.emit(`json({ error: env['sinatra.error'].message })`);
    this.indent--;
    this.emit(`end`);
    this.emitRaw('');
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'ENV["BOT_TOKEN"]';
    this.emit(`# Bot: ${node.name}`);
    this.emit(`${node.name}_token = ${tokenExpr}`);
    this.emit(`# Bot implementation requires a Ruby bot library`);
    this.emitRaw('');
  }

  // ===== Every (cron) =====

  visitEvery(node) {
    const interval = this.expr(node.interval);
    this.emit(`# Cron job: every ${interval}`);
    this.emit(`# Use rufus-scheduler gem`);
    this.emit(`Thread.new do`);
    this.indent++;
    this.emit(`loop do`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.emit(`sleep 60 # adjust interval`);
    this.indent--;
    this.emit('end');
    this.indent--;
    this.emit('end');
    this.emitRaw('');
  }

  // ===== Prompt =====

  visitPrompt(node) {
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : `[${lines.join(', ')}].join("\\n")`;
    const defaults = node.defaults ? this.expr(node.defaults) : '{}';

    this.emit(`def ${node.name}(vars = {})`);
    this.indent++;
    this.emit(`defaults = ${defaults}`);
    this.emit(`merged = defaults.merge(vars)`);
    this.emit(`template = ${template}`);
    this.emit(`merged.each { |k, v| template = template.gsub("{#{k}}", v.to_s) }`);
    this.emit(`template`);
    this.indent--;
    this.emit('end');
    this.emitRaw('');
  }

  // ===== Page =====

  visitPage(node) {
    const filename = this.rawString(node.filename);
    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`__html = <<~HTML`);
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
    this.emit(`HTML`);
    this.emit(`File.write(${JSON.stringify(filename)}, __html)`);
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

  // ===== CLI =====

  visitCli(node) {
    this.addGem('optparse');
    const desc = node.description ? this.rawString(node.description) : node.name;
    this.emit(`# CLI: ${node.name} - ${desc}`);
    this.emit(`options = {}`);
    this.emit(`OptionParser.new do |opts|`);
    this.indent++;
    this.emit(`opts.banner = "Usage: ${node.name} [options]"`);
    for (const arg of node.args) {
      const argName = this.rawString(arg.name);
      this.emit(`opts.on("--${argName} VALUE") { |v| options[:${argName}] = v }`);
    }
    for (const flag of node.flags) {
      const s = this.rawString(flag.short);
      const l = this.rawString(flag.long);
      const flagDesc = flag.description ? this.rawString(flag.description) : l;
      this.emit(`opts.on("-${s}", "--${l}", "${flagDesc}") { options[:${l}] = true }`);
    }
    this.indent--;
    this.emit(`end.parse!`);
    this.emitRaw('');

    if (node.run) {
      const runParam = node.run.params.length > 0 ? node.run.params[0] : 'options';
      if (runParam !== 'options') {
        this.emit(`${runParam} = options`);
      }
      for (const stmt of node.run.body) this.visitStatement(stmt);
    }
    this.emitRaw('');
  }

  // ===== Mail =====

  visitMail(node) {
    this.addGem('mail');
    const host = this.generateString(node.host);
    const port = this.expr(node.port);
    this.emit(`# Mail configuration`);
    this.emit(`Mail.defaults do`);
    this.indent++;
    this.emit(`delivery_method :smtp, address: ${host}, port: ${port}`);
    this.indent--;
    this.emit(`end`);
    this.emitRaw('');
  }

  // ===== Desktop =====

  visitDesktop(node) {
    this.emit(`# Desktop app: ${node.name}`);
    this.emit(`# Ruby is not typically used for desktop apps`);
    this.emit(`# Consider using shoes or glimmer-dsl-libui`);
    this.emitRaw('');
  }

  // ===== Screen =====

  visitScreen(node) {
    this.emit(`# Mobile screen: ${node.name}`);
    this.emit(`# Ruby is not used for mobile development`);
    this.emitRaw('');
  }

  // ===== GraphQL =====

  visitGraphql(node) {
    const path = this.rubyStringValue(node.path);
    this.emit(`# GraphQL endpoint at ${path}`);
    this.emit(`# Use graphql-ruby gem`);
    this.emitRaw('');
  }

  // ===== OAuth =====

  visitOauth(node) {
    this.addGem('omniauth');
    const provider = this.rawString(node.provider);
    const clientId = this.expr(node.clientId);
    const clientSecret = this.expr(node.clientSecret);
    this.emit(`# OAuth: ${provider}`);
    this.emit(`use OmniAuth::Builder do`);
    this.indent++;
    this.emit(`provider :${provider}, ${clientId}, ${clientSecret}`);
    this.indent--;
    this.emit(`end`);
    this.emitRaw('');
  }

  // ===== Pay =====

  visitPay(node) {
    const provider = this.rawString(node.provider);
    const secretKey = this.expr(node.secretKey);
    if (provider === 'stripe') {
      this.addGem('stripe');
      this.emit(`# Stripe payment`);
      this.emit(`Stripe.api_key = ${secretKey}`);
    } else {
      this.emit(`# ${provider} payment integration`);
    }
    this.emitRaw('');
  }

  // ===== Storage =====

  visitStorage(node) {
    this.addGem('aws-sdk-s3');
    const provider = this.rawString(node.provider);
    const bucket = this.expr(node.bucket);
    this.emit(`# Storage: ${provider}`);
    this.emit(`storage_bucket = ${bucket}`);
    this.emitRaw('');
  }

  // ===== PDF =====

  visitPdf(node) {
    this.addGem('prawn');
    const filename = this.rawString(node.filename);
    this.emit(`# PDF generation: ${filename}`);
    this.emit(`Prawn::Document.generate(${JSON.stringify(filename)}) do |pdf|`);
    this.indent++;

    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
      if (tag === 'title') {
        this.emit(`pdf.text ${JSON.stringify(arg0)}, size: 24, style: :bold`);
      } else if (tag === 'text' || tag === 'p') {
        this.emit(`pdf.text ${JSON.stringify(arg0)}, size: 12`);
      } else {
        this.emit(`pdf.text ${JSON.stringify(arg0)}`);
      }
    }

    this.indent--;
    this.emit(`end`);
    this.emit(`puts "Generated: ${filename}"`);
    this.emitRaw('');
  }

  // ===== i18n =====

  visitI18n(node) {
    this.addGem('i18n');
    const dir = this.rawString(node.dir);
    const defaultLang = node.defaultLang ? this.rawString(node.defaultLang) : 'en';
    this.emit(`I18n.load_path += Dir[${JSON.stringify(dir + '/*.yml')}]`);
    this.emit(`I18n.default_locale = :${defaultLang}`);
    this.emitRaw('');
    this.emit(`def t(key, params = {})`);
    this.indent++;
    this.emit(`I18n.t(key, **params)`);
    this.indent--;
    this.emit('end');
    this.emitRaw('');
  }

  // ===== Push =====

  visitPush(node) {
    this.addGem('web-push');
    this.emit(`# Push notifications`);
    this.emit(`VAPID_PUBLIC_KEY = ${this.expr(node.publicKey)}`);
    this.emit(`VAPID_PRIVATE_KEY = ${this.expr(node.privateKey)}`);
    this.emitRaw('');
  }

  // ===== Search =====

  visitSearch(node) {
    const engine = this.rawString(node.engine);
    const host = this.expr(node.host);
    const apiKey = this.expr(node.apiKey);
    this.emit(`# Search engine: ${engine}`);
    this.emit(`SEARCH_HOST = ${host}`);
    this.emit(`SEARCH_API_KEY = ${apiKey}`);
    this.emitRaw('');
  }

  // ===== Image =====

  visitImage(node) {
    this.addGem('mini_magick');
    const input = this.expr(node.input);
    const output = node.output ? this.expr(node.output) : input;
    this.emit(`# Image processing with MiniMagick`);
    this.emit(`image = MiniMagick::Image.open(${input})`);
    for (const op of node.operations) {
      if (op.op === 'resize') {
        const w = op.args[0] || 800;
        const h = op.args[1] || 600;
        this.emit(`image.resize "${w}x${h}"`);
      } else if (op.op === 'rotate') {
        this.emit(`image.rotate "${op.args[0] || 90}"`);
      } else if (op.op === 'flip') {
        this.emit(`image.flip`);
      } else if (op.op === 'grayscale' || op.op === 'greyscale') {
        this.emit(`image.colorspace "Gray"`);
      }
    }
    this.emit(`image.write(${output})`);
    this.emit(`puts "Processed: #{${output}}"`);
    this.emitRaw('');
  }

  // ===== CSV =====

  visitCsv(node) {
    this.addGem('csv');
    const name = this.rawString(node.name);
    const columns = node.columns.map(c => this.rawString(c));
    const source = node.source ? this.expr(node.source) : '[]';
    const output = node.output ? this.rawString(node.output) : `${name}.csv`;

    this.emit(`CSV.open(${JSON.stringify(output)}, 'w') do |csv|`);
    this.indent++;
    if (columns.length > 0) {
      this.emit(`csv << ${JSON.stringify(columns)}`);
    }
    this.emit(`${source}.each { |row| csv << (row.is_a?(Hash) ? row.values : [row]) }`);
    this.indent--;
    this.emit('end');
    this.emit(`puts "Exported: ${output}"`);
    this.emitRaw('');
  }

  // ===== Logging =====

  visitLogging(node) {
    this.addGem('logger');
    const name = this.rawString(node.name);
    const level = node.level ? this.rawString(node.level) : 'info';
    const file = node.file ? this.rawString(node.file) : null;

    this.emit(`# Logger: ${name} (level: ${level})`);
    if (file) {
      this.emit(`${name}_logger = Logger.new(${JSON.stringify(file)})`);
    } else {
      this.emit(`${name}_logger = Logger.new($stdout)`);
    }
    this.emit(`${name}_logger.level = Logger::${level.toUpperCase()}`);
    this.emitRaw('');
  }

  // ===== Migration =====

  visitMigrate(node) {
    const name = this.rawString(node.name);
    this.emit(`# Migration: ${name}`);
    this.emit(`Sequel.migration do`);
    this.indent++;
    this.emit(`up do`);
    this.indent++;
    if (node.up.length > 0) {
      for (const stmt of node.up) this.visitStatement(stmt);
    } else {
      this.emit('# empty');
    }
    this.indent--;
    this.emit(`end`);
    this.emit(`down do`);
    this.indent++;
    if (node.down.length > 0) {
      for (const stmt of node.down) this.visitStatement(stmt);
    } else {
      this.emit('# empty');
    }
    this.indent--;
    this.emit(`end`);
    this.indent--;
    this.emit(`end`);
    this.emitRaw('');
  }

  // ===== gRPC =====

  visitGrpc(node) {
    this.addGem('grpc');
    const name = this.rawString(node.name);
    const port = node.port ? this.expr(node.port) : '50051';
    this.emit(`# gRPC server: ${name} on port ${port}`);
    this.emitRaw('');
  }

  // ===== WebRTC =====

  visitWebrtc(node) {
    this.emit(`# WebRTC signaling - use a WebSocket server`);
    this.emitRaw('');
  }

  // ===== Blockchain =====

  visitBlockchain(node) {
    const name = this.rawString(node.name);
    const provider = node.provider ? this.expr(node.provider) : "'http://localhost:8545'";
    this.emit(`# Blockchain: ${name}`);
    this.emit(`${name.replace(/\W/g, '_')}_provider = ${provider}`);
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
      case 'Identifier': return node.name;

      case 'Binary': {
        const op = this.mapBinaryOp(node.op);
        const l = this.expr(node.left);
        const r = this.expr(node.right);
        if (node.op === 'instanceof') {
          return `${l}.is_a?(${r})`;
        }
        if (node.op === 'in') {
          return `${r}.include?(${l})`;
        }
        const simple = node.left.type !== 'Binary' && node.right.type !== 'Binary';
        return simple ? `${l} ${op} ${r}` : `(${l} ${op} ${r})`;
      }

      case 'Unary': {
        const op = node.op === '!' ? '!' : node.op;
        return `${op}${this.expr(node.expr)}`;
      }

      case 'Await':
        return this.expr(node.expr);

      case 'AwaitAllExpr':
        return this.expr(node.expr);

      case 'Spread':
        return `*${this.expr(node.expr)}`;

      case 'New':
        return `${this.exprName(node.expr)}`;

      case 'TypeOf':
        return `${this.expr(node.expr)}.class.name`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

      case 'OptionalAccess':
        return `${this.expr(node.object)}&.${node.property}`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array':
        return `[${node.elements.map(e => this.expr(e)).join(', ')}]`;

      case 'Object': {
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `**${this.expr(p.value)}`;
          if (p.type === 'shorthand') return `${p.key}: ${p.key}`;
          const key = typeof p.key === 'string' ? p.key :
                      (p.key.type === 'String' ? this.rawString(p.key.value) :
                       (p.key.type === 'Computed' ? this.expr(p.key.expr) : p.key));
          return `${key}: ${this.expr(p.value)}`;
        }).join(', ');
        return `{ ${props} }`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        if (params) return `-> (${params}) { ${body} }`;
        return `-> { ${body} }`;
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
        if (params) return `lambda { |${params}| ${bodyLines.join('; ')} }`;
        return `lambda { ${bodyLines.join('; ')} }`;
      }

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `nil # expr:${node.type}`;
    }
  }

  // Get identifier name without wrapping (for assignment targets, class names)
  exprName(node) {
    if (!node) return 'nil';
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'Call') {
      const callee = node.callee.type === 'Identifier' ? node.callee.name : this.exprName(node.callee);
      const args = node.args.map(a => this.expr(a)).join(', ');
      return `${callee}.new(${args})`;
    }
    if (node.type === 'MemberAccess') {
      return `${this.expr(node.object)}.${node.property}`;
    }
    return this.expr(node);
  }

  mapBinaryOp(op) {
    const map = {
      '===': '==', '!==': '!=',
      '==': '==', '!=': '!=',
      '&&': '&&', '||': '||',
      '??': '||',
      '>': '>', '<': '<', '>=': '>=', '<=': '<=',
      '+': '+', '-': '-', '*': '*', '/': '/', '%': '%',
      '**': '**',
      'and': '&&', 'or': '||',
    };
    return map[op] || op;
  }

  mapMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    // Map common JS patterns to Ruby
    if (prop === 'length') return `${obj}.length`;
    if (prop === 'toString') return `${obj}.to_s`;

    // Request mappings (Sinatra)
    if ((obj === 'request' || obj === 'req') && prop === 'body') return 'request.body.read';
    if ((obj === 'request' || obj === 'req') && prop === 'query') return 'params';
    if ((obj === 'request' || obj === 'req') && prop === 'params') return 'params';
    if ((obj === 'request' || obj === 'req') && prop === 'headers') return 'request.env';
    if ((obj === 'request' || obj === 'req') && prop === 'cookies') return 'request.cookies';
    if ((obj === 'request' || obj === 'req') && prop === 'method') return 'request.request_method';
    if ((obj === 'request' || obj === 'req') && prop === 'url') return 'request.url';

    // JSON
    if (obj === 'JSON' && prop === 'parse') return 'JSON.parse';
    if (obj === 'JSON' && prop === 'stringify') return 'JSON.generate';

    // Math
    if (obj === 'Math' && prop === 'floor') return 'method(:floor)';
    if (obj === 'Math' && prop === 'ceil') return 'method(:ceil)';
    if (obj === 'Math' && prop === 'round') return 'method(:round)';
    if (obj === 'Math' && prop === 'abs') return 'method(:abs)';
    if (obj === 'Math' && prop === 'random') return 'rand';
    if (obj === 'Math' && prop === 'PI') return 'Math::PI';
    if (obj === 'Math') return `Math.${prop}`;

    // Console
    if (obj === 'console' && prop === 'log') return 'method(:puts)';
    if (obj === 'console' && prop === 'error') return '$stderr.method(:puts)';

    return `${obj}.${prop}`;
  }

  generateCall(node) {
    if (node.callee.type === 'Identifier') {
      const argList = node.args.map(a => this.expr(a));
      const b = this.generateBuiltin(node.callee.name, argList);
      if (b) return b;
    }

    const args = node.args.map(a => this.expr(a)).join(', ');

    // Map global function calls
    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;
      if (name === 'parseInt') return `${args}.to_i`;
      if (name === 'parseFloat') return `${args}.to_f`;
      if (name === 'String') return `${args}.to_s`;
      if (name === 'Number') return `${args}.to_f`;
      if (name === 'Boolean') return `!!${args}`;
      if (name === 'isNaN') return `${args}.nan?`;
      if (name === 'setTimeout') return `Thread.new { sleep(${node.args[1] ? this.expr(node.args[1]) : '0'} / 1000.0); ${this.expr(node.args[0])}.call }`;
      if (name === 'setInterval') return `Thread.new { loop { sleep(${node.args[1] ? this.expr(node.args[1]) : '0'} / 1000.0); ${this.expr(node.args[0])}.call } }`;

      if (args) return `${name}(${args})`;
      return `${name}`;
    }

    // Map method calls
    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // Array methods
      if (prop === 'push') return `${obj}.push(${args})`;
      if (prop === 'pop') return `${obj}.pop`;
      if (prop === 'shift') return `${obj}.shift`;
      if (prop === 'unshift') return `${obj}.unshift(${args})`;
      if (prop === 'indexOf') return `${obj}.index(${args})`;
      if (prop === 'includes') return `${obj}.include?(${args})`;
      if (prop === 'join') return `${obj}.join(${args})`;
      if (prop === 'slice') return `${obj}.slice(${args})`;
      if (prop === 'forEach') return `${obj}.each { |item| ${args}.call(item) }`;
      if (prop === 'map') return `${obj}.map { |item| ${args}.call(item) }`;
      if (prop === 'filter') return `${obj}.select { |item| ${args}.call(item) }`;
      if (prop === 'find') return `${obj}.find { |item| ${args}.call(item) }`;
      if (prop === 'some') return `${obj}.any? { |item| ${args}.call(item) }`;
      if (prop === 'every') return `${obj}.all? { |item| ${args}.call(item) }`;
      if (prop === 'reduce') return `${obj}.reduce { |acc, item| ${args}.call(acc, item) }`;
      if (prop === 'reverse') return `${obj}.reverse`;
      if (prop === 'sort') return `${obj}.sort`;
      if (prop === 'concat') return `${obj} + ${args}`;
      if (prop === 'flat') return `${obj}.flatten`;
      if (prop === 'flatMap') return `${obj}.flat_map { |item| ${args}.call(item) }`;
      if (prop === 'fill') return `${obj}.fill(${args})`;

      // String methods
      if (prop === 'split') return `${obj}.split(${args})`;
      if (prop === 'trim') return `${obj}.strip`;
      if (prop === 'trimStart') return `${obj}.lstrip`;
      if (prop === 'trimEnd') return `${obj}.rstrip`;
      if (prop === 'toUpperCase') return `${obj}.upcase`;
      if (prop === 'toLowerCase') return `${obj}.downcase`;
      if (prop === 'startsWith') return `${obj}.start_with?(${args})`;
      if (prop === 'endsWith') return `${obj}.end_with?(${args})`;
      if (prop === 'replace') return `${obj}.sub(${args})`;
      if (prop === 'replaceAll') return `${obj}.gsub(${args})`;
      if (prop === 'charAt') return `${obj}[${args}]`;
      if (prop === 'substring') return `${obj}[${args}]`;
      if (prop === 'repeat') return `${obj} * ${args}`;
      if (prop === 'padStart') return `${obj}.rjust(${args})`;
      if (prop === 'padEnd') return `${obj}.ljust(${args})`;
      if (prop === 'match') return `${obj}.match(${args})`;

      // Object methods
      if (obj === 'Object' && prop === 'keys') return `${args}.keys`;
      if (obj === 'Object' && prop === 'values') return `${args}.values`;
      if (obj === 'Object' && prop === 'entries') return `${args}.to_a`;
      if (obj === 'Object' && prop === 'assign') return `${args}.merge`;

      // Array static
      if (obj === 'Array' && prop === 'isArray') return `${args}.is_a?(Array)`;
      if (obj === 'Array' && prop === 'from') return `Array(${args})`;

      // Date
      if (obj === 'Date' && prop === 'now') return `(Time.now.to_f * 1000).to_i`;

      // Console
      if (obj === 'console' && prop === 'log') return `puts ${args}`;
      if (obj === 'console' && prop === 'error') return `$stderr.puts ${args}`;

      // JSON
      if (obj === 'JSON' && prop === 'parse') return `JSON.parse(${args})`;
      if (obj === 'JSON' && prop === 'stringify') return `JSON.generate(${args})`;
    }

    const callee = this.expr(node.callee);
    if (args) return `${callee}(${args})`;
    return `${callee}`;
  }

  generateString(strData) {
    if (!strData || !strData.parts) return '""';

    const hasInterpolation = strData.parts.some(p => p.type === 'expr');

    if (!hasInterpolation) {
      const raw = strData.parts.map(p => p.value).join('');
      return JSON.stringify(raw);
    }

    // Use double-quoted string with #{expr} interpolation
    let result = '"';
    for (const part of strData.parts) {
      if (part.type === 'text') {
        result += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/#\{/g, '\\#{');
      } else {
        result += '#{' + part.value + '}';
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

  rubyStringValue(strData) {
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

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier') {
        const name = step.callee.name;
        const args = step.args.map(a => this.expr(a)).join(', ');

        if (name === 'filter') {
          result = `${result}.select { |item| ${args}.call(item) }`;
        } else if (name === 'map') {
          result = `${result}.map { |item| ${args}.call(item) }`;
        } else if (name === 'reduce') {
          result = `${result}.reduce { |acc, item| ${args}.call(acc, item) }`;
        } else if (name === 'sort') {
          result = `${result}.sort`;
        } else if (name === 'reverse') {
          result = `${result}.reverse`;
        } else if (name === 'join') {
          result = `${result}.join(${args})`;
        } else {
          result = `${name}(${result}${args ? ', ' + args : ''})`;
        }
      } else if (step.type === 'Identifier') {
        result = `${step.name}(${result})`;
      } else if (step.type === 'Call') {
        const callee = this.exprName(step.callee);
        const args = step.args.map(a => this.expr(a)).join(', ');
        result = `${callee}(${result}${args ? ', ' + args : ''})`;
      } else {
        result = `${this.expr(step)}.call(${result})`;
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
    this.emit(`module ${node.name}`);
    this.indent++;
    node.values.forEach((v, i) => {
      this.emit(`${v} = ${i}`);
    });
    this.indent--;
    this.emit(`end`);
    this.emitRaw('');
  }

  visitSwap(node) {
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    this.emit(`${a}, ${b} = ${b}, ${a}`);
  }

  generateBuiltin(name, args) {
    switch (name) {
      case 'len': return `${args[0]}.length`;
      case 'sort': return `${args[0]}.sort`;
      case 'reverse': return `${args[0]}.reverse`;
      case 'unique': return `${args[0]}.uniq`;
      case 'upper': return `${args[0]}.upcase`;
      case 'lower': return `${args[0]}.downcase`;
      case 'trim': return `${args[0]}.strip`;
      case 'split': return `${args[0]}.split(${args[1] || '","'})`;
      case 'join': return `${args[0]}.join(${args[1] || '","'})`;
      case 'contains': return `${args[0]}.include?(${args[1]})`;
      case 'replace': return `${args[0]}.gsub(${args[1]}, ${args[2]})`;
      case 'keys': return `${args[0]}.keys`;
      case 'values': return `${args[0]}.values`;
      case 'entries': return `${args[0]}.to_a`;
      case 'range': return args.length >= 2 ? `(${args[0]}...${args[1]}).to_a` : `(0...${args[0]}).to_a`;
      case 'abs': return `${args[0]}.abs`;
      case 'round': return `${args[0]}.round`;
      case 'ceil': return `${args[0]}.ceil`;
      case 'floor': return `${args[0]}.floor`;
      case 'sqrt': return `Math.sqrt(${args[0]})`;
      case 'pow': return `${args[0]} ** ${args[1]}`;
      case 'sum': return `${args[0]}.sum`;
      case 'flat': return `${args[0]}.flatten`;
      case 'zip': return `${args[0]}.zip(${args[1]})`;
      case 'chunk': return `${args[0]}.each_slice(${args[1]}).to_a`;
      case 'str': return `${args[0]}.to_s`;
      case 'int': return `${args[0]}.to_i`;
      case 'float': return `${args[0]}.to_f`;
      case 'json_parse': return `JSON.parse(${args[0]})`;
      case 'json_str': return `JSON.generate(${args[0]})`;
      case 'now': return `(Time.now.to_f * 1000).to_i`;
      case 'time': return `Time.now.iso8601`;
      case 'exit': return `exit(${args[0] || '0'})`;
      case 'sleep': return `sleep(${args[0]} / 1000.0)`;
      case 'random': return args.length >= 2 ? `rand(${args[0]}..${args[1]})` : `rand`;
      case 'read': return `File.read(${args[0]})`;
      case 'write': return `File.write(${args[0]}, ${args[1]})`;
      case 'ask': return `(print(${args[0] || '""'}); gets.chomp)`;
      default: return null;
    }
  }
}
