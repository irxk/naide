import { T, TYPE_TOKENS } from './tokens.js';

class ASTNode {
  constructor(type, props = {}, line = 0) {
    this.type = type;
    this._line = line;
    Object.assign(this, props);
  }
}

export class Parser {
  constructor(tokens) {
    this.tokens = this.preprocessTokens(tokens.filter(t => t.type !== T.COMMENT));
    this.pos = 0;
  }

  preprocessTokens(tokens) {
    const result = [...tokens];
    const indentsToRemove = new Set();

    for (let i = 0; i < result.length; i++) {
      if (result[i].type !== T.INDENT) continue;
      let j = i + 1;
      while (j < result.length && result[j].type === T.NEWLINE) j++;
      if (j < result.length && result[j].type === T.PIPE) {
        indentsToRemove.add(i);
      }
    }

    if (indentsToRemove.size === 0) return result;

    const dedentsToRemove = new Set();
    for (const idx of indentsToRemove) {
      let depth = 0;
      for (let i = idx; i < result.length; i++) {
        if (result[i].type === T.INDENT) depth++;
        if (result[i].type === T.DEDENT) {
          depth--;
          if (depth === 0) {
            dedentsToRemove.add(i);
            break;
          }
        }
      }
    }

    const allRemove = new Set([...indentsToRemove, ...dedentsToRemove]);
    return result.filter((_, i) => !allRemove.has(i));
  }

  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.tokens.length ? this.tokens[idx] : { type: T.EOF, value: '' };
  }

  advance() {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  expect(type) {
    const tok = this.advance();
    if (tok.type !== type) {
      const hints = {
        COLON: "Missing ':' — blocks (if, fn, server, etc.) need a colon at the end",
        INDENT: "Expected an indented block — check your indentation (use 2 spaces)",
        RPAREN: "Missing closing ')'",
        RBRACKET: "Missing closing ']'",
        RBRACE: "Missing closing '}'",
        IDENT: "Expected an identifier (variable/function name)",
      };
      const hint = hints[type] ? `\n  Hint: ${hints[type]}` : '';
      throw this.error(`Expected ${type} but got ${tok.type} ('${tok.value}')${hint}`, tok);
    }
    return tok;
  }

  match(type) {
    if (this.peek().type === type) {
      return this.advance();
    }
    return null;
  }

  at(type) {
    return this.peek().type === type;
  }

  atAny(...types) {
    return types.includes(this.peek().type);
  }

  isIdentLike(type) {
    return type === T.IDENT || TYPE_TOKENS.has(type) ||
      type === T.LOG || type === T.DB || type === T.GET ||
      type === T.POST || type === T.PUT || type === T.DEL ||
      type === T.MATCH || type === T.ON || type === T.NEW ||
      type === T.FROM || type === T.AS || type === T.SELF ||
      type === T.SCHEMA || type === T.CRUD || type === T.AUTH ||
      type === T.CORS || type === T.LIMIT || type === T.ENV ||
      type === T.EVERY || type === T.WATCH || type === T.STATIC ||
      type === T.WS || type === T.GROUP || type === T.COOKIE ||
      type === T.NOT || type === T.AND || type === T.OR ||
      type === T.IN || type === T.BREAK || type === T.CONTINUE ||
      type === T.THROW || type === T.MUT || type === T.PUB ||
      type === T.UPLOAD || type === T.SESSION || type === T.VIEW ||
      type === T.SSE || type === T.CACHE || type === T.PATCH || type === T.MID ||
      type === T.VALIDATE || type === T.TEST || type === T.ASSERT ||
      type === T.QUEUE || type === T.JOB || type === T.OPENAPI ||
      type === T.TYPEOF || type === T.INSTANCEOF || type === T.ENSURE ||
      type === T.MODEL || type === T.PROMPT ||
      type === T.PAGE || type === T.CLI_APP || type === T.MAIL ||
      type === T.GRAPHQL || type === T.DESKTOP || type === T.SCREEN ||
      type === T.OAUTH || type === T.PAY || type === T.STORAGE ||
      type === T.PDF || type === T.I18N ||
      type === T.PUSH || type === T.SEARCH || type === T.IMAGE ||
      type === T.CSV || type === T.LOGGING || type === T.MIGRATE ||
      type === T.GRPC || type === T.WEBRTC || type === T.BLOCKCHAIN ||
      type === T.UNLESS || type === T.UNTIL || type === T.REPEAT ||
      type === T.ENUM_DECL || type === T.SWAP || type === T.IS || type === T.ISNT;
  }

  expectPropertyName() {
    const tok = this.advance();
    if (this.isIdentLike(tok.type)) {
      return tok.value;
    }
    throw this.error(`Expected property name but got ${tok.type} ('${tok.value}')`, tok);
  }

  node(type, props = {}) {
    return new ASTNode(type, props, this.peek().line);
  }

  error(msg, tok) {
    const t = tok || this.peek();
    let hint = '';
    const v = t.value;
    if (v === 'unless') hint = '\n  Hint: unless <condition>:';
    else if (v === 'until') hint = '\n  Hint: until <condition>:';
    else if (v === 'repeat') hint = '\n  Hint: repeat <count>:  or  repeat <count> as <var>:';
    else if (v === 'swap') hint = '\n  Hint: swap <a>, <b>';
    else if (v === 'enum') hint = '\n  Hint: enum <Name>:  then indent values';
    else if (v === 'fn') hint = '\n  Hint: fn <name>(<params>) -> <type>:  or  fn <name>(<params>) -> <type> = <expr>';
    else if (v === 'if') hint = '\n  Hint: if <condition>:';
    else if (v === 'for') hint = '\n  Hint: for <var> in <iterable>:';
    else if (v === 'while') hint = '\n  Hint: while <condition>:';
    return new Error(`[NAIDE Parse Error] ${msg} at line ${t.line}:${t.col}${hint}`);
  }

  skipNewlines() {
    while (this.at(T.NEWLINE)) this.advance();
  }

  skipWhitespace() {
    while (this.atAny(T.NEWLINE, T.INDENT, T.DEDENT)) this.advance();
  }

  parse() {
    const body = [];
    this.skipNewlines();
    while (!this.at(T.EOF)) {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }
    return new ASTNode('Program', { body });
  }

  parseStatement() {
    this.skipNewlines();
    const tok = this.peek();

    switch (tok.type) {
      case T.USE: return this.parseUse();
      case T.FN: return this.parseFunction(false, false);
      case T.FN_ASYNC: return this.parseFunction(true, false);
      case T.PUB: return this.parsePub();
      case T.RET: return this.parseReturn();
      case T.IF: return this.parseIf();
      case T.UNLESS: return this.parseUnless();
      case T.EACH: return this.parseEach();
      case T.FOR: return this.parseFor();
      case T.WHILE: return this.parseWhile();
      case T.UNTIL: return this.parseUntil();
      case T.REPEAT: return this.parseRepeat();
      case T.ENUM_DECL: return this.parseEnum();
      case T.SWAP: return this.parseSwap();
      case T.MATCH: return this.parseMatch();
      case T.TRY: return this.parseTry();
      case T.SERVER: return this.parseServer();
      case T.BOT: return this.parseBot();
      case T.PAGE: return this.parsePage();
      case T.CLI_APP: return this.parseCli();
      case T.MAIL: return this.parseMail();
      case T.DESKTOP: return this.parseDesktop();
      case T.SCREEN: return this.parseScreen();
      case T.OAUTH: return this.parseOauth();
      case T.PAY: return this.parsePay();
      case T.STORAGE: return this.parseStorage();
      case T.PDF: return this.parsePdf();
      case T.I18N: return this.parseI18n();
      case T.PUSH: return this.parsePush();
      case T.SEARCH: return this.parseSearch();
      case T.IMAGE: return this.parseImage();
      case T.CSV: return this.parseCsv();
      case T.LOGGING: return this.parseLogging();
      case T.MIGRATE: return this.parseMigrate();
      case T.GRPC: return this.parseGrpc();
      case T.WEBRTC: return this.parseWebrtc();
      case T.BLOCKCHAIN: return this.parseBlockchain();
      case T.MODEL: return this.parseModel();
      case T.ON: return this.parseOn();
      case T.LOG: return this.parseLog();
      case T.THROW: return this.parseThrow();
      case T.BREAK: this.advance(); return new ASTNode('Break');
      case T.CONTINUE: this.advance(); return new ASTNode('Continue');
      case T.MUT: return this.parseMutVariable();
      case T.DB:
        if (this.peek(1).type === T.DOT) return this.parseDbStatement();
        return this.parseDbDir();
      case T.AWAIT: return this.parseAwaitStatement();
      case T.AWAIT_ALL: return this.parseAwaitAll();
      case T.SCHEMA: return this.parseSchema();
      case T.CRUD:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseCrud();
      case T.AUTH:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseAuth();
      case T.CORS:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseCors();
      case T.LIMIT:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseLimit();
      case T.ENV:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseEnv();
      case T.EVERY:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseEvery();
      case T.WATCH:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseWatch();
      case T.STATIC:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseStatic();
      case T.WS:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseWs();
      case T.GROUP:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseGroup();
      case T.COOKIE:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        this.advance();
        return new ASTNode('CookieDecl');
      case T.VALIDATE:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseValidate();
      case T.TEST:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseTest();
      case T.ASSERT:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseAssert();
      case T.QUEUE:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parseQueue();
      case T.PROMPT:
        if (this.peek(1).type === T.DOT) return this.parseExpressionStatement();
        return this.parsePrompt();
      default:
        if (TYPE_TOKENS.has(tok.type)) {
          return this.parseTypedVariable();
        }
        return this.parseExpressionStatement();
    }
  }

  parseUse() {
    this.advance(); // use

    if (this.at(T.LBRACE)) {
      this.advance();
      const names = [];
      while (!this.at(T.RBRACE) && !this.at(T.EOF)) {
        const tok = this.peek();
        let name;
        if (this.isIdentLike(tok.type)) {
          name = this.advance().value;
        } else {
          name = this.expect(T.IDENT).value;
        }
        let alias = null;
        if (this.match(T.AS)) {
          alias = this.expect(T.IDENT).value;
        }
        names.push({ name, alias });
        this.match(T.COMMA);
      }
      this.expect(T.RBRACE);
      this.expect(T.FROM);
      const source = this.parseString();
      return new ASTNode('UseDestructured', { names, source });
    }

    const name = this.expect(T.IDENT).value;
    let source = null;
    let alias = null;

    if (this.match(T.AS)) {
      alias = this.expect(T.IDENT).value;
    }

    if (this.match(T.FROM)) {
      source = this.parseString();
    }

    return new ASTNode('Use', { name, source, alias });
  }

  parseString() {
    const tok = this.expect(T.STRING);
    return tok.value;
  }

  parseFunction(isAsync, isPublic) {
    this.advance(); // fn or fn.async
    const tok = this.advance();
    if (!this.isIdentLike(tok.type)) {
      throw this.error(`Expected function name but got ${tok.type} ('${tok.value}')`, tok);
    }
    const name = tok.value;
    this.expect(T.LPAREN);
    const params = this.parseFnParams();
    this.expect(T.RPAREN);

    let returnType = null;
    if (this.match(T.ARROW)) {
      returnType = this.parseTypeAnnotation();
    }

    if (this.match(T.ASSIGN)) {
      const expr = this.parseExpression();
      return new ASTNode('Function', { name, params, returnType, body: [new ASTNode('Return', { value: expr })], isAsync, isPublic });
    }

    this.expect(T.COLON);
    const body = this.parseBlock();

    return new ASTNode('Function', { name, params, returnType, body, isAsync, isPublic });
  }

  parseFnParams() {
    const params = [];
    while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
      let type = null;
      let spread = false;

      if (this.match(T.SPREAD)) {
        spread = true;
      }

      if (TYPE_TOKENS.has(this.peek().type)) {
        type = this.advance().value;
      }

      const name = this.expect(T.IDENT).value;

      let defaultValue = null;
      if (this.match(T.ASSIGN)) {
        defaultValue = this.parseExpression();
      }

      params.push({ name, type, defaultValue, spread });
      this.match(T.COMMA);
    }
    return params;
  }

  parseTypeAnnotation() {
    if (TYPE_TOKENS.has(this.peek().type)) {
      return this.advance().value;
    }
    return this.expect(T.IDENT).value;
  }

  parseBlock() {
    this.skipNewlines();
    this.expect(T.INDENT);
    const body = [];
    this.skipNewlines();
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }
    this.match(T.DEDENT);
    return body;
  }

  parsePub() {
    this.advance(); // pub
    if (this.at(T.FN)) return this.parseFunction(false, true);
    if (this.at(T.FN_ASYNC)) return this.parseFunction(true, true);
    if (this.at(T.MODEL)) return this.parseModel(true);

    if (TYPE_TOKENS.has(this.peek().type)) {
      const node = this.parseTypedVariable();
      node.isPublic = true;
      return node;
    }

    throw this.error('Expected fn, model, or type after pub');
  }

  parseReturn() {
    this.advance(); // ret
    if (this.at(T.NEWLINE) || this.at(T.EOF) || this.at(T.DEDENT)) {
      return new ASTNode('Return', { value: null });
    }
    if (this.match(T.DOT)) {
      const method = this.expect(T.IDENT).value;
      if (method === 'status') {
        const statusCode = this.parseExpression();
        const body = this.parseExpression();
        return new ASTNode('ReturnStatus', { method, statusCode, body });
      }
      if (method === 'render') {
        const template = this.parseExpression();
        let data = null;
        if (!this.at(T.NEWLINE) && !this.at(T.EOF) && !this.at(T.DEDENT)) {
          data = this.parseExpression();
        }
        return new ASTNode('ReturnRender', { template, data });
      }
      if (method === 'redirect') {
        const first = this.parseExpression();
        if (!this.at(T.NEWLINE) && !this.at(T.EOF) && !this.at(T.DEDENT)) {
          const url = this.parseExpression();
          return new ASTNode('ReturnRedirect', { statusCode: first, url });
        }
        return new ASTNode('ReturnMethod', { method: 'redirect', value: first });
      }
      if (method === 'download') {
        const filePath = this.parseExpression();
        if (!this.at(T.NEWLINE) && !this.at(T.EOF) && !this.at(T.DEDENT)) {
          const filename = this.parseExpression();
          return new ASTNode('ReturnDownload', { filePath, filename });
        }
        return new ASTNode('ReturnMethod', { method: 'download', value: filePath });
      }
      const value = this.parseExpression();
      return new ASTNode('ReturnMethod', { method, value });
    }
    const value = this.parseExpression();
    return new ASTNode('Return', { value });
  }

  expectIdentLike() {
    const tok = this.advance();
    if (this.isIdentLike(tok.type)) return tok.value;
    throw this.error(`Expected identifier but got ${tok.type} ('${tok.value}')`, tok);
  }

  parseTypedVariable() {
    const varType = this.advance().value;
    if (this.at(T.LBRACE)) {
      return this.parseDestructure(varType, false);
    }
    if (this.at(T.LBRACKET)) {
      return this.parseDestructure(varType, false);
    }
    const name = this.expectIdentLike();
    this.expect(T.ASSIGN);
    const value = this.parseExpression();
    return new ASTNode('TypedVar', { varType, name, value, isMut: false, isPublic: false });
  }

  parseMutVariable() {
    this.advance(); // mut
    if (TYPE_TOKENS.has(this.peek().type)) {
      const node = this.parseTypedVariable();
      node.isMut = true;
      return node;
    }
    if (this.at(T.LBRACE) || this.at(T.LBRACKET)) {
      return this.parseDestructure(null, true);
    }
    const name = this.expectIdentLike();
    this.expect(T.ASSIGN);
    const value = this.parseExpression();
    return new ASTNode('TypedVar', { varType: null, name, value, isMut: true });
  }

  parseDestructure(varType, isMut) {
    const pattern = this.at(T.LBRACE) ? 'object' : 'array';
    this.advance(); // { or [
    const names = [];
    const endToken = pattern === 'object' ? T.RBRACE : T.RBRACKET;
    while (!this.at(endToken) && !this.at(T.EOF)) {
      this.skipWhitespace();
      if (this.at(endToken)) break;
      if (this.match(T.SPREAD)) {
        const name = this.expectIdentLike();
        names.push({ name, rest: true });
      } else {
        const name = this.expectIdentLike();
        let alias = null;
        if (this.match(T.COLON)) {
          alias = this.expectIdentLike();
        }
        let defaultValue = null;
        if (this.match(T.ASSIGN)) {
          defaultValue = this.parseExpression();
        }
        names.push({ name, alias, defaultValue, rest: false });
      }
      this.match(T.COMMA);
      this.skipWhitespace();
    }
    this.expect(endToken);
    this.expect(T.ASSIGN);
    const value = this.parseExpression();
    return new ASTNode('Destructure', { pattern, names, value, varType, isMut });
  }

  parseIf() {
    this.advance(); // if
    const condition = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();

    const elifs = [];
    this.skipNewlines();
    while (this.at(T.ELIF)) {
      this.advance();
      const elifCond = this.parseExpression();
      this.expect(T.COLON);
      const elifBody = this.parseBlock();
      elifs.push({ condition: elifCond, body: elifBody });
      this.skipNewlines();
    }

    let elseBody = null;
    if (this.at(T.ELSE)) {
      this.advance();
      this.expect(T.COLON);
      elseBody = this.parseBlock();
    }

    return new ASTNode('If', { condition, body, elifs, elseBody });
  }

  parseEach() {
    this.advance(); // each
    let key = null;
    const valueName = this.expect(T.IDENT).value;
    if (this.match(T.COMMA)) {
      key = valueName;
      const val = this.expect(T.IDENT).value;
      this.expect(T.IN);
      const collection = this.parseExpression();
      this.expect(T.COLON);
      const body = this.parseBlock();
      return new ASTNode('Each', { key, value: val, collection, body });
    }
    this.expect(T.IN);
    const collection = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('Each', { key: null, value: valueName, collection, body });
  }

  parseFor() {
    this.advance(); // for
    const varName = this.expect(T.IDENT).value;
    this.expect(T.IN);
    const start = this.parseExpression();
    this.expect(T.RANGE);
    const end = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('For', { varName, start, end, body });
  }

  parseWhile() {
    this.advance(); // while
    const condition = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('While', { condition, body });
  }

  parseMatch() {
    this.advance(); // match
    const value = this.parseExpression();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const cases = [];
    this.skipNewlines();
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      let pattern;
      if (this.at(T.IDENT) && this.peek().value === '_') {
        this.advance();
        pattern = new ASTNode('DefaultPattern');
      } else {
        pattern = this.parseExpression();
      }
      this.expect(T.COLON);

      let body;
      if (this.at(T.NEWLINE) || this.at(T.INDENT)) {
        this.skipNewlines();
        if (this.at(T.INDENT)) {
          body = this.parseBlock();
        } else {
          body = [this.parseStatement()];
        }
      } else {
        body = [this.parseStatement()];
      }
      cases.push({ pattern, body });
      this.skipNewlines();
    }
    this.match(T.DEDENT);
    return new ASTNode('Match', { value, cases });
  }

  parseTry() {
    this.advance(); // try
    this.expect(T.COLON);
    const body = this.parseBlock();

    this.skipNewlines();
    let catchVar = null;
    let catchBody = null;
    if (this.at(T.FAIL)) {
      this.advance();
      if (!this.at(T.COLON)) {
        catchVar = this.expect(T.IDENT).value;
      }
      this.expect(T.COLON);
      catchBody = this.parseBlock();
    }

    this.skipNewlines();
    let ensureBody = null;
    if (this.at(T.ENSURE)) {
      this.advance();
      this.expect(T.COLON);
      ensureBody = this.parseBlock();
    }

    return new ASTNode('Try', { body, catchVar, catchBody, ensureBody });
  }

  parseServer() {
    this.advance(); // server
    const name = this.expect(T.IDENT).value;

    let port = null;
    if (this.at(T.IDENT) && this.peek().value === 'port') {
      this.advance();
      port = this.parseExpression();
    }

    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const routes = [];
    const middleware = [];
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.atAny(T.GET, T.POST, T.PUT, T.DEL, T.PATCH)) {
        routes.push(this.parseRoute());
      } else if (this.at(T.MID)) {
        const mid = this.parseMiddleware();
        if (mid.type === 'MiddlewareRef') {
          routes.push(mid);
        } else {
          middleware.push(mid);
        }
      } else if (this.at(T.CRUD)) {
        routes.push(this.parseCrud());
      } else if (this.at(T.AUTH)) {
        routes.push(this.parseAuth());
      } else if (this.at(T.CORS)) {
        routes.push(this.parseCors());
      } else if (this.at(T.LIMIT)) {
        routes.push(this.parseLimit());
      } else if (this.at(T.STATIC)) {
        routes.push(this.parseStatic());
      } else if (this.at(T.WS)) {
        routes.push(this.parseWs());
      } else if (this.at(T.GROUP)) {
        routes.push(this.parseGroup());
      } else if (this.at(T.COOKIE)) {
        this.advance();
        routes.push(new ASTNode('CookieDecl'));
      } else if (this.at(T.UPLOAD)) {
        routes.push(this.parseUpload());
      } else if (this.at(T.SESSION)) {
        routes.push(this.parseSession());
      } else if (this.at(T.VIEW)) {
        routes.push(this.parseView());
      } else if (this.at(T.SSE)) {
        routes.push(this.parseSse());
      } else if (this.at(T.CACHE)) {
        routes.push(this.parseCache());
      } else if (this.at(T.VALIDATE)) {
        routes.push(this.parseValidate());
      } else if (this.at(T.OPENAPI)) {
        routes.push(this.parseOpenapi());
      } else if (this.at(T.QUEUE)) {
        routes.push(this.parseQueue());
      } else if (this.at(T.GRAPHQL)) {
        routes.push(this.parseGraphql());
      } else if (this.at(T.IDENT) && this.peek().value === 'error') {
        routes.push(this.parseErrorHandler());
      } else {
        routes.push(this.parseStatement());
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('Server', { name, port, routes, middleware });
  }

  parseBot() {
    this.advance(); // bot
    const name = this.expect(T.IDENT).value;

    let botType = null;
    if (this.at(T.IDENT) && this.peek().value === 'type') {
      this.advance();
      botType = this.parseString();
    }

    let token = null;
    if (this.at(T.IDENT) && this.peek().value === 'token') {
      this.advance();
      token = this.parseExpression();
    }

    let prefix = null;
    if (this.at(T.IDENT) && this.peek().value === 'prefix') {
      this.advance();
      prefix = this.parseExpression();
    }

    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const handlers = [];
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.ON)) {
        this.advance(); // on
        const event = this.parseString();
        let params = [];
        if (this.match(T.LPAREN)) {
          while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
            params.push(this.expect(T.IDENT).value);
            this.match(T.COMMA);
          }
          this.expect(T.RPAREN);
        }
        this.expect(T.COLON);
        const body = this.parseBlock();
        handlers.push(new ASTNode('BotEvent', { event, params, body }));
      } else if (this.at(T.SLASH_CMD)) {
        this.advance(); // slash
        const cmdName = this.parseString();
        const description = this.parseString();
        let params = [];
        if (this.match(T.LPAREN)) {
          while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
            params.push(this.expect(T.IDENT).value);
            this.match(T.COMMA);
          }
          this.expect(T.RPAREN);
        }
        this.expect(T.COLON);
        const body = this.parseBlock();
        handlers.push(new ASTNode('BotSlashCmd', { name: cmdName, description, params, body }));
      } else {
        handlers.push(this.parseStatement());
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('Bot', { name, token, prefix, botType, handlers });
  }

  parseRoute() {
    const method = this.advance().value; // get/post/put/del
    const path = this.parseString();

    let middleware = [];
    if (this.at(T.LBRACKET)) {
      this.advance();
      while (!this.at(T.RBRACKET) && !this.at(T.EOF)) {
        middleware.push(this.parseExpression());
        this.match(T.COMMA);
      }
      this.expect(T.RBRACKET);
    }

    let params = [];
    if (this.match(T.LPAREN)) {
      while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
        params.push(this.expect(T.IDENT).value);
        this.match(T.COMMA);
      }
      this.expect(T.RPAREN);
    }

    let returnType = null;
    if (this.match(T.ARROW)) {
      returnType = this.parseTypeAnnotation();
    }

    this.expect(T.COLON);
    const body = this.parseBlock();

    return new ASTNode('Route', { method, path, middleware, params, returnType, body });
  }

  parseMiddleware() {
    this.advance(); // mid
    const name = this.expect(T.IDENT).value;
    if (this.at(T.LPAREN)) {
      this.advance();
      const params = [];
      while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
        params.push(this.expect(T.IDENT).value);
        this.match(T.COMMA);
      }
      this.expect(T.RPAREN);
      this.expect(T.COLON);
      const body = this.parseBlock();
      return new ASTNode('Middleware', { name, params, body });
    }
    let path = null;
    if (this.at(T.STRING)) {
      path = this.parseString();
    }
    return new ASTNode('MiddlewareRef', { name, path });
  }

  parseModel(isPublic = false) {
    this.advance(); // model
    const name = this.expect(T.IDENT).value;

    let parent = null;
    if (this.at(T.IDENT) && this.peek().value === 'extends') {
      this.advance();
      parent = this.expect(T.IDENT).value;
    }

    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const fields = [];
    const methods = [];
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.FN) || this.at(T.FN_ASYNC)) {
        const isAsync = this.at(T.FN_ASYNC);
        methods.push(this.parseFunction(isAsync, false));
      } else if (TYPE_TOKENS.has(this.peek().type)) {
        const fieldType = this.advance().value;
        const fieldName = this.expect(T.IDENT).value;
        let defaultValue = null;
        if (this.match(T.ASSIGN)) {
          defaultValue = this.parseExpression();
        }
        fields.push({ name: fieldName, type: fieldType, defaultValue });
      } else {
        this.advance();
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('Model', { name, parent, fields, methods, isPublic });
  }

  parseOn() {
    this.advance(); // on
    const event = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('On', { event, body });
  }

  parseLog() {
    this.advance(); // log
    let level = 'log';
    if (this.match(T.DOT)) {
      level = this.expect(T.IDENT).value;
    }
    const args = [this.parseExpression()];
    while (this.match(T.COMMA)) {
      args.push(this.parseExpression());
    }
    return new ASTNode('Log', { level, args });
  }

  parseThrow() {
    this.advance(); // throw
    const value = this.parseExpression();
    return new ASTNode('Throw', { value });
  }

  parseDbStatement() {
    this.advance(); // db
    this.expect(T.DOT);
    const method = this.expect(T.IDENT).value;
    if (method === 'connect') {
      const connectionString = this.parseExpression();
      return new ASTNode('DbConnect', { connectionString });
    }
    if (method === 'sql') {
      const driver = this.parseString();
      let connection = null;
      if (this.at(T.STRING)) {
        connection = this.parseString();
      }
      return new ASTNode('DbSql', { driver, connection });
    }
    this.pos -= 3;
    return this.parseExpressionStatement();
  }

  parseDbDir() {
    this.advance(); // db
    const path = this.parseString();
    return new ASTNode('DbDir', { path });
  }

  parseAwaitStatement() {
    return this.parseExpressionStatement();
  }

  parseAwaitAll() {
    this.advance(); // await.all
    const exprs = [];
    if (this.match(T.LBRACKET)) {
      while (!this.at(T.RBRACKET) && !this.at(T.EOF)) {
        this.skipWhitespace();
        if (this.at(T.RBRACKET)) break;
        exprs.push(this.parseExpression());
        this.match(T.COMMA);
        this.skipWhitespace();
      }
      this.expect(T.RBRACKET);
    } else {
      exprs.push(this.parseExpression());
    }
    return new ASTNode('AwaitAll', { expressions: exprs });
  }

  parseExpressionStatement() {
    const expr = this.parseExpression();

    if (this.match(T.ASSIGN)) {
      const value = this.parseExpression();
      return new ASTNode('Assignment', { target: expr, value });
    }
    if (this.match(T.PLUS_ASSIGN)) {
      const value = this.parseExpression();
      return new ASTNode('CompoundAssign', { target: expr, op: '+=', value });
    }
    if (this.match(T.MINUS_ASSIGN)) {
      const value = this.parseExpression();
      return new ASTNode('CompoundAssign', { target: expr, op: '-=', value });
    }

    return new ASTNode('ExprStatement', { expression: expr });
  }

  parseExpression() {
    return this.parsePipe();
  }

  parsePipe() {
    let left = this.parseTernary();
    while (this.matchPipeAcrossLines()) {
      this.skipWhitespace();
      const right = this.parseTernary();
      left = new ASTNode('Pipe', { left, right });
    }
    return left;
  }

  matchPipeAcrossLines() {
    if (this.match(T.PIPE)) return true;
    let scanPos = this.pos;
    while (scanPos < this.tokens.length && this.tokens[scanPos].type === T.NEWLINE) {
      scanPos++;
    }
    if (scanPos < this.tokens.length && this.tokens[scanPos].type === T.PIPE) {
      while (this.at(T.NEWLINE)) this.advance();
      this.advance();
      return true;
    }
    return false;
  }

  parseTernary() {
    if (this.at(T.IF)) {
      const savedPos = this.pos;
      this.advance();
      const condition = this.parseNullish();
      if (this.match(T.THEN)) {
        const consequent = this.parseNullish();
        this.expect(T.ELSE);
        const alternate = this.parseNullish();
        return new ASTNode('Ternary', { condition, consequent, alternate });
      }
      this.pos = savedPos;
    }
    let expr = this.parseNullish();
    if (this.at(T.IF)) {
      const savedPos = this.pos;
      this.advance();
      const condition = this.parseNullish();
      if (this.match(T.THEN)) {
        const consequent = this.parseNullish();
        this.expect(T.ELSE);
        const alternate = this.parseNullish();
        return new ASTNode('Ternary', { condition, consequent, alternate });
      }
      this.pos = savedPos;
    }
    return expr;
  }

  parseNullish() {
    let left = this.parseOr();
    while (this.match(T.NULLISH)) {
      const right = this.parseOr();
      left = new ASTNode('Binary', { op: '??', left, right });
    }
    return left;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.match(T.OR)) {
      const right = this.parseAnd();
      left = new ASTNode('Binary', { op: '||', left, right });
    }
    return left;
  }

  parseAnd() {
    let left = this.parseComparison();
    while (this.match(T.AND)) {
      const right = this.parseComparison();
      left = new ASTNode('Binary', { op: '&&', left, right });
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAddition();
    while (this.atAny(T.EQ, T.NEQ, T.GT, T.LT, T.GTE, T.LTE, T.INSTANCEOF, T.IS, T.ISNT)) {
      const tok = this.advance();
      const right = this.parseAddition();
      if (tok.type === T.INSTANCEOF) {
        left = new ASTNode('Binary', { op: 'instanceof', left, right });
      } else if (tok.type === T.IS) {
        left = new ASTNode('Binary', { op: '===', left, right });
      } else if (tok.type === T.ISNT) {
        left = new ASTNode('Binary', { op: '!==', left, right });
      } else {
        left = new ASTNode('Binary', { op: tok.value === '==' ? '===' : tok.value === '!=' ? '!==' : tok.value, left, right });
      }
    }
    return left;
  }

  parseAddition() {
    let left = this.parseMultiplication();
    while (this.atAny(T.PLUS, T.MINUS)) {
      const op = this.advance().value;
      const right = this.parseMultiplication();
      left = new ASTNode('Binary', { op, left, right });
    }
    return left;
  }

  parseMultiplication() {
    let left = this.parseUnary();
    while (this.atAny(T.STAR, T.SLASH, T.PERCENT)) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = new ASTNode('Binary', { op, left, right });
    }
    return left;
  }

  parseUnary() {
    if (this.match(T.NOT)) {
      const expr = this.parseUnary();
      return new ASTNode('Unary', { op: '!', expr });
    }
    if (this.at(T.MINUS)) {
      this.advance();
      const expr = this.parseUnary();
      return new ASTNode('Unary', { op: '-', expr });
    }
    if (this.match(T.AWAIT)) {
      const expr = this.parseUnary();
      return new ASTNode('Await', { expr });
    }
    if (this.at(T.AWAIT_ALL)) {
      this.advance();
      const expr = this.parsePostfix();
      return new ASTNode('AwaitAllExpr', { expr });
    }
    if (this.match(T.SPREAD)) {
      const expr = this.parseUnary();
      return new ASTNode('Spread', { expr });
    }
    if (this.match(T.NEW)) {
      const expr = this.parsePostfix();
      return new ASTNode('New', { expr });
    }
    if (this.match(T.TYPEOF)) {
      const expr = this.parseUnary();
      return new ASTNode('TypeOf', { expr });
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(T.DOT)) {
        const prop = this.expectPropertyName();
        expr = new ASTNode('MemberAccess', { object: expr, property: prop });
      } else if (this.match(T.OPTIONAL)) {
        const prop = this.expectPropertyName();
        expr = new ASTNode('OptionalAccess', { object: expr, property: prop });
      } else if (this.at(T.LPAREN)) {
        this.advance();
        const args = this.parseArgList();
        this.expect(T.RPAREN);
        expr = new ASTNode('Call', { callee: expr, args });
      } else if (this.at(T.LBRACKET)) {
        this.advance();
        const index = this.parseExpression();
        this.expect(T.RBRACKET);
        expr = new ASTNode('IndexAccess', { object: expr, index });
      } else {
        break;
      }
    }

    return expr;
  }

  parseArgList() {
    const args = [];
    while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
      this.skipWhitespace();
      if (this.at(T.RPAREN)) break;
      args.push(this.parseExpression());
      this.match(T.COMMA);
      this.skipWhitespace();
    }
    return args;
  }

  parsePrimary() {
    const tok = this.peek();

    switch (tok.type) {
      case T.NUMBER:
        this.advance();
        return new ASTNode('Number', { value: tok.value });

      case T.STRING:
        this.advance();
        return new ASTNode('String', { value: tok.value });

      case T.BOOL:
        this.advance();
        return new ASTNode('Bool', { value: tok.value === 'true' });

      case T.NULL:
        this.advance();
        return new ASTNode('Null');

      case T.SELF:
        this.advance();
        return new ASTNode('Self');

      case T.IDENT:
        this.advance();
        return new ASTNode('Identifier', { name: tok.value });

      case T.TYPE_STR: case T.TYPE_INT: case T.TYPE_NUM:
      case T.TYPE_BOOL: case T.TYPE_LIST: case T.TYPE_MAP:
      case T.TYPE_ANY: case T.TYPE_JSON: case T.TYPE_VOID:
        this.advance();
        return new ASTNode('Identifier', { name: tok.value });

      case T.SCHEMA: case T.CRUD: case T.AUTH: case T.CORS:
      case T.LIMIT: case T.ENV: case T.EVERY: case T.WATCH:
      case T.STATIC: case T.WS: case T.GROUP: case T.COOKIE:
      case T.UPLOAD: case T.SESSION: case T.VIEW: case T.SSE:
      case T.CACHE: case T.PATCH: case T.MID:
      case T.VALIDATE: case T.TEST: case T.ASSERT:
      case T.QUEUE: case T.JOB: case T.OPENAPI:
      case T.TYPEOF: case T.INSTANCEOF: case T.ENSURE:
      case T.PROMPT:
      case T.PAGE: case T.CLI_APP: case T.MAIL:
      case T.GRAPHQL: case T.DESKTOP: case T.SCREEN:
      case T.OAUTH: case T.PAY: case T.STORAGE: case T.PDF: case T.I18N:
      case T.PUSH: case T.SEARCH: case T.IMAGE:
      case T.CSV: case T.LOGGING: case T.MIGRATE:
      case T.GRPC: case T.WEBRTC: case T.BLOCKCHAIN:
      case T.UNLESS: case T.UNTIL: case T.REPEAT:
      case T.ENUM_DECL: case T.SWAP: case T.IS: case T.ISNT:
      case T.FROM: case T.AS: case T.IN:
        this.advance();
        return new ASTNode('Identifier', { name: tok.value });

      case T.DB:
        return this.parseDbExpression();

      case T.LOG:
        return this.parseLogExpression();

      case T.LPAREN:
        return this.parseGroupOrArrow();

      case T.LBRACKET:
        return this.parseArray();

      case T.LBRACE:
        return this.parseObject();

      case T.FN:
      case T.FN_ASYNC:
        return this.parseLambda();

      default:
        throw this.error(`Unexpected token ${tok.type} ('${tok.value}')`);
    }
  }

  parseDbExpression() {
    this.advance(); // db
    this.expect(T.DOT);
    const method = this.expect(T.IDENT).value;
    if (this.at(T.LPAREN)) {
      this.advance();
      const args = this.parseArgList();
      this.expect(T.RPAREN);
      return new ASTNode('Call', {
        callee: new ASTNode('MemberAccess', {
          object: new ASTNode('Identifier', { name: 'db' }),
          property: method
        }),
        args
      });
    }
    return new ASTNode('MemberAccess', {
      object: new ASTNode('Identifier', { name: 'db' }),
      property: method
    });
  }

  parseLogExpression() {
    this.advance(); // log
    let level = 'log';
    if (this.match(T.DOT)) {
      level = this.expect(T.IDENT).value;
    }
    if (this.at(T.LPAREN)) {
      this.advance();
      const args = this.parseArgList();
      this.expect(T.RPAREN);
      return new ASTNode('Call', {
        callee: new ASTNode('MemberAccess', {
          object: new ASTNode('Identifier', { name: 'console' }),
          property: level
        }),
        args
      });
    }
    return new ASTNode('MemberAccess', {
      object: new ASTNode('Identifier', { name: 'console' }),
      property: level
    });
  }

  parseGroupOrArrow() {
    const savedPos = this.pos;
    this.advance(); // (

    let isArrow = false;
    let depth = 1;
    let scanPos = this.pos;
    while (scanPos < this.tokens.length && depth > 0) {
      if (this.tokens[scanPos].type === T.LPAREN) depth++;
      if (this.tokens[scanPos].type === T.RPAREN) depth--;
      scanPos++;
    }
    if (scanPos < this.tokens.length && this.tokens[scanPos].type === T.FAT_ARROW) {
      isArrow = true;
    }

    if (isArrow) {
      const params = [];
      while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
        let type = null;
        if (TYPE_TOKENS.has(this.peek().type)) {
          type = this.advance().value;
        }
        const name = this.expect(T.IDENT).value;
        params.push({ name, type });
        this.match(T.COMMA);
      }
      this.expect(T.RPAREN);
      this.expect(T.FAT_ARROW);
      const body = this.parseExpression();
      return new ASTNode('ArrowFn', { params, body });
    }

    this.pos = savedPos;
    this.advance(); // (
    const expr = this.parseExpression();
    this.expect(T.RPAREN);
    return expr;
  }

  parseArray() {
    this.advance(); // [
    const elements = [];
    while (!this.at(T.RBRACKET) && !this.at(T.EOF)) {
      this.skipWhitespace();
      if (this.at(T.RBRACKET)) break;
      elements.push(this.parseExpression());
      this.match(T.COMMA);
      this.skipWhitespace();
    }
    this.expect(T.RBRACKET);
    return new ASTNode('Array', { elements });
  }

  parseObject() {
    this.advance(); // {
    const properties = [];
    while (!this.at(T.RBRACE) && !this.at(T.EOF)) {
      this.skipWhitespace();
      if (this.at(T.RBRACE)) break;

      if (this.match(T.SPREAD)) {
        const expr = this.parseExpression();
        properties.push({ type: 'spread', value: expr });
        this.match(T.COMMA);
        this.skipWhitespace();
        continue;
      }

      let key;
      if (this.at(T.STRING)) {
        key = this.parseString();
        key = new ASTNode('String', { value: key });
      } else if (this.at(T.LBRACKET)) {
        this.advance();
        key = this.parseExpression();
        this.expect(T.RBRACKET);
        key = new ASTNode('Computed', { expr: key });
      } else {
        const tok = this.peek();
        if (this.isIdentLike(tok.type)) {
          key = this.advance().value;
        } else {
          key = this.expect(T.IDENT).value;
        }
      }

      if (this.match(T.COLON)) {
        const value = this.parseExpression();
        properties.push({ type: 'property', key, value });
      } else {
        properties.push({ type: 'shorthand', key });
      }
      this.match(T.COMMA);
      this.skipWhitespace();
    }
    this.expect(T.RBRACE);
    return new ASTNode('Object', { properties });
  }

  parseLambda() {
    const isAsync = this.at(T.FN_ASYNC);
    this.advance(); // fn or fn.async
    this.expect(T.LPAREN);
    const params = this.parseFnParams();
    this.expect(T.RPAREN);
    let returnType = null;
    if (this.match(T.ARROW)) {
      returnType = this.parseTypeAnnotation();
    }
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('Lambda', { params, returnType, body, isAsync });
  }

  // ===== High-level feature parsers =====

  parseSchema() {
    this.advance(); // schema
    const name = this.expect(T.IDENT).value;
    let parent = null;
    if (this.match(T.EXTENDS)) {
      parent = this.expect(T.IDENT).value;
    }
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const fields = [];
    const methods = [];
    let init = null;
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.FN) || this.at(T.FN_ASYNC)) {
        methods.push(this.parseFunction(this.at(T.FN_ASYNC), false));
      } else if (this.at(T.IDENT) && this.peek().value === 'init' && this.peek(1).type === T.LPAREN) {
        this.advance(); // init
        this.expect(T.LPAREN);
        const params = this.parseFnParams();
        this.expect(T.RPAREN);
        this.expect(T.COLON);
        const body = this.parseBlock();
        init = { params, body };
      } else {
        fields.push(this.parseSchemaField());
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    if (parent || methods.length > 0 || init) {
      return new ASTNode('ClassDecl', { name, parent, fields, methods, init });
    }
    return new ASTNode('SchemaDecl', { name, fields });
  }

  parseSchemaField() {
    const name = this.expect(T.IDENT).value;

    let fieldType;
    let enumValues = null;

    if (TYPE_TOKENS.has(this.peek().type)) {
      fieldType = this.advance().value;
    } else if (this.at(T.IDENT) || this.at(T.ENUM_DECL)) {
      fieldType = this.advance().value;
      if (fieldType === 'enum' && this.at(T.LPAREN)) {
        this.advance();
        enumValues = [];
        while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
          enumValues.push(this.parseExpression());
          this.match(T.COMMA);
        }
        this.expect(T.RPAREN);
      }
    } else {
      throw this.error('Expected type in schema field');
    }

    const modifiers = [];
    while (!this.at(T.NEWLINE) && !this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.isIdentLike(this.peek().type)) {
        const modName = this.advance().value;
        if (this.at(T.LPAREN)) {
          this.advance();
          const args = [];
          while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
            args.push(this.parseExpression());
            this.match(T.COMMA);
          }
          this.expect(T.RPAREN);
          modifiers.push({ name: modName, args });
        } else {
          modifiers.push({ name: modName, args: [] });
        }
      } else {
        break;
      }
    }

    return { name, type: fieldType, enumValues, modifiers };
  }

  parseCrud() {
    this.advance(); // crud
    const path = this.parseString();
    const schemaName = this.expect(T.IDENT).value;
    return new ASTNode('CrudDecl', { path, schemaName });
  }

  parseAuth() {
    this.advance(); // auth
    const secret = this.parseExpression();

    const protectedPaths = [];
    const publicPaths = [];

    if (this.match(T.COLON)) {
      this.skipNewlines();
      this.expect(T.INDENT);
      this.skipNewlines();
      while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
        if (this.at(T.IDENT) && this.peek().value === 'protect') {
          this.advance();
          protectedPaths.push(this.parseString());
        } else if (this.at(T.IDENT) && this.peek().value === 'public') {
          this.advance();
          publicPaths.push(this.parseString());
        } else {
          this.advance();
        }
        this.skipNewlines();
      }
      this.match(T.DEDENT);
    }

    return new ASTNode('AuthDecl', { secret, protectedPaths, publicPaths });
  }

  parseCors() {
    this.advance(); // cors
    const origins = this.parseExpression();
    return new ASTNode('CorsDecl', { origins });
  }

  parseLimit() {
    this.advance(); // limit
    const path = this.parseString();
    const max = this.parseExpression();
    const window = this.parseExpression();
    return new ASTNode('LimitDecl', { path, max, window });
  }

  parseEnv() {
    this.advance(); // env
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const vars = [];
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      vars.push(this.parseEnvField());
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('EnvDecl', { vars });
  }

  parseEnvField() {
    const name = this.expect(T.IDENT).value;

    let fieldType = 'string';
    if (TYPE_TOKENS.has(this.peek().type)) {
      fieldType = this.advance().value;
    } else if (this.at(T.IDENT) && ['string', 'number', 'integer', 'boolean'].includes(this.peek().value)) {
      fieldType = this.advance().value;
    }

    const modifiers = [];
    while (!this.at(T.NEWLINE) && !this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.IDENT)) {
        const modName = this.advance().value;
        if (this.at(T.LPAREN)) {
          this.advance();
          const args = [];
          while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
            args.push(this.parseExpression());
            this.match(T.COMMA);
          }
          this.expect(T.RPAREN);
          modifiers.push({ name: modName, args });
        } else {
          modifiers.push({ name: modName, args: [] });
        }
      } else {
        break;
      }
    }

    return { name, type: fieldType, modifiers };
  }

  parseEvery() {
    this.advance(); // every
    const interval = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('EveryDecl', { interval, body });
  }

  parseWatch() {
    this.advance(); // watch
    let eventName = this.expect(T.IDENT).value;
    while (this.match(T.DOT)) {
      eventName += '.' + this.expectPropertyName();
    }
    let params = [];
    if (this.match(T.LPAREN)) {
      while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
        params.push(this.expect(T.IDENT).value);
        this.match(T.COMMA);
      }
      this.expect(T.RPAREN);
    }
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('WatchDecl', { eventName, params, body });
  }

  // static "/public"
  parseStatic() {
    this.advance(); // static
    const path = this.parseString();
    return new ASTNode('StaticDecl', { path });
  }

  // ws "/chat":
  //   on "message" (data):
  //     broadcast(data)
  //   on "connect":
  //     send({type: "welcome"})
  parseWs() {
    this.advance(); // ws
    const path = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const events = [];
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.ON)) {
        this.advance(); // on
        const eventName = this.parseString();
        let params = [];
        if (this.match(T.LPAREN)) {
          while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
            params.push(this.expect(T.IDENT).value);
            this.match(T.COMMA);
          }
          this.expect(T.RPAREN);
        }
        this.expect(T.COLON);
        const body = this.parseBlock();
        events.push({ name: eventName, params, body });
      } else {
        this.advance();
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('WsDecl', { path, events });
  }

  parseGroup() {
    this.advance(); // group
    const prefix = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const routes = [];
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.atAny(T.GET, T.POST, T.PUT, T.DEL, T.PATCH)) {
        routes.push(this.parseRoute());
      } else if (this.at(T.MID)) {
        routes.push(this.parseMiddleware());
      } else if (this.at(T.CRUD)) {
        routes.push(this.parseCrud());
      } else if (this.at(T.AUTH)) {
        routes.push(this.parseAuth());
      } else if (this.at(T.GROUP)) {
        routes.push(this.parseGroup());
      } else {
        routes.push(this.parseStatement());
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('GroupDecl', { prefix, routes });
  }

  parseErrorHandler() {
    this.advance(); // error (ident)
    let params = ['err', 'req', 'res'];
    if (this.match(T.LPAREN)) {
      params = [];
      while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
        params.push(this.expect(T.IDENT).value);
        this.match(T.COMMA);
      }
      this.expect(T.RPAREN);
    }
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('ErrorHandler', { params, body });
  }

  parseUpload() {
    this.advance(); // upload
    const path = this.parseString();
    const fieldName = this.parseString();
    let params = [];
    if (this.match(T.LPAREN)) {
      while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
        params.push(this.expect(T.IDENT).value);
        this.match(T.COMMA);
      }
      this.expect(T.RPAREN);
    }
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('UploadDecl', { path, fieldName, params, body });
  }

  parseSession() {
    this.advance(); // session
    const secret = this.parseExpression();
    return new ASTNode('SessionDecl', { secret });
  }

  parseView() {
    this.advance(); // view
    const dir = this.parseString();
    return new ASTNode('ViewDecl', { dir });
  }

  parseSse() {
    this.advance(); // sse
    const path = this.parseString();
    return new ASTNode('SseDecl', { path });
  }

  parseCache() {
    this.advance(); // cache
    const path = this.parseString();
    const duration = this.parseExpression();
    return new ASTNode('CacheDecl', { path, duration });
  }

  parseValidate() {
    this.advance(); // validate
    const path = this.parseString();
    const schemaName = this.expect(T.IDENT).value;
    return new ASTNode('ValidateDecl', { path, schemaName });
  }

  parseTest() {
    this.advance(); // test
    const name = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('TestDecl', { name, body });
  }

  parseAssert() {
    this.advance(); // assert
    const expr = this.parseExpression();
    return new ASTNode('AssertStmt', { expr });
  }

  parseQueue() {
    this.advance(); // queue
    const name = this.expect(T.IDENT).value;
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const jobs = [];
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.JOB)) {
        this.advance();
        const jobName = this.parseString();
        let params = [];
        if (this.match(T.LPAREN)) {
          while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
            params.push(this.expect(T.IDENT).value);
            this.match(T.COMMA);
          }
          this.expect(T.RPAREN);
        }
        this.expect(T.COLON);
        const body = this.parseBlock();
        jobs.push({ name: jobName, params, body });
      } else {
        this.advance();
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('QueueDecl', { name, jobs });
  }

  parseOpenapi() {
    this.advance(); // openapi
    const path = this.parseString();
    return new ASTNode('OpenapiDecl', { path });
  }

  parsePrompt() {
    this.advance(); // prompt
    const name = this.expect(T.IDENT).value;
    let defaults = null;
    if (this.at(T.LBRACE)) {
      defaults = this.parseObject();
    }
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    const lines = [];
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.STRING)) {
        lines.push(this.parseString());
      } else {
        this.advance();
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);
    return new ASTNode('PromptDecl', { name, defaults, lines });
  }

  parsePage() {
    this.advance(); // page
    const filename = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    const elements = [];
    this.skipNewlines();
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      elements.push(this.parsePageElement());
      this.skipNewlines();
    }
    this.match(T.DEDENT);
    return new ASTNode('Page', { filename, elements });
  }

  parsePageElement() {
    const tag = this.advance().value;
    const args = [];
    while (this.at(T.STRING)) {
      args.push(this.parseString());
    }
    let children = [];
    if (this.at(T.COLON)) {
      this.advance();
      this.skipNewlines();
      this.expect(T.INDENT);
      this.skipNewlines();
      while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
        children.push(this.parsePageElement());
        this.skipNewlines();
      }
      this.match(T.DEDENT);
    }
    return new ASTNode('PageElement', { tag, args, children });
  }

  parseCli() {
    this.advance(); // cli
    const name = this.expect(T.IDENT).value;
    let description = null;
    if (this.at(T.STRING)) {
      description = this.parseString();
    }
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    const args = [];
    const flags = [];
    let run = null;
    this.skipNewlines();
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.IDENT) && this.peek().value === 'arg') {
        this.advance();
        const argName = this.parseString();
        let argType = 'str';
        if (TYPE_TOKENS.has(this.peek().type)) {
          argType = this.advance().value;
        } else if (this.at(T.IDENT) && ['str', 'int', 'num', 'bool'].includes(this.peek().value)) {
          argType = this.advance().value;
        }
        let desc = null;
        if (this.at(T.STRING)) desc = this.parseString();
        args.push({ name: argName, type: argType, description: desc });
      } else if (this.at(T.IDENT) && this.peek().value === 'flag') {
        this.advance();
        const short = this.parseString();
        const long = this.parseString();
        let desc = null;
        if (this.at(T.STRING)) desc = this.parseString();
        flags.push({ short, long, description: desc });
      } else if (this.at(T.IDENT) && this.peek().value === 'run') {
        this.advance();
        let params = [];
        if (this.match(T.LPAREN)) {
          while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
            params.push(this.expect(T.IDENT).value);
            this.match(T.COMMA);
          }
          this.expect(T.RPAREN);
        }
        this.expect(T.COLON);
        run = { params, body: this.parseBlock() };
      } else {
        this.advance();
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);
    return new ASTNode('CliApp', { name, description, args, flags, run });
  }

  parseMail() {
    this.advance(); // mail
    const host = this.parseString();
    const port = this.parseExpression();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let user = null, pass = null;
    this.skipNewlines();
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.IDENT) && this.peek().value === 'user') {
        this.advance();
        user = this.parseExpression();
      } else if (this.at(T.IDENT) && this.peek().value === 'pass') {
        this.advance();
        pass = this.parseExpression();
      } else {
        this.advance();
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);
    return new ASTNode('MailConfig', { host, port, user, pass });
  }

  parseGraphql() {
    this.advance(); // graphql
    const path = this.parseString();
    return new ASTNode('GraphqlDecl', { path });
  }

  parseDesktop() {
    this.advance(); // desktop
    const name = this.expect(T.IDENT).value;
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let title = null, width = null, height = null, load = null;
    this.skipNewlines();
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      if (this.at(T.IDENT) && this.peek().value === 'title') {
        this.advance();
        title = this.parseString();
      } else if (this.at(T.IDENT) && this.peek().value === 'size') {
        this.advance();
        width = this.parseExpression();
        height = this.parseExpression();
      } else if (this.at(T.IDENT) && this.peek().value === 'load') {
        this.advance();
        load = this.parseExpression();
      } else {
        this.advance();
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);
    return new ASTNode('DesktopApp', { name, title, width, height, load });
  }

  parseScreen() {
    this.advance(); // screen
    const name = this.expect(T.IDENT).value;
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    const elements = [];
    this.skipNewlines();
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      elements.push(this.parseScreenElement());
      this.skipNewlines();
    }
    this.match(T.DEDENT);
    return new ASTNode('Screen', { name, elements });
  }

  parseScreenElement() {
    const tag = this.advance().value;
    const args = [];
    while (this.at(T.STRING)) {
      args.push(this.parseString());
    }
    let body = [];
    if (this.at(T.COLON)) {
      this.advance();
      body = this.parseBlock();
    }
    return new ASTNode('ScreenElement', { tag, args, body });
  }

  // oauth "google" clientId clientSecret:
  //   callback "/auth/callback"
  //   scope "email profile"
  parseOauth() {
    this.expect(T.OAUTH);
    const provider = this.parseString();
    const clientId = this.parseExpression();
    const clientSecret = this.parseExpression();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let callback = null, scope = null;
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'callback') { this.advance(); callback = this.parseString(); }
      else if (kw === 'scope') { this.advance(); scope = this.parseString(); }
      else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('OauthDecl', { provider, clientId, clientSecret, callback, scope });
  }

  // pay "stripe" secretKey:
  //   webhook "/webhook"
  parsePay() {
    this.expect(T.PAY);
    const provider = this.parseString();
    const secretKey = this.parseExpression();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let webhook = null, successUrl = null, cancelUrl = null;
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'webhook') { this.advance(); webhook = this.parseString(); }
      else if (kw === 'success') { this.advance(); successUrl = this.parseString(); }
      else if (kw === 'cancel') { this.advance(); cancelUrl = this.parseString(); }
      else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('PayDecl', { provider, secretKey, webhook, successUrl, cancelUrl });
  }

  // storage "s3" bucket accessKey secretKey:
  //   region "ap-northeast-1"
  parseStorage() {
    this.expect(T.STORAGE);
    const provider = this.parseString();
    const bucket = this.parseExpression();
    const accessKey = this.parseExpression();
    const secretKey = this.parseExpression();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let region = null;
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'region') { this.advance(); region = this.parseString(); }
      else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('StorageDecl', { provider, bucket, accessKey, secretKey, region });
  }

  // pdf "output.pdf":
  //   title "My Document"
  //   text "Hello World"
  //   table data
  parsePdf() {
    this.expect(T.PDF);
    const filename = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    const elements = [];
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const tag = this.advance().value;
      const args = [];
      while (this.at(T.STRING)) args.push(this.parseString());
      if (args.length === 0 && !this.at(T.NEWLINE) && !this.at(T.DEDENT) && !this.at(T.EOF)) {
        args.push(this.parseExpression());
      }
      elements.push({ tag, args });
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('PdfDecl', { filename, elements });
  }

  // i18n "locales/":
  //   default "en"
  //   lang "ja" "jp.json"
  //   lang "en" "en.json"
  parseI18n() {
    this.expect(T.I18N);
    const dir = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let defaultLang = null;
    const langs = [];
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'default') { this.advance(); defaultLang = this.parseString(); }
      else if (kw === 'lang') { this.advance(); const code = this.parseString(); const file = this.parseString(); langs.push({ code, file }); }
      else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('I18nDecl', { dir, defaultLang, langs });
  }

  // push "vapid_public" "vapid_private":
  //   endpoint "/subscribe"
  parsePush() {
    this.expect(T.PUSH);
    const publicKey = this.parseExpression();
    const privateKey = this.parseExpression();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let endpoint = null;
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'endpoint') { this.advance(); endpoint = this.parseString(); }
      else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('PushDecl', { publicKey, privateKey, endpoint });
  }

  // search "meilisearch" "http://localhost:7700" apiKey:
  //   index "products"
  parseSearch() {
    this.expect(T.SEARCH);
    const engine = this.parseString();
    const host = this.parseExpression();
    const apiKey = this.parseExpression();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let index = null;
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'index') { this.advance(); index = this.parseString(); }
      else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('SearchDecl', { engine, host, apiKey, index });
  }

  // image "input.jpg" -> "output.jpg":
  //   resize 800 600
  //   crop 100 100 400 300
  //   watermark "logo.png"
  parseImage() {
    this.expect(T.IMAGE);
    const input = this.parseExpression();
    let output = null;
    if (this.at(T.ARROW)) { this.advance(); output = this.parseExpression(); }
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    const operations = [];
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const op = this.advance().value;
      const args = [];
      while (!this.at(T.NEWLINE) && !this.at(T.DEDENT) && !this.at(T.EOF)) {
        if (this.at(T.STRING)) { args.push(this.parseString()); }
        else if (this.at(T.NUMBER)) { args.push(this.advance().value); }
        else { args.push(this.parseExpression()); break; }
      }
      operations.push({ op, args });
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('ImageDecl', { input, output, operations });
  }

  // csv "users" format "xlsx":
  //   columns "name" "email" "age"
  //   from users
  parseCsv() {
    this.expect(T.CSV);
    const name = this.parseString();
    let format = null;
    let source = null;
    let columns = [];
    let output = null;
    if (this.peek().value === 'format') { this.advance(); format = this.parseString(); }
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'columns') {
        this.advance();
        while (this.at(T.STRING)) { columns.push(this.parseString()); }
      } else if (kw === 'from') {
        this.advance(); source = this.parseExpression();
      } else if (kw === 'output') {
        this.advance(); output = this.parseString();
      } else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('CsvDecl', { name, format, source, columns, output });
  }

  // logging "app":
  //   level "info"
  //   file "app.log"
  //   format "json"
  parseLogging() {
    this.expect(T.LOGGING);
    const name = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let level = null;
    let file = null;
    let format = null;
    let rotate = null;
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'level') { this.advance(); level = this.parseString(); }
      else if (kw === 'file') { this.advance(); file = this.parseString(); }
      else if (kw === 'format') { this.advance(); format = this.parseString(); }
      else if (kw === 'rotate') { this.advance(); rotate = this.parseString(); }
      else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('LoggingDecl', { name, level, file, format, rotate });
  }

  // migrate "create_users":
  //   up:
  //     sql "CREATE TABLE users (...)"
  //   down:
  //     sql "DROP TABLE users"
  parseMigrate() {
    this.expect(T.MIGRATE);
    const name = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let up = [];
    let down = [];
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'up') {
        this.advance(); this.expect(T.COLON);
        up = this.parseBlock();
      } else if (kw === 'down') {
        this.advance(); this.expect(T.COLON);
        down = this.parseBlock();
      } else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('MigrateDecl', { name, up, down });
  }

  // grpc "users" port 50051:
  //   rpc getUser(id) -> user
  //   rpc createUser(data) -> user
  parseGrpc() {
    this.expect(T.GRPC);
    const name = this.parseString();
    let port = null;
    if (this.peek().value === 'port') { this.advance(); port = this.parseExpression(); }
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    const rpcs = [];
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'rpc') {
        this.advance();
        const method = this.advance().value;
        this.expect(T.LPAREN);
        const params = [];
        while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
          params.push(this.advance().value);
          this.match(T.COMMA);
        }
        this.expect(T.RPAREN);
        let returnType = null;
        if (this.at(T.ARROW)) { this.advance(); returnType = this.advance().value; }
        let body = [];
        if (this.at(T.COLON)) { this.advance(); body = this.parseBlock(); }
        rpcs.push({ method, params, returnType, body });
      } else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('GrpcDecl', { name, port, rpcs });
  }

  // webrtc "video-chat":
  //   stun "stun:stun.l.google.com:19302"
  //   on offer(data):
  //     ...
  parseWebrtc() {
    this.expect(T.WEBRTC);
    const name = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let stun = null;
    let turn = null;
    const events = [];
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'stun') { this.advance(); stun = this.parseString(); }
      else if (kw === 'turn') { this.advance(); turn = this.parseString(); }
      else if (kw === 'on') {
        this.advance();
        const eventName = this.advance().value;
        const params = [];
        if (this.at(T.LPAREN)) {
          this.advance();
          while (!this.at(T.RPAREN) && !this.at(T.EOF)) {
            params.push(this.advance().value);
            this.match(T.COMMA);
          }
          this.expect(T.RPAREN);
        }
        this.expect(T.COLON);
        const body = this.parseBlock();
        events.push({ event: eventName, params, body });
      } else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('WebrtcDecl', { name, stun, turn, events });
  }

  // blockchain "mytoken":
  //   network "ethereum"
  //   provider env.ETH_RPC
  //   contract "0x..."
  parseBlockchain() {
    this.expect(T.BLOCKCHAIN);
    const name = this.parseString();
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);
    let network = null;
    let provider = null;
    let contract = null;
    let abi = null;
    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      this.skipNewlines();
      if (this.at(T.DEDENT) || this.at(T.EOF)) break;
      const kw = this.peek().value;
      if (kw === 'network') { this.advance(); network = this.parseString(); }
      else if (kw === 'provider') { this.advance(); provider = this.parseExpression(); }
      else if (kw === 'contract') { this.advance(); contract = this.parseString(); }
      else if (kw === 'abi') { this.advance(); abi = this.parseString(); }
      else { this.advance(); }
      this.skipNewlines();
    }
    if (this.at(T.DEDENT)) this.advance();
    return new ASTNode('BlockchainDecl', { name, network, provider, contract, abi });
  }

  // unless cond:  → desugars to if (!cond)
  parseUnless() {
    this.advance();
    const condition = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('If', {
      condition: new ASTNode('Unary', { op: '!', expr: condition }),
      elifs: [], elseBody: null, body
    });
  }

  // until cond:  → desugars to while (!cond)
  parseUntil() {
    this.advance();
    const condition = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('While', {
      condition: new ASTNode('Unary', { op: '!', expr: condition }),
      body
    });
  }

  // repeat 5:  or  repeat 5 as i:
  parseRepeat() {
    this.advance();
    const count = this.parseExpression();
    let varName = 'it';
    if (this.peek().value === 'as') {
      this.advance();
      varName = this.advance().value;
    }
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('For', {
      varName,
      start: new ASTNode('Number', { value: '0' }),
      end: count,
      body
    });
  }

  // enum Color: red, green, blue
  parseEnum() {
    this.advance();
    const name = this.advance().value;
    this.expect(T.COLON);
    const values = [];
    if (this.at(T.INDENT) || this.at(T.NEWLINE)) {
      this.skipNewlines();
      this.expect(T.INDENT);
      while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
        this.skipNewlines();
        if (this.at(T.DEDENT) || this.at(T.EOF)) break;
        values.push(this.advance().value);
        this.match(T.COMMA);
        this.skipNewlines();
      }
      if (this.at(T.DEDENT)) this.advance();
    } else {
      while (!this.at(T.NEWLINE) && !this.at(T.EOF)) {
        values.push(this.advance().value);
        this.match(T.COMMA);
      }
    }
    return new ASTNode('EnumDecl', { name, values });
  }

  // swap a, b
  parseSwap() {
    this.advance();
    const a = this.parseExpression();
    this.expect(T.COMMA);
    const b = this.parseExpression();
    return new ASTNode('Swap', { a, b });
  }
}
