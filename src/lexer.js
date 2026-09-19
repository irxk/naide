import { T, KEYWORDS } from './tokens.js';

class Token {
  constructor(type, value, line, col) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
  }
}

export class Lexer {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.indentStack = [0];
    this.atLineStart = true;
  }

  peek() {
    return this.pos < this.source.length ? this.source[this.pos] : null;
  }

  advance() {
    const ch = this.source[this.pos++];
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  lookAhead(n = 1) {
    return this.pos + n < this.source.length ? this.source[this.pos + n] : null;
  }

  makeToken(type, value) {
    return new Token(type, value, this.line, this.col);
  }

  tokenize() {
    while (this.pos < this.source.length) {
      if (this.atLineStart) {
        this.handleIndentation();
        this.atLineStart = false;
      }

      const ch = this.peek();
      if (ch === null) break;

      if (ch === '\n') {
        this.advance();
        // Skip consecutive newlines
        if (this.tokens.length > 0 && this.tokens[this.tokens.length - 1].type !== T.NEWLINE) {
          this.tokens.push(this.makeToken(T.NEWLINE, '\n'));
        }
        this.atLineStart = true;
        continue;
      }

      if (ch === '\r') {
        this.advance();
        continue;
      }

      if (ch === ' ' || ch === '\t') {
        this.advance();
        continue;
      }

      if (ch === '#') {
        this.skipComment();
        continue;
      }

      if (ch === '"' || ch === "'") {
        this.readString(ch);
        continue;
      }

      if (ch === '`') {
        this.readTemplateString();
        continue;
      }

      if (this.isDigit(ch)) {
        this.readNumber();
        continue;
      }

      if (this.isIdentStart(ch)) {
        this.readIdentifier();
        continue;
      }

      this.readOperator();
    }

    // Emit remaining DEDENTs
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.tokens.push(this.makeToken(T.DEDENT, ''));
    }

    this.tokens.push(this.makeToken(T.EOF, ''));
    return this.tokens;
  }

  handleIndentation() {
    let indent = 0;
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === ' ') {
        indent++;
        this.pos++;
        this.col++;
      } else if (ch === '\t') {
        indent += 2;
        this.pos++;
        this.col++;
      } else {
        break;
      }
    }

    // Skip blank lines and comment-only lines
    if (this.pos >= this.source.length || this.source[this.pos] === '\n' || this.source[this.pos] === '#') {
      return;
    }

    const currentIndent = this.indentStack[this.indentStack.length - 1];

    if (indent > currentIndent) {
      this.indentStack.push(indent);
      this.tokens.push(this.makeToken(T.INDENT, indent));
    } else if (indent < currentIndent) {
      while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1] > indent) {
        this.indentStack.pop();
        this.tokens.push(this.makeToken(T.DEDENT, ''));
      }
    }
  }

  skipComment() {
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.advance();
    }
  }

  readString(quote) {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip opening quote

    let parts = [];
    let current = '';

    while (this.pos < this.source.length && this.peek() !== quote) {
      if (this.peek() === '\\') {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case 'n': current += '\n'; break;
          case 't': current += '\t'; break;
          case 'r': current += '\r'; break;
          case '\\': current += '\\'; break;
          case '"': current += '"'; break;
          case "'": current += "'"; break;
          case '{': current += '{'; break;
          default: current += '\\' + esc;
        }
      } else if (this.peek() === '{' && quote === '"') {
        // String interpolation - only in double quotes
        if (current) {
          parts.push({ type: 'text', value: current });
          current = '';
        }
        this.advance(); // skip {
        let expr = '';
        let depth = 1;
        while (this.pos < this.source.length && depth > 0) {
          if (this.peek() === '{') depth++;
          if (this.peek() === '}') depth--;
          if (depth > 0) expr += this.advance();
          else this.advance(); // skip closing }
        }
        parts.push({ type: 'expr', value: expr.trim() });
      } else {
        current += this.advance();
      }
    }

    if (this.peek() === quote) this.advance(); // skip closing quote

    if (current) parts.push({ type: 'text', value: current });

    if (parts.length === 0) {
      this.tokens.push(new Token(T.STRING, { parts: [{ type: 'text', value: '' }], raw: '' }, startLine, startCol));
    } else if (parts.length === 1 && parts[0].type === 'text') {
      this.tokens.push(new Token(T.STRING, { parts, raw: parts[0].value }, startLine, startCol));
    } else {
      this.tokens.push(new Token(T.STRING, { parts, raw: null }, startLine, startCol));
    }
  }

  readTemplateString() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip `
    let value = '';
    while (this.pos < this.source.length && this.peek() !== '`') {
      if (this.peek() === '\\') {
        this.advance();
        value += this.advance();
      } else {
        value += this.advance();
      }
    }
    if (this.peek() === '`') this.advance();
    this.tokens.push(new Token(T.STRING, { parts: [{ type: 'text', value }], raw: value }, startLine, startCol));
  }

  readNumber() {
    const startLine = this.line;
    const startCol = this.col;
    let num = '';
    let isFloat = false;

    while (this.pos < this.source.length && (this.isDigit(this.peek()) || this.peek() === '.' || this.peek() === '_')) {
      if (this.peek() === '.') {
        if (isFloat) break;
        if (this.lookAhead() === '.') break; // range operator ..
        isFloat = true;
      }
      if (this.peek() !== '_') {
        num += this.peek();
      }
      this.advance();
    }

    this.tokens.push(new Token(T.NUMBER, num, startLine, startCol));
  }

  readIdentifier() {
    const startLine = this.line;
    const startCol = this.col;
    let ident = '';

    while (this.pos < this.source.length && this.isIdentChar(this.peek())) {
      ident += this.advance();
    }

    // Check for compound keywords
    if (ident === 'fn' && this.peek() === '.') {
      const savedPos = this.pos;
      const savedCol = this.col;
      this.advance(); // skip .
      let sub = '';
      while (this.pos < this.source.length && this.isIdentChar(this.peek())) {
        sub += this.advance();
      }
      if (sub === 'async') {
        this.tokens.push(new Token(T.FN_ASYNC, 'fn.async', startLine, startCol));
        return;
      }
      // Restore if not a compound keyword
      this.pos = savedPos;
      this.col = savedCol;
    }

    if (ident === 'await' && this.peek() === '.') {
      const savedPos = this.pos;
      const savedCol = this.col;
      this.advance();
      let sub = '';
      while (this.pos < this.source.length && this.isIdentChar(this.peek())) {
        sub += this.advance();
      }
      if (sub === 'all') {
        this.tokens.push(new Token(T.AWAIT_ALL, 'await.all', startLine, startCol));
        return;
      }
      this.pos = savedPos;
      this.col = savedCol;
    }

    if (ident === 'ret' && this.peek() === '.') {
      // ret.status, ret.json etc - keep as IDENT with dot access
      this.tokens.push(new Token(T.RET, ident, startLine, startCol));
      return;
    }

    const keyword = KEYWORDS[ident];
    if (keyword) {
      this.tokens.push(new Token(keyword, ident, startLine, startCol));
    } else {
      this.tokens.push(new Token(T.IDENT, ident, startLine, startCol));
    }
  }

  readOperator() {
    const startLine = this.line;
    const startCol = this.col;
    const ch = this.advance();

    switch (ch) {
      case '=':
        if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(T.EQ, '==', startLine, startCol)); }
        else if (this.peek() === '>') { this.advance(); this.tokens.push(new Token(T.FAT_ARROW, '=>', startLine, startCol)); }
        else this.tokens.push(new Token(T.ASSIGN, '=', startLine, startCol));
        break;
      case '+':
        if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(T.PLUS_ASSIGN, '+=', startLine, startCol)); }
        else this.tokens.push(new Token(T.PLUS, '+', startLine, startCol));
        break;
      case '-':
        if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(T.MINUS_ASSIGN, '-=', startLine, startCol)); }
        else if (this.peek() === '>') { this.advance(); this.tokens.push(new Token(T.ARROW, '->', startLine, startCol)); }
        else this.tokens.push(new Token(T.MINUS, '-', startLine, startCol));
        break;
      case '*':
        this.tokens.push(new Token(T.STAR, '*', startLine, startCol));
        break;
      case '/':
        this.tokens.push(new Token(T.SLASH, '/', startLine, startCol));
        break;
      case '%':
        this.tokens.push(new Token(T.PERCENT, '%', startLine, startCol));
        break;
      case '!':
        if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(T.NEQ, '!=', startLine, startCol)); }
        else this.tokens.push(new Token(T.NOT, '!', startLine, startCol));
        break;
      case '>':
        if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(T.GTE, '>=', startLine, startCol)); }
        else this.tokens.push(new Token(T.GT, '>', startLine, startCol));
        break;
      case '<':
        if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(T.LTE, '<=', startLine, startCol)); }
        else this.tokens.push(new Token(T.LT, '<', startLine, startCol));
        break;
      case '|':
        if (this.peek() === '>') { this.advance(); this.tokens.push(new Token(T.PIPE, '|>', startLine, startCol)); }
        else this.tokens.push(new Token(T.IDENT, '|', startLine, startCol));
        break;
      case '?':
        if (this.peek() === '?') { this.advance(); this.tokens.push(new Token(T.NULLISH, '??', startLine, startCol)); }
        else if (this.peek() === '.') { this.advance(); this.tokens.push(new Token(T.OPTIONAL, '?.', startLine, startCol)); }
        else this.tokens.push(new Token(T.IDENT, '?', startLine, startCol));
        break;
      case '.':
        if (this.peek() === '.') {
          this.advance();
          if (this.peek() === '.') { this.advance(); this.tokens.push(new Token(T.SPREAD, '...', startLine, startCol)); }
          else this.tokens.push(new Token(T.RANGE, '..', startLine, startCol));
        } else {
          this.tokens.push(new Token(T.DOT, '.', startLine, startCol));
        }
        break;
      case '(': this.tokens.push(new Token(T.LPAREN, '(', startLine, startCol)); break;
      case ')': this.tokens.push(new Token(T.RPAREN, ')', startLine, startCol)); break;
      case '[': this.tokens.push(new Token(T.LBRACKET, '[', startLine, startCol)); break;
      case ']': this.tokens.push(new Token(T.RBRACKET, ']', startLine, startCol)); break;
      case '{': this.tokens.push(new Token(T.LBRACE, '{', startLine, startCol)); break;
      case '}': this.tokens.push(new Token(T.RBRACE, '}', startLine, startCol)); break;
      case ':': this.tokens.push(new Token(T.COLON, ':', startLine, startCol)); break;
      case ',': this.tokens.push(new Token(T.COMMA, ',', startLine, startCol)); break;
      default:
        throw new Error(`Unexpected character '${ch}' at line ${startLine}:${startCol}`);
    }
  }

  isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  isIdentStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
  }

  isIdentChar(ch) {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }
}
