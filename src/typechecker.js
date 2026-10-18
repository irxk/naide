export class TypeChecker {
  constructor() {
    this.scopes = [new Map()];
    this.errors = [];
    this.warnings = [];
    this.functions = new Map();
    this.returnTypes = [];
  }

  pushScope() { this.scopes.push(new Map()); }
  popScope() { this.scopes.pop(); }

  setType(name, type) {
    this.scopes[this.scopes.length - 1].set(name, type);
  }

  getType(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    }
    return null;
  }

  error(msg, line) {
    this.errors.push({ message: msg, line: line || 0, severity: 'error' });
  }

  warn(msg, line) {
    this.warnings.push({ message: msg, line: line || 0, severity: 'warning' });
  }

  check(ast) {
    for (const stmt of ast.body) {
      if (stmt.type === 'Function') this.registerFunction(stmt);
    }
    this.visitProgram(ast);
    return { errors: this.errors, warnings: this.warnings };
  }

  registerFunction(node) {
    this.functions.set(node.name, {
      params: node.params.map(p => ({ name: p.name, type: p.type || 'any', hasDefault: p.defaultValue !== null, spread: p.spread })),
      returnType: node.returnType || 'any',
      isAsync: node.isAsync || false,
    });
  }

  visitProgram(node) {
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
  }

  visitStatement(node) {
    const line = node._line || 0;
    switch (node.type) {
      case 'TypedVar': return this.visitTypedVar(node, line);
      case 'Function': return this.visitFunction(node, line);
      case 'Assignment': return this.visitAssignment(node, line);
      case 'Return': return this.visitReturn(node, line);
      case 'If': return this.visitIf(node, line);
      case 'Each': return this.visitEach(node, line);
      case 'For': return this.visitFor(node, line);
      case 'While': return this.visitWhile(node, line);
      case 'Try': return this.visitTry(node, line);
      case 'Server': return this.visitBlock(node.body, line);
      default: return;
    }
  }

  visitBlock(body, _line) {
    if (!body) return;
    this.pushScope();
    for (const stmt of body) {
      this.visitStatement(stmt);
    }
    this.popScope();
  }

  visitTypedVar(node, line) {
    const declaredType = node.varType;
    const inferredType = this.inferType(node.value);

    if (declaredType && inferredType && inferredType !== 'any' && declaredType !== 'any') {
      const compatible = this.typesCompatible(declaredType, inferredType);
      if (!compatible) {
        this.error(`Type mismatch: cannot assign ${inferredType} to ${declaredType}`, line);
      }
    }

    this.setType(node.name, declaredType || inferredType || 'any');
  }

  visitFunction(node, line) {
    this.registerFunction(node);

    this.setType(node.name, 'function');

    this.pushScope();
    for (const p of node.params) {
      this.setType(p.name, p.type || 'any');
    }
    this.returnTypes.push(node.returnType || 'any');
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    this.returnTypes.pop();
    this.popScope();
  }

  visitAssignment(node, line) {
    if (node.target.type === 'Identifier') {
      const existing = this.getType(node.target.name);
      const newType = this.inferType(node.value);
      if (existing && existing !== 'any' && newType && newType !== 'any') {
        if (!this.typesCompatible(existing, newType)) {
          this.warn(`Type warning: reassigning ${existing} variable '${node.target.name}' with ${newType}`, line);
        }
      }
      if (!existing) {
        this.setType(node.target.name, newType || 'any');
      }
    }
  }

  visitReturn(node, line) {
    const expectedType = this.returnTypes[this.returnTypes.length - 1];
    if (!expectedType || expectedType === 'any') return;

    if (!node.value) {
      if (expectedType !== 'void') {
        this.error(`Return type mismatch: expected ${expectedType} but got void`, line);
      }
      return;
    }

    const actualType = this.inferType(node.value);
    if (actualType !== 'any' && !this.typesCompatible(expectedType, actualType)) {
      this.error(`Return type mismatch: expected ${expectedType} but got ${actualType}`, line);
    }
  }

  visitIf(node, line) {
    this.visitBlock(node.body, line);
    for (const elif of (node.elifs || [])) {
      this.visitBlock(elif.body, line);
    }
    if (node.elseBody) {
      this.visitBlock(node.elseBody, line);
    }
  }

  visitEach(node, line) {
    this.pushScope();
    this.setType(node.variable, 'any');
    if (node.keyVar) this.setType(node.keyVar, 'any');
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    this.popScope();
  }

  visitFor(node, line) {
    this.pushScope();
    this.setType(node.variable, 'int');
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    this.popScope();
  }

  visitWhile(node, line) {
    this.visitBlock(node.body, line);
  }

  visitTry(node, line) {
    this.visitBlock(node.body, line);
    if (node.catchBody) {
      this.pushScope();
      if (node.catchVar) this.setType(node.catchVar, 'any');
      for (const stmt of node.catchBody) {
        this.visitStatement(stmt);
      }
      this.popScope();
    }
    if (node.ensureBody) {
      this.visitBlock(node.ensureBody, line);
    }
  }

  inferType(node) {
    if (!node) return 'any';
    switch (node.type) {
      case 'Number': {
        const n = typeof node.value === 'string' ? Number(node.value) : node.value;
        return Number.isInteger(n) && !String(node.value).includes('.') ? 'int' : 'num';
      }
      case 'String': return 'str';
      case 'InterpolatedString': return 'str';
      case 'Boolean': return 'bool';
      case 'Null': return 'any';
      case 'Array': return 'list';
      case 'Object': return 'map';
      case 'Identifier': return this.getType(node.name) || 'any';
      case 'Binary': return this.inferBinaryType(node);
      case 'Unary': {
        if (node.op === 'not') return 'bool';
        if (node.op === 'typeof') return 'str';
        return this.inferType(node.operand);
      }
      case 'Call': return this.inferCallType(node);
      case 'MemberAccess': return 'any';
      case 'Ternary': {
        const t = this.inferType(node.consequent);
        const f = this.inferType(node.alternate);
        return t === f ? t : 'any';
      }
      case 'Await': return this.inferType(node.expression);
      case 'ArrowFunction': return 'function';
      default: return 'any';
    }
  }

  inferBinaryType(node) {
    const op = node.op;
    if (['==', '!=', '>', '<', '>=', '<=', 'and', 'or'].includes(op)) return 'bool';
    if (['+', '-', '*', '/', '%'].includes(op)) {
      const l = this.inferType(node.left);
      const r = this.inferType(node.right);
      if (l === 'str' || r === 'str') {
        if (op === '+') return 'str';
      }
      if (l === 'num' || r === 'num') return 'num';
      if (l === 'int' && r === 'int') return 'int';
      return 'num';
    }
    return 'any';
  }

  inferCallType(node) {
    if (node.callee.type === 'Identifier') {
      const fn = this.functions.get(node.callee.name);
      if (fn) {
        this.checkCallArguments(node, fn);
        return fn.returnType;
      }

      const builtins = {
        'uuid': 'str', 'hash': 'str', 'verify': 'bool',
        'sign': 'str', 'parseInt': 'int', 'parseFloat': 'num',
        'String': 'str', 'Number': 'num', 'Boolean': 'bool',
        'createMock': 'function', 'createSpy': 'function',
      };
      if (builtins[node.callee.name]) return builtins[node.callee.name];
    }

    if (node.callee.type === 'MemberAccess') {
      const obj = node.callee.object;
      const prop = node.callee.property;
      if (obj.type === 'Identifier' && obj.name === 'ai') {
        if (prop === 'ask' || prop === 'chat') return 'str';
        if (prop === 'json') return 'map';
        if (prop === 'embed') return 'list';
        if (prop === 'similarity') return 'num';
      }
      if (obj.type === 'Identifier' && obj.name === 'api') return 'any';
      if (prop === 'length') return 'int';
      if (['map', 'filter', 'slice'].includes(prop)) return 'list';
      if (['join', 'toString', 'trim', 'toLowerCase', 'toUpperCase'].includes(prop)) return 'str';
      if (['includes', 'startsWith', 'endsWith', 'some', 'every'].includes(prop)) return 'bool';
      if (['indexOf', 'findIndex'].includes(prop)) return 'int';
    }

    return 'any';
  }

  checkCallArguments(node, fn) {
    const params = fn.params;
    const line = node._line || 0;
    const requiredCount = params.filter(p => !p.hasDefault && !p.spread).length;
    const hasSpread = params.some(p => p.spread);

    if (node.args.length < requiredCount || (!hasSpread && node.args.length > params.length)) {
      const expected = hasSpread ? `at least ${requiredCount}` : `${requiredCount}${params.length === requiredCount ? '' : ` to ${params.length}`}`;
      this.error(`Argument count mismatch for '${node.callee.name}': expected ${expected}, got ${node.args.length}`, line);
    }

    const spreadIndex = params.findIndex(param => param.spread);
    for (let i = 0; i < node.args.length; i++) {
      const paramIndex = spreadIndex >= 0 && i >= spreadIndex ? spreadIndex : i;
      const param = params[paramIndex];
      if (!param) continue;
      const expectedType = param.type;
      const actualType = this.inferType(node.args[i]);
      if (expectedType !== 'any' && actualType !== 'any' && !this.typesCompatible(expectedType, actualType)) {
        this.error(`Argument '${param.name}' of '${node.callee.name}' expects ${expectedType} but got ${actualType}`, line);
      }
    }
  }

  typesCompatible(declared, actual) {
    if (declared === actual) return true;
    if (declared === 'any' || actual === 'any') return true;
    if (declared === 'num' && actual === 'int') return true;
    if (declared === 'json' && ['str', 'int', 'num', 'bool', 'list', 'map'].includes(actual)) return true;
    return false;
  }
}
