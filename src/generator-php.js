export class PhpGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.usesLaravel = false;
    this.authSecret = null;
    this.dbVar = null;
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
  }

  generate(ast) {
    this.visitProgram(ast);

    // Prepend <?php
    this.output.unshift('<?php');
    this.output.splice(1, 0, '');

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
      case 'AuthDecl': return this.visitAuth('$app', node);
      case 'CorsDecl': return this.visitCors('$app', node);
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
      case 'Destructure': return this.visitDestructure(node);
      case 'ClassDecl': return this.visitClassDecl(node);
      default:
        this.emit(`/* unknown: ${node.type} */`);
    }
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const alias = node.alias || node.name;
    const clean = raw.replace(/^['"]|['"]$/g, '');
    this.emit(`// use ${clean}`);
    this.emit(`require_once '${clean}.php';`);
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const clean = raw.replace(/^['"]|['"]$/g, '');
    this.emit(`// use { ${node.names.map(n => n.name).join(', ')} } from ${clean}`);
    this.emit(`require_once '${clean}.php';`);
  }

  // ===== Functions =====

  visitFunction(node) {
    const params = node.params.map(p => {
      let s = '';
      if (p.spread) s += '...';
      s += '$' + p.name;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    const retType = node.returnType ? `: ${this.mapType(node.returnType)}` : '';

    this.emit(`function ${node.name}(${params})${retType} {`);
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
      this.emit('return;');
    } else {
      this.emit(`return ${this.expr(node.value)};`);
    }
  }

  visitReturnStatus(node) {
    this.emit(`http_response_code(${this.expr(node.statusCode)});`);
    this.emit(`echo json_encode(${this.expr(node.body)});`);
    this.emit('return;');
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`header("Location: " . ${val});`);
        this.emit('exit;');
        break;
      case 'html':
        this.emit(`header("Content-Type: text/html");`);
        this.emit(`echo ${val};`);
        break;
      case 'text':
        this.emit(`header("Content-Type: text/plain");`);
        this.emit(`echo ${val};`);
        break;
      case 'file':
        this.emit(`readfile(${val});`);
        break;
      default:
        this.emit(`echo ${val};`);
    }
  }

  // ===== Variables =====

  visitTypedVar(node) {
    this.emit(`$${node.name} = ${this.expr(node.value)};`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.expr(e)).join(', ');
      this.emit(`[${names}] = ${value};`);
    } else if (node.target.type === 'Object') {
      const tempVar = '$__d';
      this.emit(`${tempVar} = ${value};`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? '$' + p.key : this.expr(p.value);
        this.emit(`${varName} = ${tempVar}[${JSON.stringify(key)}];`);
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
      this.emit(`} elseif (${this.expr(elif.condition)}) {`);
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
      this.emit(`foreach (${collection} as $${node.key} => $${node.value}) {`);
    } else {
      this.emit(`foreach (${collection} as $${node.value}) {`);
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
    this.emit(`for ($${varName} = ${start}; $${varName} < ${end}; $${varName}++) {`);
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
    this.emit(`$__match_result = match(${this.expr(node.value)}) {`);
    this.indent++;
    for (const c of node.cases) {
      if (c.pattern.type === 'DefaultPattern') {
        this.emit(`default => (function() {`);
      } else {
        this.emit(`${this.expr(c.pattern)} => (function() {`);
      }
      this.indent++;
      for (const stmt of c.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('})(),');
    }
    this.indent--;
    this.emit('};');
  }

  visitTry(node) {
    this.emit('try {');
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;

    if (node.catchBody) {
      const catchParam = node.catchVar || 'e';
      this.emit(`} catch (\\Exception $${catchParam}) {`);
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

  // ===== Server (Laravel-style) =====

  visitServer(node) {
    this.usesLaravel = true;
    this.emit(`// Server: ${node.name}`);
    this.emit(`// Laravel-style route definitions`);
    this.emitRaw('');

    this.emit(`use Illuminate\\Support\\Facades\\Route;`);
    this.emit(`use Illuminate\\Http\\Request;`);
    this.emitRaw('');

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth('Route', child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors('Route', child);
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

    const port = node.port ? this.expr(node.port) : '8000';
    this.emitRaw('');
    this.emit(`// To run: php artisan serve --port=${port}`);
  }

  visitRoute(route) {
    const method = route.method === 'del' ? 'delete' : route.method;
    const path = this.phpStringValue(route.path);

    this.emit(`Route::${method}(${path}, function (Request $request) {`);
    this.indent++;

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`return response()->json(${this.expr(stmt.value)});`);
      } else {
        this.visitStatement(stmt);
      }
    }

    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitGroup(node) {
    const prefix = this.phpStringValue(node.prefix);
    this.emit(`Route::prefix(${prefix})->group(function () {`);
    this.indent++;

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(child);
      } else {
        this.visitStatement(child);
      }
    }

    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Model (class) =====

  visitModel(node) {
    this.models.set(node.name, node);

    const ext = node.parent ? ` extends ${node.parent}` : '';
    this.emit(`class ${node.name}${ext} {`);
    this.indent++;

    // Properties
    for (const f of node.fields) {
      const phpType = this.mapType(f.type);
      this.emit(`public ${phpType} $${f.name};`);
    }

    if (node.fields.length > 0) {
      this.emitRaw('');
    }

    // Constructor
    if (node.fields.length > 0 || node.parent) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const constructorParams = allFields.map(f => {
        const phpType = this.mapType(f.type);
        if (f.defaultValue) return `${phpType} $${f.name} = ${this.expr(f.defaultValue)}`;
        return `${phpType} $${f.name}`;
      }).join(', ');

      this.emit(`public function __construct(${constructorParams}) {`);
      this.indent++;
      if (node.parent) {
        const superArgs = parentFields.map(f => '$' + f.name).join(', ');
        this.emit(`parent::__construct(${superArgs});`);
      }
      for (const f of node.fields) {
        this.emit(`$this->${f.name} = $${f.name};`);
      }
      this.indent--;
      this.emit('}');
      this.emitRaw('');
    }

    // Methods
    for (const method of node.methods) {
      const params = method.params.map(p => {
        let s = '';
        if (p.spread) s += '...';
        s += '$' + p.name;
        if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      this.emit(`public function ${method.name}(${params}) {`);
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

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    this.emit(`// on ${event}`);
    this.emit(`// Event handler`);
    this.emit(`(function () {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('})();');
  }

  // ===== Logging =====

  visitLog(node) {
    const args = node.args.map(a => this.expr(a));
    if (args.length === 1) {
      if (node.level === 'error') {
        this.emit(`error_log(${args[0]});`);
      } else {
        this.emit(`echo ${args[0]} . "\\n";`);
      }
    } else {
      if (node.level === 'error') {
        this.emit(`error_log(implode(' ', [${args.join(', ')}]));`);
      } else {
        this.emit(`echo implode(' ', [${args.join(', ')}]) . "\\n";`);
      }
    }
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw new \\Exception(${value});`);
    } else {
      this.emit(`throw ${value};`);
    }
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.dbVar = '$db';
    this.emit(`$db = new PDO(${this.expr(node.connectionString)});`);
    this.emit(`$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);`);
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`// db dir: ${raw}`);
  }

  visitDbSql(node) {
    const driverRaw = node.driver.raw || node.driver.parts?.map(p => p.value).join('') || 'sqlite';
    this.dbVar = '$__db';

    if (driverRaw === 'sqlite') {
      const conn = node.connection ? this.phpStringValue(node.connection) : '"data.db"';
      this.emit(`$__db = new PDO("sqlite:" . ${conn});`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      const conn = node.connection ? this.phpStringValue(node.connection) : 'getenv("DATABASE_URL")';
      this.emit(`$__db = new PDO(${conn});`);
    } else {
      const conn = node.connection ? this.phpStringValue(node.connection) : '"localhost"';
      this.emit(`$__db = new PDO(${conn});`);
    }
    this.emit(`$__db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);`);
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    this.emit(`// await.all - PHP is synchronous; executing sequentially`);
    for (const e of node.expressions) {
      this.emit(`${this.expr(e)};`);
    }
  }

  // ===== Schema =====

  visitSchema(node) {
    this.emit(`// Schema: ${node.name}`);
    this.emit(`class ${node.name} {`);
    this.indent++;

    for (const field of node.fields) {
      const phpType = this.mapSchemaType(field.type);
      const defaultVal = this.schemaDefault(field);
      if (defaultVal !== null) {
        this.emit(`public ${phpType} $${field.name} = ${defaultVal};`);
      } else {
        this.emit(`public ${phpType} $${field.name};`);
      }
    }

    this.indent--;
    this.emit('}');

    this.schemas.set(node.name, node);
    this.emitRaw('');
  }

  mapSchemaType(type) {
    const map = {
      'str': 'string', 'string': 'string',
      'int': 'int', 'integer': 'int',
      'num': 'float', 'number': 'float',
      'bool': 'bool', 'boolean': 'bool',
      'auto': 'int', 'timestamp': 'string',
      'enum': 'string',
    };
    return map[type] || 'mixed';
  }

  schemaDefault(fieldNode) {
    for (const mod of fieldNode.modifiers) {
      if (mod.name === 'default') {
        return this.expr(mod.args[0]);
      }
    }
    for (const mod of fieldNode.modifiers) {
      if (mod.name === 'optional') return 'null';
    }
    if (fieldNode.type === 'auto') return 'null';
    if (fieldNode.type === 'timestamp') return 'null';
    return null;
  }

  // ===== Auth =====

  visitAuth(appName, node) {
    const secret = this.expr(node.secret);
    this.authSecret = secret;
    this.emit(`$__authSecret = ${secret};`);
    this.emit(`// JWT authentication middleware`);
    this.emit(`function requireAuth() {`);
    this.indent++;
    this.emit(`global $__authSecret;`);
    this.emit(`$token = $_SERVER['HTTP_AUTHORIZATION'] ?? '';`);
    this.emit(`$token = str_replace('Bearer ', '', $token);`);
    this.emit(`if (!$token) {`);
    this.indent++;
    this.emit(`http_response_code(401);`);
    this.emit(`echo json_encode(['error' => 'No token provided']);`);
    this.emit(`exit;`);
    this.indent--;
    this.emit('}');
    this.emit('try {');
    this.indent++;
    this.emit(`$decoded = json_decode(base64_decode(explode('.', $token)[1]), true);`);
    this.emit(`return $decoded;`);
    this.indent--;
    this.emit('} catch (\\Exception $e) {');
    this.indent++;
    this.emit(`http_response_code(401);`);
    this.emit(`echo json_encode(['error' => 'Invalid token']);`);
    this.emit(`exit;`);
    this.indent--;
    this.emit('}');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== CORS =====

  visitCors(appName, node) {
    const origins = this.expr(node.origins);
    this.emit(`// CORS`);
    this.emit(`header("Access-Control-Allow-Origin: " . ${origins});`);
    this.emit(`header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");`);
    this.emit(`header("Access-Control-Allow-Headers: Content-Type, Authorization");`);
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
        this.emit(`$${v.name} = getenv(${JSON.stringify(v.name)}) ?: ${defaultVal};`);
      } else {
        this.emit(`$${v.name} = getenv(${JSON.stringify(v.name)});`);
      }

      if (v.type === 'int') {
        this.emit(`$${v.name} = (int)$${v.name};`);
      } else if (v.type === 'num') {
        this.emit(`$${v.name} = (float)$${v.name};`);
      } else if (v.type === 'bool') {
        this.emit(`$${v.name} = filter_var($${v.name}, FILTER_VALIDATE_BOOLEAN);`);
      }
    }
    this.emitRaw('');
  }

  // ===== Tests =====

  visitTest(node) {
    const name = this.rawString(node.name);
    const funcName = `test_${name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}`;

    this.emit(`// Test: ${name}`);
    this.emit(`function ${funcName}() {`);
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
      this.emit(`assert(${this.expr(exprNode.left)} === ${this.expr(exprNode.right)}, "Assertion failed");`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`assert(${this.expr(exprNode.left)} !== ${this.expr(exprNode.right)}, "Assertion failed");`);
    } else {
      this.emit(`assert(${this.expr(exprNode)}, "Assertion failed");`);
    }
  }

  // ===== CRUD =====

  visitCrud(node) {
    const path = this.rawString(node.path);
    const schema = node.schemaName;
    this.emit(`// CRUD for ${schema} at ${path}`);
    this.emit(`Route::get('${path}', function () { return response()->json([]); });`);
    this.emit(`Route::get('${path}/{id}', function ($id) { return response()->json(['id' => $id]); });`);
    this.emit(`Route::post('${path}', function (Request $request) { return response()->json($request->all(), 201); });`);
    this.emit(`Route::put('${path}/{id}', function (Request $request, $id) { return response()->json(array_merge(['id' => $id], $request->all())); });`);
    this.emit(`Route::delete('${path}/{id}', function ($id) { return response()->json(['deleted' => true]); });`);
    this.emitRaw('');
  }

  // ===== Static =====

  visitStatic(node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    this.emit(`// Static files from: ${raw}`);
  }

  // ===== Rate limit =====

  visitLimit(node) {
    const path = this.rawString(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`// Rate limit: ${max} requests per ${window} on ${path}`);
  }

  // ===== WebSocket =====

  visitWs(node) {
    this.emit(`// WebSocket - use Ratchet or Laravel WebSockets`);
    this.emit(`// ws path: ${this.phpStringValue(node.path)}`);
    for (const evt of (node.events || [])) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      this.emit(`// on ${evtName}`);
    }
    this.emitRaw('');
  }

  // ===== Session =====

  visitSession(node) {
    this.emit(`session_start();`);
    this.emitRaw('');
  }

  // ===== Cache =====

  visitCache(node) {
    const path = this.rawString(node.path);
    this.emit(`// Cache: ${path}`);
  }

  // ===== Error handler =====

  visitErrorHandler(node) {
    this.emit(`set_exception_handler(function ($exception) {`);
    this.indent++;
    this.emit(`http_response_code(500);`);
    this.emit(`echo json_encode(['error' => $exception->getMessage()]);`);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'getenv("BOT_TOKEN")';
    this.emit(`// Bot: ${node.name}`);
    this.emit(`$${node.name}_token = ${tokenExpr};`);
    this.emit(`// Bot implementation requires a PHP bot library`);
    this.emitRaw('');
  }

  // ===== Every (cron) =====

  visitEvery(node) {
    const interval = this.expr(node.interval);
    this.emit(`// Cron job: every ${interval}`);
    this.emit(`// Schedule via: * * * * * php artisan schedule:run`);
    this.emit(`(function () {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('})();');
    this.emitRaw('');
  }

  // ===== Prompt =====

  visitPrompt(node) {
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : `implode("\\n", [${lines.join(', ')}])`;
    const defaults = node.defaults ? this.expr(node.defaults) : '[]';

    this.emit(`function ${node.name}($vars = []) {`);
    this.indent++;
    this.emit(`$defaults = ${defaults};`);
    this.emit(`$merged = array_merge($defaults, $vars);`);
    this.emit(`$template = ${template};`);
    this.emit(`foreach ($merged as $k => $v) {`);
    this.indent++;
    this.emit(`$template = str_replace('{' . $k . '}', (string)$v, $template);`);
    this.indent--;
    this.emit('}');
    this.emit('return $template;');
    this.indent--;
    this.emit('}');
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

    this.emit(`$__html = '<!DOCTYPE html>`);
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
    this.emit(`</html>';`);
    this.emit(`file_put_contents(${JSON.stringify(filename)}, $__html);`);
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
    const desc = node.description ? this.rawString(node.description) : node.name;
    this.emit(`// CLI: ${node.name} - ${desc}`);
    this.emit(`$args = [];`);
    this.emit(`$argv = array_slice($argv ?? [], 1);`);
    this.emitRaw('');

    this.emit(`for ($__i = 0; $__i < count($argv); $__i++) {`);
    this.indent++;
    for (const arg of node.args) {
      const argName = this.rawString(arg.name);
      this.emit(`if ($argv[$__i] === '--${argName}') { $args['${argName}'] = $argv[++$__i]; continue; }`);
    }
    for (const flag of node.flags) {
      const s = this.rawString(flag.short);
      const l = this.rawString(flag.long);
      this.emit(`if ($argv[$__i] === '-${s}' || $argv[$__i] === '--${l}') { $args['${l}'] = true; continue; }`);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');

    if (node.run) {
      const runParam = node.run.params.length > 0 ? node.run.params[0] : 'args';
      if (runParam !== 'args') {
        this.emit(`$${runParam} = $args;`);
      }
      for (const stmt of node.run.body) this.visitStatement(stmt);
    }
    this.emitRaw('');
  }

  // ===== Mail =====

  visitMail(node) {
    const host = this.generateString(node.host);
    const port = this.expr(node.port);
    this.emit(`// Mail configuration`);
    this.emit(`// Use PHPMailer or Laravel Mail`);
    this.emit(`$mailConfig = ['host' => ${host}, 'port' => ${port}];`);
    this.emitRaw('');
  }

  // ===== Desktop =====

  visitDesktop(node) {
    this.emit(`// Desktop app: ${node.name}`);
    this.emit(`// PHP is not typically used for desktop apps`);
    this.emit(`// Consider using PHP-GTK or a web-based approach`);
    this.emitRaw('');
  }

  // ===== Screen =====

  visitScreen(node) {
    this.emit(`// Mobile screen: ${node.name}`);
    this.emit(`// PHP is not used for mobile development`);
    this.emitRaw('');
  }

  // ===== GraphQL =====

  visitGraphql(node) {
    const path = this.phpStringValue(node.path);
    this.emit(`// GraphQL endpoint at ${path}`);
    this.emit(`// Use webonyx/graphql-php for GraphQL support`);
    this.emitRaw('');
  }

  // ===== OAuth =====

  visitOauth(node) {
    const provider = this.rawString(node.provider);
    const clientId = this.expr(node.clientId);
    const clientSecret = this.expr(node.clientSecret);
    this.emit(`// OAuth: ${provider}`);
    this.emit(`$oauthConfig = [`);
    this.indent++;
    this.emit(`'provider' => ${JSON.stringify(provider)},`);
    this.emit(`'client_id' => ${clientId},`);
    this.emit(`'client_secret' => ${clientSecret},`);
    this.indent--;
    this.emit(`];`);
    this.emitRaw('');
  }

  // ===== Pay =====

  visitPay(node) {
    const provider = this.rawString(node.provider);
    const secretKey = this.expr(node.secretKey);
    if (provider === 'stripe') {
      this.emit(`// Stripe payment`);
      this.emit(`// composer require stripe/stripe-php`);
      this.emit(`\\Stripe\\Stripe::setApiKey(${secretKey});`);
    } else {
      this.emit(`// ${provider} payment integration`);
    }
    this.emitRaw('');
  }

  // ===== Storage =====

  visitStorage(node) {
    const provider = this.rawString(node.provider);
    const bucket = this.expr(node.bucket);
    this.emit(`// Storage: ${provider}`);
    this.emit(`$storageBucket = ${bucket};`);
    this.emit(`// Use league/flysystem for storage abstraction`);
    this.emitRaw('');
  }

  // ===== PDF =====

  visitPdf(node) {
    const filename = this.rawString(node.filename);
    this.emit(`// PDF generation: ${filename}`);
    this.emit(`// Use TCPDF or FPDF`);
    this.emit(`// composer require tecnickcom/tcpdf`);
    this.emit(`$__pdf = new TCPDF();`);
    this.emit(`$__pdf->AddPage();`);

    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
      if (tag === 'title') {
        this.emit(`$__pdf->SetFont('helvetica', 'B', 24);`);
        this.emit(`$__pdf->Cell(0, 15, ${JSON.stringify(arg0)}, 0, 1);`);
      } else if (tag === 'text' || tag === 'p') {
        this.emit(`$__pdf->SetFont('helvetica', '', 12);`);
        this.emit(`$__pdf->MultiCell(0, 8, ${JSON.stringify(arg0)});`);
      } else {
        this.emit(`$__pdf->Cell(0, 8, ${JSON.stringify(arg0)}, 0, 1);`);
      }
    }

    this.emit(`$__pdf->Output(${JSON.stringify(filename)}, 'F');`);
    this.emit(`echo "Generated: ${filename}\\n";`);
    this.emitRaw('');
  }

  // ===== i18n =====

  visitI18n(node) {
    const dir = this.rawString(node.dir);
    const defaultLang = node.defaultLang ? this.rawString(node.defaultLang) : 'en';
    this.emit(`$__i18nData = [];`);
    for (const lang of node.langs) {
      const code = this.rawString(lang.code);
      const file = this.rawString(lang.file);
      this.emit(`$__i18nData[${JSON.stringify(code)}] = json_decode(file_get_contents(${JSON.stringify(dir)}. '/' . ${JSON.stringify(file)}), true);`);
    }
    this.emit(`$__i18nLang = ${JSON.stringify(defaultLang)};`);
    this.emitRaw('');
    this.emit(`function t($key, $params = []) {`);
    this.indent++;
    this.emit(`global $__i18nData, $__i18nLang;`);
    this.emit(`$data = $__i18nData[$__i18nLang] ?? [];`);
    this.emit(`foreach (explode('.', $key) as $k) { $data = $data[$k] ?? $key; if (!is_array($data)) break; }`);
    this.emit(`$text = (string)$data;`);
    this.emit(`foreach ($params as $k => $v) { $text = str_replace('{' . $k . '}', (string)$v, $text); }`);
    this.emit(`return $text;`);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== Push =====

  visitPush(node) {
    this.emit(`// Push notifications - use minishlink/web-push`);
    this.emit(`$vapidPublicKey = ${this.expr(node.publicKey)};`);
    this.emit(`$vapidPrivateKey = ${this.expr(node.privateKey)};`);
    this.emitRaw('');
  }

  // ===== Search =====

  visitSearch(node) {
    const engine = this.rawString(node.engine);
    const host = this.expr(node.host);
    const apiKey = this.expr(node.apiKey);
    this.emit(`// Search engine: ${engine}`);
    this.emit(`$searchHost = ${host};`);
    this.emit(`$searchApiKey = ${apiKey};`);
    this.emitRaw('');
  }

  // ===== Image =====

  visitImage(node) {
    const input = this.expr(node.input);
    const output = node.output ? this.expr(node.output) : input;
    this.emit(`// Image processing with GD or Intervention Image`);
    this.emit(`$__img = imagecreatefromstring(file_get_contents(${input}));`);
    for (const op of node.operations) {
      if (op.op === 'resize') {
        const w = op.args[0] || 800;
        const h = op.args[1] || 600;
        this.emit(`$__img = imagescale($__img, ${w}, ${h});`);
      } else if (op.op === 'rotate') {
        this.emit(`$__img = imagerotate($__img, ${op.args[0] || 90}, 0);`);
      } else if (op.op === 'flip') {
        this.emit(`imageflip($__img, IMG_FLIP_VERTICAL);`);
      } else if (op.op === 'grayscale' || op.op === 'greyscale') {
        this.emit(`imagefilter($__img, IMG_FILTER_GRAYSCALE);`);
      }
    }
    this.emit(`imagepng($__img, ${output});`);
    this.emit(`echo "Processed: " . ${output} . "\\n";`);
    this.emitRaw('');
  }

  // ===== CSV =====

  visitCsv(node) {
    const name = this.rawString(node.name);
    const columns = node.columns.map(c => this.rawString(c));
    const source = node.source ? this.expr(node.source) : '[]';
    const output = node.output ? this.rawString(node.output) : `${name}.csv`;

    this.emit(`$__fp = fopen(${JSON.stringify(output)}, 'w');`);
    if (columns.length > 0) {
      this.emit(`fputcsv($__fp, ${JSON.stringify(columns)});`);
    }
    this.emit(`foreach (${source} as $row) {`);
    this.indent++;
    this.emit(`fputcsv($__fp, is_array($row) ? array_values($row) : [$row]);`);
    this.indent--;
    this.emit('}');
    this.emit(`fclose($__fp);`);
    this.emit(`echo "Exported: ${output}\\n";`);
    this.emitRaw('');
  }

  // ===== Logging =====

  visitLogging(node) {
    const name = this.rawString(node.name);
    const level = node.level ? this.rawString(node.level) : 'info';
    const file = node.file ? this.rawString(node.file) : null;
    this.emit(`// Logger: ${name} (level: ${level})`);
    if (file) {
      this.emit(`// Log file: ${file}`);
      this.emit(`function logger($msg, $level = '${level}') {`);
      this.indent++;
      this.emit(`$line = date('Y-m-d H:i:s') . " [{$level}] {$msg}\\n";`);
      this.emit(`file_put_contents(${JSON.stringify(file)}, $line, FILE_APPEND);`);
      this.indent--;
      this.emit('}');
    } else {
      this.emit(`function logger($msg, $level = '${level}') {`);
      this.indent++;
      this.emit(`error_log(date('Y-m-d H:i:s') . " [{$level}] {$msg}");`);
      this.indent--;
      this.emit('}');
    }
    this.emitRaw('');
  }

  // ===== Migration =====

  visitMigrate(node) {
    const name = this.rawString(node.name);
    this.emit(`// Migration: ${name}`);
    this.emit(`class Migration_${name.replace(/\W/g, '_')} {`);
    this.indent++;
    this.emit(`public function up($db) {`);
    this.indent++;
    if (node.up.length > 0) {
      for (const stmt of node.up) this.visitStatement(stmt);
    } else {
      this.emit('// empty');
    }
    this.indent--;
    this.emit('}');
    this.emit(`public function down($db) {`);
    this.indent++;
    if (node.down.length > 0) {
      for (const stmt of node.down) this.visitStatement(stmt);
    } else {
      this.emit('// empty');
    }
    this.indent--;
    this.emit('}');
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== gRPC =====

  visitGrpc(node) {
    const name = this.rawString(node.name);
    const port = node.port ? this.expr(node.port) : '50051';
    this.emit(`// gRPC server: ${name} on port ${port}`);
    this.emit(`// Use grpc/grpc PHP extension`);
    this.emitRaw('');
  }

  // ===== WebRTC =====

  visitWebrtc(node) {
    this.emit(`// WebRTC signaling - use Ratchet WebSocket`);
    this.emitRaw('');
  }

  // ===== Blockchain =====

  visitBlockchain(node) {
    const name = this.rawString(node.name);
    const provider = node.provider ? this.expr(node.provider) : "'http://localhost:8545'";
    this.emit(`// Blockchain: ${name}`);
    this.emit(`// Use web3.php or similar`);
    this.emit(`$${name.replace(/\W/g, '_')}_provider = ${provider};`);
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
      case 'Self': return '$this';
      case 'Identifier': return '$' + node.name;

      case 'Binary': {
        const op = this.mapBinaryOp(node.op);
        const l = this.expr(node.left);
        const r = this.expr(node.right);
        if (node.op === 'instanceof') {
          return `${l} instanceof ${r}`;
        }
        if (node.op === 'in') {
          return `in_array(${l}, ${r})`;
        }
        const simple = node.left.type !== 'Binary' && node.right.type !== 'Binary';
        return simple ? `${l} ${op} ${r}` : `(${l} ${op} ${r})`;
      }

      case 'Unary': {
        const op = node.op === '!' ? '!' : node.op;
        return `${op}${this.expr(node.expr)}`;
      }

      case 'Await':
        // PHP is synchronous; just return the expression
        return this.expr(node.expr);

      case 'AwaitAllExpr':
        return this.expr(node.expr);

      case 'Spread':
        return `...${this.expr(node.expr)}`;

      case 'New':
        return `new ${this.exprNoPrefix(node.expr)}`;

      case 'TypeOf':
        return `gettype(${this.expr(node.expr)})`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

      case 'OptionalAccess':
        return `${this.expr(node.object)}?->${node.property}`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array':
        return `[${node.elements.map(e => this.expr(e)).join(', ')}]`;

      case 'Object': {
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `...${this.expr(p.value)}`;
          if (p.type === 'shorthand') return `${JSON.stringify(p.key)} => $${p.key}`;
          const key = typeof p.key === 'string' ? JSON.stringify(p.key) :
                      (p.key.type === 'String' ? this.generateString(p.key.value) :
                       (p.key.type === 'Computed' ? this.expr(p.key.expr) : JSON.stringify(p.key)));
          return `${key} => ${this.expr(p.value)}`;
        }).join(', ');
        return `[${props}]`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => '$' + p.name).join(', ');
        const body = this.expr(node.body);
        return `fn(${params}) => ${body}`;
      }

      case 'Lambda': {
        const params = node.params.map(p => '$' + p.name).join(', ');
        const bodyLines = [];
        const savedOutput = this.output;
        const savedIndent = this.indent;
        this.output = bodyLines;
        this.indent = 0;
        for (const stmt of node.body) this.visitStatement(stmt);
        this.output = savedOutput;
        this.indent = savedIndent;
        return `function(${params}) { ${bodyLines.join(' ')} }`;
      }

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `null /* expr:${node.type} */`;
    }
  }

  // Generate expression without $ prefix for class names (new Foo, not new $Foo)
  exprNoPrefix(node) {
    if (!node) return 'null';
    if (node.type === 'Call') {
      const callee = node.callee.type === 'Identifier' ? node.callee.name : this.exprNoPrefix(node.callee);
      const args = node.args.map(a => this.expr(a)).join(', ');
      return `${callee}(${args})`;
    }
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberAccess') {
      return `${this.exprNoPrefix(node.object)}->${node.property}`;
    }
    return this.expr(node);
  }

  mapBinaryOp(op) {
    const map = {
      '===': '===', '!==': '!==',
      '==': '==', '!=': '!=',
      '&&': '&&', '||': '||',
      '??': '??',
      '>': '>', '<': '<', '>=': '>=', '<=': '<=',
      '+': '+', '-': '-', '*': '*', '/': '/', '%': '%',
      '**': '**',
      'and': '&&', 'or': '||',
      '.': '.',
    };
    return map[op] || op;
  }

  mapMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    // Map common JS patterns to PHP
    if (prop === 'length') return `count(${obj})`;
    if (prop === 'toString') return `(string)${obj}`;

    // Request mappings
    if ((obj === '$request' || obj === '$req') && prop === 'body') return '$_POST';
    if ((obj === '$request' || obj === '$req') && prop === 'query') return '$_GET';
    if ((obj === '$request' || obj === '$req') && prop === 'params') return '$_GET';
    if ((obj === '$request' || obj === '$req') && prop === 'headers') return 'getallheaders()';
    if ((obj === '$request' || obj === '$req') && prop === 'cookies') return '$_COOKIE';
    if ((obj === '$request' || obj === '$req') && prop === 'method') return '$_SERVER["REQUEST_METHOD"]';
    if ((obj === '$request' || obj === '$req') && prop === 'url') return '$_SERVER["REQUEST_URI"]';

    // JSON
    if (obj === '$JSON' && prop === 'parse') return 'json_decode';
    if (obj === '$JSON' && prop === 'stringify') return 'json_encode';

    // Math
    if (obj === '$Math' && prop === 'floor') return 'floor';
    if (obj === '$Math' && prop === 'ceil') return 'ceil';
    if (obj === '$Math' && prop === 'round') return 'round';
    if (obj === '$Math' && prop === 'abs') return 'abs';
    if (obj === '$Math' && prop === 'min') return 'min';
    if (obj === '$Math' && prop === 'max') return 'max';
    if (obj === '$Math' && prop === 'random') return '(mt_rand() / mt_getrandmax())';
    if (obj === '$Math' && prop === 'PI') return 'M_PI';

    // Console
    if (obj === '$console' && prop === 'log') return 'print_r';
    if (obj === '$console' && prop === 'error') return 'error_log';

    return `${obj}->${prop}`;
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
      if (name === 'parseInt') return `(int)(${args})`;
      if (name === 'parseFloat') return `(float)(${args})`;
      if (name === 'String') return `(string)(${args})`;
      if (name === 'Number') return `(float)(${args})`;
      if (name === 'Boolean') return `(bool)(${args})`;
      if (name === 'isNaN') return `is_nan(${args})`;
      if (name === 'setTimeout') return `/* setTimeout not available in PHP */`;
      if (name === 'setInterval') return `/* setInterval not available in PHP */`;
      // Don't add $ prefix for function calls
      return `${name}(${args})`;
    }

    // Map method calls
    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // Array methods
      if (prop === 'push') return `${obj}[] = ${args}`;
      if (prop === 'pop') return `array_pop(${obj})`;
      if (prop === 'shift') return `array_shift(${obj})`;
      if (prop === 'unshift') return `array_unshift(${obj}, ${args})`;
      if (prop === 'indexOf') return `array_search(${args}, ${obj})`;
      if (prop === 'includes') return `in_array(${args}, ${obj})`;
      if (prop === 'join') return `implode(${args}, ${obj})`;
      if (prop === 'slice') return `array_slice(${obj}, ${args})`;
      if (prop === 'forEach') { return `array_map(${args}, ${obj})`; }
      if (prop === 'map') return `array_map(${args}, ${obj})`;
      if (prop === 'filter') return `array_filter(${obj}, ${args})`;
      if (prop === 'find') return `current(array_filter(${obj}, ${args}))`;
      if (prop === 'some') return `count(array_filter(${obj}, ${args})) > 0`;
      if (prop === 'every') return `count(array_filter(${obj}, ${args})) === count(${obj})`;
      if (prop === 'reduce') return `array_reduce(${obj}, ${args})`;
      if (prop === 'reverse') return `array_reverse(${obj})`;
      if (prop === 'sort') { return `(function(&$a) { sort($a); return $a; })(${obj})`; }
      if (prop === 'concat') return `array_merge(${obj}, ${args})`;
      if (prop === 'flat') return `array_merge(...${obj})`;

      // String methods
      if (prop === 'split') return `explode(${args}, ${obj})`;
      if (prop === 'trim') return `trim(${obj})`;
      if (prop === 'trimStart') return `ltrim(${obj})`;
      if (prop === 'trimEnd') return `rtrim(${obj})`;
      if (prop === 'toUpperCase') return `strtoupper(${obj})`;
      if (prop === 'toLowerCase') return `strtolower(${obj})`;
      if (prop === 'startsWith') return `str_starts_with(${obj}, ${args})`;
      if (prop === 'endsWith') return `str_ends_with(${obj}, ${args})`;
      if (prop === 'replace') return `str_replace(${args}, ${obj})`;
      if (prop === 'replaceAll') return `str_replace(${args}, ${obj})`;
      if (prop === 'charAt') return `${obj}[${args}]`;
      if (prop === 'substring') return `substr(${obj}, ${args})`;
      if (prop === 'repeat') return `str_repeat(${obj}, ${args})`;
      if (prop === 'padStart') return `str_pad(${obj}, ${args}, ' ', STR_PAD_LEFT)`;
      if (prop === 'padEnd') return `str_pad(${obj}, ${args})`;

      // Object methods
      if (obj === '$Object' && prop === 'keys') return `array_keys(${args})`;
      if (obj === '$Object' && prop === 'values') return `array_values(${args})`;
      if (obj === '$Object' && prop === 'entries') return `array_map(null, array_keys(${args}), array_values(${args}))`;
      if (obj === '$Object' && prop === 'assign') return `array_merge(${args})`;

      // Array static
      if (obj === '$Array' && prop === 'isArray') return `is_array(${args})`;
      if (obj === '$Array' && prop === 'from') return `(array)(${args})`;

      // Date
      if (obj === '$Date' && prop === 'now') return `(int)(microtime(true) * 1000)`;

      // Console
      if (obj === '$console' && prop === 'log') return `print_r(${args})`;
      if (obj === '$console' && prop === 'error') return `error_log(${args})`;
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

    // Use double-quoted string with {$var} interpolation
    let result = '"';
    for (const part of strData.parts) {
      if (part.type === 'text') {
        result += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
      } else {
        const exprCode = part.value.replace(/\bthis\b/g, 'this');
        // Wrap in braces for interpolation
        result += '{$' + exprCode + '}';
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

  phpStringValue(strData) {
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

    const ARRAY_METHODS = new Set(['filter', 'map', 'reduce', 'sort', 'reverse', 'join']);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier') {
        const name = step.callee.name;
        const args = step.args.map(a => this.expr(a)).join(', ');

        if (name === 'filter') {
          result = `array_filter(${result}, ${args})`;
        } else if (name === 'map') {
          result = `array_map(${args}, ${result})`;
        } else if (name === 'reduce') {
          result = `array_reduce(${result}, ${args})`;
        } else if (name === 'sort') {
          result = `(function($a) { sort($a); return $a; })(${result})`;
        } else if (name === 'reverse') {
          result = `array_reverse(${result})`;
        } else if (name === 'join') {
          result = `implode(${args}, ${result})`;
        } else {
          result = `${name}(${result}${args ? ', ' + args : ''})`;
        }
      } else if (step.type === 'Identifier') {
        result = `${step.name}(${result})`;
      } else if (step.type === 'Call') {
        const callee = this.exprNoPrefix(step.callee);
        const args = step.args.map(a => this.expr(a)).join(', ');
        result = `${callee}(${result}${args ? ', ' + args : ''})`;
      } else {
        result = `(${this.expr(step)})(${result})`;
      }
    }
    return result;
  }

  mapType(type) {
    if (!type) return 'mixed';
    const map = {
      'str': 'string', 'string': 'string',
      'int': 'int', 'integer': 'int',
      'num': 'float', 'number': 'float',
      'bool': 'bool', 'boolean': 'bool',
      'list': 'array', 'array': 'array',
      'map': 'array',
      'any': 'mixed', 'void': 'void',
      'json': 'mixed',
    };
    return map[type] || type;
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
    this.emit(`class ${node.name} {`);
    this.indent++;
    node.values.forEach((v, i) => {
      this.emit(`const ${v} = ${i};`);
    });
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
  }

  visitSwap(node) {
    const a = this.expr(node.a);
    const b = this.expr(node.b);
    this.emit(`[$${a.replace('$','')}, $${b.replace('$','')}] = [$${b.replace('$','')}, $${a.replace('$','')}];`);
  }

  visitDestructure(node) {
    const val = this.expr(node.value);
    if (node.pattern === 'array') {
      const names = node.names.map(n => {
        if (n.rest) return `...$${n.name}`;
        return `$${n.alias || n.name}`;
      });
      this.emit(`[${names.join(', ')}] = ${val};`);
    } else {
      const parts = node.names.filter(n => !n.rest).map(n => {
        const varName = n.alias || n.name;
        return `'${n.name}' => $${varName}`;
      });
      this.emit(`[${parts.join(', ')}] = ${val};`);
    }
  }

  visitClassDecl(node) {
    const ext = node.parent ? ` extends ${node.parent}` : '';
    this.emit(`class ${node.name}${ext} {`);
    this.indent++;
    for (const field of node.fields) {
      if (field.defaultValue) {
        this.emit(`public $${field.name} = ${this.expr(field.defaultValue)};`);
      }
    }
    if (node.init) {
      const params = node.init.params.map(p => `$${p.name}`).join(', ');
      this.emit(`public function __construct(${params}) {`);
      this.indent++;
      if (node.parent) this.emit('parent::__construct();');
      for (const stmt of node.init.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    }
    for (const method of node.methods) {
      const params = method.params.map(p => `$${p.name}`).join(', ');
      this.emit(`public function ${method.name}(${params}) {`);
      this.indent++;
      if (method.body.length === 0) {
        this.emit('// empty');
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
      case 'len': return `count(${args[0]})`;
      case 'sort': return `(function($a) { sort($a); return $a; })(${args[0]})`;
      case 'reverse': return `array_reverse(${args[0]})`;
      case 'unique': return `array_values(array_unique(${args[0]}))`;
      case 'upper': return `strtoupper(${args[0]})`;
      case 'lower': return `strtolower(${args[0]})`;
      case 'trim': return `trim(${args[0]})`;
      case 'split': return `explode(${args[1] || '","'}, ${args[0]})`;
      case 'join': return `implode(${args[1] || '","'}, ${args[0]})`;
      case 'contains': return `in_array(${args[1]}, ${args[0]})`;
      case 'replace': return `str_replace(${args[1]}, ${args[2]}, ${args[0]})`;
      case 'keys': return `array_keys(${args[0]})`;
      case 'values': return `array_values(${args[0]})`;
      case 'entries': return `array_map(null, array_keys(${args[0]}), array_values(${args[0]}))`;
      case 'range': return args.length >= 2 ? `range(${args[0]}, ${args[1]} - 1)` : `range(0, ${args[0]} - 1)`;
      case 'abs': return `abs(${args[0]})`;
      case 'round': return `round(${args[0]})`;
      case 'ceil': return `ceil(${args[0]})`;
      case 'floor': return `floor(${args[0]})`;
      case 'sqrt': return `sqrt(${args[0]})`;
      case 'pow': return `pow(${args[0]}, ${args[1]})`;
      case 'sum': return `array_sum(${args[0]})`;
      case 'flat': return `array_merge(...${args[0]})`;
      case 'str': return `strval(${args[0]})`;
      case 'int': return `intval(${args[0]})`;
      case 'float': return `floatval(${args[0]})`;
      case 'json_parse': return `json_decode(${args[0]}, true)`;
      case 'json_str': return `json_encode(${args[0]})`;
      case 'now': return `(int)(microtime(true) * 1000)`;
      case 'time': return `date('c')`;
      case 'exit': return `exit(${args[0] || '0'})`;
      case 'sleep': return `usleep(${args[0]} * 1000)`;
      case 'random': return args.length >= 2 ? `random_int(${args[0]}, ${args[1]})` : `(mt_rand() / mt_getrandmax())`;
      case 'read': return `file_get_contents(${args[0]})`;
      case 'write': return `file_put_contents(${args[0]}, ${args[1]})`;
      case 'ask': return `readline(${args[0] || '""'})`;
      case 'chunk': return `array_chunk(${args[0]}, ${args[1]})`;
      case 'zip': return `array_map(null, ${args[0]}, ${args[1]})`;
      case 'map': return `array_map(${args[1]}, ${args[0]})`;
      case 'filter': return `array_values(array_filter(${args[0]}, ${args[1]}))`;
      case 'reduce': return `array_reduce(${args[0]}, ${args[1]}, ${args[2] || 'null'})`;
      case 'find': return `current(array_filter(${args[0]}, ${args[1]}))`;
      case 'every': return `count(array_filter(${args[0]}, ${args[1]})) === count(${args[0]})`;
      case 'some': return `count(array_filter(${args[0]}, ${args[1]})) > 0`;
      case 'foreach': return `array_walk(${args[0]}, ${args[1]})`;
      default: return null;
    }
  }
}
