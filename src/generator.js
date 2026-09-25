export class Generator {
  constructor(options = {}) {
    this.indent = 0;
    this.output = [];
    this.usesExpress = false;
    this.models = new Map();
    this.runtimeImports = new Set();
    this.schemas = new Map();
    this.needsEventBus = false;
    this.runtimePath = options.runtimePath || 'naider/runtime';
    this.dbDir = null;
    this.authSecret = null;
    this.hasWs = false;
    this.wsNodes = [];
    this.hasTests = false;
    this.hasAsserts = false;
    this.dbSql = false;
    this.sqlDriver = null;
    this.sourceMap = [];
    this.currentSourceLine = 0;
    this.sourceFile = options.sourceFile || null;
  }

  generate(ast) {
    this.visitProgram(ast);

    const preamble = [];

    if (this.needsEventBus) {
      this.runtimeImports.add('createEventBus');
    }

    if (this.runtimeImports.size > 0) {
      const imports = [...this.runtimeImports].join(', ');
      preamble.push(`import { ${imports} } from '${this.runtimePath}';`);
      preamble.push('');
    }

    if (this.hasTests) {
      preamble.push("import { test } from 'node:test';");
    }
    if (this.hasTests || this.hasAsserts) {
      preamble.push("import assert from 'node:assert/strict';");
      if (this.hasTests) preamble.push('');
    }

    if (this.needsEventBus) {
      preamble.push('const __eventBus = createEventBus();');
      preamble.push('');
    }

    if (this.usesExpress) {
      this.output.push('');
      this.output.push("process.on('unhandledRejection', (err) => { console.error('[NAIDE] Unhandled async error:', err.message || err); });");
    }

    if (preamble.length > 0) {
      this.output.unshift(...preamble);
    }

    return this.output.join('\n');
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

  normalizeRoutePath(pathStr) {
    return pathStr.replace(/(["'])(.+?)\1/g, (m, q, p) => {
      const normalized = p.replace(/(?<!\()(?<!\.\*)\*(?!\))/g, '(.*)');
      return q + normalized + q;
    });
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
      case 'CrudDecl': return this.visitCrudTopLevel(node);
      case 'AuthDecl': return this.visitAuthTopLevel(node);
      case 'CorsDecl': return this.visitCorsTopLevel(node);
      case 'LimitDecl': return this.visitLimitTopLevel(node);
      case 'EnvDecl': return this.visitEnv(node);
      case 'EveryDecl': return this.visitEvery(node);
      case 'WatchDecl': return this.visitWatch(node);
      case 'StaticDecl': return this.visitStaticTopLevel(node);
      case 'WsDecl': return this.visitWsTopLevel(node);
      case 'GroupDecl': return this.visitGroupTopLevel(node);
      case 'ErrorHandler': return this.visitErrorHandlerTopLevel(node);
      case 'CookieDecl': return this.visitCookieTopLevel(node);
      case 'UploadDecl': return this.visitUploadTopLevel(node);
      case 'SessionDecl': return this.visitSessionTopLevel(node);
      case 'ViewDecl': return this.visitViewTopLevel(node);
      case 'SseDecl': return this.visitSseTopLevel(node);
      case 'CacheDecl': return this.visitCacheTopLevel(node);
      case 'MiddlewareRef': return this.visitMiddlewareRefTopLevel(node);
      case 'ReturnRender': return this.visitReturnRender(node);
      case 'ValidateDecl': return this.visitValidateTopLevel(node);
      case 'TestDecl': return this.visitTest(node);
      case 'AssertStmt': return this.visitAssert(node);
      case 'QueueDecl': return this.visitQueue(node);
      case 'OpenapiDecl': return this.visitOpenapiTopLevel(node);
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
        this.emit(`/* unknown: ${node.type} */`);
    }
  }

  visitUse(node) {
    const source = node.source ? this.stringValue(node.source) : `'${node.name}'`;
    const alias = node.alias || node.name;
    if (source.includes('express')) this.usesExpress = true;
    this.emit(`import ${alias} from ${this.rewriteNaideImport(source)};`);
  }

  visitUseDestructured(node) {
    const source = this.stringValue(node.source);
    const names = node.names.map(n => n.alias ? `${n.name} as ${n.alias}` : n.name).join(', ');
    this.emit(`import { ${names} } from ${this.rewriteNaideImport(source)};`);
  }

  rewriteNaideImport(source) {
    return source.replace(/\.(naide|nx)(['"])/g, '.mjs$2');
  }

  visitFunction(node) {
    const exp = node.isPublic ? 'export ' : '';
    const async = node.isAsync ? 'async ' : '';
    const params = node.params.map(p => {
      let s = p.spread ? '...' : '';
      s += p.name;
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');

    this.emit(`${exp}${async}function ${node.name}(${params}) {`);
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
    this.emit(`return res.status(${this.expr(node.statusCode)}).json(${this.expr(node.body)});`);
  }

  visitReturnMethod(node) {
    const val = this.expr(node.value);
    switch (node.method) {
      case 'redirect':
        this.emit(`return res.redirect(${val});`);
        break;
      case 'html':
        this.emit(`return res.type('html').send(${val});`);
        break;
      case 'text':
        this.emit(`return res.type('text').send(${val});`);
        break;
      case 'file':
        this.emit(`return res.sendFile(${val});`);
        break;
      default:
        this.emit(`return res.${node.method}(${val});`);
    }
  }

  visitTypedVar(node) {
    const keyword = node.isMut ? 'let' : 'const';
    const exp = node.isPublic ? 'export ' : '';
    this.emit(`${exp}${keyword} ${node.name} = ${this.expr(node.value)};`);
  }

  visitAssignment(node) {
    const target = this.expr(node.target);
    const value = this.expr(node.value);

    if (node.target.type === 'Array') {
      const names = node.target.elements.map(e => this.expr(e)).join(', ');
      this.emit(`const [${names}] = ${value};`);
    } else if (node.target.type === 'Object') {
      const names = node.target.properties.map(p => {
        if (p.type === 'shorthand') return p.key;
        return `${p.key}: ${this.expr(p.value)}`;
      }).join(', ');
      this.emit(`const { ${names} } = ${value};`);
    } else {
      this.emit(`${target} = ${value};`);
    }
  }

  visitCompoundAssign(node) {
    this.emit(`${this.expr(node.target)} ${node.op} ${this.expr(node.value)};`);
  }

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
      this.emit(`for (const [${node.key}, ${node.value}] of Object.entries(${collection})) {`);
    } else {
      this.emit(`for (const ${node.value} of ${collection}) {`);
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
    this.emit(`for (let ${varName} = ${start}; ${varName} < ${end}; ${varName}++) {`);
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
      const catchParam = node.catchVar || '_err';
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

  visitServer(node) {
    this.usesExpress = true;
    const hasWs = node.routes.some(r => r.type === 'WsDecl');

    this.emit(`import express from 'express';`);
    if (hasWs) {
      this.emit(`import { WebSocketServer } from 'ws';`);
    }
    this.emitRaw('');
    this.emit(`const ${node.name} = express();`);
    this.emit(`${node.name}.use(express.json());`);
    this.emit(`${node.name}.use(express.urlencoded({ extended: true }));`);
    this.emitRaw('');

    for (const mid of node.middleware) {
      this.emit(`${node.name}.use(${this.generateMiddleware(mid)});`);
      this.emitRaw('');
    }

    const wsNodes = [];
    const errorHandlers = [];

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(node.name, child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(node.name, child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(node.name, child);
      } else if (child.type === 'CorsDecl') {
        this.visitCors(node.name, child);
      } else if (child.type === 'LimitDecl') {
        this.visitLimit(node.name, child);
      } else if (child.type === 'StaticDecl') {
        this.visitStatic(node.name, child);
      } else if (child.type === 'WsDecl') {
        wsNodes.push(child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(node.name, child);
      } else if (child.type === 'ErrorHandler') {
        errorHandlers.push(child);
      } else if (child.type === 'CookieDecl') {
        this.visitCookie(node.name, child);
      } else if (child.type === 'UploadDecl') {
        this.visitUpload(node.name, child);
      } else if (child.type === 'SessionDecl') {
        this.visitSession(node.name, child);
      } else if (child.type === 'ViewDecl') {
        this.visitView(node.name, child);
      } else if (child.type === 'SseDecl') {
        this.visitSse(node.name, child);
      } else if (child.type === 'CacheDecl') {
        this.visitCache(node.name, child);
      } else if (child.type === 'MiddlewareRef') {
        this.visitMiddlewareRef(node.name, child);
      } else if (child.type === 'ValidateDecl') {
        this.visitValidate(node.name, child);
      } else if (child.type === 'OpenapiDecl') {
        this.visitOpenapi(node.name, child);
      } else if (child.type === 'QueueDecl') {
        this.visitQueue(child);
      } else if (child.type === 'GraphqlDecl') {
        this.visitGraphql(node.name, child);
      } else {
        this.visitStatement(child);
      }
    }

    for (const eh of errorHandlers) {
      this.visitErrorHandler(node.name, eh);
    }

    const port = node.port ? this.expr(node.port) : '3000';
    this.emitRaw('');
    if (hasWs) {
      this.emit(`const __server = ${node.name}.listen(${port}, () => {`);
    } else {
      this.emit(`${node.name}.listen(${port}, () => {`);
    }
    this.indent++;
    this.emit(`console.log(\`Server running on port \${${port}}\`);`);
    this.indent--;
    this.emit('});');

    for (const wsNode of wsNodes) {
      this.emitRaw('');
      this.visitWs(wsNode);
    }
  }

  visitBot(node) {
    const tokenExpr = node.token ? this.expr(node.token) : 'process.env.BOT_TOKEN';
    const botType = this.rawBotType(node.botType);

    if (botType === 'slack') return this.visitSlackBot(node, tokenExpr);
    if (botType === 'telegram') return this.visitTelegramBot(node, tokenExpr);
    if (botType === 'line') return this.visitLineBot(node, tokenExpr);
    return this.visitDiscordBot(node, tokenExpr);
  }

  rawBotType(bt) {
    if (!bt) return 'discord';
    return bt.raw || bt.parts?.map(p => p.value).join('') || 'discord';
  }

  visitDiscordBot(node, tokenExpr) {
    this.emit(`import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';`);
    this.emitRaw('');
    this.emit(`const ${node.name} = new Client({`);
    this.indent++;
    this.emit(`intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]`);
    this.indent--;
    this.emit(`});`);
    this.emitRaw('');

    const events = node.handlers.filter(h => h.type === 'BotEvent');
    const slashCmds = node.handlers.filter(h => h.type === 'BotSlashCmd');

    for (const evt of events) {
      const evtName = evt.event.raw || evt.event.parts?.map(p => p.value).join('');
      const discordEvent = evtName === 'message' ? 'messageCreate' : evtName;
      const params = evt.params.length > 0 ? evt.params.join(', ') : '';
      const needsAsync = this.bodyUsesAwait(evt.body);
      const asyncPrefix = needsAsync ? 'async ' : '';

      this.emit(`${node.name}.on('${discordEvent}', ${asyncPrefix}(${params}) => {`);
      this.indent++;
      for (const stmt of evt.body) this.visitStatement(stmt);
      this.indent--;
      this.emit(`});`);
      this.emitRaw('');
    }

    if (slashCmds.length > 0) {
      this.emit(`${node.name}.on('interactionCreate', async (interaction) => {`);
      this.indent++;
      this.emit(`if (!interaction.isChatInputCommand()) return;`);
      this.emitRaw('');

      for (const cmd of slashCmds) {
        const cmdName = cmd.name.raw || cmd.name.parts?.map(p => p.value).join('');
        const param = cmd.params.length > 0 ? cmd.params[0] : 'interaction';

        this.emit(`if (interaction.commandName === ${JSON.stringify(cmdName)}) {`);
        this.indent++;
        if (param !== 'interaction') {
          this.emit(`const ${param} = interaction;`);
        }
        for (const stmt of cmd.body) this.visitStatement(stmt);
        this.indent--;
        this.emit(`}`);
      }

      this.indent--;
      this.emit(`});`);
      this.emitRaw('');

      this.emit(`${node.name}.once('ready', async () => {`);
      this.indent++;
      this.emit(`const commands = [`);
      this.indent++;
      for (const cmd of slashCmds) {
        const cmdName = cmd.name.raw || cmd.name.parts?.map(p => p.value).join('');
        const desc = cmd.description.raw || cmd.description.parts?.map(p => p.value).join('');
        this.emit(`new SlashCommandBuilder().setName(${JSON.stringify(cmdName)}).setDescription(${JSON.stringify(desc)}),`);
      }
      this.indent--;
      this.emit(`];`);
      this.emit(`const rest = new REST().setToken(${tokenExpr});`);
      this.emit(`await rest.put(Routes.applicationCommands(${node.name}.user.id), { body: commands });`);
      this.indent--;
      this.emit(`});`);
      this.emitRaw('');
    }

    this.emit(`${node.name}.login(${tokenExpr});`);
    this.emitRaw('');
  }

  visitSlackBot(node, tokenExpr) {
    this.emit(`import pkg from '@slack/bolt';`);
    this.emit(`const { App: SlackApp } = pkg;`);
    this.emitRaw('');
    this.emit(`const ${node.name} = new SlackApp({`);
    this.indent++;
    this.emit(`token: ${tokenExpr},`);
    this.emit(`signingSecret: process.env.SLACK_SIGNING_SECRET,`);
    this.indent--;
    this.emit(`});`);
    this.emitRaw('');

    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        const params = handler.params.length > 0 ? handler.params.join(', ') : '';
        const needsAsync = this.bodyUsesAwait(handler.body);
        const asyncPrefix = needsAsync ? 'async ' : '';
        if (evtName === 'message') {
          this.emit(`${node.name}.message(${asyncPrefix}({ message, say${params ? ', ' + params : ''} }) => {`);
        } else {
          this.emit(`${node.name}.event('${evtName}', ${asyncPrefix}({ event${params ? ', ' + params : ''} }) => {`);
        }
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emit(`});`);
        this.emitRaw('');
      } else if (handler.type === 'BotSlashCmd') {
        const cmdName = handler.name.raw || handler.name.parts?.map(p => p.value).join('');
        this.emit(`${node.name}.command('/${cmdName}', async ({ command, ack, respond }) => {`);
        this.indent++;
        this.emit(`await ack();`);
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emit(`});`);
        this.emitRaw('');
      }
    }

    this.emit(`(async () => { await ${node.name}.start(3000); console.log('Slack bot running'); })();`);
    this.emitRaw('');
  }

  visitTelegramBot(node, tokenExpr) {
    this.emit(`import TelegramBot from 'node-telegram-bot-api';`);
    this.emitRaw('');
    this.emit(`const ${node.name} = new TelegramBot(${tokenExpr}, { polling: true });`);
    this.emitRaw('');

    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        const params = handler.params.length > 0 ? handler.params.join(', ') : 'msg';
        const needsAsync = this.bodyUsesAwait(handler.body);
        const asyncPrefix = needsAsync ? 'async ' : '';
        this.emit(`${node.name}.on('${evtName}', ${asyncPrefix}(${params}) => {`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emit(`});`);
        this.emitRaw('');
      } else if (handler.type === 'BotSlashCmd') {
        const cmdName = handler.name.raw || handler.name.parts?.map(p => p.value).join('');
        const param = handler.params.length > 0 ? handler.params[0] : 'msg';
        this.emit(`${node.name}.onText(/\\/${cmdName}/, async (${param}) => {`);
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emit(`});`);
        this.emitRaw('');
      }
    }
  }

  visitLineBot(node, tokenExpr) {
    this.emit(`import line from '@line/bot-sdk';`);
    this.emit(`import express from 'express';`);
    this.emitRaw('');
    this.emit(`const __lineConfig = { channelAccessToken: ${tokenExpr}, channelSecret: process.env.LINE_CHANNEL_SECRET };`);
    this.emit(`const ${node.name} = new line.messagingApi.MessagingApiClient({ channelAccessToken: ${tokenExpr} });`);
    this.emit(`const __lineApp = express();`);
    this.emitRaw('');

    this.emit(`__lineApp.post('/webhook', line.middleware(__lineConfig), (req, res) => {`);
    this.indent++;
    this.emit(`Promise.all(req.body.events.map(__handleLineEvent)).then(r => res.json(r));`);
    this.indent--;
    this.emit(`});`);
    this.emitRaw('');

    this.emit(`async function __handleLineEvent(event) {`);
    this.indent++;
    for (const handler of node.handlers) {
      if (handler.type === 'BotEvent') {
        const evtName = handler.event.raw || handler.event.parts?.map(p => p.value).join('');
        if (evtName === 'message') {
          this.emit(`if (event.type === 'message') {`);
        } else {
          this.emit(`if (event.type === '${evtName}') {`);
        }
        this.indent++;
        for (const stmt of handler.body) this.visitStatement(stmt);
        this.indent--;
        this.emit(`}`);
      }
    }
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
    this.emit(`__lineApp.listen(3000, () => console.log('LINE bot running on port 3000'));`);
    this.emitRaw('');
  }

  visitRoute(appName, route) {
    const method = route.method === 'del' ? 'delete' : route.method;
    const path = this.stringValue(route.path);
    const params = route.params.length > 0 ? route.params.join(', ') : 'req, res';

    const needsAsync = this.bodyUsesAwait(route.body);
    const asyncPrefix = needsAsync ? 'async ' : '';

    const midArgs = route.middleware && route.middleware.length > 0
      ? route.middleware.map(m => this.expr(m)).join(', ') + ', '
      : '';

    this.emit(`${appName}.${method}(${path}, ${midArgs}${asyncPrefix}(${params}) => {`);
    this.indent++;

    const hasRes = params.includes('res');
    const hasTryCatch = route.body.some(s => s.type === 'Try');

    if (needsAsync && !hasTryCatch) {
      this.emit('try {');
      this.indent++;
    }

    for (let i = 0; i < route.body.length; i++) {
      const stmt = route.body[i];
      if (stmt.type === 'Return' && stmt.value !== null) {
        if (hasRes || params === 'req, res') {
          this.emit(`res.json(${this.expr(stmt.value)});`);
        } else {
          this.emit(`return ${this.expr(stmt.value)};`);
        }
      } else {
        this.visitStatement(stmt);
      }
    }

    if (needsAsync && !hasTryCatch) {
      this.indent--;
      this.emit('} catch (__err) {');
      this.indent++;
      this.emit('if (!res.headersSent) res.status(500).json({ error: __err.message });');
      this.indent--;
      this.emit('}');
    }

    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  generateMiddleware(mid) {
    const params = mid.params.join(', ');
    let code = `(${params}) => {\n`;
    for (const stmt of mid.body) {
      code += '    ' + this.statementToString(stmt) + '\n';
    }
    code += '  }';
    return code;
  }

  visitModel(node) {
    this.models.set(node.name, node);

    const exp = node.isPublic ? 'export ' : '';
    const ext = node.parent ? ` extends ${node.parent}` : '';
    this.emit(`${exp}class ${node.name}${ext} {`);
    this.indent++;

    if (node.fields.length > 0 || node.parent) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const constructorParams = allFields.map(f => {
        if (f.defaultValue) return `${f.name} = ${this.expr(f.defaultValue)}`;
        return f.name;
      }).join(', ');

      this.emit(`constructor(${constructorParams}) {`);
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
    }

    for (const method of node.methods) {
      const async = method.isAsync ? 'async ' : '';
      const params = method.params.map(p => {
        let s = p.spread ? '...' : '';
        s += p.name;
        if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      this.emit(`${async}${method.name}(${params}) {`);
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

  visitOn(node) {
    const event = this.expr(node.event);
    if (node.event.type === 'MemberAccess') {
      const obj = this.expr(node.event.object);
      const evt = node.event.property;
      this.emit(`${obj}.on('${evt}', () => {`);
    } else {
      this.emit(`${event}(() => {`);
    }
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
  }

  visitLog(node) {
    const method = node.level === 'log' ? 'log' : node.level;
    const args = node.args.map(a => this.expr(a)).join(', ');
    this.emit(`console.${method}(${args});`);
  }

  visitThrow(node) {
    const value = this.expr(node.value);
    if (node.value.type === 'String') {
      this.emit(`throw new Error(${value});`);
    } else {
      this.emit(`throw ${value};`);
    }
  }

  visitDbConnect(node) {
    this.emit(`const db = new Database(${this.expr(node.connectionString)});`);
  }

  visitDbDir(node) {
    const raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'data/';
    this.dbDir = raw.endsWith('/') ? raw : raw + '/';
  }

  visitDbSql(node) {
    this.dbSql = true;
    const driverRaw = node.driver.raw || node.driver.parts?.map(p => p.value).join('') || 'sqlite';
    this.sqlDriver = driverRaw;

    if (driverRaw === 'sqlite') {
      this.emit(`import Database from 'better-sqlite3';`);
      const conn = node.connection ? this.stringValue(node.connection) : '"data.db"';
      this.emit(`const __db = new Database(${conn});`);
      this.emit(`__db.pragma('journal_mode = WAL');`);
    } else if (driverRaw === 'postgres' || driverRaw === 'pg') {
      this.emit(`import pg from 'pg';`);
      const conn = node.connection ? this.stringValue(node.connection) : 'process.env.DATABASE_URL';
      this.emit(`const __pool = new pg.Pool({ connectionString: ${conn} });`);
    }
    this.emitRaw('');
  }

  visitAwaitAllStatement(node) {
    const exprs = node.expressions.map(e => this.expr(e)).join(', ');
    this.emit(`await Promise.all([${exprs}]);`);
  }

  // ===== High-level features =====

  visitSchema(node) {
    this.runtimeImports.add('createSchema');
    if (this.dbDir) {
      this.runtimeImports.add('createFileStore');
    } else {
      this.runtimeImports.add('createStore');
    }

    this.emit(`const ${node.name}Schema = createSchema('${node.name}', {`);
    this.indent++;

    for (const field of node.fields) {
      const props = [];

      switch (field.type) {
        case 'auto':
          props.push("type: 'id'", 'auto: true');
          break;
        case 'timestamp':
          props.push("type: 'timestamp'");
          break;
        case 'str':
          props.push("type: 'string'");
          break;
        case 'int':
          props.push("type: 'integer'");
          break;
        case 'num':
          props.push("type: 'number'");
          break;
        case 'bool':
          props.push("type: 'boolean'");
          break;
        case 'enum':
          if (field.enumValues) {
            const vals = field.enumValues.map(v => this.expr(v)).join(', ');
            props.push("type: 'enum'", `values: [${vals}]`);
          } else {
            props.push("type: 'enum'");
          }
          break;
        default:
          props.push(`type: '${field.type}'`);
          break;
      }

      for (const mod of field.modifiers) {
        switch (mod.name) {
          case 'required': props.push('required: true'); break;
          case 'optional': props.push('required: false'); break;
          case 'unique': props.push('unique: true'); break;
          case 'email': props.push('email: true'); break;
          case 'url': props.push('url: true'); break;
          case 'auto': props.push('auto: true'); break;
          case 'min': props.push(`min: ${this.expr(mod.args[0])}`); break;
          case 'max': props.push(`max: ${this.expr(mod.args[0])}`); break;
          case 'default': props.push(`default: ${this.expr(mod.args[0])}`); break;
        }
      }

      this.emit(`${field.name}: { ${props.join(', ')} },`);
    }

    this.indent--;
    this.emit('});');
    if (this.dbSql && this.sqlDriver === 'sqlite') {
      this.runtimeImports.add('createSqliteStore');
      this.emit(`const ${node.name}Store = createSqliteStore(__db, '${node.name}', ${node.name}Schema);`);
    } else if (this.dbDir) {
      this.emit(`const ${node.name}Store = createFileStore(${node.name}Schema, '${this.dbDir}${node.name}.json');`);
    } else {
      this.emit(`const ${node.name}Store = createStore(${node.name}Schema);`);
    }
    this.emitRaw('');

    this.schemas.set(node.name, node);
  }

  visitCrud(appName, node) {
    this.runtimeImports.add('registerCrud');
    this.needsEventBus = true;

    const path = this.stringValue(node.path);
    this.emit(`registerCrud(${appName}, ${path}, ${node.schemaName}Schema, ${node.schemaName}Store, __eventBus);`);
    this.emitRaw('');
  }

  visitCrudTopLevel(node) {
    this.visitCrud('app', node);
  }

  visitAuth(appName, node) {
    this.runtimeImports.add('jwtAuth');

    const secret = this.expr(node.secret);
    this.authSecret = secret;

    this.emit(`const __authSecret = ${secret};`);

    const options = [];
    if (node.publicPaths.length > 0) {
      const paths = node.publicPaths.map(p => this.stringValue(p)).join(', ');
      options.push(`public: [${paths}]`);
    }
    const optStr = options.length > 0 ? `, { ${options.join(', ')} }` : '';

    if (node.protectedPaths.length > 0) {
      const path = this.normalizeRoutePath(this.stringValue(node.protectedPaths[0]));
      this.emit(`${appName}.use(${path}, jwtAuth(${secret}${optStr}));`);
    } else {
      this.emit(`${appName}.use(jwtAuth(${secret}${optStr}));`);
    }
    this.emitRaw('');
  }

  visitAuthTopLevel(node) {
    this.visitAuth('app', node);
  }

  visitCors(appName, node) {
    this.runtimeImports.add('corsMiddleware');

    const origins = this.expr(node.origins);
    if (node.origins.type === 'String') {
      this.emit(`${appName}.use(corsMiddleware([${origins}]));`);
    } else {
      this.emit(`${appName}.use(corsMiddleware(${origins}));`);
    }
    this.emitRaw('');
  }

  visitCorsTopLevel(node) {
    this.visitCors('app', node);
  }

  visitLimit(appName, node) {
    this.runtimeImports.add('rateLimit');

    const path = this.normalizeRoutePath(this.stringValue(node.path));
    const max = this.expr(node.max);
    const window = this.expr(node.window);
    this.emit(`${appName}.use(${path}, rateLimit(${max}, ${window}));`);
    this.emitRaw('');
  }

  visitLimitTopLevel(node) {
    this.visitLimit('app', node);
  }

  visitStatic(appName, node) {
    let raw = node.path.raw || node.path.parts?.map(p => p.value).join('') || 'public';
    if (raw.startsWith('/')) raw = raw.slice(1);
    this.emit(`${appName}.use(express.static(${JSON.stringify(raw)}));`);
    this.emitRaw('');
  }

  visitStaticTopLevel(node) {
    this.visitStatic('app', node);
  }

  visitWs(node) {
    const path = this.stringValue(node.path);
    this.emit(`const __wss = new WebSocketServer({ server: __server, path: ${path} });`);
    this.emit(`__wss.on('connection', (__ws) => {`);
    this.indent++;
    this.emit(`const send = (d) => __ws.send(typeof d === 'string' ? d : JSON.stringify(d));`);
    this.emit(`const broadcast = (d) => { const m = typeof d === 'string' ? d : JSON.stringify(d); for (const c of __wss.clients) if (c.readyState === 1) c.send(m); };`);

    const connectEvents = node.events.filter(e => {
      const name = e.name.raw || e.name.parts?.map(p => p.value).join('');
      return name === 'connect' || name === 'open';
    });
    const otherEvents = node.events.filter(e => {
      const name = e.name.raw || e.name.parts?.map(p => p.value).join('');
      return name !== 'connect' && name !== 'open';
    });

    for (const evt of connectEvents) {
      this.emitRaw('');
      for (const stmt of evt.body) this.visitStatement(stmt);
    }

    for (const evt of otherEvents) {
      const evtName = evt.name.raw || evt.name.parts?.map(p => p.value).join('');
      this.emitRaw('');

      if (evtName === 'message') {
        const needsAsync = this.bodyUsesAwait(evt.body);
        const asyncPrefix = needsAsync ? 'async ' : '';
        this.emit(`__ws.on('message', ${asyncPrefix}(__raw) => {`);
        this.indent++;
        const dataParam = evt.params[0] || 'data';
        this.emit(`const ${dataParam} = JSON.parse(__raw);`);
        for (const stmt of evt.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('});');
      } else {
        const params = evt.params.length > 0 ? evt.params.join(', ') : '';
        const needsAsync = this.bodyUsesAwait(evt.body);
        const asyncPrefix = needsAsync ? 'async ' : '';
        this.emit(`__ws.on('${evtName}', ${asyncPrefix}(${params}) => {`);
        this.indent++;
        for (const stmt of evt.body) this.visitStatement(stmt);
        this.indent--;
        this.emit('});');
      }
    }

    this.indent--;
    this.emit('});');
  }

  visitWsTopLevel(node) {
    this.visitWs(node);
  }

  visitGroup(appName, node) {
    const prefix = this.stringValue(node.prefix);
    this.groupCounter = (this.groupCounter || 0) + 1;
    const routerName = `__router${this.groupCounter}`;
    this.emit(`const ${routerName} = express.Router();`);

    for (const child of node.routes) {
      if (child.type === 'Route') {
        this.visitRoute(routerName, child);
      } else if (child.type === 'CrudDecl') {
        this.visitCrud(routerName, child);
      } else if (child.type === 'AuthDecl') {
        this.visitAuth(routerName, child);
      } else if (child.type === 'GroupDecl') {
        this.visitGroup(routerName, child);
      } else {
        this.visitStatement(child);
      }
    }

    this.emit(`${appName}.use(${prefix}, ${routerName});`);
    this.emitRaw('');
  }

  visitGroupTopLevel(node) {
    this.visitGroup('app', node);
  }

  visitErrorHandler(appName, node) {
    const params = node.params.join(', ');
    this.emit(`${appName}.use((${params}, next) => {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitErrorHandlerTopLevel(node) {
    this.visitErrorHandler('app', node);
  }

  visitCookie(appName, node) {
    this.runtimeImports.add('cookieParser');
    this.emit(`${appName}.use(cookieParser());`);
    this.emitRaw('');
  }

  visitCookieTopLevel(node) {
    this.visitCookie('app', node);
  }

  visitUpload(appName, node) {
    this.runtimeImports.add('uploadMiddleware');
    const path = this.stringValue(node.path);
    const field = this.stringValue(node.fieldName);
    const params = node.params.length > 0 ? node.params.join(', ') : 'req, res';
    const needsAsync = this.bodyUsesAwait(node.body);
    const asyncPrefix = needsAsync ? 'async ' : '';
    this.emit(`${appName}.post(${path}, uploadMiddleware(${field}), ${asyncPrefix}(${params}) => {`);
    this.indent++;
    for (const stmt of node.body) {
      if (stmt.type === 'Return' && stmt.value !== null) {
        this.emit(`res.json(${this.expr(stmt.value)});`);
      } else {
        this.visitStatement(stmt);
      }
    }
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitUploadTopLevel(node) {
    this.visitUpload('app', node);
  }

  visitSession(appName, node) {
    this.runtimeImports.add('sessionMiddleware');
    const secret = this.expr(node.secret);
    this.emit(`${appName}.use(sessionMiddleware(${secret}));`);
    this.emitRaw('');
  }

  visitSessionTopLevel(node) {
    this.visitSession('app', node);
  }

  visitView(appName, node) {
    this.runtimeImports.add('createRenderer');
    const dir = this.stringValue(node.dir);
    this.emit(`const __render = createRenderer(${dir});`);
    this.emitRaw('');
  }

  visitViewTopLevel(node) {
    this.visitView('app', node);
  }

  visitSse(appName, node) {
    this.runtimeImports.add('createSseManager');
    const path = this.stringValue(node.path);
    this.emit(`const sse = createSseManager();`);
    this.emit(`${appName}.get(${path}, sse.handler());`);
    this.emitRaw('');
  }

  visitSseTopLevel(node) {
    this.visitSse('app', node);
  }

  visitCache(appName, node) {
    this.runtimeImports.add('cacheMiddleware');
    const path = this.normalizeRoutePath(this.stringValue(node.path));
    const duration = this.expr(node.duration);
    this.emit(`${appName}.use(${path}, cacheMiddleware(${duration}));`);
    this.emitRaw('');
  }

  visitCacheTopLevel(node) {
    this.visitCache('app', node);
  }

  visitMiddlewareRef(appName, node) {
    if (node.path) {
      this.emit(`${appName}.use(${this.stringValue(node.path)}, ${node.name});`);
    } else {
      this.emit(`${appName}.use(${node.name});`);
    }
    this.emitRaw('');
  }

  visitMiddlewareRefTopLevel(node) {
    this.visitMiddlewareRef('app', node);
  }

  visitReturnRender(node) {
    const template = this.expr(node.template);
    const data = node.data ? this.expr(node.data) : '{}';
    this.emit(`return res.type('html').send(__render(${template}, ${data}));`);
  }

  visitReturnRedirect(node) {
    this.emit(`return res.redirect(${this.expr(node.statusCode)}, ${this.expr(node.url)});`);
  }

  visitReturnDownload(node) {
    this.emit(`return res.download(${this.expr(node.filePath)}, ${this.expr(node.filename)});`);
  }

  visitValidate(appName, node) {
    this.runtimeImports.add('validateMiddleware');
    const path = this.normalizeRoutePath(this.stringValue(node.path));
    this.emit(`${appName}.use(${path}, validateMiddleware(${node.schemaName}Schema));`);
    this.emitRaw('');
  }

  visitValidateTopLevel(node) {
    this.visitValidate('app', node);
  }

  visitTest(node) {
    this.hasTests = true;
    const name = this.expr(node.name);
    const needsAsync = this.bodyUsesAwait(node.body);
    const asyncPrefix = needsAsync ? 'async ' : '';
    this.emit(`test(${name}, ${asyncPrefix}() => {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitAssert(node) {
    this.hasAsserts = true;
    const exprNode = node.expr;
    if (exprNode.type === 'Binary' && exprNode.op === '===') {
      this.emit(`assert.strictEqual(${this.expr(exprNode.left)}, ${this.expr(exprNode.right)});`);
    } else if (exprNode.type === 'Binary' && exprNode.op === '!==') {
      this.emit(`assert.notStrictEqual(${this.expr(exprNode.left)}, ${this.expr(exprNode.right)});`);
    } else {
      this.emit(`assert.ok(${this.expr(exprNode)});`);
    }
  }

  visitQueue(node) {
    this.runtimeImports.add('createQueue');
    this.emit(`const ${node.name} = createQueue();`);
    for (const job of node.jobs) {
      const params = job.params.length > 0 ? job.params.join(', ') : 'data';
      const needsAsync = this.bodyUsesAwait(job.body);
      const asyncPrefix = needsAsync ? 'async ' : '';
      this.emit(`${node.name}.register(${this.generateString(job.name)}, ${asyncPrefix}(${params}) => {`);
      this.indent++;
      for (const stmt of job.body) this.visitStatement(stmt);
      this.indent--;
      this.emit('});');
    }
    this.emitRaw('');
  }

  visitPrompt(node) {
    this.runtimeImports.add('createPrompt');
    const lines = node.lines.map(l => this.generateString(l));
    const template = lines.length === 1 ? lines[0] : `${lines.join(' + "\\n" + ')}`;
    const defaults = node.defaults ? this.expr(node.defaults) : '{}';
    this.emit(`const ${node.name} = createPrompt(${template}, ${defaults});`);
    this.emitRaw('');
  }

  visitOpenapi(appName, node) {
    this.runtimeImports.add('buildOpenApiSpec');
    const path = this.stringValue(node.path);
    const schemaNames = [...this.schemas.keys()];
    const schemaArgs = schemaNames.map(n => `${n}Schema`).join(', ');
    this.emit(`${appName}.get(${path}, (req, res) => {`);
    this.indent++;
    this.emit(`res.json(buildOpenApiSpec([${schemaArgs}]));`);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitOpenapiTopLevel(node) {
    this.visitOpenapi('app', node);
  }

  visitEnv(node) {
    this.runtimeImports.add('loadEnv');

    const names = node.vars.map(v => v.name);
    this.emit(`const { ${names.join(', ')} } = loadEnv({`);
    this.indent++;

    for (const v of node.vars) {
      const props = [];

      switch (v.type) {
        case 'str': props.push("type: 'string'"); break;
        case 'int': props.push("type: 'integer'"); break;
        case 'num': props.push("type: 'number'"); break;
        case 'bool': props.push("type: 'boolean'"); break;
        default: props.push(`type: '${v.type}'`); break;
      }

      for (const mod of v.modifiers) {
        switch (mod.name) {
          case 'required': props.push('required: true'); break;
          case 'default': props.push(`default: ${this.expr(mod.args[0])}`); break;
        }
      }

      this.emit(`${v.name}: { ${props.join(', ')} },`);
    }

    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitEvery(node) {
    const interval = this.expr(node.interval);
    const needsAsync = this.bodyUsesAwait(node.body);
    const asyncPrefix = needsAsync ? 'async ' : '';

    let raw = '';
    if (node.interval.type === 'String' && node.interval.value) {
      raw = node.interval.value.raw || node.interval.value.parts?.map(p => p.value).join('') || '';
    }
    const isCron = /^[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+/.test(raw.trim());

    if (isCron) {
      this.emit(`import cron from 'node-cron';`);
      this.emitRaw('');
      this.emit(`cron.schedule(${interval}, ${asyncPrefix}() => {`);
    } else {
      this.runtimeImports.add('scheduleEvery');
      this.emit(`scheduleEvery(${interval}, ${asyncPrefix}() => {`);
    }
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  visitWatch(node) {
    this.needsEventBus = true;

    const params = node.params.length > 0 ? node.params.join(', ') : 'event';
    const needsAsync = this.bodyUsesAwait(node.body);
    const asyncPrefix = needsAsync ? 'async ' : '';

    this.emit(`__eventBus.on('${node.eventName}', ${asyncPrefix}(${params}) => {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('});');
    this.emitRaw('');
  }

  // ===== Page (Frontend HTML) =====

  visitPage(node) {
    const filename = this.rawPageString(node.filename);
    this.emit(`import { writeFileSync } from 'fs';`);
    this.emitRaw('');

    const headParts = [];
    const bodyParts = [];
    let pageTitle = 'NAIDE Page';

    for (const el of node.elements) {
      this.classifyPageElement(el, headParts, bodyParts, (t) => { pageTitle = t; });
    }

    this.emit(`writeFileSync(${JSON.stringify(filename)}, \`<!DOCTYPE html>`);
    this.emit(`<html lang="en">`);
    this.emit(`<head>`);
    this.emit(`<meta charset="UTF-8">`);
    this.emit(`<meta name="viewport" content="width=device-width, initial-scale=1.0">`);
    this.emit(`<title>\${${JSON.stringify(pageTitle)}}</title>`);
    for (const h of headParts) this.emit(h);
    this.emit(`</head>`);
    this.emit(`<body>`);
    for (const b of bodyParts) this.emit(b);
    this.emit(`</body>`);
    this.emit(`</html>\`);`);
    this.emitRaw('');
  }

  classifyPageElement(el, head, body, setTitle) {
    const tag = el.tag;
    const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
    const arg1 = el.args[1] ? this.rawPageString(el.args[1]) : '';

    if (tag === 'title') { setTitle(arg0); return; }
    if (tag === 'style') { head.push(`<link rel="stylesheet" href="${arg0}">`); return; }
    if (tag === 'meta') { head.push(`<meta name="${arg0}" content="${arg1}">`); return; }
    if (tag === 'script') { body.push(`<script src="${arg0}"></script>`); return; }
    if (tag === 'link') { head.push(`<link rel="stylesheet" href="${arg0}">`); return; }
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
    const name = node.name;
    const desc = node.description ? this.rawPageString(node.description) : name;

    this.emit(`const __argv = process.argv.slice(2);`);
    this.emit(`const args = {};`);
    this.emitRaw('');

    this.emit(`if (__argv.includes('--help') || __argv.includes('-h')) {`);
    this.indent++;
    this.emit(`console.log(${JSON.stringify(desc)});`);
    this.emit(`console.log('Options:');`);
    for (const arg of node.args) {
      const argName = this.rawPageString(arg.name);
      const argDesc = arg.description ? this.rawPageString(arg.description) : '';
      this.emit(`console.log('  --${argName} <${arg.type}>  ${argDesc}');`);
    }
    for (const flag of node.flags) {
      const s = this.rawPageString(flag.short);
      const l = this.rawPageString(flag.long);
      const d = flag.description ? this.rawPageString(flag.description) : '';
      this.emit(`console.log('  -${s}, --${l}  ${d}');`);
    }
    this.emit(`process.exit(0);`);
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');

    this.emit(`for (let __i = 0; __i < __argv.length; __i++) {`);
    this.indent++;
    for (const arg of node.args) {
      const argName = this.rawPageString(arg.name);
      const coerce = arg.type === 'int' ? 'parseInt(__argv[++__i])' :
                     arg.type === 'num' ? 'parseFloat(__argv[++__i])' :
                     arg.type === 'bool' ? 'true' : '__argv[++__i]';
      this.emit(`if (__argv[__i] === '--${argName}') { args.${argName} = ${coerce}; continue; }`);
    }
    for (const flag of node.flags) {
      const s = this.rawPageString(flag.short);
      const l = this.rawPageString(flag.long);
      this.emit(`if (__argv[__i] === '-${s}' || __argv[__i] === '--${l}') { args.${l} = true; continue; }`);
    }
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');

    if (node.run) {
      const runParam = node.run.params.length > 0 ? node.run.params[0] : 'args';
      if (runParam !== 'args') {
        this.emit(`const ${runParam} = args;`);
      }
      for (const stmt of node.run.body) this.visitStatement(stmt);
    }
    this.emitRaw('');
  }

  // ===== Mail =====

  visitMail(node) {
    const host = this.generateString(node.host);
    const port = this.expr(node.port);
    const user = node.user ? this.expr(node.user) : 'process.env.MAIL_USER';
    const pass = node.pass ? this.expr(node.pass) : 'process.env.MAIL_PASS';

    this.emit(`import nodemailer from 'nodemailer';`);
    this.emitRaw('');
    this.emit(`const mail = nodemailer.createTransport({`);
    this.indent++;
    this.emit(`host: ${host},`);
    this.emit(`port: ${port},`);
    this.emit(`secure: ${port} === 465,`);
    this.emit(`auth: { user: ${user}, pass: ${pass} },`);
    this.indent--;
    this.emit(`});`);
    this.emitRaw('');
  }

  // ===== GraphQL =====

  visitGraphql(appName, node) {
    const path = this.stringValue(node.path);

    this.emit(`import { buildSchema } from 'graphql';`);
    this.emit(`import { createHandler } from 'graphql-http/lib/use/express';`);
    this.emitRaw('');

    const schemaNames = [...this.schemas.keys()];
    if (schemaNames.length > 0) {
      let schemaDef = '';
      for (const name of schemaNames) {
        const schema = this.schemas.get(name);
        const fields = schema.fields.map(f => {
          const gqlType = this.toGraphqlType(f.type);
          return `  ${f.name}: ${gqlType}`;
        }).join('\\n');
        schemaDef += `type ${name} {\\n${fields}\\n}\\n`;
      }
      schemaDef += `type Query {\\n`;
      for (const name of schemaNames) {
        schemaDef += `  ${name.toLowerCase()}s: [${name}]\\n`;
        schemaDef += `  ${name.toLowerCase()}(id: ID): ${name}\\n`;
      }
      schemaDef += `}`;

      this.emit(`const __graphqlSchema = buildSchema(\`${schemaDef}\`);`);
      this.emit(`const __graphqlRoot = {`);
      this.indent++;
      for (const name of schemaNames) {
        this.emit(`${name.toLowerCase()}s: () => ${name}Store.getAll(),`);
        this.emit(`${name.toLowerCase()}: ({ id }) => ${name}Store.getById(id),`);
      }
      this.indent--;
      this.emit(`};`);
    } else {
      this.emit(`const __graphqlSchema = buildSchema(\`type Query { hello: String }\`);`);
      this.emit(`const __graphqlRoot = { hello: () => 'Hello from NAIDE GraphQL' };`);
    }

    this.emit(`${appName}.all(${path}, createHandler({ schema: __graphqlSchema, rootValue: __graphqlRoot }));`);
    this.emitRaw('');
  }

  toGraphqlType(naideType) {
    const map = { 'str': 'String', 'int': 'Int', 'num': 'Float', 'bool': 'Boolean', 'auto': 'ID', 'timestamp': 'String', 'enum': 'String' };
    return map[naideType] || 'String';
  }

  // ===== Desktop (Electron) =====

  visitDesktop(node) {
    const title = node.title ? this.rawPageString(node.title) : node.name;
    const width = node.width ? this.expr(node.width) : '800';
    const height = node.height ? this.expr(node.height) : '600';
    const load = node.load ? this.expr(node.load) : '"index.html"';

    this.emit(`import { app, BrowserWindow } from 'electron';`);
    this.emitRaw('');
    this.emit(`function createWindow() {`);
    this.indent++;
    this.emit(`const ${node.name} = new BrowserWindow({`);
    this.indent++;
    this.emit(`width: ${width},`);
    this.emit(`height: ${height},`);
    this.emit(`title: ${JSON.stringify(title)},`);
    this.emit(`webPreferences: { nodeIntegration: true, contextIsolation: false },`);
    this.indent--;
    this.emit(`});`);
    this.emit(`${node.name}.loadFile(${load});`);
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
    this.emit(`app.whenReady().then(createWindow);`);
    this.emit(`app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });`);
    this.emit(`app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });`);
    this.emitRaw('');
  }

  // ===== Screen (React Native) =====

  visitScreen(node) {
    const imports = new Set(['View', 'StyleSheet']);
    const elements = [];

    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? this.rawPageString(el.args[0]) : '';
      if (tag === 'text') { imports.add('Text'); elements.push({ jsx: `<Text>${arg0}</Text>` }); }
      else if (tag === 'button') { imports.add('Button'); elements.push({ jsx: `<Button title="${arg0}" onPress={() => { ${this.screenBodyToJs(el.body)} }} />` }); }
      else if (tag === 'input') { imports.add('TextInput'); elements.push({ jsx: `<TextInput placeholder="${arg0}" style={styles.input} />` }); }
      else if (tag === 'image') { imports.add('Image'); elements.push({ jsx: `<Image source={require('${arg0}')} style={styles.image} />` }); }
      else { imports.add('Text'); elements.push({ jsx: `<Text>${arg0}</Text>` }); }
    }

    this.emit(`import React from 'react';`);
    this.emit(`import { ${[...imports].join(', ')} } from 'react-native';`);
    this.emitRaw('');
    this.emit(`export function ${node.name}() {`);
    this.indent++;
    this.emit(`return (`);
    this.indent++;
    this.emit(`<View style={styles.container}>`);
    this.indent++;
    for (const el of elements) this.emit(el.jsx);
    this.indent--;
    this.emit(`</View>`);
    this.indent--;
    this.emit(`);`);
    this.indent--;
    this.emit(`}`);
    this.emitRaw('');
    this.emit(`const styles = StyleSheet.create({`);
    this.indent++;
    this.emit(`container: { flex: 1, padding: 16, justifyContent: 'center' },`);
    this.emit(`input: { borderWidth: 1, borderColor: '#ccc', padding: 8, marginVertical: 4, borderRadius: 4 },`);
    this.emit(`image: { width: 200, height: 200, alignSelf: 'center' },`);
    this.indent--;
    this.emit(`});`);
    this.emitRaw('');
  }

  screenBodyToJs(body) {
    if (!body || body.length === 0) return '';
    const saved = this.output;
    const savedIndent = this.indent;
    this.output = [];
    this.indent = 0;
    for (const stmt of body) this.visitStatement(stmt);
    const result = this.output.join(' ');
    this.output = saved;
    this.indent = savedIndent;
    return result;
  }

  // ===== Expression generation =====

  expr(node) {
    if (!node) return 'undefined';

    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return this.generateString(node.value);
      case 'Bool': return node.value ? 'true' : 'false';
      case 'Null': return 'null';
      case 'Self': return 'this';
      case 'Identifier': return node.name;

      case 'Binary': {
        const l = this.expr(node.left);
        const r = this.expr(node.right);
        const simple = node.left.type !== 'Binary' && node.right.type !== 'Binary';
        return simple ? `${l} ${node.op} ${r}` : `(${l} ${node.op} ${r})`;
      }

      case 'Unary':
        return `${node.op}${this.expr(node.expr)}`;

      case 'Await':
        return `await ${this.expr(node.expr)}`;

      case 'AwaitAllExpr':
        return `await Promise.all(${this.expr(node.expr)})`;

      case 'Spread':
        return `...${this.expr(node.expr)}`;

      case 'New':
        return `new ${this.expr(node.expr)}`;

      case 'TypeOf':
        return `typeof ${this.expr(node.expr)}`;

      case 'MemberAccess':
        return `${this.expr(node.object)}.${node.property}`;

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
          if (p.type === 'shorthand') return p.key;
          if (typeof p.key === 'string') return `${p.key}: ${this.expr(p.value)}`;
          if (p.key.type === 'String') return `${this.generateString(p.key.value)}: ${this.expr(p.value)}`;
          if (p.key.type === 'Computed') return `[${this.expr(p.key.expr)}]: ${this.expr(p.value)}`;
          return `${this.expr(p.key)}: ${this.expr(p.value)}`;
        }).join(', ');
        return `{ ${props} }`;
      }

      case 'ArrowFn': {
        const params = node.params.map(p => p.name).join(', ');
        const body = this.expr(node.body);
        const wrappedBody = node.body.type === 'Object' ? `(${body})` : body;
        if (node.params.length === 1) return `${params} => ${wrappedBody}`;
        return `(${params}) => ${wrappedBody}`;
      }

      case 'Lambda': {
        const async = node.isAsync ? 'async ' : '';
        const params = node.params.map(p => p.name).join(', ');
        const bodyLines = [];
        const savedOutput = this.output;
        const savedIndent = this.indent;
        this.output = bodyLines;
        this.indent = 0;
        for (const stmt of node.body) this.visitStatement(stmt);
        this.output = savedOutput;
        this.indent = savedIndent;
        return `${async}function(${params}) { ${bodyLines.join(' ')} }`;
      }

      case 'Ternary':
        return `(${this.expr(node.condition)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)})`;

      case 'Pipe':
        return this.generatePipe(node);

      default:
        return `/* expr:${node.type} */`;
    }
  }

  generateCall(node) {
    const AUTO_IMPORT = { 'hash': 'hash', 'verify': 'verify', 'uuid': 'uuid',
      'createMock': 'createMock', 'createSpy': 'createSpy',
      'registerPlugin': 'registerPlugin', 'usePlugin': 'usePlugin' };

    if (node.callee.type === 'Identifier' && AUTO_IMPORT[node.callee.name]) {
      const runtimeFn = AUTO_IMPORT[node.callee.name];
      this.runtimeImports.add(runtimeFn);
      return `${runtimeFn}(${node.args.map(a => this.expr(a)).join(', ')})`;
    }

    if (node.callee.type === 'Identifier' && node.callee.name === 'sign') {
      this.runtimeImports.add('jwtSign');
      const args = node.args.map(a => this.expr(a));
      if (args.length === 1 && this.authSecret) {
        return `jwtSign(${args[0]}, __authSecret)`;
      }
      return `jwtSign(${args.join(', ')})`;
    }

    if (node.callee.type === 'MemberAccess' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'api') {
      this.runtimeImports.add('api');
    }

    if (node.callee.type === 'MemberAccess' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'ai') {
      this.runtimeImports.add('ai');
    }

    if (node.callee.type === 'MemberAccess' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'auth') {
      if (node.callee.property === 'sign') {
        this.runtimeImports.add('jwtSign');
        const args = node.args.map(a => this.expr(a));
        if (args.length === 1 && this.authSecret) {
          return `jwtSign(${args[0]}, __authSecret)`;
        }
        return `jwtSign(${args.join(', ')})`;
      }
      if (node.callee.property === 'verify') {
        this.runtimeImports.add('jwtVerify');
        return `jwtVerify(${node.args.map(a => this.expr(a)).join(', ')})`;
      }
    }

    return `${this.expr(node.callee)}(${node.args.map(a => this.expr(a)).join(', ')})`;
  }

  generateString(strData) {
    if (!strData || !strData.parts) return '""';

    const hasInterpolation = strData.parts.some(p => p.type === 'expr');

    if (!hasInterpolation) {
      const raw = strData.parts.map(p => p.value).join('');
      return JSON.stringify(raw);
    }

    let result = '`';
    for (const part of strData.parts) {
      if (part.type === 'text') {
        result += part.value.replace(/`/g, '\\`').replace(/\$/g, '\\$');
      } else {
        const exprCode = part.value.replace(/\bself\b/g, 'this');
        result += '${' + exprCode + '}';
      }
    }
    result += '`';
    return result;
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

    const ARRAY_METHODS = new Set(['filter', 'map', 'reduce', 'find', 'findIndex', 'some', 'every', 'flat', 'flatMap', 'sort', 'reverse', 'slice', 'splice', 'join', 'includes', 'indexOf', 'forEach']);

    let result = this.expr(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'Call' && step.callee.type === 'Identifier' && ARRAY_METHODS.has(step.callee.name)) {
        const args = step.args.map(a => this.expr(a)).join(', ');
        result = `${result}.${step.callee.name}(${args})`;
      } else if (step.type === 'Identifier' && ARRAY_METHODS.has(step.name)) {
        result = `${result}.${step.name}()`;
      } else if (step.type === 'Call') {
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

  // ===== OAuth =====

  visitOauth(node) {
    const provider = this.rawPageString(node.provider);
    const clientId = this.expr(node.clientId);
    const clientSecret = this.expr(node.clientSecret);
    const callback = node.callback ? this.rawPageString(node.callback) : '/auth/callback';
    const scope = node.scope ? this.rawPageString(node.scope) : 'email profile';

    if (provider === 'google') {
      this.emit(`import passport from 'passport';`);
      this.emit(`import { Strategy as GoogleStrategy } from 'passport-google-oauth20';`);
      this.emitRaw('');
      this.emit(`passport.use(new GoogleStrategy({`);
      this.indent++;
      this.emit(`clientID: ${clientId},`);
      this.emit(`clientSecret: ${clientSecret},`);
      this.emit(`callbackURL: ${JSON.stringify(callback)},`);
      this.indent--;
      this.emit(`}, (accessToken, refreshToken, profile, done) => done(null, profile)));`);
    } else if (provider === 'github') {
      this.emit(`import passport from 'passport';`);
      this.emit(`import { Strategy as GitHubStrategy } from 'passport-github2';`);
      this.emitRaw('');
      this.emit(`passport.use(new GitHubStrategy({`);
      this.indent++;
      this.emit(`clientID: ${clientId},`);
      this.emit(`clientSecret: ${clientSecret},`);
      this.emit(`callbackURL: ${JSON.stringify(callback)},`);
      this.indent--;
      this.emit(`}, (accessToken, refreshToken, profile, done) => done(null, profile)));`);
    } else {
      this.emit(`import passport from 'passport';`);
      this.emit(`// Configure ${provider} OAuth strategy`);
    }

    this.emit(`passport.serializeUser((user, done) => done(null, user));`);
    this.emit(`passport.deserializeUser((user, done) => done(null, user));`);
    this.emitRaw('');
  }

  // ===== Pay (Stripe) =====

  visitPay(node) {
    const provider = this.rawPageString(node.provider);
    const secretKey = this.expr(node.secretKey);
    const webhook = node.webhook ? this.rawPageString(node.webhook) : '/webhook';

    if (provider === 'stripe') {
      this.emit(`import Stripe from 'stripe';`);
      this.emit(`const stripe = new Stripe(${secretKey});`);
      this.emitRaw('');
      this.emit(`const pay = {`);
      this.indent++;
      this.emit(`async checkout(items, successUrl, cancelUrl) {`);
      this.indent++;
      this.emit(`return stripe.checkout.sessions.create({`);
      this.indent++;
      this.emit(`line_items: items.map(i => ({ price_data: { currency: 'usd', product_data: { name: i.name }, unit_amount: i.price }, quantity: i.qty || 1 })),`);
      this.emit(`mode: 'payment',`);
      this.emit(`success_url: successUrl || ${node.successUrl ? this.expr(node.successUrl) : "'http://localhost:3000/success'"},`);
      this.emit(`cancel_url: cancelUrl || ${node.cancelUrl ? this.expr(node.cancelUrl) : "'http://localhost:3000/cancel'"},`);
      this.indent--;
      this.emit(`});`);
      this.indent--;
      this.emit(`},`);
      this.emit(`async verify(body, sig) {`);
      this.indent++;
      this.emit(`return stripe.webhooks.constructEvent(body, sig, ${secretKey});`);
      this.indent--;
      this.emit(`},`);
      this.indent--;
      this.emit(`};`);
    } else {
      this.emit(`// ${provider} payment integration`);
      this.emit(`const pay = {};`);
    }
    this.emitRaw('');
  }

  // ===== Storage (S3) =====

  visitStorage(node) {
    const provider = this.rawPageString(node.provider);
    const bucket = this.expr(node.bucket);
    const accessKey = this.expr(node.accessKey);
    const secretKey = this.expr(node.secretKey);
    const region = node.region ? this.rawPageString(node.region) : 'us-east-1';

    if (provider === 's3') {
      this.emit(`import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';`);
      this.emitRaw('');
      this.emit(`const __s3 = new S3Client({`);
      this.indent++;
      this.emit(`region: ${JSON.stringify(region)},`);
      this.emit(`credentials: { accessKeyId: ${accessKey}, secretAccessKey: ${secretKey} },`);
      this.indent--;
      this.emit(`});`);
      this.emitRaw('');
      this.emit(`const storage = {`);
      this.indent++;
      this.emit(`async upload(key, body, contentType = 'application/octet-stream') {`);
      this.indent++;
      this.emit(`return __s3.send(new PutObjectCommand({ Bucket: ${bucket}, Key: key, Body: body, ContentType: contentType }));`);
      this.indent--;
      this.emit(`},`);
      this.emit(`async download(key) {`);
      this.indent++;
      this.emit(`const res = await __s3.send(new GetObjectCommand({ Bucket: ${bucket}, Key: key }));`);
      this.emit(`return res.Body;`);
      this.indent--;
      this.emit(`},`);
      this.emit(`async remove(key) {`);
      this.indent++;
      this.emit(`return __s3.send(new DeleteObjectCommand({ Bucket: ${bucket}, Key: key }));`);
      this.indent--;
      this.emit(`},`);
      this.indent--;
      this.emit(`};`);
    } else if (provider === 'gcs') {
      this.emit(`import { Storage } from '@google-cloud/storage';`);
      this.emit(`const __gcs = new Storage();`);
      this.emit(`const __bucket = __gcs.bucket(${bucket});`);
      this.emit(`const storage = {`);
      this.indent++;
      this.emit(`async upload(key, body) { await __bucket.file(key).save(body); },`);
      this.emit(`async download(key) { const [buf] = await __bucket.file(key).download(); return buf; },`);
      this.emit(`async remove(key) { await __bucket.file(key).delete(); },`);
      this.indent--;
      this.emit(`};`);
    } else {
      this.emit(`// ${provider} storage integration`);
      this.emit(`const storage = {};`);
    }
    this.emitRaw('');
  }

  // ===== PDF =====

  visitPdf(node) {
    const filename = this.rawPageString(node.filename);
    this.emit(`import PDFDocument from 'pdfkit';`);
    this.emit(`import { createWriteStream } from 'fs';`);
    this.emitRaw('');
    this.emit(`const __pdf = new PDFDocument();`);
    this.emit(`__pdf.pipe(createWriteStream(${JSON.stringify(filename)}));`);

    for (const el of node.elements) {
      const tag = el.tag;
      const arg0 = el.args[0] ? (el.args[0].raw !== undefined ? JSON.stringify(el.args[0].raw || el.args[0].parts?.map(p => p.value).join('')) : this.expr(el.args[0])) : '""';
      if (tag === 'title') {
        this.emit(`__pdf.fontSize(24).text(${arg0});`);
        this.emit(`__pdf.moveDown();`);
      } else if (tag === 'heading' || tag === 'h1' || tag === 'h2') {
        const size = tag === 'h1' ? 20 : 16;
        this.emit(`__pdf.fontSize(${size}).text(${arg0});`);
        this.emit(`__pdf.moveDown();`);
      } else if (tag === 'text' || tag === 'p') {
        this.emit(`__pdf.fontSize(12).text(${arg0});`);
      } else if (tag === 'image') {
        this.emit(`__pdf.image(${arg0}, { width: 300 });`);
      } else if (tag === 'line') {
        this.emit(`__pdf.moveTo(50, __pdf.y).lineTo(550, __pdf.y).stroke();`);
        this.emit(`__pdf.moveDown();`);
      } else if (tag === 'table') {
        this.emit(`// table: ${arg0}`);
      } else {
        this.emit(`__pdf.text(${arg0});`);
      }
    }

    this.emit(`__pdf.end();`);
    this.emit(`console.log('Generated: ${filename}');`);
    this.emitRaw('');
  }

  // ===== i18n =====

  visitI18n(node) {
    const dir = this.rawPageString(node.dir);
    const defaultLang = node.defaultLang ? this.rawPageString(node.defaultLang) : 'en';

    this.emit(`import { readFileSync } from 'fs';`);
    this.emit(`import { join } from 'path';`);
    this.emitRaw('');
    this.emit(`const __i18nData = {};`);
    for (const lang of node.langs) {
      const code = this.rawPageString(lang.code);
      const file = this.rawPageString(lang.file);
      this.emit(`__i18nData[${JSON.stringify(code)}] = JSON.parse(readFileSync(join(${JSON.stringify(dir)}, ${JSON.stringify(file)}), 'utf-8'));`);
    }
    this.emit(`let __i18nLang = ${JSON.stringify(defaultLang)};`);
    this.emitRaw('');
    this.emit(`const i18n = {`);
    this.indent++;
    this.emit(`t(key, params = {}) {`);
    this.indent++;
    this.emit(`let text = key.split('.').reduce((o, k) => o?.[k], __i18nData[__i18nLang]) || key;`);
    this.emit(`for (const [k, v] of Object.entries(params)) text = text.replace(new RegExp(\`{$\{k}}\`, 'g'), v);`);
    this.emit(`return text;`);
    this.indent--;
    this.emit(`},`);
    this.emit(`setLang(code) { __i18nLang = code; },`);
    this.emit(`getLang() { return __i18nLang; },`);
    this.indent--;
    this.emit(`};`);
    this.emitRaw('');
  }

  // ===== Push Notifications =====

  visitPush(node) {
    const publicKey = this.expr(node.publicKey);
    const privateKey = this.expr(node.privateKey);
    const endpoint = node.endpoint ? this.rawPageString(node.endpoint) : '/subscribe';

    this.emit(`import webpush from 'web-push';`);
    this.emitRaw('');
    this.emit(`webpush.setVapidDetails('mailto:noreply@example.com', ${publicKey}, ${privateKey});`);
    this.emitRaw('');
    this.emit(`const push = {`);
    this.indent++;
    this.emit(`async send(subscription, title, body, data = {}) {`);
    this.indent++;
    this.emit(`return webpush.sendNotification(subscription, JSON.stringify({ title, body, data }));`);
    this.indent--;
    this.emit(`},`);
    this.emit(`async sendAll(subscriptions, title, body, data = {}) {`);
    this.indent++;
    this.emit(`return Promise.allSettled(subscriptions.map(sub => push.send(sub, title, body, data)));`);
    this.indent--;
    this.emit(`},`);
    this.indent--;
    this.emit(`};`);
    this.emitRaw('');
  }

  // ===== Search =====

  visitSearch(node) {
    const engine = this.rawPageString(node.engine);
    const host = this.expr(node.host);
    const apiKey = this.expr(node.apiKey);
    const index = node.index ? this.rawPageString(node.index) : 'default';

    if (engine === 'meilisearch') {
      this.emit(`import { MeiliSearch } from 'meilisearch';`);
      this.emitRaw('');
      this.emit(`const __searchClient = new MeiliSearch({ host: ${host}, apiKey: ${apiKey} });`);
      this.emit(`const __searchIndex = __searchClient.index(${JSON.stringify(index)});`);
      this.emitRaw('');
      this.emit(`const search = {`);
      this.indent++;
      this.emit(`async query(q, opts = {}) { return __searchIndex.search(q, opts); },`);
      this.emit(`async add(docs) { return __searchIndex.addDocuments(docs); },`);
      this.emit(`async remove(id) { return __searchIndex.deleteDocument(id); },`);
      this.emit(`async update(docs) { return __searchIndex.updateDocuments(docs); },`);
      this.indent--;
      this.emit(`};`);
    } else {
      this.emit(`import { Client } from '@elastic/elasticsearch';`);
      this.emitRaw('');
      this.emit(`const __esClient = new Client({ node: ${host}, auth: { apiKey: ${apiKey} } });`);
      this.emitRaw('');
      this.emit(`const search = {`);
      this.indent++;
      this.emit(`async query(q, opts = {}) { return __esClient.search({ index: ${JSON.stringify(index)}, query: { match: { _all: q } }, ...opts }); },`);
      this.emit(`async add(doc) { return __esClient.index({ index: ${JSON.stringify(index)}, body: doc }); },`);
      this.emit(`async remove(id) { return __esClient.delete({ index: ${JSON.stringify(index)}, id }); },`);
      this.indent--;
      this.emit(`};`);
    }
    this.emitRaw('');
  }

  // ===== Image Processing =====

  visitImage(node) {
    const input = this.expr(node.input);
    const output = node.output ? this.expr(node.output) : input;

    this.emit(`import sharp from 'sharp';`);
    this.emitRaw('');
    this.emit(`let __img = sharp(${input});`);

    for (const op of node.operations) {
      if (op.op === 'resize') {
        const w = op.args[0] || 800;
        const h = op.args[1] || null;
        this.emit(`__img = __img.resize(${w}${h ? ', ' + h : ''});`);
      } else if (op.op === 'crop') {
        const l = op.args[0] || 0, t = op.args[1] || 0, w = op.args[2] || 100, h = op.args[3] || 100;
        this.emit(`__img = __img.extract({ left: ${l}, top: ${t}, width: ${w}, height: ${h} });`);
      } else if (op.op === 'watermark') {
        const wm = op.args[0] ? (typeof op.args[0] === 'object' ? this.rawPageString(op.args[0]) : op.args[0]) : 'watermark.png';
        this.emit(`__img = __img.composite([{ input: ${JSON.stringify(wm)}, gravity: 'southeast' }]);`);
      } else if (op.op === 'rotate') {
        this.emit(`__img = __img.rotate(${op.args[0] || 90});`);
      } else if (op.op === 'blur') {
        this.emit(`__img = __img.blur(${op.args[0] || 5});`);
      } else if (op.op === 'grayscale' || op.op === 'greyscale') {
        this.emit(`__img = __img.grayscale();`);
      } else if (op.op === 'flip') {
        this.emit(`__img = __img.flip();`);
      } else if (op.op === 'format') {
        const fmt = op.args[0] ? (typeof op.args[0] === 'object' ? this.rawPageString(op.args[0]) : op.args[0]) : 'png';
        this.emit(`__img = __img.toFormat(${JSON.stringify(fmt)});`);
      }
    }

    this.emit(`await __img.toFile(${output});`);
    this.emit(`console.log('Processed:', ${output});`);
    this.emitRaw('');
  }

  // ===== CSV/Excel =====

  visitCsv(node) {
    const name = this.rawPageString(node.name);
    const format = node.format ? this.rawPageString(node.format) : 'csv';
    const columns = node.columns.map(c => this.rawPageString(c));
    const source = node.source ? this.expr(node.source) : '[]';
    const output = node.output ? this.rawPageString(node.output) : `${name}.${format}`;

    if (format === 'xlsx' || format === 'excel') {
      this.emit(`import ExcelJS from 'exceljs';`);
      this.emitRaw('');
      this.emit(`const __wb = new ExcelJS.Workbook();`);
      this.emit(`const __ws = __wb.addWorksheet(${JSON.stringify(name)});`);
      if (columns.length > 0) {
        this.emit(`__ws.columns = [${columns.map(c => `{ header: ${JSON.stringify(c)}, key: ${JSON.stringify(c)} }`).join(', ')}];`);
      }
      this.emit(`for (const row of ${source}) { __ws.addRow(row); }`);
      this.emit(`await __wb.xlsx.writeFile(${JSON.stringify(output)});`);
    } else {
      this.emit(`import { writeFileSync } from 'fs';`);
      this.emit(`import { stringify } from 'csv-stringify/sync';`);
      this.emitRaw('');
      if (columns.length > 0) {
        this.emit(`const __csvOut = stringify(${source}, { header: true, columns: ${JSON.stringify(columns)} });`);
      } else {
        this.emit(`const __csvOut = stringify(${source}, { header: true });`);
      }
      this.emit(`writeFileSync(${JSON.stringify(output)}, __csvOut);`);
    }
    this.emit(`console.log('Exported: ${output}');`);
    this.emitRaw('');
  }

  // ===== Logging =====

  visitLogging(node) {
    const name = this.rawPageString(node.name);
    const level = node.level ? this.rawPageString(node.level) : 'info';
    const file = node.file ? this.rawPageString(node.file) : null;
    const format = node.format ? this.rawPageString(node.format) : 'text';
    const rotate = node.rotate ? this.rawPageString(node.rotate) : null;

    this.emit(`import winston from 'winston';`);
    this.emitRaw('');
    this.emit(`const __logTransports = [new winston.transports.Console()];`);
    if (file) {
      if (rotate) {
        this.emit(`import DailyRotateFile from 'winston-daily-rotate-file';`);
        this.emit(`__logTransports.push(new DailyRotateFile({ filename: ${JSON.stringify(file.replace(/\.\w+$/, '-%DATE%$&'))}, datePattern: 'YYYY-MM-DD', maxFiles: ${JSON.stringify(rotate)} }));`);
      } else {
        this.emit(`__logTransports.push(new winston.transports.File({ filename: ${JSON.stringify(file)} }));`);
      }
    }
    this.emit(`const logger = winston.createLogger({`);
    this.indent++;
    this.emit(`level: ${JSON.stringify(level)},`);
    if (format === 'json') {
      this.emit(`format: winston.format.json(),`);
    } else {
      this.emit(`format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),`);
    }
    this.emit(`transports: __logTransports,`);
    this.indent--;
    this.emit(`});`);
    this.emitRaw('');
  }

  // ===== DB Migration =====

  visitMigrate(node) {
    const name = this.rawPageString(node.name);

    this.emit(`import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs';`);
    this.emitRaw('');
    this.emit(`mkdirSync('migrations', { recursive: true });`);
    this.emit(`const __ts = Date.now();`);
    this.emit(`const __migration_${name.replace(/\W/g, '_')} = {`);
    this.indent++;
    this.emit(`name: ${JSON.stringify(name)},`);
    this.emit(`async up(db) {`);
    this.indent++;
    for (const stmt of node.up) this.visitStatement(stmt);
    this.indent--;
    this.emit(`},`);
    this.emit(`async down(db) {`);
    this.indent++;
    for (const stmt of node.down) this.visitStatement(stmt);
    this.indent--;
    this.emit(`},`);
    this.indent--;
    this.emit(`};`);
    this.emitRaw('');
  }

  // ===== gRPC =====

  visitGrpc(node) {
    const name = this.rawPageString(node.name);
    const port = node.port ? this.expr(node.port) : '50051';

    this.emit(`import grpc from '@grpc/grpc-js';`);
    this.emit(`import protoLoader from '@grpc/proto-loader';`);
    this.emitRaw('');
    this.emit(`const __grpcServer = new grpc.Server();`);
    this.emit(`const __grpcService = {};`);
    this.emitRaw('');

    for (const rpc of node.rpcs) {
      this.emit(`__grpcService.${rpc.method} = (call, callback) => {`);
      this.indent++;
      if (rpc.params.length > 0) {
        this.emit(`const ${rpc.params[0]} = call.request;`);
      }
      if (rpc.body.length > 0) {
        for (const stmt of rpc.body) this.visitStatement(stmt);
      } else {
        this.emit(`callback(null, {});`);
      }
      this.indent--;
      this.emit(`};`);
    }

    this.emitRaw('');
    this.emit(`__grpcServer.addService(${JSON.stringify(name)}, __grpcService);`);
    this.emit(`__grpcServer.bindAsync('0.0.0.0:' + ${port}, grpc.ServerCredentials.createInsecure(), () => {`);
    this.indent++;
    this.emit(`console.log('gRPC server running on port ' + ${port});`);
    this.indent--;
    this.emit(`});`);
    this.emitRaw('');
  }

  // ===== WebRTC =====

  visitWebrtc(node) {
    const name = this.rawPageString(node.name);
    const stun = node.stun ? this.rawPageString(node.stun) : 'stun:stun.l.google.com:19302';
    const turn = node.turn ? this.rawPageString(node.turn) : null;

    this.emit(`import { WebSocketServer } from 'ws';`);
    this.emitRaw('');
    this.emit(`const __rtcConfig = {`);
    this.indent++;
    this.emit(`iceServers: [`);
    this.indent++;
    this.emit(`{ urls: ${JSON.stringify(stun)} },`);
    if (turn) {
      this.emit(`{ urls: ${JSON.stringify(turn)} },`);
    }
    this.indent--;
    this.emit(`],`);
    this.indent--;
    this.emit(`};`);
    this.emitRaw('');

    this.emit(`const __signalingServer = new WebSocketServer({ port: 8080 });`);
    this.emit(`const __peers = new Map();`);
    this.emitRaw('');
    this.emit(`__signalingServer.on('connection', (ws) => {`);
    this.indent++;
    this.emit(`const peerId = Math.random().toString(36).slice(2);`);
    this.emit(`__peers.set(peerId, ws);`);
    this.emitRaw('');
    this.emit(`ws.on('message', (raw) => {`);
    this.indent++;
    this.emit(`const data = JSON.parse(raw);`);

    for (const evt of node.events) {
      this.emit(`if (data.type === ${JSON.stringify(evt.event)}) {`);
      this.indent++;
      if (evt.params.length > 0) {
        this.emit(`const ${evt.params[0]} = data;`);
      }
      for (const stmt of evt.body) this.visitStatement(stmt);
      this.indent--;
      this.emit(`}`);
    }

    this.indent--;
    this.emit(`});`);
    this.emitRaw('');
    this.emit(`ws.on('close', () => __peers.delete(peerId));`);
    this.indent--;
    this.emit(`});`);
    this.emit(`console.log('WebRTC signaling server on port 8080');`);
    this.emitRaw('');
  }

  // ===== Blockchain =====

  visitBlockchain(node) {
    const name = this.rawPageString(node.name);
    const network = node.network ? this.rawPageString(node.network) : 'ethereum';
    const provider = node.provider ? this.expr(node.provider) : "'http://localhost:8545'";
    const contract = node.contract ? this.rawPageString(node.contract) : null;
    const abi = node.abi ? this.rawPageString(node.abi) : null;

    this.emit(`import { ethers } from 'ethers';`);
    this.emitRaw('');
    this.emit(`const __provider = new ethers.JsonRpcProvider(${provider});`);
    this.emitRaw('');
    this.emit(`const ${name.replace(/\W/g, '_')} = {`);
    this.indent++;
    this.emit(`provider: __provider,`);
    this.emit(`async getBalance(address) { return ethers.formatEther(await __provider.getBalance(address)); },`);
    this.emit(`async getBlock(n) { return __provider.getBlock(n ?? 'latest'); },`);
    this.emit(`async sendTx(wallet, to, value) { return wallet.sendTransaction({ to, value: ethers.parseEther(value) }); },`);
    if (contract) {
      const abiVal = abi ? `JSON.parse(require('fs').readFileSync(${JSON.stringify(abi)}, 'utf-8'))` : '[]';
      this.emit(`contract: new ethers.Contract(${JSON.stringify(contract)}, ${abiVal}, __provider),`);
    }
    this.indent--;
    this.emit(`};`);
    this.emitRaw('');
  }
}
