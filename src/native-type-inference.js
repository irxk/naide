const TOP = new Set(['unknown']);
const TYPE_ALIASES = new Map([
  ['int', 'number'],
  ['float', 'number'],
  ['number', 'number'],
  ['bool', 'boolean'],
  ['str', 'string'],
  ['string', 'string'],
  ['null', 'null'],
  ['list', 'array'],
  ['array', 'array'],
  ['map', 'object'],
  ['object', 'object'],
  ['fn', 'function'],
  ['function', 'function'],
]);
const ARITHMETIC_OPERATORS = new Set(['-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>']);
const COMPARISON_OPERATORS = new Set(['==', '===', '!=', '!==', '>', '<', '>=', '<=']);

export function inferNativeFunction(node, { functions = new Map() } = {}) {
  if (node?.type !== 'Function' || node.isAsync || node.isGenerator) {
    return rejected('Only synchronous function declarations are currently analyzed.');
  }

  const diagnostics = [];
  const scopes = [new Map()];
  const parameters = [];
  const returns = [];
  const expressionFacts = new Map();
  for (const parameter of node.params) {
    if (parameter.spread || parameter.defaultValue) {
      return rejected('Spread parameters and default values are not in the initial inference subset.');
    }
    const declared = typeFromAnnotation(parameter.type);
    const fact = declared
      ? { types: declared, guardRequired: true, source: 'annotation' }
      : makeFact(TOP, false, 'dynamic');
    scopes[0].set(parameter.name, fact);
    parameters.push({ name: parameter.name, ...serializeFact(fact) });
  }

  analyzeStatements(node.body, { diagnostics, functions, returns, scopes, expressionFacts });
  const returnFact = returns.reduce((result, current) => mergeFacts(result, current), null)
    || makeFact(new Set(['undefined']), true, 'inferred');
  const declaredReturn = typeFromAnnotation(node.returnType);
  const resultType = declaredReturn
    ? mergeFacts(returnFact, makeFact(declaredReturn, false, 'annotation'))
    : returnFact;

  return {
    eligible: diagnostics.length === 0
      && parameters.every(parameter => parameter.types.length === 1 && parameter.types[0] === 'number')
      && resultType.types.size === 1 && resultType.types.has('number'),
    functionName: node.name || null,
    parameters,
    locals: [...scopes[0]].filter(([name]) =>
      !node.params.some(parameter => parameter.name === name))
      .map(([name, fact]) => ({ name, ...serializeFact(fact) })),
    returnType: [...resultType.types],
    returnGuardRequired: resultType.guardRequired,
    diagnostics,
    expressionFacts,
  };
}

function rejected(message) {
  return {
    eligible: false,
    functionName: null,
    parameters: [],
    locals: [],
    returnType: ['unknown'],
    returnGuardRequired: true,
    diagnostics: [message],
    expressionFacts: new Map(),
  };
}

function makeFact(types, guardRequired, source) {
  return { types: new Set(types), guardRequired, source };
}

function serializeFact(fact) {
  return {
    types: [...fact.types].sort(),
    guardRequired: fact.guardRequired,
    source: fact.source,
  };
}

function mergeFacts(left, right) {
  if (!left) return makeFact(right.types, right.guardRequired, right.source);
  if (!right) return makeFact(left.types, left.guardRequired, left.source);
  if (left.types.has('unknown') || right.types.has('unknown')) {
    return makeFact(TOP, left.guardRequired || right.guardRequired, 'widened');
  }
  const types = new Set([...left.types, ...right.types]);
  return makeFact(
    types,
    left.guardRequired || right.guardRequired,
    types.size === 1 && left.source === right.source ? left.source : 'joined',
  );
}

function typeFromAnnotation(annotation) {
  if (typeof annotation !== 'string') return null;
  const type = TYPE_ALIASES.get(annotation.toLowerCase());
  return type ? new Set([type]) : null;
}

function cloneScopes(scopes) {
  return scopes.map(scope => new Map([...scope].map(([name, fact]) =>
    [name, makeFact(fact.types, fact.guardRequired, fact.source)])));
}

function mergeScopes(target, left, right) {
  for (let index = 0; index < target.length; index++) {
    for (const [name, targetFact] of target[index]) {
      const leftFact = left[index]?.get(name) || targetFact;
      const rightFact = right[index]?.get(name) || targetFact;
      target[index].set(name, mergeFacts(leftFact, rightFact));
    }
  }
}

function resolveFact(scopes, name) {
  for (let index = scopes.length - 1; index >= 0; index--) {
    if (scopes[index].has(name)) return scopes[index].get(name);
  }
  return null;
}

function assignFact(scopes, name, fact) {
  for (let index = scopes.length - 1; index >= 0; index--) {
    if (scopes[index].has(name)) {
      scopes[index].set(name, mergeFacts(scopes[index].get(name), fact));
      return true;
    }
  }
  return false;
}

function analyzeStatements(statements, context) {
  for (const statement of statements) analyzeStatement(statement, context);
}

function analyzeScopedStatements(statements, context) {
  context.scopes.push(new Map());
  analyzeStatements(statements, context);
  context.scopes.pop();
}

function analyzeStatement(node, context) {
  switch (node.type) {
    case 'TypedVar': {
      const value = node.value ? inferExpression(node.value, context) : makeFact(TOP, true, 'uninitialized');
      const declared = typeFromAnnotation(node.varType);
      const fact = declared
        ? mergeFacts(value, makeFact(declared, true, 'annotation'))
        : value;
      context.scopes.at(-1).set(node.name, fact);
      return;
    }
    case 'Assignment':
    case 'CompoundAssign': {
      if (node.target?.type !== 'Identifier') {
        context.diagnostics.push(`${node.type} with a non-local target is outside the initial inference subset.`);
        return;
      }
      const value = inferExpression(node.value, context);
      if (node.type === 'CompoundAssign') {
        const operator = node.op.slice(0, -1);
        if (ARITHMETIC_OPERATORS.has(operator) || operator === '+') {
          const current = resolveFact(context.scopes, node.target.name);
          const numeric = requireNumber(current, value);
          assignFact(context.scopes, node.target.name, numeric);
          return;
        }
      }
      if (!assignFact(context.scopes, node.target.name, value)) {
        context.diagnostics.push(`Assignment to unresolved name '${node.target.name}'.`);
      }
      return;
    }
    case 'Return':
      context.returns.push(node.value
        ? inferExpression(node.value, context)
        : makeFact(new Set(['undefined']), false, 'inferred'));
      return;
    case 'If': {
      inferExpression(node.condition, context);
      const before = cloneScopes(context.scopes);
      const branches = [];
      const first = cloneScopes(before);
      context.scopes.splice(0, context.scopes.length, ...first);
      analyzeScopedStatements(node.body, context);
      branches.push(cloneScopes(context.scopes));
      for (const branch of node.elifs || []) {
        inferExpression(branch.condition, context);
        const branchScopes = cloneScopes(before);
        context.scopes.splice(0, context.scopes.length, ...branchScopes);
        analyzeScopedStatements(branch.body, context);
        branches.push(cloneScopes(context.scopes));
      }
      if (node.elseBody) {
        const elseScopes = cloneScopes(before);
        context.scopes.splice(0, context.scopes.length, ...elseScopes);
        analyzeScopedStatements(node.elseBody, context);
        branches.push(cloneScopes(context.scopes));
      } else {
        branches.push(before);
      }
      context.scopes.splice(0, context.scopes.length, ...cloneScopes(before));
      for (const branch of branches) mergeScopes(context.scopes, context.scopes, branch);
      return;
    }
    case 'For': {
      const start = inferExpression(node.start, context);
      const end = inferExpression(node.end, context);
      const loopFact = requireNumber(start, end);
      context.scopes.push(new Map([[node.varName, loopFact]]));
      const before = cloneScopes(context.scopes);
      analyzeStatements(node.body, context);
      mergeScopes(context.scopes, before, context.scopes);
      context.scopes.pop();
      return;
    }
    case 'ForEach':
      inferExpression(node.iterable, context);
      context.diagnostics.push('Collection iteration is not part of the initial scalar type-inference subset.');
      return;
    case 'ExprStatement':
      inferExpression(node.expression, context);
      return;
    case 'Break':
    case 'Continue':
      return;
    default:
      context.diagnostics.push(`Statement '${node.type}' is not part of the initial type-inference subset.`);
  }
}

function inferExpression(node, context) {
  const fact = inferExpressionFact(node, context);
  context.expressionFacts.set(node, fact);
  return fact;
}

function inferExpressionFact(node, context) {
  switch (node.type) {
    case 'Number':
      return makeFact(new Set([String(node.value).endsWith('n') ? 'bigint' : 'number']), false, 'literal');
    case 'Bool':
      return makeFact(new Set(['boolean']), false, 'literal');
    case 'Null':
      return makeFact(new Set(['null']), false, 'literal');
    case 'String':
      return makeFact(new Set(['string']), false, 'literal');
    case 'Identifier': {
      const fact = resolveFact(context.scopes, node.name);
      if (fact) return fact;
      const callable = context.functions.get(node.name);
      if (callable) return typeFromAnnotation(callable.returnType)
        ? makeFact(typeFromAnnotation(callable.returnType), true, 'callable-return-annotation')
        : makeFact(TOP, true, 'dynamic');
      context.diagnostics.push(`Unresolved identifier '${node.name}'.`);
      return makeFact(TOP, true, 'dynamic');
    }
    case 'Unary': {
      const value = inferExpression(node.expr, context);
      if (node.op === '!') return makeFact(new Set(['boolean']), value.guardRequired, 'inferred');
      if (['+', '-', '~'].includes(node.op)) return requireNumber(value);
      context.diagnostics.push(`Unary operator '${node.op}' is not supported by type inference.`);
      return makeFact(TOP, true, 'dynamic');
    }
    case 'Binary': {
      const left = inferExpression(node.left, context);
      if (node.op === '&&' || node.op === '||' || node.op === '??') {
        const right = inferExpression(node.right, context);
        return mergeFacts(left, right);
      }
      const right = inferExpression(node.right, context);
      if (COMPARISON_OPERATORS.has(node.op)) {
        return makeFact(new Set(['boolean']), left.guardRequired || right.guardRequired, 'inferred');
      }
      if (node.op === '+' && (left.types.has('string') || right.types.has('string'))) {
        return makeFact(new Set(['string']), left.guardRequired || right.guardRequired, 'inferred');
      }
      if (node.op === '+' || ARITHMETIC_OPERATORS.has(node.op)) return requireNumber(left, right);
      context.diagnostics.push(`Binary operator '${node.op}' is not supported by type inference.`);
      return makeFact(TOP, true, 'dynamic');
    }
    case 'Ternary': {
      inferExpression(node.condition, context);
      return mergeFacts(
        inferExpression(node.consequent, context),
        inferExpression(node.alternate, context),
      );
    }
    case 'Call': {
      if (node.callee.type !== 'Identifier') {
        context.diagnostics.push('Indirect calls are not part of the initial type-inference subset.');
        for (const argument of node.args) inferExpression(argument, context);
        return makeFact(TOP, true, 'dynamic');
      }
      for (const argument of node.args) inferExpression(argument, context);
      if (resolveFact(context.scopes, node.callee.name)) {
        context.diagnostics.push(`Call through local '${node.callee.name}' is dynamic.`);
        return makeFact(TOP, true, 'dynamic');
      }
      const callable = context.functions.get(node.callee.name);
      const result = callable && typeFromAnnotation(callable.returnType);
      return result
        ? makeFact(result, true, 'callable-return-annotation')
        : makeFact(TOP, true, 'dynamic');
    }
    default:
      context.diagnostics.push(`Expression '${node.type}' is not part of the initial type-inference subset.`);
      return makeFact(TOP, true, 'dynamic');
  }
}

function requireNumber(...facts) {
  const guardRequired = facts.some(fact => fact?.guardRequired);
  if (facts.every(fact => fact?.types.size === 1 && fact.types.has('number'))) {
    return makeFact(new Set(['number']), guardRequired, 'inferred');
  }
  if (facts.some(fact => fact?.types.has('unknown'))) {
    return makeFact(TOP, true, 'dynamic');
  }
  const alternatives = new Set(facts.flatMap(fact => [...(fact?.types || [])]));
  alternatives.add('number');
  return makeFact(alternatives, true, 'guarded-union');
}
