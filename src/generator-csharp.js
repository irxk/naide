export class CSharpGenerator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.models = new Map();
    this.schemas = new Map();
    this.usings = new Set();
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
    this.authSecret = null;
    this.dbVar = null;
    this.usesServer = false;
    this.hasTests = false;
    this.hasAsserts = false;
    this.classBody = [];
    this.topLevel = [];
  }

  generate(ast) {
    this.visitProgram(ast);

    const result = [];

    // Emit usings
    this.usings.add('using System;');
    this.usings.add('using System.Collections.Generic;');
    this.usings.add('using System.Threading.Tasks;');

    for (const u of [...this.usings].sort()) {
      result.push(u);
    }
    result.push('');

    // Top-level classes (models, schemas)
    if (this.topLevel.length > 0) {
      for (const line of this.topLevel) {
        result.push(line);
      }
      result.push('');
    }

    // Main namespace and class
    result.push('namespace App {');
    result.push('  class Program {');
    result.push('    static async Task Main(string[] args) {');
    for (const line of this.classBody) {
      result.push(line);
    }
    result.push('    }');

    // Methods emitted inside Program class
    if (this.methods && this.methods.length > 0) {
      result.push('');
      for (const line of this.methods) {
        result.push(line);
      }
    }

    result.push('  }');
    result.push('}');

    return result.join('\n');
  }

  emit(line) {
    const indented = '      ' + '  '.repeat(this.indent) + line;
    this.classBody.push(indented);
    this.sourceMap.push(this.currentSourceLine);
  }

  emitRaw(line) {
    this.classBody.push(line);
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

  emitMethod(line) {
    if (!this.methods) this.methods = [];
    this.methods.push(line);
    this.sourceMap.push(this.currentSourceLine);
  }

  addUsing(u) {
    this.usings.add(u);
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
      'num': 'double',
      'number': 'double',
      'bool': 'bool',
      'boolean': 'bool',
      'list': 'List<object>',
      'map': 'Dictionary<string, object>',
      'any': 'object',
      'json': 'Dictionary<string, object>',
      'void': 'void',
      'auto': 'int',
      'timestamp': 'string',
    };
    return map[naideType] || 'object';
  }

  // ===== Imports =====

  visitUse(node) {
    const raw = node.source ? this.rawString(node.source) : node.name;
    const clean = raw.replace(/^['"]|['"]$/g, '');
    const csNamespace = this.mapModuleName(clean);
    this.addUsing(`using ${csNamespace};`);
  }

  visitUseDestructured(node) {
    const raw = this.rawString(node.source);
    const clean = raw.replace(/^['"]|['"]$/g, '');
    const csNamespace = this.mapModuleName(clean);
    this.addUsing(`using ${csNamespace};`);
  }

  mapModuleName(name) {
    const map = {
      'express': 'Microsoft.AspNetCore.Builder',
      'axios': 'System.Net.Http',
      'lodash': 'System.Linq',
      'moment': 'System',
      'fs': 'System.IO',
      'path': 'System.IO',
      'crypto': 'System.Security.Cryptography',
      'uuid': 'System',
    };
    return map[name] || name;
  }

  // ===== Functions =====

  visitFunction(node) {
    const async = node.isAsync ? 'async ' : '';
    const returnType = node.isAsync ? 'static async Task<object>' : 'static object';
    const params = node.params.map(p => {
      let s = 'object ';
      if (p.spread) s = 'params object[] ';
      s += p.name;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    const name = this.capitalize(node.name);

    const savedBody = this.classBody;
    const savedIndent = this.indent;
    this.classBody = [];
    this.indent = 0;
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    const bodyLines = this.classBody;
    this.classBody = savedBody;
    this.indent = savedIndent;

    this.emitMethod(`    ${returnType} ${name}(${params}) {`);
    for (const line of bodyLines) {
      this.emitMethod('  ' + line);
    }
    this.emitMethod('    }');
    this.emitMethod('');
  }

  visitReturn(node) {
    if (node.value === null) {
      this.emit('return;');
    } else {
      this.emit(`return ${this.expr(node.value)};`);
    }
  }

  visitReturnStatus(node) {
    this.emit(`return Results.Json(${this.expr(node.body)}, statusCode: ${this.expr(node.statusCode)});`);
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`return Results.Redirect(${val});`);
        break;
      case 'html':
        this.emit(`return Results.Content(${val}, "text/html");`);
        break;
      case 'text':
        this.emit(`return Results.Text(${val});`);
        break;
      case 'file':
        this.emit(`return Results.File(${val});`);
        break;
      default:
        this.emit(`return Results.Ok(${val});`);
    }
  }

  // ===== Variables =====

  visitTypedVar(node) {
    this.emit(`var ${node.name} = ${this.expr(node.value)};`);
  }

  visitAssignment(node) {
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      this.emit(`var __list = ${value};`);
      node.target.elements.forEach((e, i) => {
        this.emit(`var ${this.expr(e)} = __list[${i}];`);
      });
    } else if (node.target.type === 'Object') {
      const tempVar = '__dict';
      this.emit(`var ${tempVar} = ${value};`);
      for (const p of node.target.properties) {
        const key = p.type === 'shorthand' ? p.key : p.key;
        const varName = p.type === 'shorthand' ? p.key : this.expr(p.value);
        this.emit(`var ${varName} = ${tempVar}["${key}"];`);
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
      this.emit(`foreach (var __entry in ${collection}) {`);
      this.indent++;
      this.emit(`var ${node.key} = __entry.Key;`);
      this.emit(`var ${node.value} = __entry.Value;`);
      for (const stmt of node.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('}');
    } else {
      this.emit(`foreach (var ${node.value} in ${collection}) {`);
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

  // ===== Server (ASP.NET minimal API) =====

  visitServer(node) {
    this.usesServer = true;
    this.addUsing('using Microsoft.AspNetCore.Builder;');
    this.addUsing('using Microsoft.AspNetCore.Http;');
    this.addUsing('using Microsoft.Extensions.Hosting;');

    this.emit(`var builder = WebApplication.CreateBuilder(args);`);
    this.emit(`var app = builder.Build();`);
    this.emitRaw('');

    const errorHandlers = [];

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute('app', child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors('app', child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth('app', child);
      } else if (child.type === 'StaticDecl') {
        this.visitStatic('app', child);
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'SchemaDecl') {
        this.visitSchema(child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud('app', child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup('app', child);
      } else if (child.type === 'WsDecl') {
        this.visitWs(child);
      } else if (child.type === 'SessionDecl') {
        this.visitSession('app', child);
      } else if (child.type === 'CacheDecl') {
        this.visitCache('app', child);
      } else if (child.type === 'GraphqlDecl') {
        this.emit(`// GraphQL: use HotChocolate package`);
      } else {
        this.visitStatement(child);
      }
    }

    for (const eh of errorHandlers) {
      this.visitErrorHandler('app', eh);
    }

    const port = node.port ? this.expr(node.port) : '3000';
    this.emitRaw('');
    this.emit(`app.Run("http://0.0.0.0:${port.replace(/['"]/g, '')}");`);
  }

  visitRoute(appName, route) {
    const method = route.method === 'del' ? 'Delete' : this.capitalize(route.method);
    const path = this.stringValue(route.path);
    const needsAsync = this.bodyUsesAwait(route.body);
    const asyncPrefix = needsAsync ? 'async ' : '';

    this.emit(`${appName}.Map${method}(${path}, ${asyncPrefix}(HttpContext context) => {`);
    this.indent++;

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`return Results.Json(${this.expr(stmt.value)});`);
      } else {
        this.visitStatement(stmt);
      }
    }

    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Bot =====

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'Environment.GetEnvironmentVariable("BOT_TOKEN")';
    this.emit(`// Bot: ${node.name}`);
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

    const ext = node.parent ? ` : ${node.parent}` : '';
    this.emitTop(`public class ${node.name}${ext} {`);

    // Properties
    for (const f of node.fields) {
      const csType = f.fieldType ? this.mapType(f.fieldType) : 'object';
      if (f.defaultValue) {
        this.emitTop(`  public ${csType} ${this.capitalize(f.name)} { get; set; } = ${this.expr(f.defaultValue)};`);
      } else {
        this.emitTop(`  public ${csType} ${this.capitalize(f.name)} { get; set; }`);
      }
    }

    if (node.fields.length > 0) {
      this.emitTopRaw('');
    }

    // Methods
    for (const method of node.methods) {
      const async = method.isAsync ? 'async ' : '';
      const returnType = method.isAsync ? 'Task<object>' : 'object';
      const params = method.params.map(p => {
        let s = 'object ';
        if (p.spread) s = 'params object[] ';
        s += p.name;
        if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      const savedBody = this.classBody;
      const savedIndent = this.indent;
      this.classBody = [];
      this.indent = 0;
      for (const stmt of method.body) {
        this.visitStatement(stmt);
      }
      const bodyLines = this.classBody;
      this.classBody = savedBody;
      this.indent = savedIndent;

      this.emitTop(`  public ${async}${returnType} ${this.capitalize(method.name)}(${params}) {`);
      for (const line of bodyLines) {
        this.emitTop('  ' + line);
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
    const args = node.args.map(a => this.expr(a)).join(' + " " + ');
    this.emit(`Console.WriteLine(${args});`);
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw new Exception(${value});`);
    } else {
      this.emit(`throw ${value};`);
    }
  }

  // ===== Database =====

  visitDbConnect(node) {
    this.addUsing('using System.Data;');
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
      this.addUsing('using Microsoft.Data.Sqlite;');
      const conn = node.connection ? this.stringValue(node.connection) : '"Data Source=data.db"';
      this.emit(`var __db = new SqliteConnection(${conn});`);
      this.emit(`await __db.OpenAsync();`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      this.addUsing('using Npgsql;');
      const conn = node.connection ? this.stringValue(node.connection) : 'Environment.GetEnvironmentVariable("DATABASE_URL")';
      this.emit(`var __db = new NpgsqlConnection(${conn});`);
      this.emit(`await __db.OpenAsync();`);
    }
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    const exprs = node.expressions.map(e => this.expr(e)).join(', ');
    this.emit(`await Task.WhenAll(${exprs});`);
  }

  // ===== Schema =====

  visitSchema(node) {
    this.schemas.set(node.name, node);

    this.emitTop(`public class ${node.name} {`);
    for (const field of node.fields) {
      const csType = this.mapType(field.type);
      const nullable = field.modifiers.some(m => m.name === 'optional') ? '?' : '';
      this.emitTop(`  public ${csType}${nullable} ${this.capitalize(field.name)} { get; set; }`);
    }
    this.emitTop('}');
    this.emitTopRaw('');
  }

  // ===== CRUD =====

  visitCrud(appName, node) {
    const path = this.rawString(node.path);
    const schema = node.schemaName;
    const store = `__${schema.toLowerCase()}Store`;

    this.emit(`var ${store} = new List<${schema}>();`);
    this.emit(`var __${schema.toLowerCase()}Id = 1;`);
    this.emitRaw('');

    // GET all
    this.emit(`${appName}.MapGet("${path}", () => Results.Json(${store}));`);
    this.emitRaw('');

    // GET by id
    this.emit(`${appName}.MapGet("${path}/{id}", (int id) => {`);
    this.indent++;
    this.emit(`var item = ${store}.Find(i => i.${this.capitalize('id')} == id);`);
    this.emit(`return item != null ? Results.Json(item) : Results.NotFound();`);
    this.indent--;
    this.emit('});');
    this.emitRaw('');

    // POST
    this.emit(`${appName}.MapPost("${path}", (${schema} body) => {`);
    this.indent++;
    this.emit(`${store}.Add(body);`);
    this.emit(`return Results.Created("${path}", body);`);
    this.indent--;
    this.emit('});');
    this.emitRaw('');

    // DELETE
    this.emit(`${appName}.MapDelete("${path}/{id}", (int id) => {`);
    this.indent++;
    this.emit(`${store}.RemoveAll(i => i.${this.capitalize('id')} == id);`);
    this.emit(`return Results.Ok(new { deleted = true });`);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Auth =====

  visitAuth(appName, node) {
    const secret = this.expr(node.secret);
    this.authSecret = secret;
    this.addUsing('using Microsoft.AspNetCore.Authentication.JwtBearer;');
    this.emit(`// auth: JWT secret = ${secret}`);
    this.emit(`// builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)...`);
    this.emitRaw('');
  }

  // ===== CORS =====

  visitCors(appName, node) {
    const origins = this.expr(node.origins);
    this.emit(`// CORS: allow origins ${origins}`);
    this.emit(`// builder.Services.AddCors(options => options.AddDefaultPolicy(b => b.WithOrigins(${origins}).AllowAnyMethod().AllowAnyHeader()));`);
    this.emit(`// app.UseCors();`);
    this.emitRaw('');
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
    for (const v of node.vars) {
      let defaultVal = null;
      for (const mod of v.modifiers) {
        if (mod.name === 'default') {
          defaultVal = this.expr(mod.args[0]);
        }
      }
      if (defaultVal !== null) {
        this.emit(`var ${v.name} = Environment.GetEnvironmentVariable("${v.name}") ?? ${defaultVal};`);
      } else {
        this.emit(`var ${v.name} = Environment.GetEnvironmentVariable("${v.name}");`);
      }

      if (v.type === 'int') {
        this.emit(`var ${v.name}_parsed = int.TryParse(${v.name}, out var __${v.name}Val) ? __${v.name}Val : 0;`);
      } else if (v.type === 'num') {
        this.emit(`var ${v.name}_parsed = double.TryParse(${v.name}, out var __${v.name}Val) ? __${v.name}Val : 0.0;`);
      } else if (v.type === 'bool') {
        this.emit(`var ${v.name}_parsed = ${v.name}?.ToLower() == "true";`);
      }
    }
    this.emitRaw('');
  }

  // ===== Every (scheduler) =====

  visitEvery(node) {
    const interval = this.expr(node.interval);
    this.addUsing('using System.Timers;');
    this.emit(`// scheduled task every ${interval}`);
    this.emit(`var __timer = new System.Timers.Timer(60000);`);
    this.emit(`__timer.Elapsed += (sender, e) => {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('};');
    this.emit('__timer.Start();');
    this.emitRaw('');
  }

  // ===== Watch =====

  visitWatch(node) {
    const params = node.params.length > 0 ? node.params.join(', ') : 'event';
    this.emit(`// watch: ${node.eventName}(${params})`);
    for (const stmt of node.body) this.visitStatement(stmt);
  }

  // ===== Static =====

  visitStatic(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    this.emit(`${appName}.UseStaticFiles();`);
    this.emit(`// static files from: ${raw}`);
    this.emitRaw('');
  }

  // ===== WebSocket =====

  visitWs(node) {
    this.addUsing('using System.Net.WebSockets;');
    const path = this.rawString(node.path);
    this.emit(`// WebSocket endpoint: ${path}`);
    this.emit(`app.UseWebSockets();`);
    for (const evt of (node.events || [])) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      this.emit(`// ws event: ${evtName}`);
      for (const stmt of evt.body) this.visitStatement(stmt);
    }
  }

  // ===== Group =====

  visitGroup(appName, node) {
    const prefix = this.rawString(node.prefix);
    this.emit(`var __group = ${appName}.MapGroup("${prefix}");`);
    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute('__group', child);
      } else {
        this.visitStatement(child);
      }
    }
    this.emitRaw('');
  }

  // ===== Error handler =====

  visitErrorHandler(appName, node) {
    this.emit(`// error handler`);
    this.emit(`${appName}.UseExceptionHandler(errorApp => {`);
    this.indent++;
    this.emit(`errorApp.Run(async context => {`);
    this.indent++;
    this.emit(`context.Response.StatusCode = 500;`);
    this.emit(`await context.Response.WriteAsJsonAsync(new { error = "Internal Server Error" });`);
    this.indent--;
    this.emit('});');
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Cookie =====

  visitCookie(appName, node) {
    this.emit(`// cookies enabled`);
  }

  // ===== Upload =====

  visitUpload(appName, node) {
    const path = this.rawString(node.path);
    this.emit(`// upload endpoint: ${path}`);
    this.emit(`${appName}.MapPost("${path}", async (HttpContext context) => {`);
    this.indent++;
    this.emit(`var form = await context.Request.ReadFormAsync();`);
    this.emit(`var file = form.Files[0];`);
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Session =====

  visitSession(appName, node) {
    this.emit(`// session enabled`);
    this.emit(`// builder.Services.AddDistributedMemoryCache();`);
    this.emit(`// builder.Services.AddSession();`);
    this.emit(`// app.UseSession();`);
    this.emitRaw('');
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
    this.addUsing('using Xunit;');
    const name = this.rawString(node.name);
    const funcName = `Test_${name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}`;
    this.emit(`// [Fact]`);
    this.emit(`// public void ${funcName}() {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit(`// }`);
    this.emitRaw('');
  }

  visitAssert(node) {
    this.hasAsserts = true;
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && (exprNode.op === '===' || exprNode.op === '==')) {
      this.emit(`System.Diagnostics.Debug.Assert(${this.expr(exprNode.left)} == ${this.expr(exprNode.right)});`);
    } else if (exprNode.type === 'Binary' && (exprNode.op === '!==' || exprNode.op === '!=')) {
      this.emit(`System.Diagnostics.Debug.Assert(${this.expr(exprNode.left)} != ${this.expr(exprNode.right)});`);
    } else {
      this.emit(`System.Diagnostics.Debug.Assert((bool)(${this.expr(exprNode)}));`);
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
    this.addUsing('using Microsoft.OpenApi;');
    this.emit(`// OpenAPI: builder.Services.AddEndpointsApiExplorer(); builder.Services.AddSwaggerGen();`);
  }

  // ===== ReturnRedirect =====

  visitReturnRedirect(node) {
    this.emit(`return Results.Redirect(${this.expr(node.url)});`);
  }

  // ===== ReturnDownload =====

  visitReturnDownload(node) {
    this.emit(`return Results.File(${this.expr(node.filePath)}, fileDownloadName: ${this.expr(node.filename)});`);
  }

  // ===== Prompt =====

  visitPrompt(node) {
    this.emit(`// prompt template: ${node.name}`);
    const name = this.capitalize(node.name);
    this.emitMethod(`    static string ${name}(Dictionary<string, string> vars) {`);
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : lines.join(' + "\\n" + ');
    this.emitMethod(`      var template = ${template};`);
    this.emitMethod(`      foreach (var kv in vars) template = template.Replace("{" + kv.Key + "}", kv.Value);`);
    this.emitMethod(`      return template;`);
    this.emitMethod('    }');
    this.emitMethod('');
  }

  // ===== Page =====

  visitPage(node) {
    this.addUsing('using System.IO;');
    const filename = this.rawString(node.filename);
    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`File.WriteAllText("${filename}", @"<!DOCTYPE html>`);
    this.emit(`<html lang=""en""><head><meta charset=""UTF-8"">`);
    this.emit(`<meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">`);
    this.emit(`<title>${pageTitle}</title>`);
    for (const h of headParts) this.emit(h);
    this.emit(`</head><body>`);
    for (const b of bodyParts) this.emit(b);
    this.emit(`</body></html>");`);
    this.emitRaw('');
  }

  classifyPageElement(el, head, body, setTitle) {
    const tag = el.tag;
    const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
    const arg1 = el.args[1] ? this.rawString(el.args[1]) : '';
    if (tag === 'title') { setTitle(arg0); return; }
    if (tag === 'style' || tag === 'link') { head.push(`<link rel=""stylesheet"" href=""${arg0}"">`); return; }
    if (tag === 'meta') { head.push(`<meta name=""${arg0}"" content=""${arg1}"">`); return; }
    if (tag === 'script') { body.push(`<script src=""${arg0}""></script>`); return; }
    if (tag === 'img') { body.push(`<img src=""${arg0}"" alt=""${arg1}"">`); return; }
    if (tag === 'a') { body.push(`<a href=""${arg0}"">${arg1}</a>`); return; }
    if (tag === 'input') { body.push(`<input type=""${arg0}"" name=""${arg1}"">`); return; }
    if (el.children && el.children.length > 0) {
      const cls = arg0 ? ` class=""${arg0}""` : '';
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
    this.emit(`// CLI: ${desc}`);
    this.emit(`var cliArgs = new Dictionary<string, object>();`);

    for (const arg of node.args) {
      const argName = this.rawString(arg.name);
      this.emit(`// arg: --${argName} (${arg.type})`);
    }

    this.emit(`for (var i = 0; i < args.Length; i++) {`);
    this.indent++;
    for (const arg of node.args) {
      const argName = this.rawString(arg.name);
      const coerce = arg.type === 'int' ? `int.Parse(args[++i])` :
                     arg.type === 'num' ? `double.Parse(args[++i])` :
                     arg.type === 'bool' ? 'true' : 'args[++i]';
      this.emit(`if (args[i] == "--${argName}") { cliArgs["${argName}"] = ${coerce}; continue; }`);
    }
    for (const flag of node.flags) {
      const s = this.rawString(flag.short);
      const l = this.rawString(flag.long);
      this.emit(`if (args[i] == "-${s}" || args[i] == "--${l}") { cliArgs["${l}"] = true; continue; }`);
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
    this.addUsing('using System.Net.Mail;');
    const host = this.generateString(node.host);
    const port = this.expr(node.port);
    const user = node.user ? this.expr(node.user) : 'Environment.GetEnvironmentVariable("MAIL_USER")';
    const pass = node.pass ? this.expr(node.pass) : 'Environment.GetEnvironmentVariable("MAIL_PASS")';
    this.emit(`var smtpClient = new SmtpClient(${host}, ${port}) {`);
    this.indent++;
    this.emit(`Credentials = new System.Net.NetworkCredential(${user}, ${pass}),`);
    this.emit(`EnableSsl = true,`);
    this.indent--;
    this.emit('};');
    this.emitRaw('');
  }

  // ===== Desktop =====

  visitDesktop(node) {
    this.emit(`// Desktop app: ${node.name} — use WPF/Avalonia/MAUI`);
    const title = node.title ? this.rawString(node.title) : node.name;
    const width = node.width ? this.expr(node.width) : '800';
    const height = node.height ? this.expr(node.height) : '600';
    this.emit(`// title: ${title}, size: ${width}x${height}`);
    this.emitRaw('');
  }

  // ===== Screen =====

  visitScreen(node) {
    this.emit(`// Screen: ${node.name} — use .NET MAUI`);
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
      this.emit(`// widget: ${tag}("${arg0}")`);
    }
    this.emitRaw('');
  }

  // ===== OAuth =====

  visitOauth(node) {
    const provider = this.rawString(node.provider);
    const clientId = this.expr(node.clientId);
    this.addUsing('using Microsoft.AspNetCore.Authentication;');
    this.emit(`// OAuth: ${provider}, clientId: ${clientId}`);
    this.emitRaw('');
  }

  // ===== Pay =====

  visitPay(node) {
    const provider = this.rawString(node.provider);
    this.emit(`// Payment: ${provider} — use Stripe.net NuGet`);
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
    this.emit(`// PDF generation: ${filename} — use QuestPDF or iTextSharp`);
    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawString(el.args[0]) : '';
      this.emit(`// pdf element: ${tag}("${arg0}")`);
    }
    this.emitRaw('');
  }

  // ===== i18n =====

  visitI18n(node) {
    const defaultLang = node.defaultLang ? this.rawString(node.defaultLang) : 'en';
    this.addUsing('using System.Text.Json;');
    this.emit(`// i18n: default language = ${defaultLang}`);
    this.emit(`var __i18nLang = "${defaultLang}";`);
    this.emit(`var __i18nData = new Dictionary<string, Dictionary<string, object>>();`);
    for (const lang of node.langs) {
      const code = this.rawString(lang.code);
      const file = this.rawString(lang.file);
      const dir = this.rawString(node.dir);
      this.emit(`__i18nData["${code}"] = JsonSerializer.Deserialize<Dictionary<string, object>>(File.ReadAllText("${dir}/${file}"));`);
    }
    this.emitRaw('');
  }

  // ===== Push =====

  visitPush(node) {
    this.emit(`// Push notifications — use FirebaseAdmin or WebPush NuGet`);
    this.emitRaw('');
  }

  // ===== Search =====

  visitSearch(node) {
    const engine = this.rawString(node.engine);
    this.emit(`// Search engine: ${engine} — use NEST or Meilisearch NuGet`);
    this.emitRaw('');
  }

  // ===== Image =====

  visitImage(node) {
    const input = this.expr(node.input);
    this.emit(`// Image processing: ${input} — use SixLabors.ImageSharp`);
    this.addUsing('using SixLabors.ImageSharp;');
    this.addUsing('using SixLabors.ImageSharp.Processing;');
    this.emit(`using (var __img = Image.Load(${input})) {`);
    this.indent++;
    for (const op of node.operations) {
      if (op.op === 'resize') {
        this.emit(`__img.Mutate(x => x.Resize(${op.args[0] || 800}, ${op.args[1] || 0}));`);
      } else if (op.op === 'rotate') {
        this.emit(`__img.Mutate(x => x.Rotate(${op.args[0] || 90}));`);
      } else if (op.op === 'grayscale' || op.op === 'greyscale') {
        this.emit(`__img.Mutate(x => x.Grayscale());`);
      } else if (op.op === 'flip') {
        this.emit(`__img.Mutate(x => x.Flip(FlipMode.Vertical));`);
      } else if (op.op === 'blur') {
        this.emit(`__img.Mutate(x => x.GaussianBlur(${op.args[0] || 5}));`);
      } else if (op.op === 'crop') {
        this.emit(`__img.Mutate(x => x.Crop(new Rectangle(${op.args[0] || 0}, ${op.args[1] || 0}, ${op.args[2] || 100}, ${op.args[3] || 100})));`);
      }
    }
    const output = node.output ? this.expr(node.output) : input;
    this.emit(`__img.Save(${output});`);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  // ===== CSV =====

  visitCsv(node) {
    const name = this.rawString(node.name);
    const format = node.format ? this.rawString(node.format) : 'csv';
    const output = node.output ? this.rawString(node.output) : `${name}.${format}`;
    this.addUsing('using System.IO;');
    this.emit(`// CSV/Excel export: ${output}`);
    if (format === 'csv') {
      this.emit(`// Use CsvHelper NuGet for CSV export`);
    } else {
      this.emit(`// Use ClosedXML or EPPlus NuGet for Excel export`);
    }
    this.emitRaw('');
  }

  // ===== Logging =====

  visitLogging(node) {
    const name = this.rawString(node.name);
    this.addUsing('using Microsoft.Extensions.Logging;');
    this.emit(`// logger: ${name}`);
    this.emit(`// var logger = LoggerFactory.Create(b => b.AddConsole()).CreateLogger("${name}");`);
    this.emitRaw('');
  }

  // ===== Migrate =====

  visitMigrate(node) {
    const name = this.rawString(node.name);
    this.emit(`// migration: ${name} — use Entity Framework migrations`);
    this.emitRaw('');
  }

  // ===== gRPC =====

  visitGrpc(node) {
    const name = this.rawString(node.name);
    this.addUsing('using Grpc.Core;');
    this.emit(`// gRPC service: ${name} — use Grpc.AspNetCore NuGet`);
    this.emitRaw('');
  }

  // ===== WebRTC =====

  visitWebrtc(node) {
    this.emit(`// WebRTC signaling server — use WebSocket middleware`);
    this.emitRaw('');
  }

  // ===== Blockchain =====

  visitBlockchain(node) {
    const name = this.rawString(node.name);
    this.emit(`// Blockchain: ${name} — use Nethereum NuGet`);
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
        return `await Task.WhenAll(${this.expr(node.expr)})`;

      case 'Spread':
        return `/* spread */ ${this.expr(node.expr)}`;

      case 'New':
        return `new ${this.expr(node.expr)}`;

      case 'TypeOf':
        return `${this.expr(node.expr)}.GetType().Name`;

      case 'MemberAccess':
        return this.mapMemberAccess(node);

      case 'OptionalAccess':
        return `${this.expr(node.object)}?.${node.property}`;

      case 'Call':
        return this.generateCall(node);

      case 'IndexAccess':
        return `${this.expr(node.object)}[${this.expr(node.index)}]`;

      case 'Array':
        return `new List<object> { ${node.elements.map(e => this.expr(e)).join(', ')} }`;

      case 'Object': {
        const props = node.properties.map(p => {
          if (p.type === 'spread') return `/* spread */ ${this.expr(p.value)}`;
          if (p.type === 'shorthand') return `{ "${p.key}", ${p.key} }`;
          const key = typeof p.key === 'string' ? `"${p.key}"` :
                      (p.key.type === 'String' ? this.generateString(p.key.value) :
                       (p.key.type === 'Computed' ? this.expr(p.key.expr) : `"${this.expr(p.key)}"`));
          return `{ ${key}, ${this.expr(p.value)} }`;
        }).join(', ');
        return `new Dictionary<string, object> { ${props} }`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        if (node.params.length === 1) return `(${params}) => ${body}`;
        return `(${params}) => ${body}`;
      }

      case 'Lambda': {
        const async = node.isAsync ? 'async ' : '';
        const params = node.params.map(p => p.name).join(', ');
        const savedBody = this.classBody;
        const savedIndent = this.indent;
        this.classBody = [];
        this.indent = 0;
        for (const stmt of node.body) this.visitStatement(stmt);
        const bodyLines = this.classBody;
        this.classBody = savedBody;
        this.indent = savedIndent;
        return `${async}(${params}) => { ${bodyLines.map(l => l.trim()).join(' ')} }`;
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

    if (prop === 'length') return `${obj}.Count`;
    if (prop === 'toString') return `${obj}.ToString`;

    if ((obj === 'request' || obj === 'req') && prop === 'body') return 'await context.Request.ReadFromJsonAsync<object>()';
    if ((obj === 'request' || obj === 'req') && prop === 'query') return 'context.Request.Query';
    if ((obj === 'request' || obj === 'req') && prop === 'params') return 'context.Request.RouteValues';
    if ((obj === 'request' || obj === 'req') && prop === 'headers') return 'context.Request.Headers';
    if ((obj === 'request' || obj === 'req') && prop === 'method') return 'context.Request.Method';
    if ((obj === 'request' || obj === 'req') && prop === 'url') return 'context.Request.Path.ToString()';

    if (obj === 'JSON' && prop === 'parse') { this.addUsing('using System.Text.Json;'); return 'JsonSerializer.Deserialize<object>'; }
    if (obj === 'JSON' && prop === 'stringify') { this.addUsing('using System.Text.Json;'); return 'JsonSerializer.Serialize'; }

    if (obj === 'Math' && prop === 'floor') return 'Math.Floor';
    if (obj === 'Math' && prop === 'ceil') return 'Math.Ceiling';
    if (obj === 'Math' && prop === 'round') return 'Math.Round';
    if (obj === 'Math' && prop === 'abs') return 'Math.Abs';
    if (obj === 'Math' && prop === 'min') return 'Math.Min';
    if (obj === 'Math' && prop === 'max') return 'Math.Max';
    if (obj === 'Math' && prop === 'random') return 'new Random().NextDouble';
    if (obj === 'Math' && prop === 'PI') return 'Math.PI';

    if (obj === 'console' && prop === 'log') return 'Console.WriteLine';
    if (obj === 'console' && prop === 'error') return 'Console.Error.WriteLine';
    if (obj === 'console' && prop === 'warn') return 'Console.Error.WriteLine';

    return `${obj}.${this.capitalize(prop)}`;
  }

  generateCall(node) {
    const args = node.args.map(a => this.expr(a)).join(', ');

    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;
      if (name === 'parseInt') return `int.Parse(${args})`;
      if (name === 'parseFloat') return `double.Parse(${args})`;
      if (name === 'String') return `${args}.ToString()`;
      if (name === 'Number') return `Convert.ToDouble(${args})`;
      if (name === 'Boolean') return `Convert.ToBoolean(${args})`;
      if (name === 'isNaN') return `double.IsNaN(Convert.ToDouble(${args}))`;
      if (name === 'setTimeout') return `Task.Delay(${node.args.length > 1 ? this.expr(node.args[1]) : '0'}).ContinueWith(_ => ${this.expr(node.args[0])}())`;
      if (name === 'setInterval') return `/* setInterval */ Task.Run(async () => { while (true) { await Task.Delay(${node.args.length > 1 ? this.expr(node.args[1]) : '1000'}); ${this.expr(node.args[0])}(); } })`;
    }

    if (node.callee.type === 'MemberAccess') {
      const obj = this.expr(node.callee.object);
      const prop = node.callee.property;

      // List methods
      if (prop === 'push') return `${obj}.Add(${args})`;
      if (prop === 'pop') { return `${obj}.RemoveAt(${obj}.Count - 1)`; }
      if (prop === 'shift') return `${obj}.RemoveAt(0)`;
      if (prop === 'unshift') return `${obj}.Insert(0, ${args})`;
      if (prop === 'indexOf') return `${obj}.IndexOf(${args})`;
      if (prop === 'includes') return `${obj}.Contains(${args})`;
      if (prop === 'join') return `string.Join(${args}, ${obj})`;
      if (prop === 'slice') { this.addUsing('using System.Linq;'); return `${obj}.Skip(${args}).ToList()`; }
      if (prop === 'forEach') return `${obj}.ForEach(${args})`;
      if (prop === 'map') { this.addUsing('using System.Linq;'); return `${obj}.Select(${args}).ToList()`; }
      if (prop === 'filter') { this.addUsing('using System.Linq;'); return `${obj}.Where(${args}).ToList()`; }
      if (prop === 'find') { this.addUsing('using System.Linq;'); return `${obj}.FirstOrDefault(${args})`; }
      if (prop === 'some') { this.addUsing('using System.Linq;'); return `${obj}.Any(${args})`; }
      if (prop === 'every') { this.addUsing('using System.Linq;'); return `${obj}.All(${args})`; }
      if (prop === 'reduce') { this.addUsing('using System.Linq;'); return `${obj}.Aggregate(${args})`; }
      if (prop === 'flat') { this.addUsing('using System.Linq;'); return `${obj}.SelectMany(x => (IEnumerable<object>)x).ToList()`; }
      if (prop === 'reverse') { return `${obj}.AsEnumerable().Reverse().ToList()`; }
      if (prop === 'sort') { return `(${obj}.OrderBy(x => x).ToList())`; }
      if (prop === 'concat') { this.addUsing('using System.Linq;'); return `${obj}.Concat(${args}).ToList()`; }

      // String methods
      if (prop === 'split') return `${obj}.Split(${args})`;
      if (prop === 'trim') return `${obj}.Trim()`;
      if (prop === 'trimStart') return `${obj}.TrimStart()`;
      if (prop === 'trimEnd') return `${obj}.TrimEnd()`;
      if (prop === 'toUpperCase') return `${obj}.ToUpper()`;
      if (prop === 'toLowerCase') return `${obj}.ToLower()`;
      if (prop === 'startsWith') return `${obj}.StartsWith(${args})`;
      if (prop === 'endsWith') return `${obj}.EndsWith(${args})`;
      if (prop === 'replace') return `${obj}.Replace(${args})`;
      if (prop === 'replaceAll') return `${obj}.Replace(${args})`;
      if (prop === 'padStart') return `${obj}.PadLeft(${args})`;
      if (prop === 'padEnd') return `${obj}.PadRight(${args})`;
      if (prop === 'charAt') return `${obj}[${args}]`;
      if (prop === 'substring') return `${obj}.Substring(${args})`;
      if (prop === 'repeat') { return `string.Concat(Enumerable.Repeat(${obj}, ${args}))`; }

      // Object methods
      if (obj === 'Object' && prop === 'keys') { this.addUsing('using System.Linq;'); return `((Dictionary<string, object>)${this.expr(node.args[0])}).Keys.ToList()`; }
      if (obj === 'Object' && prop === 'values') { this.addUsing('using System.Linq;'); return `((Dictionary<string, object>)${this.expr(node.args[0])}).Values.ToList()`; }
      if (obj === 'Object' && prop === 'entries') { this.addUsing('using System.Linq;'); return `((Dictionary<string, object>)${this.expr(node.args[0])}).ToList()`; }

      // Array static
      if (obj === 'Array' && prop === 'isArray') return `${args} is IList`;
      if (obj === 'Array' && prop === 'from') return `new List<object>(${args})`;

      // Promise -> Task
      if (obj === 'Promise' && prop === 'all') return `Task.WhenAll(${args})`;
      if (obj === 'Promise' && prop === 'resolve') return `Task.FromResult(${args})`;

      // Date
      if (obj === 'Date' && prop === 'now') return `DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()`;

      // JSON
      if (prop === 'json') {
        this.addUsing('using System.Text.Json;');
        return `await context.Request.ReadFromJsonAsync<object>()`;
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

    // Use C# interpolated string
    let result = '$"';
    for (const part of strData.parts) {
      if (part.type === 'text') {
        result += part.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/{/g, '{{').replace(/}/g, '}}');
      } else {
        result += '{' + part.value + '}';
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

    this.addUsing('using System.Linq;');
    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier') {
        const name = step.callee.name;
        const args = step.args.map(a => this.expr(a)).join(', ');

        if (name === 'filter') {
          result = `${result}.Where(${args}).ToList()`;
        } else if (name === 'map') {
          result = `${result}.Select(${args}).ToList()`;
        } else if (name === 'reduce') {
          result = `${result}.Aggregate(${args})`;
        } else if (name === 'sort') {
          result = `${result}.OrderBy(x => x).ToList()`;
        } else if (name === 'reverse') {
          result = `${result}.AsEnumerable().Reverse().ToList()`;
        } else if (name === 'join') {
          result = `string.Join(${args}, ${result})`;
        } else if (name === 'find') {
          result = `${result}.FirstOrDefault(${args})`;
        } else if (name === 'some') {
          result = `${result}.Any(${args})`;
        } else if (name === 'every') {
          result = `${result}.All(${args})`;
        } else {
          result = `${this.capitalize(name)}(${result}${args ? ', ' + args : ''})`;
        }
      } else if (step.type === 'Identifier') {
        result = `${this.capitalize(step.name)}(${result})`;
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

  capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
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
    const saved = this.classBody;
    const savedIndent = this.indent;
    this.classBody = [];
    this.indent = 0;
    this.visitStatement(stmt);
    const result = this.classBody.join('\n');
    this.classBody = saved;
    this.indent = savedIndent;
    return result;
  }
}
