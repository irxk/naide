import { T, TYPE_TOKENS } from './tokens.js';

class ASTNode {
  constructor(type, props = {}) {
    this.type = type;
    Object.assign(this, props);
  }
}

export class Parser {
  constructor(tokens) {
    this.tokens = this.preprocessTokens(tokens.filter(t => t.type !== T.COMMENT));
    this.pos = 0;
  }

  preprocessTokens(tokens) {
    // Remove INDENT/DEDENT pairs around pipe continuation lines
    // Pattern: NEWLINE INDENT PIPE -> NEWLINE PIPE (and remove matching DEDENT)
    const result = [...tokens];
    const indentsToRemove = new Set();

    for (let i = 0; i < result.length; i++) {
      if (result[i].type !== T.INDENT) continue;
      // Look forward past any newlines for PIPE
      let j = i + 1;
      while (j < result.length && result[j].type === T.NEWLINE) j++;
      if (j < result.length && result[j].type === T.PIPE) {
        indentsToRemove.add(i);
      }
    }

    if (indentsToRemove.size === 0) return result;

    // For each INDENT to remove, find matching DEDENT
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
      throw this.error(`Expected ${type} but got ${tok.type} ('${tok.value}')`, tok);
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

  expectPropertyName() {
    const tok = this.advance();
    if (tok.type === T.IDENT || TYPE_TOKENS.has(tok.type) ||
        tok.type === T.LOG || tok.type === T.DB || tok.type === T.GET ||
        tok.type === T.POST || tok.type === T.PUT || tok.type === T.DEL ||
        tok.type === T.MATCH || tok.type === T.ON || tok.type === T.NEW ||
        tok.type === T.FROM || tok.type === T.AS || tok.type === T.SELF ||
        tok.type === T.SCHEMA || tok.type === T.CRUD || tok.type === T.AUTH ||
        tok.type === T.CORS || tok.type === T.LIMIT || tok.type === T.ENV ||
        tok.type === T.EVERY || tok.type === T.WATCH) {
      return tok.value;
    }
    throw this.error(`Expected property name but got ${tok.type} ('${tok.value}')`, tok);
  }

  error(msg, tok) {
    const t = tok || this.peek();
    return new Error(`[NAIDE Parse Error] ${msg} at line ${t.line}:${t.col}`);
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
      case T.EACH: return this.parseEach();
      case T.FOR: return this.parseFor();
      case T.WHILE: return this.parseWhile();
      case T.MATCH: return this.parseMatch();
      case T.TRY: return this.parseTry();
      case T.SERVER: return this.parseServer();
      case T.MODEL: return this.parseModel();
      case T.ON: return this.parseOn();
      case T.LOG: return this.parseLog();
      case T.THROW: return this.parseThrow();
      case T.BREAK: this.advance(); return new ASTNode('Break');
      case T.CONTINUE: this.advance(); return new ASTNode('Continue');
      case T.MUT: return this.parseMutVariable();
      case T.DB: return this.parseDbStatement();
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
      default:
        if (TYPE_TOKENS.has(tok.type)) {
          return this.parseTypedVariable();
        }
        return this.parseExpressionStatement();
    }
  }

  // use express
  // use express from "express"
  // use {readFile, writeFile} from "fs/promises"
  parseUse() {
    this.advance(); // use

    if (this.at(T.LBRACE)) {
      // use {a, b} from "module"
      this.advance();
      const names = [];
      while (!this.at(T.RBRACE) && !this.at(T.EOF)) {
        const name = this.expect(T.IDENT).value;
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

  // fn name(params) -> returnType:
  //   body
  parseFunction(isAsync, isPublic) {
    this.advance(); // fn or fn.async
    const name = this.expect(T.IDENT).value;
    this.expect(T.LPAREN);
    const params = this.parseFnParams();
    this.expect(T.RPAREN);

    let returnType = null;
    if (this.match(T.ARROW)) {
      returnType = this.parseTypeAnnotation();
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

    // pub variable
    if (TYPE_TOKENS.has(this.peek().type)) {
      const node = this.parseTypedVariable();
      node.isPublic = true;
      return node;
    }

    throw this.error('Expected fn, model, or type after pub');
  }

  // ret expression
  parseReturn() {
    this.advance(); // ret
    if (this.at(T.NEWLINE) || this.at(T.EOF) || this.at(T.DEDENT)) {
      return new ASTNode('Return', { value: null });
    }
    // ret.status 200 {...}
    if (this.match(T.DOT)) {
      const method = this.expect(T.IDENT).value;
      const statusCode = this.parseExpression();
      const body = this.parseExpression();
      return new ASTNode('ReturnStatus', { method, statusCode, body });
    }
    const value = this.parseExpression();
    return new ASTNode('Return', { value });
  }

  // str name = "hello"
  parseTypedVariable() {
    const varType = this.advance().value;
    const name = this.expect(T.IDENT).value;
    this.expect(T.ASSIGN);
    const value = this.parseExpression();
    return new ASTNode('TypedVar', { varType, name, value, isMut: false, isPublic: false });
  }

  // mut int counter = 0
  parseMutVariable() {
    this.advance(); // mut
    if (TYPE_TOKENS.has(this.peek().type)) {
      const node = this.parseTypedVariable();
      node.isMut = true;
      return node;
    }
    // mut name = value (no type)
    const name = this.expect(T.IDENT).value;
    this.expect(T.ASSIGN);
    const value = this.parseExpression();
    return new ASTNode('TypedVar', { varType: null, name, value, isMut: true });
  }

  // if condition:
  //   body
  // elif condition:
  //   body
  // else:
  //   body
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

  // each item in collection:
  //   body
  parseEach() {
    this.advance(); // each
    let key = null;
    const valueName = this.expect(T.IDENT).value;
    if (this.match(T.COMMA)) {
      key = valueName;
      // The next ident is actually the value
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

  // for i in 0..10:
  //   body
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

  // while condition:
  //   body
  parseWhile() {
    this.advance(); // while
    const condition = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('While', { condition, body });
  }

  // match value:
  //   pattern: body
  //   _: default
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

  // try:
  //   body
  // fail e:
  //   handler
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

    return new ASTNode('Try', { body, catchVar, catchBody });
  }

  // server app port 3000:
  //   get "/path" -> type:
  //     body
  parseServer() {
    this.advance(); // server
    const name = this.expect(T.IDENT).value;

    let portKw = null;
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
      if (this.atAny(T.GET, T.POST, T.PUT, T.DEL)) {
        routes.push(this.parseRoute());
      } else if (this.at(T.MID)) {
        middleware.push(this.parseMiddleware());
      } else if (this.at(T.CRUD)) {
        routes.push(this.parseCrud());
      } else if (this.at(T.AUTH)) {
        routes.push(this.parseAuth());
      } else if (this.at(T.CORS)) {
        routes.push(this.parseCors());
      } else if (this.at(T.LIMIT)) {
        routes.push(this.parseLimit());
      } else {
        routes.push(this.parseStatement());
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('Server', { name, port, routes, middleware });
  }

  parseRoute() {
    const method = this.advance().value; // get/post/put/del
    const path = this.parseString();

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

    return new ASTNode('Route', { method, path, params, returnType, body });
  }

  parseMiddleware() {
    this.advance(); // mid
    const name = this.expect(T.IDENT).value;
    this.expect(T.LPAREN);
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

  // model User:
  //   str name
  //   int age
  //   fn greet() -> str:
  //     ret "hi"
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
        // skip unknown
        this.advance();
      }
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('Model', { name, parent, fields, methods, isPublic });
  }

  // on event:
  //   body
  parseOn() {
    this.advance(); // on
    const event = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('On', { event, body });
  }

  // log "message"
  // log.error "message"
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
    // db.query, db.find, etc -> treat as expression
    this.pos -= 3; // rewind to parse as expression
    return this.parseExpressionStatement();
  }

  parseAwaitStatement() {
    // could be await expression or standalone await call
    return this.parseExpressionStatement();
  }

  // [a, b] = await.all [expr1, expr2]
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

    // Check for assignment: expr = value
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

  // Expression parsing with precedence climbing
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
    // Lookahead across newlines for pipe (INDENT/DEDENT already preprocessed)
    let scanPos = this.pos;
    while (scanPos < this.tokens.length && this.tokens[scanPos].type === T.NEWLINE) {
      scanPos++;
    }
    if (scanPos < this.tokens.length && this.tokens[scanPos].type === T.PIPE) {
      while (this.at(T.NEWLINE)) this.advance();
      this.advance(); // consume PIPE
      return true;
    }
    return false;
  }

  parseTernary() {
    let expr = this.parseNullish();
    // inline if: value = if cond then a else b
    if (this.at(T.IF)) {
      // Only treat as ternary if we're in an expression context
      // Lookahead: if ... then ... else
      const savedPos = this.pos;
      this.advance(); // if
      const condition = this.parseNullish();
      if (this.match(T.THEN)) {
        const consequent = this.parseNullish();
        this.expect(T.ELSE);
        const alternate = this.parseNullish();
        return new ASTNode('Ternary', { condition, consequent, alternate });
      }
      // Not a ternary, restore
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
    while (this.atAny(T.EQ, T.NEQ, T.GT, T.LT, T.GTE, T.LTE)) {
      const op = this.advance().value;
      const right = this.parseAddition();
      left = new ASTNode('Binary', { op: op === '==' ? '===' : op === '!=' ? '!==' : op, left, right });
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
        // In expression context, type keywords act as identifiers (e.g., arr.map(), JSON.parse())
        this.advance();
        return new ASTNode('Identifier', { name: tok.value });

      case T.SCHEMA: case T.CRUD: case T.AUTH: case T.CORS:
      case T.LIMIT: case T.ENV: case T.EVERY: case T.WATCH:
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
    // Check if this is an arrow function: (params) => body
    const savedPos = this.pos;
    this.advance(); // (

    // Try to parse as arrow function params
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

    // Regular grouping
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
        key = this.expect(T.IDENT).value;
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

  // schema User:
  //   id     auto
  //   name   str required min(2) max(50)
  //   email  str required email unique
  parseSchema() {
    this.advance(); // schema
    const name = this.expect(T.IDENT).value;
    this.expect(T.COLON);
    this.skipNewlines();
    this.expect(T.INDENT);

    const fields = [];
    this.skipNewlines();

    while (!this.at(T.DEDENT) && !this.at(T.EOF)) {
      fields.push(this.parseSchemaField());
      this.skipNewlines();
    }
    this.match(T.DEDENT);

    return new ASTNode('SchemaDecl', { name, fields });
  }

  parseSchemaField() {
    const name = this.expect(T.IDENT).value;

    let fieldType;
    let enumValues = null;

    if (TYPE_TOKENS.has(this.peek().type)) {
      fieldType = this.advance().value;
    } else if (this.at(T.IDENT)) {
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
      if (this.at(T.IDENT) || this.at(T.IDENT)) {
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

  // crud "/api/users" User
  parseCrud() {
    this.advance(); // crud
    const path = this.parseString();
    const schemaName = this.expect(T.IDENT).value;
    return new ASTNode('CrudDecl', { path, schemaName });
  }

  // auth SECRET:
  //   protect "/api/*"
  //   public "/api/auth/*"
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

  // cors "*"
  // cors ["origin1", "origin2"]
  parseCors() {
    this.advance(); // cors
    const origins = this.parseExpression();
    return new ASTNode('CorsDecl', { origins });
  }

  // limit "/api/*" 100 "1m"
  parseLimit() {
    this.advance(); // limit
    const path = this.parseString();
    const max = this.parseExpression();
    const window = this.parseExpression();
    return new ASTNode('LimitDecl', { path, max, window });
  }

  // env:
  //   PORT int default(3000)
  //   JWT_SECRET str required
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

  // every "5m":
  //   log "tick"
  parseEvery() {
    this.advance(); // every
    const interval = this.parseExpression();
    this.expect(T.COLON);
    const body = this.parseBlock();
    return new ASTNode('EveryDecl', { interval, body });
  }

  // watch User.create (event):
  //   log event
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
}
