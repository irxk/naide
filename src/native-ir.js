const NUMERIC_BINARY_OPERATORS = new Set([
  '+', '-', '*', '/', '%', '**',
  '==', '===', '!=', '!==', '>', '<', '>=', '<=',
  '&', '|', '^', '<<', '>>', '>>>',
]);
const NUMERIC_UNARY_OPERATORS = new Set(['+', '-', '~']);

export function lowerNativeFunction(node, inference) {
  if (node?.type !== 'Function' || !inference?.eligible) return null;

  const context = {
    scopes: [new Map()],
    locals: [],
    nextLocalId: 0,
    sourceLine: Number.isSafeInteger(node._line) ? node._line : 0,
    inference,
    guards: [],
    maxInlineCallDepth: 0,
  };
  const params = [];
  for (const [index, parameter] of node.params.entries()) {
    const local = declareLocal(context, parameter.name, true);
    params.push({ index, localId: local.id, name: parameter.name, type: 'number' });
    if (parameter.type && inference.parameters[index]?.guardRequired) {
      context.guards.push({ kind: 'argument-type', argumentIndex: index, type: 'number' });
    }
  }
  const body = lowerStatements(node.body, context);
  if (body === null || !hasGuaranteedReturn(body)) return null;
  const ir = {
    version: 1,
    kind: 'function',
    name: node.name || '<anonymous>',
    params,
    locals: context.locals,
    body,
    returnType: 'number',
    guards: context.guards,
    maxInlineCallDepth: context.maxInlineCallDepth,
    source: sourceOf(node, context),
  };
  return verifyNativeIR(ir).valid ? ir : null;
}

export function verifyNativeIR(ir) {
  const diagnostics = [];
  if (ir?.version !== 1 || ir.kind !== 'function' || !Array.isArray(ir.body)
    || !Array.isArray(ir.params) || !Array.isArray(ir.locals) || !Array.isArray(ir.guards)) {
    return { valid: false, diagnostics: ['Malformed native IR function header.'] };
  }
  const localIds = new Set();
  const localMetadata = new Map();
  if (ir.maxInlineCallDepth !== undefined
    && (!Number.isSafeInteger(ir.maxInlineCallDepth)
      || ir.maxInlineCallDepth < 0 || ir.maxInlineCallDepth > 1_000_000)) {
    diagnostics.push('Maximum inlined call depth must be a bounded non-negative safe integer.');
  }
  for (const local of ir.locals) {
    if (!local || typeof local !== 'object') {
      diagnostics.push('Local slots must be metadata objects.');
      continue;
    }
    if (!Number.isSafeInteger(local.id) || local.id < 0 || localIds.has(local.id)) {
      diagnostics.push('Local slots must have unique non-negative safe-integer IDs.');
    }
    localIds.add(local.id);
    localMetadata.set(local.id, local);
    if (local.type !== 'number' || typeof local.name !== 'string' || typeof local.mutable !== 'boolean') {
      diagnostics.push(`Local slot ${local.id} has invalid metadata.`);
    }
  }
  const parameterIds = new Set();
  const initialized = new Set();
  for (const parameter of ir.params) {
    if (!parameter || typeof parameter !== 'object') {
      diagnostics.push('Parameters must be metadata objects.');
      continue;
    }
    if (!Number.isSafeInteger(parameter.index) || parameter.index < 0
      || !localIds.has(parameter.localId) || parameter.type !== 'number') {
      diagnostics.push('Parameters must reference declared numeric local slots.');
    }
    if (parameterIds.has(parameter.index)) diagnostics.push(`Duplicate parameter index ${parameter.index}.`);
    parameterIds.add(parameter.index);
    if (initialized.has(parameter.localId)) diagnostics.push('Parameters must use distinct local slots.');
    initialized.add(parameter.localId);
  }
  if (parameterIds.size !== ir.params.length
    || [...parameterIds].some((index, position) => index !== position)) {
    diagnostics.push('Parameter indices must be contiguous and start at zero.');
  }
  verifyStatements(ir.body, localIds, localMetadata, diagnostics, new WeakSet(), initialized);
  if (!hasGuaranteedReturn(ir.body)) diagnostics.push('Every control-flow path must return a value.');
  for (const guard of ir.guards) {
    if (!guard || guard.kind !== 'argument-type'
      || !parameterIds.has(guard.argumentIndex) || guard.type !== 'number') {
      diagnostics.push('Invalid runtime guard metadata.');
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

function verifyStatements(statements, localIds, localMetadata, diagnostics, visited, initialized) {
  if (!Array.isArray(statements)) {
    diagnostics.push('Statement block must be an array.');
    return new Set(initialized);
  }
  if (visited.has(statements)) {
    diagnostics.push('Native IR statement blocks must not contain cycles or shared blocks.');
    return new Set(initialized);
  }
  visited.add(statements);
  const state = new Set(initialized);
  for (const statement of statements) {
    if (!statement || typeof statement !== 'object') {
      diagnostics.push('Statement must be an object.');
      continue;
    }
    switch (statement.op) {
      case 'local.init':
      case 'local.set': {
        const local = localMetadata.get(statement.localId);
        if (!localIds.has(statement.localId) || statement.value?.type !== local?.type) {
          diagnostics.push(`${statement.op} must target a declared local and store a value of its type.`);
        }
        if (statement.op === 'local.init') {
          if (state.has(statement.localId)) diagnostics.push('A local slot cannot be initialized more than once.');
        } else if (!state.has(statement.localId) || !local?.mutable) {
          diagnostics.push('local.set requires an initialized mutable local.');
        }
        verifyExpression(statement.value, localIds, diagnostics, 'number', new WeakSet(), state);
        state.add(statement.localId);
        break;
      }
      case 'return':
        if (statement.value?.type !== 'number') diagnostics.push('return must produce a numeric value.');
        verifyExpression(statement.value, localIds, diagnostics, 'number', new WeakSet(), state);
        break;
      case 'if':
        verifyExpression(statement.condition, localIds, diagnostics, 'boolean', new WeakSet(), state);
        {
          const thenState = verifyStatements(
            statement.then, localIds, localMetadata, diagnostics, visited, state,
          );
          const otherwiseState = verifyStatements(
            statement.otherwise, localIds, localMetadata, diagnostics, visited, state,
          );
          for (const localId of state) {
            if (!thenState.has(localId) || !otherwiseState.has(localId)) state.delete(localId);
          }
          for (const localId of thenState) {
            if (otherwiseState.has(localId)) state.add(localId);
          }
        }
        break;
      case 'range.for':
        if (!localIds.has(statement.localId)) diagnostics.push('range.for must target a declared loop local.');
        verifyExpression(statement.start, localIds, diagnostics, 'number', new WeakSet(), state);
        verifyExpression(statement.end, localIds, diagnostics, 'number', new WeakSet(), state);
        {
          const bodyState = new Set(state);
          bodyState.add(statement.localId);
          verifyStatements(statement.body, localIds, localMetadata, diagnostics, visited, bodyState);
        }
        break;
      default:
        diagnostics.push(`Unknown native IR statement '${statement.op}'.`);
    }
  }
  return state;
}

function verifyExpression(
  expression,
  localIds,
  diagnostics,
  expectedType = 'number',
  visited = new WeakSet(),
  initialized = new Set(),
) {
  if (!expression || typeof expression !== 'object'
    || !['number', 'boolean'].includes(expression.type) || expression.type !== expectedType) {
    diagnostics.push(`Native IR expression must have the ${expectedType} type.`);
    return;
  }
  for (const sources of [expression.inlineStepPrefix, expression.inlineStepSources]) {
    if (sources !== undefined && (!Array.isArray(sources)
      || sources.some(source => !Number.isSafeInteger(source?.line) || source.line < 0))) {
      diagnostics.push('Inlined step source metadata must contain non-negative safe-integer lines.');
    }
  }
  if (visited.has(expression)) {
    diagnostics.push('Native IR expressions must not contain cycles or shared nodes.');
    return;
  }
  visited.add(expression);
  switch (expression.op) {
    case 'const':
    if (expression.type === 'number'
      ? typeof expression.value !== 'number' || !Number.isFinite(expression.value)
      : expression.type !== 'boolean' || typeof expression.value !== 'boolean') {
      diagnostics.push('Constants must have a finite numeric or boolean value matching their type.');
    }
    break;
    case 'local.get':
      if (!localIds.has(expression.localId)) diagnostics.push('local.get references an unknown local slot.');
      else if (!initialized.has(expression.localId)) diagnostics.push('local.get reads an uninitialized local slot.');
      break;
    case 'binary':
      if (['==', '===', '!=', '!==', '>', '<', '>=', '<='].includes(expression.operator)) {
        if (expression.type !== 'boolean') diagnostics.push('Comparison instructions must produce booleans.');
        verifyExpression(expression.left, localIds, diagnostics, 'number', visited, initialized);
        verifyExpression(expression.right, localIds, diagnostics, 'number', visited, initialized);
      } else if (NUMERIC_BINARY_OPERATORS.has(expression.operator)) {
        if (expression.type !== 'number') diagnostics.push('Numeric instructions must produce numbers.');
        verifyExpression(expression.left, localIds, diagnostics, 'number', visited, initialized);
        verifyExpression(expression.right, localIds, diagnostics, 'number', visited, initialized);
      } else {
        diagnostics.push(`Unsupported numeric IR operator '${expression.operator}'.`);
        verifyExpression(expression.left, localIds, diagnostics, 'number', visited, initialized);
        verifyExpression(expression.right, localIds, diagnostics, 'number', visited, initialized);
      }
      break;
    case 'unary':
      if (expression.operator === '!') {
        if (expression.type !== 'boolean') diagnostics.push('Logical negation must produce a boolean.');
      } else if (!NUMERIC_UNARY_OPERATORS.has(expression.operator)) {
        diagnostics.push(`Unsupported numeric IR unary operator '${expression.operator}'.`);
      } else if (expression.type !== 'number') {
        diagnostics.push('Numeric unary instructions must produce numbers.');
      }
      verifyExpression(
        expression.value,
        localIds,
        diagnostics,
        expression.operator === '!' ? 'boolean' : 'number',
        visited,
        initialized,
      );
      break;
    case 'conditional':
      if (!['number', 'boolean'].includes(expression.type)) {
        diagnostics.push('Conditional instructions must produce a numeric or boolean value.');
      }
      verifyExpression(expression.condition, localIds, diagnostics, 'boolean', visited, initialized);
      verifyExpression(
        expression.consequent,
        localIds,
        diagnostics,
        expression.type,
        visited,
        initialized,
      );
      verifyExpression(
        expression.alternate,
        localIds,
        diagnostics,
        expression.type,
        visited,
        initialized,
      );
      break;
    default:
      diagnostics.push(`Unknown native IR expression '${expression.op}'.`);
  }
}

function lowerStatements(statements, context) {
  const lowered = [];
  const previousLine = context.sourceLine;
  for (const statement of statements) {
    if (Number.isSafeInteger(statement?._line) && statement._line > 0) {
      context.sourceLine = statement._line;
    }
    const item = lowerStatement(statement, context);
    if (item === null) {
      context.sourceLine = previousLine;
      return null;
    }
    lowered.push(...item);
  }
  context.sourceLine = previousLine;
  return lowered;
}

function lowerScopedStatements(statements, context) {
  context.scopes.push(new Map());
  const body = lowerStatements(statements, context);
  context.scopes.pop();
  return body;
}

function lowerStatement(node, context) {
  switch (node.type) {
    case 'TypedVar': {
      if (!node.value) return null;
      const value = lowerExpression(node.value, context);
      if (!value) return null;
      const local = declareLocal(context, node.name, node.isMut);
      return [{ op: 'local.init', localId: local.id, value, source: sourceOf(node, context) }];
    }
    case 'Assignment':
    case 'CompoundAssign': {
      if (node.target?.type !== 'Identifier') return null;
      const local = resolveLocal(context, node.target.name);
      if (!local?.mutable) return null;
      const right = lowerExpression(node.value, context);
      const value = node.type === 'CompoundAssign'
        ? right && NUMERIC_BINARY_OPERATORS.has(node.op.slice(0, -1))
          ? {
            op: 'binary',
            type: 'number',
            operator: node.op.slice(0, -1),
            left: {
              op: 'local.get',
              type: 'number',
              localId: local.id,
              source: sourceOf(node.target, context),
              metered: false,
            },
            right,
            source: sourceOf(node, context),
            metered: false,
          }
          : null
        : right;
      return value ? [{ op: 'local.set', localId: local.id, value, source: sourceOf(node, context) }] : null;
    }
    case 'Return': {
      const value = node.value ? lowerExpression(node.value, context) : null;
      return value ? [{ op: 'return', value, source: sourceOf(node, context) }] : null;
    }
    case 'If': {
      const condition = lowerExpression(node.condition, context);
      const then = lowerScopedStatements(node.body, context);
      if (!condition || !then) return null;
      let otherwise = [];
      if (node.elifs?.length) {
        otherwise = lowerElseIfs(node.elifs, node.elseBody, context);
        if (!otherwise) return null;
      } else if (node.elseBody) {
        otherwise = lowerScopedStatements(node.elseBody, context);
        if (!otherwise) return null;
      }
      return [{ op: 'if', condition, then, otherwise, source: sourceOf(node, context) }];
    }
    case 'For': {
      const start = lowerExpression(node.start, context);
      const end = lowerExpression(node.end, context);
      if (!start || !end) return null;
      context.scopes.push(new Map());
      const local = declareLocal(context, node.varName, true);
      const body = lowerScopedStatements(node.body, context);
      context.scopes.pop();
      if (!body) return null;
      return [{
        op: 'range.for',
        localId: local.id,
        start,
        end,
        body,
        source: sourceOf(node, context),
      }];
    }
    case 'Break':
    case 'Continue':
      return null;
    default:
      return null;
  }
}

function lowerElseIfs(branches, elseBody, context) {
  if (branches.length === 0) return elseBody ? lowerScopedStatements(elseBody, context) : [];
  const [branch, ...remaining] = branches;
  const condition = lowerExpression(branch.condition, context);
  const then = lowerScopedStatements(branch.body, context);
  const otherwise = lowerElseIfs(remaining, elseBody, context);
  if (!condition || !then || !otherwise) return null;
  return [{ op: 'if', condition, then, otherwise, source: sourceOf(branch, context) }];
}

function lowerExpression(node, context) {
  if (Number.isSafeInteger(node?._nativeInlineCallDepth)) {
    context.maxInlineCallDepth = Math.max(
      context.maxInlineCallDepth,
      node._nativeInlineCallDepth,
    );
  }
  const finish = expression => expression ? {
    ...expression,
    ...(node?._nativeMetered === false ? { metered: false } : {}),
    ...(Array.isArray(node?._nativeInlineStepPrefix)
      ? { inlineStepPrefix: node._nativeInlineStepPrefix.map(source => ({ ...source })) }
      : {}),
    ...(Array.isArray(node?._nativeInlineStepSources)
      ? { inlineStepSources: node._nativeInlineStepSources.map(source => ({ ...source })) }
      : {}),
  } : null;
  const inferred = context.inference.expressionFacts.get(node);
  if (!inferred || inferred.types.size !== 1) return null;
  const resultType = inferred.types.values().next().value;
  if (!['number', 'boolean'].includes(resultType)) return null;
  switch (node.type) {
    case 'Number': {
      const value = Number(String(node.value).replaceAll('_', ''));
      return finish(Number.isFinite(value)
        ? { op: 'const', type: resultType, value, source: sourceOf(node, context) }
        : null);
    }
    case 'Bool':
      return finish({ op: 'const', type: 'boolean', value: Boolean(node.value), source: sourceOf(node, context) });
    case 'Identifier': {
      const local = resolveLocal(context, node.name);
      return finish(local
        ? { op: 'local.get', type: resultType, localId: local.id, source: sourceOf(node, context) }
        : null);
    }
    case 'Binary': {
      if (!NUMERIC_BINARY_OPERATORS.has(node.op)) return null;
      const left = lowerExpression(node.left, context);
      const right = lowerExpression(node.right, context);
      return finish(left && right
        ? { op: 'binary', type: resultType, operator: node.op, left, right, source: sourceOf(node, context) }
        : null);
    }
    case 'Unary': {
      if (!NUMERIC_UNARY_OPERATORS.has(node.op) && node.op !== '!') return null;
      const value = lowerExpression(node.expr, context);
      return finish(value
        ? { op: 'unary', type: resultType, operator: node.op, value, source: sourceOf(node, context) }
        : null);
    }
    case 'Ternary': {
      const condition = lowerExpression(node.condition, context);
      const consequent = lowerExpression(node.consequent, context);
      const alternate = lowerExpression(node.alternate, context);
      return finish(condition && consequent && alternate
        ? {
          op: 'conditional',
          type: resultType,
          condition,
          consequent,
          alternate,
          source: sourceOf(node, context),
        }
        : null);
    }
    default:
      return null;
  }
}

function declareLocal(context, name, mutable) {
  const local = { id: context.nextLocalId++, name, type: 'number', mutable: Boolean(mutable) };
  context.locals.push(local);
  context.scopes.at(-1).set(name, local);
  return local;
}

function resolveLocal(context, name) {
  for (let index = context.scopes.length - 1; index >= 0; index--) {
    const local = context.scopes[index].get(name);
    if (local) return local;
  }
  return null;
}

function sourceOf(node, context) {
  return {
    line: Number.isSafeInteger(node?._line) && node._line > 0
      ? node._line
      : context?.sourceLine || 0,
  };
}

function hasGuaranteedReturn(statements) {
  if (!Array.isArray(statements)) return false;
  for (const statement of statements) {
    if (!statement || typeof statement !== 'object') continue;
    if (statement.op === 'return') return true;
    if (statement.op === 'if'
      && Array.isArray(statement.otherwise) && statement.otherwise.length > 0
      && Array.isArray(statement.then) && hasGuaranteedReturn(statement.then)
      && hasGuaranteedReturn(statement.otherwise)) return true;
  }
  return false;
}
