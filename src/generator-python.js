export class PythonGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.usesFlask = false;
    this.usesCors = false;
    this.usesJwt = false;
    this.usesSqlite = false;
    this.usesOs = false;
    this.hasTests = false;
    this.hasAsserts = false;
    this.imports = new Set();
    this.fromImports = new Map(); // module -> Set of names
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.authSecret = null;
    this.dbVar = null;
  }

  generate(ast) {
    this.visitProgram(ast);

    const preamble = [];

    // Collect standard library imports
    if (this.usesOs) {
      this.addFromImport('os', 'environ');
    }

    // Emit top-level imports
    for (const mod of this.imports) {
      preamble.push(`import ${mod}`);
    }

    // Emit from-imports
    for (const [mod, names] of this.fromImports) {
      const sorted = [...names].sort();
      preamble.push(`from ${mod} import ${sorted.join(', ')}`);
    }

    if (this.usesFlask) {
      preamble.push('from flask import Flask, request, jsonify, redirect, send_file');
    }

    if (this.usesCors) {
      preamble.push('from flask_cors import CORS');
    }

    if (this.usesJwt) {
      preamble.push('import jwt');
      preamble.push('from functools import wraps');
    }

    if (this.usesSqlite) {
      preamble.push('import sqlite3');
    }

    if (this.hasTests) {
      preamble.push('import unittest');
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

  addImport(mod) {
    this.imports.add(mod);
  }

  addFromImport(mod, name) {
    if (!this.fromImports.has(mod)) {
      this.fromImports.set(mod, new Set());
    }
    this.fromImports.get(mod).add(name);
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
      case 'AuthDecl': return this.visitAuth('app', node);
      case 'CorsDecl': return this.visitCors('app', node);
      case 'EnvDecl': return this.visitEnv(node);
      case 'TestDecl': return this.visitTest(node);
      case 'AssertStmt': return this.visitAssert(node);
      case 'ErrorHandler': return this.visitErrorHandler('app', node);
      case 'CrudDecl': return this.visitCrud('app', node);
      case 'StaticDecl': return this.visitStatic('app', node);
      case 'LimitDecl': return this.visitLimit('app', node);
      case 'WsDecl': return this.visitWs(node);
      case 'SessionDecl': return this.visitSession('app', node);
      case 'CacheDecl': return this.visitCache('app', node);
      case 'PromptDecl': return this.visitPrompt(node);
      default:
        this.emit(`# unknown: ${node.type}`);
    }
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const alias = node.alias || node.name;

    // Rewrite common JS packages to Python equivalents
    const pyModule = this.mapModuleName(raw);

    if (alias !== pyModule) {
      this.emit(`import ${pyModule} as ${alias}`);
    } else {
      this.emit(`import ${pyModule}`);
    }
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const pyModule = this.mapModuleName(raw);
    const names = node.names.map(n => {
      if (n.alias) return `${n.name} as ${n.alias}`;
      return n.name;
    }).join(', ');
    this.emit(`from ${pyModule} import ${names}`);
  }

  mapModuleName(name) {
    // Strip quotes if present
    const clean = name.replace(/^['"]|['"]$/g, '');
    const map = {
      'express': 'flask',
      'axios': 'requests',
      'lodash': 'itertools',
      'moment': 'datetime',
      'fs': 'pathlib',
      'path': 'os.path',
      'crypto': 'hashlib',
      'uuid': 'uuid',
    };
    return map[clean] || clean;
  }

  // ===== Functions =====

  visitFunction(node) {
    const async = node.isAsync ? 'async ' : '';
    const params = node.params.map(p => {
      let s = '';
      if (p.spread) s += '*';
      s += p.name;
      if (p.defaultValue) s += `=${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    this.emit(`${async}def ${node.name}(${params}):`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of node.body) {
        this.visitStatement(stmt);
      }
    }
    this.indent--;
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
    this.emit(`return jsonify(${this.expr(node.body)}), ${this.expr(node.statusCode)}`);
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`return redirect(${val})`);
        break;
      case 'html':
        this.emit(`return ${val}, 200, {'Content-Type': 'text/html'}`);
        break;
      case 'text':
        this.emit(`return ${val}, 200, {'Content-Type': 'text/plain'}`);
        break;
      case 'file':
        this.emit(`return send_file(${val})`);
        break;
      default:
        this.emit(`return ${val}`);
    }
  }

  // ===== Variables =====

  visitTypedVar(node) {
    this.emit(`${node.name} = ${this.expr(node.value)}`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.expr(e)).join(', ');
      this.emit(`${names} = ${value}`);
    } else if (node.target.type === 'Object') {
      // Python doesn't have object destructuring directly;
      // emit individual assignments from dict
      const tempVar = '__d';
      this.emit(`${tempVar} = ${value}`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`${varName} = ${tempVar}[${JSON.stringify(key)}]`);
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
    this.emit(`if ${this.expr(node.condition)}:`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;

    for (const elif of node.elifs) {
      this.emit(`elif ${this.expr(elif.condition)}:`);
      this.indent++;
      if (elif.body.length === 0) {
        this.emit('pass');
      } else {
        for (const stmt of elif.body) this.visitStatement(stmt);
      }
      this.indent--;
    }

    if (node.elseBody) {
      this.emit('else:');
      this.indent++;
      if (node.elseBody.length === 0) {
        this.emit('pass');
      } else {
        for (const stmt of node.elseBody) this.visitStatement(stmt);
      }
      this.indent--;
    }
  }

  visitEach(node) {
    const collection = this.expr(node.collection);
    if (node.key) {
      this.emit(`for ${node.key}, ${node.value} in ${collection}.items():`);
    } else {
      this.emit(`for ${node.value} in ${collection}:`);
    }
    this.indent++;
    if (node.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
  }

  visitFor(node) {
    const varName = node.varName;
    const start = this.expr(node.start);
    const end = this.expr(node.end);
    this.emit(`for ${varName} in range(${start}, ${end}):`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
  }

  visitWhile(node) {
    this.emit(`while ${this.expr(node.condition)}:`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
  }

  visitMatch(node) {
    this.emit(`match ${this.expr(node.value)}:`);
    this.indent++;
    for (const c of node.cases) {
      if (c.pattern.type === 'DefaultPattern') {
        this.emit('case _:');
      } else {
        this.emit(`case ${this.expr(c.pattern)}:`);
      }
      this.indent++;
      if (c.body.length === 0) {
        this.emit('pass');
      } else {
        for (const stmt of c.body) this.visitStatement(stmt);
      }
      this.indent--;
    }
    this.indent--;
  }

  visitTry(node) {
    this.emit('try:');
    this.indent++;
    if (node.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;

    if (node.catchBody) {
      const catchParam = node.catchVar || 'e';
      this.emit(`except Exception as ${catchParam}:`);
      this.indent++;
      if (node.catchBody.length === 0) {
        this.emit('pass');
      } else {
        for (const stmt of node.catchBody) this.visitStatement(stmt);
      }
      this.indent--;
    }

    if (node.ensureBody) {
      this.emit('finally:');
      this.indent++;
      if (node.ensureBody.length === 0) {
        this.emit('pass');
      } else {
        for (const stmt of node.ensureBody) this.visitStatement(stmt);
      }
      this.indent--;
    }
  }

  // ===== Server (Flask) =====

  visitServer(node) {
    this.usesFlask = true;

    this.emitRaw('');
    this.emit(`${node.name} = Flask(__name__)`);
    this.emitRaw('');

    for (const mid of node.middleware) {
      this.emitMiddleware(node.name, mid);
    }

    const errorHandlers = [];

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(node.name, child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(node.name, child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors(node.name, child);
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(node.name, child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(node.name, child);
      } else if (child.type === 'StaticDecl') {
        this.visitStatic(node.name, child);
      } else if (child.type === 'LimitDecl') {
        this.visitLimit(node.name, child);
      } else if (child.type === 'WsDecl') {
        this.visitWs(child);
      } else if (child.type === 'SessionDecl') {
        this.visitSession(node.name, child);
      } else if (child.type === 'CacheDecl') {
        this.visitCache(node.name, child);
      } else {
        this.visitStatement(child);
      }
    }

    for (const eh of errorHandlers) {
      this.visitErrorHandler(node.name, eh);
    }

    const port = node.port ? this.expr(node.port) : '3000';
    this.emitRaw('');
    this.emit(`if __name__ == '__main__':`);
    this.indent++;
    this.emit(`${node.name}.run(port=${port}, debug=True)`);
    this.indent--;
  }

  visitRoute(appName, route) {
    const method = route.method === 'del' ? 'DELETE' : route.method.toUpperCase();
    const path = this.flaskPath(route.path);

    this.emit(`@${appName}.route(${path}, methods=['${method}'])`);

    // Generate a function name from the route
    const funcName = this.routeFuncName(route.method, route.path);
    const async = this.bodyUsesAwait(route.body) ? 'async ' : '';

    this.emit(`${async}def ${funcName}():`);
    this.indent++;

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`return jsonify(${this.expr(stmt.value)})`);
      } else {
        this.visitStatement(stmt);
      }
    }

    if (route.body.length === 0) {
      this.emit('pass');
    }

    this.indent--;
    this.emitRaw('');
  }

  flaskPath(strData) {
    // Convert Express-style :param to Flask <param>
    let raw = this.rawString(strData);
    const converted = raw.replace(/:(\w+)/g, '<$1>');
    return JSON.stringify(converted);
  }

  routeFuncName(method, pathData) {
    const raw = this.rawString(pathData);
    const clean = raw.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return `${method}_${clean || 'root'}`;
  }

  emitMiddleware(appName, mid) {
    const funcName = `__middleware_${Date.now()}`;
    this.emit(`@${appName}.before_request`);
    this.emit(`def ${funcName}():`);
    this.indent++;
    if (mid.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of mid.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emitRaw('');
  }

  visitAuth(appName, node) {
    this.usesJwt = true;
    const secret = this.expr(node.secret);
    this.authSecret = secret;

    this.emitRaw('');
    this.emit(`__auth_secret = ${secret}`);
    this.emitRaw('');
    this.emit('def require_auth(f):');
    this.indent++;
    this.emit('@wraps(f)');
    this.emit('def decorated(*args, **kwargs):');
    this.indent++;
    this.emit("token = request.headers.get('Authorization', '').replace('Bearer ', '')");
    this.emit('if not token:');
    this.indent++;
    this.emit("return jsonify({'error': 'No token provided'}), 401");
    this.indent--;
    this.emit('try:');
    this.indent++;
    this.emit("request.user = jwt.decode(token, __auth_secret, algorithms=['HS256'])");
    this.indent--;
    this.emit('except jwt.InvalidTokenError:');
    this.indent++;
    this.emit("return jsonify({'error': 'Invalid token'}), 401");
    this.indent--;
    this.emit('return f(*args, **kwargs)');
    this.indent--;
    this.emit('return decorated');
    this.indent--;
    this.emitRaw('');
  }

  visitCors(appName, node) {
    this.usesCors = true;
    const origins = this.expr(node.origins);
    if (node.origins.type === 'String') {
      this.emit(`CORS(${appName}, origins=[${origins}])`);
    } else {
      this.emit(`CORS(${appName}, origins=${origins})`);
    }
    this.emitRaw('');
  }

  visitGroup(appName, node) {
    const prefix = this.rawString(node.prefix);
    this.addFromImport('flask', 'Blueprint');
    this.groupCounter = (this.groupCounter || 0) + 1;
    const bpName = `__bp${this.groupCounter}`;
    this.emit(`${bpName} = Blueprint('group_${this.groupCounter}', __name__, url_prefix=${JSON.stringify(prefix)})`);

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(bpName, child);
      } else {
        this.visitStatement(child);
      }
    }

    this.emit(`${appName}.register_blueprint(${bpName})`);
    this.emitRaw('');
  }

  visitErrorHandler(appName, node) {
    this.emit(`@${appName}.errorhandler(Exception)`);
    this.emit('def handle_error(error):');
    this.indent++;
    if (node.body.length === 0) {
      this.emit("return jsonify({'error': str(error)}), 500");
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emitRaw('');
  }

  // ===== Model (class) =====

  visitModel(node) {
    this.models.set(node.name, node);

    const ext = node.parent ? `(${node.parent})` : '';
    this.emit(`class ${node.name}${ext}:`);
    this.indent++;

    if (node.fields.length > 0 || node.parent) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const initParams = allFields.map(f => {
        if (f.defaultValue) return `${f.name}=${this.expr(f.defaultValue)}`;
        return f.name;
      }).join(', ');

      this.emit(`def __init__(self, ${initParams}):`);
      this.indent++;
      if (node.parent) {
        const superArgs = parentFields.map(f => `${f.name}=${f.name}`).join(', ');
        this.emit(`super().__init__(${superArgs})`);
      }
      for (const f of node.fields) {
        this.emit(`self.${f.name} = ${f.name}`);
      }
      if (node.fields.length === 0 && !node.parent) {
        this.emit('pass');
      }
      this.indent--;
      this.emitRaw('');
    }

    for (const method of node.methods) {
      const async = method.isAsync ? 'async ' : '';
      const params = method.params.map(p => {
        let s = '';
        if (p.spread) s += '*';
        s += p.name;
        if (p.defaultValue) s += `=${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      const selfParams = params ? `self, ${params}` : 'self';
      this.emit(`${async}def ${method.name}(${selfParams}):`);
      this.indent++;
      if (method.body.length === 0) {
        this.emit('pass');
      } else {
        for (const stmt of method.body) {
          this.visitStatement(stmt);
        }
      }
      this.indent--;
      this.emitRaw('');
    }

    if (node.fields.length === 0 && node.methods.length === 0 && !node.parent) {
      this.emit('pass');
      this.emitRaw('');
    }

    this.indent--;
    this.emitRaw('');
  }

  // ===== Events =====

  visitOn(node) {
    const event = this.expr(node.event);
    // Python doesn't have native event emitters; emit a comment-based pattern
    this.emit(`# on ${event}`);
    this.emit(`def __on_${event.replace(/\./g, '_')}():`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emitRaw('');
  }

  // ===== Logging and errors =====

  visitLog(node) {
    const args = node.args.map(a => this.expr(a)).join(', ');
    if (node.level === 'warn') {
      this.addImport('logging');
      this.emit(`logging.warning(${args})`);
    } else if (node.level === 'error') {
      this.addImport('logging');
      this.emit(`logging.error(${args})`);
    } else {
      this.emit(`print(${args})`);
    }
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`raise Exception(${value})`);
    } else {
      this.emit(`raise ${value}`);
    }
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.usesSqlite = true;
    this.dbVar = 'db';
    this.emit(`db = sqlite3.connect(${this.expr(node.connectionString)})`);
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.emit(`# db dir: ${raw}`);
  }

  visitDbSql(node) {
    this.usesSqlite = true;
    this.dbVar = '__db';
    const conn = node.connection ? this.pyStringValue(node.connection) : '"data.db"';
    this.emit(`__db = sqlite3.connect(${conn})`);
    this.emit(`__db.execute("PRAGMA journal_mode=WAL")`);
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    this.addImport('asyncio');
    const exprs = node.expressions.map(e => this.expr(e)).join(', ');
    this.emit(`await asyncio.gather(${exprs})`);
  }

  // ===== Schema (dataclass / Pydantic style) =====

  visitSchema(node) {
    this.addFromImport('dataclasses', 'dataclass');
    this.addFromImport('dataclasses', 'field');

    this.emitRaw('');
    this.emit('@dataclass');
    this.emit(`class ${node.name}:`);
    this.indent++;

    for (const f of node.fields) {
      const pyType = this.mapSchemaType(f.type);
      const defaultVal = this.schemaDefault(f);

      if (defaultVal !== null) {
        this.emit(`${f.name}: ${pyType} = ${defaultVal}`);
      } else {
        this.emit(`${f.name}: ${pyType}`);
      }
    }

    if (node.fields.length === 0) {
      this.emit('pass');
    }

    this.indent--;
    this.emitRaw('');

    this.schemas.set(node.name, node);
  }

  mapSchemaType(type) {
    const map = {
      'str': 'str',
      'string': 'str',
      'int': 'int',
      'integer': 'int',
      'num': 'float',
      'number': 'float',
      'bool': 'bool',
      'boolean': 'bool',
      'auto': 'int',
      'timestamp': 'str',
      'enum': 'str',
    };
    return map[type] || 'object';
  }

  schemaDefault(fieldNode) {
    for (const mod of fieldNode.modifiers) {
      if (mod.name === 'default') {
        return this.expr(mod.args[0]);
      }
    }
    // Optional fields get None as default
    for (const mod of fieldNode.modifiers) {
      if (mod.name === 'optional') return 'None';
    }
    if (fieldNode.type === 'auto') return 'None';
    if (fieldNode.type === 'timestamp') return 'None';
    return null;
  }

  // ===== Env =====

  visitEnv(node) {
    this.usesOs = true;
    this.emitRaw('');
    for (const v of node.vars) {
      let defaultVal = null;
      for (const mod of v.modifiers) {
        if (mod.name === 'default') {
          defaultVal = this.expr(mod.args[0]);
        }
      }

      if (defaultVal !== null) {
        this.emit(`${v.name} = os.environ.get(${JSON.stringify(v.name)}, ${defaultVal})`);
      } else {
        this.emit(`${v.name} = os.environ.get(${JSON.stringify(v.name)})`);
      }

      // Type coercion
      if (v.type === 'int') {
        this.emit(`${v.name} = int(${v.name}) if ${v.name} is not None else None`);
      } else if (v.type === 'num') {
        this.emit(`${v.name} = float(${v.name}) if ${v.name} is not None else None`);
      } else if (v.type === 'bool') {
        this.emit(`${v.name} = ${v.name}.lower() in ('true', '1', 'yes') if ${v.name} is not None else None`);
      }
    }
    this.emitRaw('');
  }

  // ===== Tests =====

  visitTest(node) {
    this.hasTests = true;
    const name = this.rawString(node.name);
    const funcName = `test_${name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}`;

    this.emit(`def ${funcName}():`);
    this.indent++;
    if (node.body.length === 0) {
      this.emit('pass');
    } else {
      for (const stmt of node.body) this.visitStatement(stmt);
    }
    this.indent--;
    this.emitRaw('');
  }

  visitAssert(node) {
    this.hasAsserts = true;
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`assert ${this.expr(exprNode.left)} == ${this.expr(exprNode.right)}`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`assert ${this.expr(exprNode.left)} != ${this.expr(exprNode.right)}`);
    } else {
      this.emit(`assert ${this.expr(exprNode)}`);
    }
  }

  // ===== Expression generation =====

  expr(node) {
    if (!node) return 'None';

    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return this.generateString(node.value);
      case 'Bool': return node.value ? 'True' : 'False';
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
        if (op === 'not ') return `not ${this.expr(node.expr)}`;
        return `${op}${this.expr(node.expr)}`;
      }

      case 'Await':
        return `await ${this.expr(node.expr)}`;

      case 'AwaitAllExpr':
        this.addImport('asyncio');
        return `await asyncio.gather(${this.expr(node.expr)})`;

      case 'Spread':
        return `*${this.expr(node.expr)}`;

      case 'New':
        return this.expr(node.expr);

      case 'TypeOf':
        return `type(${this.expr(node.expr)}).__name__`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

      case 'OptionalAccess':
        // Python doesn't have ?. — use getattr with default
        return `getattr(${this.expr(node.object)}, ${JSON.stringify(node.property)}, None)`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array':
        return `[${node.elements.map(e => this.expr(e)).join(', ')}]`;

      case 'Object': {
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `**${this.expr(p.value)}`;
          if (p.type === 'shorthand') return `${JSON.stringify(p.key)}: ${p.key}`;
          const key = typeof p.key === 'string' ? JSON.stringify(p.key) :
                      (p.key.type === 'String' ? this.generateString(p.key.value) :
                       (p.key.type === 'Computed' ? this.expr(p.key.expr) : JSON.stringify(this.expr(p.key))));
          return `${key}: ${this.expr(p.value)}`;
        }).join(', ');
        return `{${props}}`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        return `lambda ${params}: ${body}`;
      }

      case 'Lambda': {
        // Multi-line lambda must become a nested def in Python;
        // for expression context, emit a simple lambda if single-expression
        if (node.body.length === 1 && node.body[0].type === 'Return' && node.body[0].value) {
          const params = node.params.map(p => p.name).join(', ');
          return `lambda ${params}: ${this.expr(node.body[0].value)}`;
        }
        // For multi-statement lambdas, we cannot inline; use a helper comment
        const params = node.params.map(p => p.name).join(', ');
        return `lambda ${params}: None  # multi-statement lambda - refactor to def`;
      }

      case 'Ternary':
        return `(${this.expr(node.consequent)} if ${this.expr(node.condition)} else ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `None  # expr:${node.type}`;
    }
  }

  mapIdentifier(name) {
    const map = {
      'null': 'None',
      'undefined': 'None',
      'true': 'True',
      'false': 'False',
      'this': 'self',
      'console': 'print',
    };
    return map[name] || name;
  }

  mapBinaryOp(op) {
    const map = {
      '===': '==',
      '!==': '!=',
      '==': '==',
      '!=': '!=',
      '&&': 'and',
      '||': 'or',
      '!': 'not',
      '>': '>',
      '<': '<',
      '>=': '>=',
      '<=': '<=',
      '+': '+',
      '-': '-',
      '*': '*',
      '/': '/',
      '%': '%',
      '**': '**',
      'and': 'and',
      'or': 'or',
      'instanceof': 'isinstance',  // handled specially in Binary
      'in': 'in',
    };
    return map[op] || op;
  }

  mapUnaryOp(op) {
    if (op === '!') return 'not ';
    if (op === 'not') return 'not ';
    return op;
  }

  mapMemberAccess(node) {
    const obj = this.expr(node.object);
    const prop = node.property;

    // Map common JS properties/methods to Python
    if (prop === 'length') return `len(${obj})`;
    if (prop === 'toString') return `str(${obj})`;

    // request/req.body -> request.json in Flask
    if ((obj === 'request' || obj === 'req') && prop === 'body') return 'request.get_json()';
    if ((obj === 'request' || obj === 'req') && prop === 'query') return 'request.args';
    if ((obj === 'request' || obj === 'req') && prop === 'params') return 'request.view_args';
    if ((obj === 'request' || obj === 'req') && prop === 'headers') return 'request.headers';
    if ((obj === 'request' || obj === 'req') && prop === 'cookies') return 'request.cookies';
    if ((obj === 'request' || obj === 'req') && prop === 'method') return 'request.method';
    if ((obj === 'request' || obj === 'req') && prop === 'url') return 'request.url';

    // JSON methods
    if (obj === 'JSON' && prop === 'parse') return 'json.loads';
    if (obj === 'JSON' && prop === 'stringify') return 'json.dumps';

    // Math methods
    if (obj === 'Math' && prop === 'floor') return 'math.floor';
    if (obj === 'Math' && prop === 'ceil') return 'math.ceil';
    if (obj === 'Math' && prop === 'round') return 'round';
    if (obj === 'Math' && prop === 'abs') return 'abs';
    if (obj === 'Math' && prop === 'min') return 'min';
    if (obj === 'Math' && prop === 'max') return 'max';
    if (obj === 'Math' && prop === 'random') { this.addImport('random'); return 'random.random'; }
    if (obj === 'Math' && prop === 'PI') { this.addImport('math'); return 'math.pi'; }

    // console methods
    if (obj === 'console' && prop === 'log') return 'print';
    if (obj === 'console' && prop === 'error') { this.addImport('logging'); return 'logging.error'; }
    if (obj === 'console' && prop === 'warn') { this.addImport('logging'); return 'logging.warning'; }

    return `${obj}.${prop}`;
  }

  generateCall(node) {
    const args = node.args.map(a => this.expr(a)).join(', ');

    // Map common JS global functions to Python
    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;

      if (name === 'parseInt') return `int(${args})`;
      if (name === 'parseFloat') return `float(${args})`;
      if (name === 'String') return `str(${args})`;
      if (name === 'Number') return `float(${args})`;
      if (name === 'Boolean') return `bool(${args})`;
      if (name === 'isNaN') { this.addImport('math'); return `math.isnan(${args})`; }
      if (name === 'setTimeout') return `# setTimeout: use threading.Timer\nNone`;
      if (name === 'setInterval') return `# setInterval: use threading\nNone`;

      if (name === 'sign' && this.authSecret) {
        this.usesJwt = true;
        if (node.args.length === 1) {
          return `jwt.encode(${args}, __auth_secret, algorithm='HS256')`;
        }
        return `jwt.encode(${args}, algorithm='HS256')`;
      }
    }

    // Map common method calls
    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // Array/list methods
      if (prop === 'push') return `${obj}.append(${args})`;
      if (prop === 'pop') return `${obj}.pop(${args})`;
      if (prop === 'shift') return `${obj}.pop(0)`;
      if (prop === 'unshift') return `${obj}.insert(0, ${args})`;
      if (prop === 'indexOf') return `${obj}.index(${args})`;
      if (prop === 'includes') return `${args} in ${obj}`;
      if (prop === 'join') return `${args}.join(${obj})`;
      if (prop === 'slice') return `${obj}[${args}]`;
      if (prop === 'forEach') return `[${args}(x) for x in ${obj}]`;
      if (prop === 'map') return `list(map(${args}, ${obj}))`;
      if (prop === 'filter') return `list(filter(${args}, ${obj}))`;
      if (prop === 'find') return `next((x for x in ${obj} if ${args}(x)), None)`;
      if (prop === 'some') return `any(${args}(x) for x in ${obj})`;
      if (prop === 'every') return `all(${args}(x) for x in ${obj})`;
      if (prop === 'reduce') {
        this.addFromImport('functools', 'reduce');
        return `reduce(${args}, ${obj})`;
      }
      if (prop === 'flat') return `[item for sub in ${obj} for item in sub]`;
      if (prop === 'reverse') return `list(reversed(${obj}))`;
      if (prop === 'sort') return `sorted(${obj})`;
      if (prop === 'concat') return `${obj} + ${args}`;
      if (prop === 'splice') return `${obj}[${args}]`;

      // String methods
      if (prop === 'split') return `${obj}.split(${args})`;
      if (prop === 'trim') return `${obj}.strip()`;
      if (prop === 'trimStart') return `${obj}.lstrip()`;
      if (prop === 'trimEnd') return `${obj}.rstrip()`;
      if (prop === 'toUpperCase') return `${obj}.upper()`;
      if (prop === 'toLowerCase') return `${obj}.lower()`;
      if (prop === 'startsWith') return `${obj}.startswith(${args})`;
      if (prop === 'endsWith') return `${obj}.endswith(${args})`;
      if (prop === 'replace') return `${obj}.replace(${args})`;
      if (prop === 'replaceAll') return `${obj}.replace(${args})`;
      if (prop === 'padStart') return `${obj}.rjust(${args})`;
      if (prop === 'padEnd') return `${obj}.ljust(${args})`;
      if (prop === 'charAt') return `${obj}[${args}]`;
      if (prop === 'substring') return `${obj}[${args}]`;
      if (prop === 'repeat') return `${obj} * ${args}`;

      // Object methods
      if (obj === 'Object' && prop === 'keys') return `list(${args}.keys())`;
      if (obj === 'Object' && prop === 'values') return `list(${args}.values())`;
      if (obj === 'Object' && prop === 'entries') return `list(${args}.items())`;
      if (obj === 'Object' && prop === 'assign') return `{**${node.args.map(a => this.expr(a)).join(', **')}}`;

      // Array static
      if (obj === 'Array' && prop === 'isArray') return `isinstance(${args}, list)`;
      if (obj === 'Array' && prop === 'from') return `list(${args})`;

      // Promise
      if (obj === 'Promise' && prop === 'all') {
        this.addImport('asyncio');
        return `asyncio.gather(*${args})`;
      }
      if (obj === 'Promise' && prop === 'resolve') return `${args}`;

      // Date
      if (obj === 'Date' && prop === 'now') {
        this.addImport('time');
        return `int(time.time() * 1000)`;
      }

      // JSON in Flask context
      if (prop === 'json' && obj === 'request') {
        return 'request.get_json()';
      }

      // auth methods
      if (obj === 'auth' && prop === 'sign') {
        this.usesJwt = true;
        if (node.args.length === 1 && this.authSecret) {
          return `jwt.encode(${args}, __auth_secret, algorithm='HS256')`;
        }
        return `jwt.encode(${args}, algorithm='HS256')`;
      }
      if (obj === 'auth' && prop === 'verify') {
        this.usesJwt = true;
        return `jwt.decode(${args}, algorithm='HS256')`;
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
      return JSON.stringify(raw);
    }

    // Use f-string for interpolation
    let result = 'f"';
    for (const part of strData.parts) {
      if (part.type === 'text') {
        result += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/{/g, '{{').replace(/}/g, '}}');
      } else {
        const exprCode = part.value.replace(/\bself\b/g, 'self');
        result += '{' + exprCode + '}';
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

  pyStringValue(strData) {
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

    const LIST_METHODS = new Set(['filter', 'map', 'reduce', 'find', 'some', 'every', 'sort', 'reverse', 'join']);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier') {
        const name = step.callee.name;
        const args = step.args.map(a => this.expr(a)).join(', ');

        if (name === 'filter') {
          result = `list(filter(${args}, ${result}))`;
        } else if (name === 'map') {
          result = `list(map(${args}, ${result}))`;
        } else if (name === 'reduce') {
          this.addFromImport('functools', 'reduce');
          result = `reduce(${args}, ${result})`;
        } else if (name === 'sort') {
          result = `sorted(${result})`;
        } else if (name === 'reverse') {
          result = `list(reversed(${result}))`;
        } else if (name === 'join') {
          result = `${args}.join(${result})`;
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

  // ===== CRUD =====

  visitCrud(appName, node) {
    const path = this.rawString(node.path);
    const schema = node.schemaName;
    const store = `__${schema.toLowerCase()}_store`;
    const idVar = `__${schema.toLowerCase()}_id`;

    this.emitRaw('');
    this.emit(`${store} = []`);
    this.emit(`${idVar} = 1`);
    this.emitRaw('');

    // List all
    this.emit(`@${appName}.route(${JSON.stringify(path)}, methods=['GET'])`);
    this.emit(`def ${schema.toLowerCase()}_list():`);
    this.indent++;
    this.emit(`return jsonify(${store})`);
    this.indent--;
    this.emitRaw('');

    // Get by id
    this.emit(`@${appName}.route(${JSON.stringify(path + '/<id>')}, methods=['GET'])`);
    this.emit(`def ${schema.toLowerCase()}_get(id):`);
    this.indent++;
    this.emit(`item = next((i for i in ${store} if str(i['id']) == str(id)), None)`);
    this.emit(`if not item:`);
    this.indent++;
    this.emit(`return jsonify({'error': 'Not found'}), 404`);
    this.indent--;
    this.emit(`return jsonify(item)`);
    this.indent--;
    this.emitRaw('');

    // Create
    this.emit(`@${appName}.route(${JSON.stringify(path)}, methods=['POST'])`);
    this.emit(`def ${schema.toLowerCase()}_create():`);
    this.indent++;
    this.emit(`global ${idVar}`);
    this.emit(`body = request.get_json()`);
    this.emit(`body['id'] = ${idVar}`);
    this.emit(`${idVar} += 1`);
    this.emit(`${store}.append(body)`);
    this.emit(`return jsonify(body), 201`);
    this.indent--;
    this.emitRaw('');

    // Update
    this.emit(`@${appName}.route(${JSON.stringify(path + '/<id>')}, methods=['PUT'])`);
    this.emit(`def ${schema.toLowerCase()}_update(id):`);
    this.indent++;
    this.emit(`body = request.get_json()`);
    this.emit(`for i, item in enumerate(${store}):`);
    this.indent++;
    this.emit(`if str(item['id']) == str(id):`);
    this.indent++;
    this.emit(`${store}[i] = {**item, **body}`);
    this.emit(`return jsonify(${store}[i])`);
    this.indent--;
    this.indent--;
    this.emit(`return jsonify({'error': 'Not found'}), 404`);
    this.indent--;
    this.emitRaw('');

    // Delete
    this.emit(`@${appName}.route(${JSON.stringify(path + '/<id>')}, methods=['DELETE'])`);
    this.emit(`def ${schema.toLowerCase()}_delete(id):`);
    this.indent++;
    this.emit(`global ${store}`);
    this.emit(`${store} = [i for i in ${store} if str(i['id']) != str(id)]`);
    this.emit(`return jsonify({'deleted': True})`);
    this.indent--;
    this.emitRaw('');
  }

  // ===== Static files =====

  visitStatic(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.addFromImport('flask', 'send_from_directory');
    this.emitRaw('');
    this.emit(`@${appName}.route('/<path:filename>')`);
    this.emit(`def serve_static(filename):`);
    this.indent++;
    this.emit(`return send_from_directory(${JSON.stringify(raw)}, filename)`);
    this.indent--;
    this.emitRaw('');
  }

  // ===== Rate limiting =====

  visitLimit(appName, node) {
    const path = this.rawString(node.path);
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`# rate limit: ${max} requests per ${window} on ${path}`);
  }

  // ===== WebSocket =====

  visitWs(node) {
    this.addImport('flask_socketio');
    this.addFromImport('flask_socketio', 'SocketIO');
    this.addFromImport('flask_socketio', 'emit');
    const events = node.events || [];

    this.emitRaw('');
    this.emit(`socketio = SocketIO(app, cors_allowed_origins='*')`);
    this.emitRaw('');

    for (const evt of events) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      if (evtName === 'connect' || evtName === 'open') {
        this.emit(`@socketio.on('connect')`);
        this.emit(`def handle_connect():`);
      } else if (evtName === 'message') {
        const param = evt.params[0] || 'data';
        this.emit(`@socketio.on('message')`);
        this.emit(`def handle_message(${param}):`);
      } else if (evtName === 'close') {
        this.emit(`@socketio.on('disconnect')`);
        this.emit(`def handle_disconnect():`);
      } else {
        this.emit(`@socketio.on(${JSON.stringify(evtName)})`);
        const params = evt.params.length > 0 ? evt.params.join(', ') : 'data';
        this.emit(`def handle_${evtName}(${params}):`);
      }
      this.indent++;
      if (evt.body.length === 0) {
        this.emit('pass');
      } else {
        for (const stmt of evt.body) this.visitStatement(stmt);
      }
      this.indent--;
      this.emitRaw('');
    }
  }

  // ===== Session =====

  visitSession(appName, node) {
    this.emit(`${appName}.secret_key = 'naide-session-secret'`);
    this.emit(`# Flask sessions enabled via app.secret_key`);
    this.emitRaw('');
  }

  // ===== Cache =====

  visitCache(appName, node) {
    const path = this.rawString(node.path);
    const ttl = this.rawString(node.ttl);
    this.emit(`# cache: ${path} for ${ttl}`);
  }

  // ===== Prompt template =====

  visitPrompt(node) {
    const name = node.name;
    const parts = node.parts.map(p => this.generateString(p)).join(' + "\\n" + ');
    const defaults = node.defaults ? this.expr(node.defaults) : '{}';
    this.emitRaw('');
    this.emit(`def ${name}(vars={}):`);
    this.indent++;
    this.emit(`defaults = ${defaults}`);
    this.emit(`merged = {**defaults, **vars}`);
    this.emit(`template = ${parts}`);
    this.emit(`for k, v in merged.items():`);
    this.indent++;
    this.emit(`template = template.replace('{' + k + '}', str(v))`);
    this.indent--;
    this.emit(`return template`);
    this.indent--;
    this.emitRaw('');
  }
}
