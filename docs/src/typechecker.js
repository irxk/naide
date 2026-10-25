const EXPRESSION_TYPES = new Set([
  'Number', 'String', 'InterpolatedString', 'Bool', 'Null', 'Array', 'Object',
  'Identifier', 'Binary', 'Unary', 'Call', 'MemberAccess', 'Ternary', 'Await',
  'ArrowFunction', 'Spread', 'New', 'IndexAccess', 'OptionalAccess',
  'OptionalCall', 'OptionalIndexAccess', 'DynamicImport',
  'RegExp', 'Yield', 'Update',
]);

export class TypeChecker {
  constructor() {
    this.scopes = [new Map()];
    this.errors = [];
    this.warnings = [];
    this.errorKeys = new Set();
    this.warningKeys = new Set();
    this.visitedStatements = new WeakSet();
    this.functions = new Map();
    this.returnTypes = [];
    this.classDepth = 0;
    this.classContexts = [];
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
    const diagnostic = { message: msg, line: line || 0, severity: 'error' };
    const key = `${diagnostic.line}:${diagnostic.message}`;
    if (this.errorKeys.has(key)) return;
    this.errorKeys.add(key);
    this.errors.push(diagnostic);
  }

  warn(msg, line) {
    const diagnostic = { message: msg, line: line || 0, severity: 'warning' };
    const key = `${diagnostic.line}:${diagnostic.message}`;
    if (this.warningKeys.has(key)) return;
    this.warningKeys.add(key);
    this.warnings.push(diagnostic);
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
      isGenerator: node.isGenerator || false,
    });
  }

  visitProgram(node) {
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
  }

  visitStatement(node) {
    if (this.visitedStatements.has(node)) return;
    this.visitedStatements.add(node);
    const line = node._line || 0;
    this.checkExpressions(node);
    switch (node.type) {
      case 'TypedVar': return this.visitTypedVar(node, line);
      case 'Function': return this.visitFunction(node, line);
      case 'EnumDecl':
        this.setType(node.name, 'enum');
        return;
      case 'Model':
      case 'ClassDecl':
      case 'SchemaDecl':
        this.setType(node.name, 'class');
        return this.visitClass(node);
      case 'Assignment': return this.visitAssignment(node, line);
      case 'CompoundAssign': {
        const operators = {
          '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%', '**=': '**',
          '&=': '&', '|=': '|', '^=': '^', '<<=': '<<', '>>=': '>>', '>>>=': '>>>',
        };
        if (operators[node.op]) {
          this.inferBinaryType({
            op: operators[node.op],
            left: node.target,
            right: node.value,
            _line: line,
          });
        }
        return;
      }
      case 'Return': return this.visitReturn(node, line);
      case 'If': return this.visitIf(node, line);
      case 'Each': return this.visitEach(node, line);
      case 'For': return this.visitFor(node, line);
      case 'ForEach': return this.visitForEach(node, line);
      case 'While': return this.visitWhile(node, line);
      case 'DoWhile': return this.visitDoWhile(node, line);
      case 'Try': return this.visitTry(node, line);
      case 'Server': return this.visitServer(node, line);
      default: return this.visitNestedStatements(node);
    }
  }

  checkExpressions(node) {
    const seen = new WeakSet();
    const visit = value => {
      if (Array.isArray(value)) {
        if (seen.has(value)) return;
        seen.add(value);
        for (const item of value) visit(item);
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);

      if (typeof value.type === 'string') {
        if (!EXPRESSION_TYPES.has(value.type)) return;
        this.inferType(value);
        for (const [key, child] of Object.entries(value)) {
          if (key !== 'type' && key !== '_line') visit(child);
        }
        return;
      }

      for (const child of Object.values(value)) visit(child);
    };

    for (const [key, value] of Object.entries(node)) {
      if (key !== 'type' && key !== '_line') visit(value);
    }
  }

  visitNestedStatements(value, seen = new WeakSet()) {
    if (Array.isArray(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      for (const item of value) this.visitNestedStatements(item, seen);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (typeof value.type === 'string') {
      if (EXPRESSION_TYPES.has(value.type)) return;
      this.visitStatement(value);
      return;
    }
    for (const child of Object.values(value)) this.visitNestedStatements(child, seen);
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
    if (this.classDepth === 0) this.registerFunction(node);

    this.setType(node.name, 'function');

    this.pushScope();
    for (const p of node.params) {
      this.setType(p.name, p.type || 'any');
      if (p.defaultValue) this.inferType(p.defaultValue);
    }
    this.returnTypes.push(node.returnType || 'any');
    for (const stmt of node.body) {
      this.visitStatement(stmt);
    }
    this.returnTypes.pop();
    this.popScope();
  }

  visitClass(node) {
    this.classDepth++;
    this.pushScope();
    this.classContexts.push({
      fields: new Map((node.fields || []).map(field => [field.name, field.type || 'any'])),
      methods: new Map((node.methods || []).map(method => [method.name, method])),
    });
    try {
      for (const method of node.methods || []) this.visitStatement(method);
      if (node.init) {
        const initializer = node.init.type === 'Function'
          ? node.init
          : {
            ...node.init,
            type: 'Function',
            name: 'init',
            returnType: null,
            isAsync: false,
            isGenerator: false,
          };
        this.visitStatement(initializer);
      }
    } finally {
      this.classContexts.pop();
      this.popScope();
      this.classDepth--;
    }
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
      return;
    }
    if (node.target.type === 'MemberAccess') {
      const declaredType = this.inferType(node.target);
      const assignedType = this.inferType(node.value);
      if (declaredType !== 'any' && assignedType !== 'any' && !this.typesCompatible(declaredType, assignedType)) {
        this.error(`Type mismatch: cannot assign ${assignedType} to ${declaredType}`, line);
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

  visitForEach(node, line) {
    this.pushScope();
    this.setType(node.varName, node.iteration === 'in' ? 'str' : 'any');
    for (const stmt of node.body) this.visitStatement(stmt);
    this.popScope();
  }

  visitWhile(node, line) {
    this.visitBlock(node.body, line);
  }

  visitDoWhile(node, line) {
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

  visitServer(node, line) {
    for (const route of node.routes || []) {
      this.pushScope();
      for (const param of route.params || []) {
        this.setType(typeof param === 'string' ? param : param.name, 'any');
      }
      this.visitBlock(route.body, line);
      this.popScope();
    }
    this.visitNestedStatements(node.middleware || []);
    this.visitNestedStatements(node.body || []);
  }

  inferType(node) {
    if (!node) return 'any';
    switch (node.type) {
      case 'Number': {
        if (String(node.value).endsWith('n')) return 'bigint';
        const raw = String(node.value).replaceAll('_', '');
        const n = typeof node.value === 'string' ? Number(raw) : node.value;
        const radixLiteral = /^0[xob]/i.test(raw);
        return Number.isInteger(n) && (radixLiteral || !/[.eE]/.test(raw)) ? 'int' : 'num';
      }
      case 'String': return 'str';
      case 'InterpolatedString': return 'str';
      case 'RegExp': return 'any';
      case 'Yield': return node.value ? this.inferType(node.value) : 'any';
      case 'Update': return this.inferType(node.expr);
      case 'Bool': return 'bool';
      case 'Null': return 'any';
      case 'Array': return 'list';
      case 'Object': return 'map';
      case 'Identifier': return this.getType(node.name) || 'any';
      case 'Binary': return this.inferBinaryType(node);
      case 'Unary': {
        if (node.op === 'not') return 'bool';
        if (node.op === 'typeof') return 'str';
        const operandType = this.inferType(node.expr);
        if (node.op === '+' && operandType === 'bigint') {
          this.error("Unary '+' cannot be applied to a bigint", node._line);
          return 'any';
        }
        return operandType;
      }
      case 'Call': return this.inferCallType(node);
      case 'DynamicImport':
      case 'OptionalCall':
      case 'OptionalIndexAccess':
      case 'OptionalAccess':
      case 'IndexAccess': return 'any';
      case 'MemberAccess': {
        if (node.object.type === 'Self') {
          const classContext = this.classContexts.at(-1);
          return classContext?.fields.get(node.property) || 'any';
        }
        return 'any';
      }
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
    if (['===', '!==', '>', '<', '>=', '<=', 'instanceof'].includes(op)) return 'bool';
    if (['&&', '||'].includes(op)) return 'any';
    if (['+', '-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>'].includes(op)) {
      const l = this.inferType(node.left);
      const r = this.inferType(node.right);
      if (l === 'str' || r === 'str') {
        if (op === '+') return 'str';
      }
      if (l === 'bigint' || r === 'bigint') {
        if (l === 'bigint' && r === 'bigint' && op !== '>>>') return 'bigint';
        const message = op === '>>>' && l === 'bigint' && r === 'bigint'
          ? "Operator '>>>' is not defined for bigint values"
          : `Operator '${op}' cannot mix bigint and number values`;
        this.error(message, node._line);
        return 'any';
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
      if (obj.type === 'Self') {
        const method = this.classContexts.at(-1)?.methods.get(prop);
        if (method) {
          this.checkCallArguments(node, {
            params: method.params.map(param => ({
              name: param.name,
              type: param.type || 'any',
              hasDefault: param.defaultValue !== null,
              spread: param.spread,
            })),
            returnType: method.returnType || 'any',
          });
          return method.returnType || 'any';
        }
      }
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
    const calleeName = node.callee.name || node.callee.property || 'call';
    const requiredCount = params.filter(p => !p.hasDefault && !p.spread).length;
    const hasSpread = params.some(p => p.spread);

    if (node.args.length < requiredCount || (!hasSpread && node.args.length > params.length)) {
      const expected = hasSpread ? `at least ${requiredCount}` : `${requiredCount}${params.length === requiredCount ? '' : ` to ${params.length}`}`;
      this.error(`Argument count mismatch for '${calleeName}': expected ${expected}, got ${node.args.length}`, line);
    }

    const spreadIndex = params.findIndex(param => param.spread);
    for (let i = 0; i < node.args.length; i++) {
      const paramIndex = spreadIndex >= 0 && i >= spreadIndex ? spreadIndex : i;
      const param = params[paramIndex];
      if (!param) continue;
      const expectedType = param.type;
      const actualType = this.inferType(node.args[i]);
      if (expectedType !== 'any' && actualType !== 'any' && !this.typesCompatible(expectedType, actualType)) {
        this.error(`Argument '${param.name}' of '${calleeName}' expects ${expectedType} but got ${actualType}`, line);
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
