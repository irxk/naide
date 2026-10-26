const compiledFunctions = new WeakSet();
const OPERATORS = new Map([
  ['+', '+'],
  ['-', '-'],
  ['*', '*'],
  ['/', '/'],
  ['%', '%'],
  ['**', '**'],
  ['==', '==='],
  ['===', '==='],
  ['!=', '!=='],
  ['!==', '!=='],
  ['>', '>'],
  ['<', '<'],
  ['>=', '>='],
  ['<=', '<='],
  ['&', '&'],
  ['|', '|'],
  ['^', '^'],
  ['<<', '<<'],
  ['>>', '>>'],
  ['>>>', '>>>'],
]);

export function isCompiledNativeFunction(value) {
  return typeof value === 'function' && compiledFunctions.has(value);
}

export function compileNativeFunction(node, closure, engine) {
  if (node.type !== 'Function' || node.isAsync || node.isGenerator
    || node.params.some(parameter => parameter.spread || parameter.defaultValue)) return null;

  const context = {
    closure,
    engine,
    captures: [],
    captureIndices: new Map(),
    batches: [],
    nodes: [],
    nodeIndices: new Map(),
    scopes: [new Map()],
    nextLocal: 0,
    loopDepth: 0,
  };

  for (const parameter of node.params) {
    if (declareLocal(context, parameter.name, true) === null) return null;
  }

  const body = compileStatements(node.body, context);
  if (body === null) return null;
  const argumentsList = node.params.map((_, index) => `__arg${index}`).join(', ');
  const localInitializers = node.params.map((_, index) =>
    `let __local${index} = __arg${index};`).join('\n');
  const source = `
    "use strict";
    return function naideFastFunction(${argumentsList}) {
      __engine.callDepth++;
      if (__engine.callDepth > __engine.maxCallDepth) {
        __engine.callDepth--;
        const error = new RangeError(\`Native engine call depth limit (\${__engine.maxCallDepth}) exceeded.\`);
        __engine.addErrorFrame(error, __frame);
        throw error;
      }
      try {
        ${localInitializers}
        ${body}
        return undefined;
      } catch (error) {
        __engine.addErrorFrame(error, __frame);
        throw error;
      } finally {
        __engine.callDepth--;
      }
    };
  `;
  let factory;
  try {
    factory = new Function('__engine', '__captureBindings', '__nodes', '__batches', '__frame', source);
  } catch (error) {
    if (error instanceof EvalError) return null;
    throw error;
  }
  const fastFunction = factory(
    engine,
    context.captures,
    context.nodes,
    context.batches,
    {
      file: engine.findModulePath(closure),
      line: node._line,
      functionName: node.name,
    },
  );
  compiledFunctions.add(fastFunction);
  return fastFunction;
}

function declareLocal(context, name, mutable) {
  const scope = context.scopes.at(-1);
  if (scope.has(name)) return null;
  const index = context.nextLocal++;
  scope.set(name, { code: `__local${index}`, mutable, index });
  return index;
}

function resolveLocal(context, name) {
  for (let index = context.scopes.length - 1; index >= 0; index--) {
    const local = context.scopes[index].get(name);
    if (local) return local;
  }
  return null;
}

function resolveCapture(context, name) {
  if (context.captureIndices.has(name)) return context.captureIndices.get(name);
  let environment = context.closure;
  while (environment) {
    const binding = environment.bindings.get(name);
    if (binding) {
      if (binding.value === undefined || typeof binding.value === 'symbol') return null;
      const index = context.captures.length;
      context.captureIndices.set(name, index);
      context.captures.push(binding);
      return index;
    }
    environment = environment.parent;
  }
  return null;
}

function tick(context, node) {
  const index = nodeIndex(context, node);
  return `__engine.tick(__nodes[${index}]);`;
}

function nodeIndex(context, node) {
  let index = context.nodeIndices.get(node);
  if (index === undefined) {
    index = context.nodes.length;
    context.nodeIndices.set(node, index);
    context.nodes.push(node);
  }
  return index;
}

function registerTickBatch(context, nodes) {
  const batch = nodes.map(node => context.nodes[nodeIndex(context, node)]);
  const index = context.batches.length;
  context.batches.push(batch);
  return index;
}

function tickExpression(context, node) {
  return `${tick(context, node).slice(0, -1)}, `;
}

function compileStatements(statements, context) {
  const output = [];
  for (const statement of statements) {
    const compiled = compileStatement(statement, context);
    if (compiled === null) return null;
    output.push(compiled);
  }
  return output.join('\n');
}

function compileScopedStatements(statements, context) {
  context.scopes.push(new Map());
  const body = compileStatements(statements, context);
  context.scopes.pop();
  return body === null ? null : `{\n${body}\n}`;
}

function containsBreak(statements) {
  const pending = [statements];
  const visited = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    if (value.type === 'Break') return true;
    if (Array.isArray(value)) pending.push(...value);
    else pending.push(...Object.values(value));
  }
  return false;
}

function compileArrayReduction(node, context) {
  if (node.body.length !== 1) return null;
  const statement = node.body[0];
  if (statement.type !== 'Assignment' || statement.target.type !== 'Identifier'
    || statement.value.type !== 'Binary' || statement.value.op !== '+'
    || statement.value.left.type !== 'Identifier'
    || statement.value.right.type !== 'Identifier'
    || statement.value.left.name !== statement.target.name
    || statement.value.right.name !== node.varName) return null;
  const local = resolveLocal(context, statement.target.name);
  if (!local?.mutable) return null;
  const batchIndex = registerTickBatch(context, [
    node,
    statement,
    statement.value,
    statement.value.left,
    statement.value.right,
  ]);
  return { local: local.code, batchIndex };
}

function compileStatement(node, context) {
  const statementTick = tick(context, node);
  switch (node.type) {
    case 'TypedVar': {
      if (!node.value) return null;
      const index = declareLocal(context, node.name, node.isMut);
      if (index === null) return null;
      const value = compileExpression(node.value, context);
      if (value === null) return null;
      return `${statementTick}let __local${index} = ${value};`;
    }
    case 'Assignment': {
      if (node.target.type !== 'Identifier') return null;
      const local = resolveLocal(context, node.target.name);
      if (!local || !local.mutable) return null;
      const value = compileExpression(node.value, context);
      if (value === null) return null;
      return `${statementTick}${local.code} = ${value};`;
    }
    case 'CompoundAssign': {
      if (node.target.type !== 'Identifier') return null;
      const local = resolveLocal(context, node.target.name);
      const operator = OPERATORS.get(node.op.slice(0, -1));
      if (!local || !local.mutable || !operator) return null;
      const value = compileExpression(node.value, context);
      if (value === null) return null;
      return `${statementTick}${local.code} = ${local.code} ${operator} ${value};`;
    }
    case 'Return': {
      if (!node.value) return `${statementTick}return undefined;`;
      const value = compileExpression(node.value, context);
      if (value === null) return null;
      return `${statementTick}return ${value};`;
    }
    case 'If': {
      const condition = compileExpression(node.condition, context);
      if (condition === null) return null;
      const body = compileScopedStatements(node.body, context);
      if (body === null) return null;
      const branches = [`if (${condition}) ${body}`];
      for (const branch of node.elifs || []) {
        const branchCondition = compileExpression(branch.condition, context);
        const branchBody = compileScopedStatements(branch.body, context);
        if (branchCondition === null || branchBody === null) return null;
        branches.push(`else if (${branchCondition}) ${branchBody}`);
      }
      if (node.elseBody) {
        const elseBody = compileScopedStatements(node.elseBody, context);
        if (elseBody === null) return null;
        branches.push(`else ${elseBody}`);
      }
      return `${statementTick}${branches.join(' ')}`;
    }
    case 'For': {
      const start = compileExpression(node.start, context);
      const end = compileExpression(node.end, context);
      if (start === null || end === null) return null;
      context.scopes.push(new Map());
      const index = declareLocal(context, node.varName, true);
      if (index === null) {
        context.scopes.pop();
        return null;
      }
      context.loopDepth++;
      const body = compileScopedStatements(node.body, context);
      context.loopDepth--;
      context.scopes.pop();
      if (body === null) return null;
      const loopTick = tick(context, node);
      return `${statementTick}{
        const __start${index} = ${start};
        const __end${index} = ${end};
        if (!Number.isFinite(__start${index}) || !Number.isFinite(__end${index})) {
          throw new TypeError('Native range bounds must be finite numbers.');
        }
        for (let __local${index} = __start${index}; __local${index} < __end${index}; __local${index} = __local${index} + 1) {
          ${loopTick}
          ${body}
        }
      }`;
    }
    case 'ForEach': {
      if (node.isAsync) return null;
      const iterable = compileExpression(node.iterable, context);
      if (iterable === null) return null;
      context.scopes.push(new Map());
      const index = declareLocal(context, node.varName, false);
      if (index === null) {
        context.scopes.pop();
        return null;
      }
      context.loopDepth++;
      const body = compileScopedStatements(node.body, context);
      context.loopDepth--;
      context.scopes.pop();
      if (body === null) return null;
      const loopTick = tick(context, node);
      const entries = node.iteration === 'in'
        ? `Object.keys(__iterable${index})`
        : `__engine.iterable(__iterable${index})`;
      const arrayReduction = node.iteration !== 'in' && !containsBreak(node.body)
        ? compileArrayReduction(node, context)
        : null;
      if (node.iteration !== 'in' && !containsBreak(node.body)) {
        return `${statementTick}{
          const __iterable${index} = ${iterable};
          if (__iterable${index} == null) throw new TypeError('Cannot iterate over null or undefined.');
          if (__engine.isFastNativeArray(__iterable${index})) {
            for (let __arrayIndex${index} = 0; __arrayIndex${index} < __iterable${index}.length; __arrayIndex${index}++) {
              __engine.tick();
              const __local${index} = __iterable${index}[__arrayIndex${index}];
              ${arrayReduction
                ? `__engine.tickBatch(__batches[${arrayReduction.batchIndex}]);\n              ${arrayReduction.local} = ${arrayReduction.local} + __local${index};`
                : `${loopTick}\n              ${body}`}
            }
            __engine.tick();
          } else {
            for (const __local${index} of ${entries}) {
              ${loopTick}
              ${body}
            }
          }
        }`;
      }
      return `${statementTick}{
        const __iterable${index} = ${iterable};
        if (__iterable${index} == null) throw new TypeError('Cannot iterate over null or undefined.');
        for (const __local${index} of ${entries}) {
          ${loopTick}
          ${body}
        }
      }`;
    }
    case 'ExprStatement': {
      const expression = compileExpression(node.expression, context);
      return expression === null ? null : `${statementTick}${expression};`;
    }
    case 'Break':
      return context.loopDepth ? `${statementTick}break;` : null;
    case 'Continue':
      return context.loopDepth ? `${statementTick}continue;` : null;
    case 'AssertStmt': {
      const expression = compileExpression(node.expr, context);
      return expression === null
        ? null
        : `${statementTick}if (!(${expression})) throw new Error('Assertion failed.');`;
    }
    default:
      return null;
  }
}

function compileExpression(node, context) {
  const expressionTick = tickExpression(context, node);
  switch (node.type) {
    case 'Number': {
      const value = Number(String(node.value).replaceAll('_', ''));
      return Number.isFinite(value) ? `(${expressionTick}${value})` : null;
    }
    case 'Bool':
      return `(${expressionTick}${node.value ? 'true' : 'false'})`;
    case 'Null':
      return `(${expressionTick}null)`;
    case 'Identifier': {
      const local = resolveLocal(context, node.name);
      if (local) return `(${expressionTick}${local.code})`;
      const capture = resolveCapture(context, node.name);
      return capture === null ? null : `(${expressionTick}__captureBindings[${capture}].value)`;
    }
    case 'Binary': {
      const left = compileExpression(node.left, context);
      const right = compileExpression(node.right, context);
      if (left === null || right === null) return null;
      if (node.op === '&&' || node.op === '||' || node.op === '??') {
        return `(${expressionTick}${left} ${node.op} ${right})`;
      }
      const operator = OPERATORS.get(node.op);
      return operator ? `(${expressionTick}${left} ${operator} ${right})` : null;
    }
    case 'Unary': {
      const value = compileExpression(node.expr, context);
      return value === null || !['!', '-', '+', '~'].includes(node.op)
        ? null
        : `(${expressionTick}${node.op}${value})`;
    }
    case 'Ternary': {
      const condition = compileExpression(node.condition, context);
      const consequent = compileExpression(node.consequent, context);
      const alternate = compileExpression(node.alternate, context);
      return condition === null || consequent === null || alternate === null
        ? null
        : `(${expressionTick}(${condition}) ? ${consequent} : ${alternate})`;
    }
    case 'Call': {
      if (node.callee.type !== 'Identifier'
        || resolveLocal(context, node.callee.name)
        || node.args.some(argument => argument.type === 'Spread')) return null;
      let environment = context.closure;
      let binding = null;
      while (environment) {
        binding = environment.bindings.get(node.callee.name);
        if (binding) break;
        environment = environment.parent;
      }
      if (!binding || !isCompiledNativeFunction(binding.value)) return null;
      const capture = resolveCapture(context, node.callee.name);
      if (capture === null) return null;
      const calleeTick = tickExpression(context, node.callee);
      const args = node.args.map(argument => compileExpression(argument, context));
      if (args.some(argument => argument === null)) return null;
      return `(${expressionTick}(${calleeTick}(0, __captureBindings[${capture}].value))(${args.join(', ')}))`;
    }
    default:
      return null;
  }
}
