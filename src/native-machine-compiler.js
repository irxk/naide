import { inferNativeFunction } from './native-type-inference.js';
import { lowerNativeFunction } from './native-ir.js';
import {
  emitWindowsX64,
  emitWindowsX64ArraySum,
  recognizeNativeModuloCountReduction,
} from './native-x64.js';
import { performance } from 'node:perf_hooks';
import {
  nativeArraySumMachineCodeAvailable,
  compileNativeMachineCode,
  getNativeNumericArrayExactIntegerSum,
  hasNativeNumericArrayData,
  invokeNativeArraySumMachineCode,
  invokeNativeMachineCode,
} from './native-machine-bridge.js';

const machineFunctions = new WeakSet();
const tieredMachineFunctions = new WeakMap();

export function isNativeMachineFunction(value) {
  return typeof value === 'function'
    && (machineFunctions.has(value) || tieredMachineFunctions.get(value)?.compiled === true);
}

export function createTieredNativeMachineFunction(
  node,
  closure,
  engine,
  threshold,
  fallbackFunction,
) {
  if (!containsRangeLoop(node.body) && !nativeArraySumStepsPerElement(node)) {
    if (engine.nativeMachineCodeDiagnostics) {
      engine.nativeMachineCodeStats.skippedLowBenefitFunctions++;
    }
    return fallbackFunction;
  }
  const state = { calls: 0, attempted: false, compiled: false, machineFunction: null };
  const tieredFunction = function naideTieredMachineFunction(...args) {
    if (this !== undefined) return Reflect.apply(fallbackFunction, this, args);
    if (state.machineFunction) return Reflect.apply(state.machineFunction, undefined, args);

    if (!state.attempted) {
      state.calls++;
      if (state.calls < threshold) {
        if (engine.nativeMachineCodeDiagnostics) {
          engine.nativeMachineCodeStats.tieringWarmupCalls++;
        }
        return Reflect.apply(fallbackFunction, undefined, args);
      }

      state.attempted = true;
      state.machineFunction = compileNativeMachineFunction(node, closure, engine);
      if (state.machineFunction) {
        state.compiled = true;
        if (engine.nativeMachineCodeDiagnostics) {
          engine.nativeMachineCodeStats.tieredFunctions++;
        }
        return Reflect.apply(state.machineFunction, undefined, args);
      }
    }
    return Reflect.apply(fallbackFunction, undefined, args);
  };
  tieredMachineFunctions.set(tieredFunction, state);
  return tieredFunction;
}

function containsRangeLoop(statements) {
  return statements.some(statement => {
    if (statement.type === 'For') return true;
    if (statement.type === 'If') {
      return containsRangeLoop(statement.body)
        || (statement.elifs || []).some(branch => containsRangeLoop(branch.body))
        || Boolean(statement.elseBody && containsRangeLoop(statement.elseBody));
    }
    return false;
  });
}

export function compileNativeMachineFunction(node, closure, engine) {
  const arraySumFunction = compileNativeArraySumFunction(node, closure, engine);
  if (arraySumFunction) return arraySumFunction;

  const diagnostics = engine.nativeMachineCodeDiagnostics;
  const stats = engine.nativeMachineCodeStats;
  const startedAt = diagnostics ? performance.now() : 0;
  const inlining = inlinePureCalls(node, closure, engine);
  const nativeNode = inlining.node;
  if (diagnostics) stats.inlinedCalls += inlining.inlinedCalls;
  const recordCompilationTime = () => {
    if (diagnostics) stats.compilationTimeMs += performance.now() - startedAt;
  };
  if (diagnostics) stats.compilationAttempts++;
  const inference = inferNativeFunction(nativeNode);
  if (!inference.eligible) {
    if (diagnostics) stats.unsupportedFunctions++;
    recordCompilationTime();
    return null;
  }
  const ir = lowerNativeFunction(nativeNode, inference);
  if (!ir) {
    if (diagnostics) stats.unsupportedFunctions++;
    recordCompilationTime();
    return null;
  }
  const moduloCountReduction = recognizeNativeModuloCountReduction(ir);
  const stepPreflightSafe = supportsStepPreflight(
    ir.body,
    false,
    moduloCountReduction?.statement ?? null,
  );
  const generated = emitWindowsX64(ir, { metered: !stepPreflightSafe });
  if (!generated) {
    if (diagnostics) stats.unsupportedFunctions++;
    recordCompilationTime();
    return null;
  }

  const code = compileNativeMachineCode(generated.code);
  if (diagnostics) {
    stats.compiledFunctions++;
    stats.generatedCodeBytes += generated.code.byteLength;
    stats.allocatedNativeValues += generated.registerAllocation.allocatedValues;
    stats.spilledNativeValues += generated.registerAllocation.spilledValues;
    stats.peakLiveNativeValues = Math.max(
      stats.peakLiveNativeValues,
      generated.registerAllocation.peakLiveValues,
    );
    recordCompilationTime();
  }
  const frame = {
    file: engine.findModulePath(closure),
    line: node._line,
    functionName: node.name,
  };

  const machineFunction = function naideMachineFunction(...args) {
    if (this !== undefined) {
      if (diagnostics) stats.guardFallbacks++;
      return engine.invokeFunction(node, closure, args, this);
    }
    const nativeArgs = args.slice(0, node.params.length);
    if (nativeArgs.length !== node.params.length
      || nativeArgs.some(value => typeof value !== 'number')
      || generated.finiteRangeArgumentIndices.some(index => !Number.isFinite(nativeArgs[index]))
      || generated.safeIntegerRangeArgumentIndices.some(index =>
        !Number.isSafeInteger(nativeArgs[index]))
      || (generated.rangeReduction?.boundArgumentIndex !== null
        && generated.rangeReduction?.boundArgumentIndex !== undefined
        && (nativeArgs[generated.rangeReduction.boundArgumentIndex]
          < generated.rangeReduction.minimumBound
          || nativeArgs[generated.rangeReduction.boundArgumentIndex]
          > generated.rangeReduction.maxBound))) {
      if (diagnostics) stats.guardFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }

    if (engine.steps > engine.maxSteps) {
      if (diagnostics) stats.stepBudgetFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }
    const remainingSteps = engine.maxSteps - engine.steps;
    const preflightSteps = stepPreflightSafe
      ? countNativeSteps(ir, nativeArgs, remainingSteps, moduloCountReduction)
      : null;
    if (stepPreflightSafe && preflightSteps === null) {
      if (diagnostics) stats.stepBudgetFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }

    if (engine.callDepth + 1 + generated.maxInlineCallDepth > engine.maxCallDepth) {
      if (diagnostics) stats.callDepthFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }

    if (diagnostics) stats.nativeCalls++;
    engine.callDepth++;
    if (engine.callDepth > engine.maxCallDepth) {
      engine.callDepth--;
      const error = new RangeError(`Native engine call depth limit (${engine.maxCallDepth}) exceeded.`);
      engine.addErrorFrame(error, frame);
      throw error;
    }

    try {
      const result = invokeNativeMachineCode(
        code,
        stepPreflightSafe ? 0 : remainingSteps,
        nativeArgs,
      );
      if (stepPreflightSafe) {
        if (result.steps !== 0) throw new Error('Unexpected native step count in preflight mode.');
        engine.steps += preflightSteps;
      } else {
        engine.steps += result.steps;
        if (result.steps > remainingSteps) {
          const line = result.line ? ` at line ${result.line}` : '';
          throw new Error(`Native engine step limit (${engine.maxSteps}) exceeded${line}.`);
        }
      }
      return result.value;
    } catch (error) {
      engine.addErrorFrame(error, frame);
      throw error;
    } finally {
      engine.callDepth--;
    }
  };
  machineFunctions.add(machineFunction);
  return machineFunction;
}

function nativeArraySumStepsPerElement(node) {
  if (node?.type !== 'Function' || node.isAsync || node.isGenerator
    || node.params?.length !== 1
    || node.params[0].type?.toLowerCase() !== 'list'
    || node.params[0].defaultValue
    || node.params[0].spread
    || node.body?.length !== 3) return 0;
  const [initializer, loop, result] = node.body;
  if (initializer.type !== 'TypedVar'
    || !initializer.isMut
    || !['int', 'float', 'num'].includes(initializer.varType?.toLowerCase())
    || initializer.value?.type !== 'Number'
    || Number(initializer.value.value) !== 0
    || loop.type !== 'ForEach'
    || loop.isAsync
    || loop.iteration !== 'of'
    || loop.iterable?.type !== 'Identifier'
    || loop.iterable.name !== node.params[0].name
    || loop.body?.length !== 1
    || result.type !== 'Return'
    || result.value?.type !== 'Identifier'
    || result.value.name !== initializer.name) return 0;

  const increment = loop.body[0];
  if (increment.type === 'CompoundAssign'
    && increment.op === '+='
    && increment.target?.type === 'Identifier'
    && increment.target.name === initializer.name
    && increment.value?.type === 'Identifier'
    && increment.value.name === loop.varName
    && loop.varName !== initializer.name) return 4;
  if (increment.type === 'Assignment'
    && increment.target?.type === 'Identifier'
    && increment.target.name === initializer.name
    && increment.value?.type === 'Binary'
    && increment.value.op === '+'
    && increment.value.left?.type === 'Identifier'
    && increment.value.left.name === initializer.name
    && increment.value.right?.type === 'Identifier'
    && increment.value.right.name === loop.varName
    && loop.varName !== initializer.name) return 6;
  return 0;
}

function compileNativeArraySumFunction(node, closure, engine) {
  const stepsPerElement = nativeArraySumStepsPerElement(node);
  if (!nativeArraySumMachineCodeAvailable || !stepsPerElement) return null;
  const diagnostics = engine.nativeMachineCodeDiagnostics;
  const stats = engine.nativeMachineCodeStats;
  const startedAt = diagnostics ? performance.now() : 0;
  if (diagnostics) stats.compilationAttempts++;
  const generatedCode = emitWindowsX64ArraySum();
  const code = compileNativeMachineCode(generatedCode);
  if (diagnostics) {
    stats.compiledFunctions++;
    stats.generatedCodeBytes += generatedCode.byteLength;
    stats.compilationTimeMs += performance.now() - startedAt;
  }

  const frame = {
    file: engine.findModulePath(closure),
    line: node._line,
    functionName: node.name,
  };

  const machineFunction = function naideArraySumMachineFunction(...args) {
    if (this !== undefined) {
      if (diagnostics) stats.guardFallbacks++;
      return engine.invokeFunction(node, closure, args, this);
    }
    if (args.length !== 1) {
      if (diagnostics) stats.guardFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }

    if (!engine.isFastNativeArray(args[0]) || !hasNativeNumericArrayData(args[0])) {
      if (diagnostics) stats.guardFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }
    const values = args[0];
    const stepCount = values.length * stepsPerElement + 7;
    if (!Number.isSafeInteger(stepCount)) {
      if (diagnostics) stats.stepBudgetFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }
    const remainingSteps = engine.maxSteps - engine.steps;
    if (stepCount > remainingSteps) {
      if (diagnostics) stats.stepBudgetFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }
    if (engine.callDepth + 1 > engine.maxCallDepth) {
      if (diagnostics) stats.callDepthFallbacks++;
      return engine.invokeFunction(node, closure, args);
    }

    const exactIntegerSum = getNativeNumericArrayExactIntegerSum(values);
    if (exactIntegerSum !== null) {
      engine.callDepth++;
      try {
        engine.steps += stepCount;
        return exactIntegerSum;
      } finally {
        engine.callDepth--;
      }
    }

    if (diagnostics) stats.nativeCalls++;
    engine.callDepth++;
    try {
      const result = invokeNativeArraySumMachineCode(code, values);
      engine.steps += stepCount;
      return result;
    } catch (error) {
      engine.addErrorFrame(error, frame);
      throw error;
    } finally {
      engine.callDepth--;
    }
  };
  machineFunctions.add(machineFunction);
  return machineFunction;
}

function inlinePureCalls(node, closure, engine) {
  const shadowed = new Set(node.params.map(parameter => parameter.name));
  collectShadowedNames(node.body, shadowed);
  let inlineCount = 0;
  return { node: transform(node), inlinedCalls: inlineCount };

  function transform(value) {
    if (Array.isArray(value)) return value.map(item => transform(item));
    if (!value || typeof value !== 'object') return value;
    if (value.type === 'Call' && value.callee?.type === 'Identifier'
      && !shadowed.has(value.callee.name) && inlineCount < 32) {
      const helper = resolveInlineHelper(value.callee.name, closure, engine);
      const expansion = helper && canInlineCall(helper, value);
      if (expansion) {
        inlineCount++;
        const substitutions = new Map(helper.node.params.map((parameter, index) =>
          [parameter.name, value.args[index]]));
        const expression = cloneHelperExpression(expansion.expression, substitutions);
        expression._nativeInlineStepPrefix = [
          stepSource(value),
          stepSource(value.callee),
          ...value.args.flatMap(argument => expressionStepSources(argument)),
          stepSource(expansion.entry),
        ];
        if (expansion.consequentReturn) {
          expression._nativeMetered = false;
          expression.consequent._nativeInlineStepPrefix = [
            stepSource(expansion.consequentReturn),
          ];
          expression.alternate._nativeInlineStepPrefix = [
            stepSource(expansion.alternateReturn),
          ];
        }
        expression._nativeInlineCallDepth = 1;
        return expression;
      }
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('_nativeInline')) continue;
      result[key] = transform(child);
    }
    return result;
  }
}

function resolveInlineHelper(name, closure, engine) {
  for (let environment = closure; environment; environment = environment.parent) {
    const binding = environment.bindings?.get(name);
    if (!binding) continue;
    if (binding.mutable || typeof binding.value !== 'function') return null;
    const node = engine.nativeFunctionNodes.get(binding.value);
    return node?.type === 'Function' ? { node } : null;
  }
  return null;
}

function canInlineCall(helper, call) {
  const node = helper.node;
  if (node.isAsync || node.isGenerator
    || !Array.isArray(node.params)
    || !Array.isArray(node.body)
    || call.args.length !== node.params.length
    || call.args.some(argument => !['Identifier', 'Number'].includes(argument.type)
      || (argument.type === 'Number' && String(argument.value).endsWith('n')))) return false;
  if (node.params.some(parameter => parameter.spread || parameter.defaultValue)) return false;

  const parameters = new Set(node.params.map(parameter => parameter.name));
  const references = new Map([...parameters].map(name => [name, 0]));
  const expansion = getPureReturnExpansion(node);
  if (!expansion) return false;
  if (expansion.kind === 'expression') {
    return isPureNumericExpression(expansion.expression, parameters, references)
      ? expansion
      : false;
  }
  if (!isPureInlineCondition(expansion.condition, parameters, references)
    || !isPureNumericExpression(expansion.consequent, parameters, references)
    || !isPureNumericExpression(expansion.alternate, parameters, references)) return false;
  return expansion;
}

function getPureReturnExpansion(node) {
  if (node.body.length === 1 && node.body[0].type === 'Return' && node.body[0].value) {
    return {
      kind: 'expression',
      expression: node.body[0].value,
      entry: node.body[0],
    };
  }

  let branch;
  let alternateReturn;
  if (node.body.length === 1 && node.body[0].type === 'If') {
    branch = node.body[0];
    if (!Array.isArray(branch.elseBody) || branch.elseBody.length !== 1) return null;
    alternateReturn = branch.elseBody[0];
  } else if (node.body.length === 2 && node.body[0].type === 'If'
    && !node.body[0].elseBody?.length && !node.body[0].elifs?.length) {
    [branch, alternateReturn] = [node.body[0], node.body[1]];
  } else {
    return null;
  }

  if (branch.elifs?.length
    || branch.body.length !== 1
    || branch.body[0].type !== 'Return'
    || !branch.body[0].value
    || alternateReturn.type !== 'Return'
    || !alternateReturn.value) return null;

  return {
    kind: 'conditional',
    expression: {
      type: 'Ternary',
      condition: branch.condition,
      consequent: branch.body[0].value,
      alternate: alternateReturn.value,
      _line: branch._line,
    },
    condition: branch.condition,
    consequent: branch.body[0].value,
    alternate: alternateReturn.value,
    entry: branch,
    consequentReturn: branch.body[0],
    alternateReturn,
  };
}

function isPureInlineCondition(expression, parameters, references) {
  if (expression?.type === 'Binary'
    && ['==', '===', '!=', '!==', '<', '<=', '>', '>='].includes(expression.op)) {
    return isPureNumericExpression(expression.left, parameters, references)
      && isPureNumericExpression(expression.right, parameters, references);
  }
  return false;
}

function isPureNumericExpression(expression, parameters, references) {
  if (expression?.type === 'Number') return !String(expression.value).endsWith('n');
  if (expression?.type === 'Identifier') {
    if (!parameters.has(expression.name)) return false;
    references.set(expression.name, references.get(expression.name) + 1);
    return true;
  }
  if (expression?.type === 'Binary'
    && ['+', '-', '*', '/', '%'].includes(expression.op)) {
    return isPureNumericExpression(expression.left, parameters, references)
      && isPureNumericExpression(expression.right, parameters, references);
  }
  return false;
}

function cloneHelperExpression(expression, substitutions) {
  if (expression.type === 'Identifier' && substitutions.has(expression.name)) {
    const argument = cloneAst(substitutions.get(expression.name));
    markUnmetered(argument);
    argument._nativeInlineStepSources = [stepSource(expression)];
    return argument;
  }
  const result = {};
  for (const [key, value] of Object.entries(expression)) {
    result[key] = Array.isArray(value)
      ? value.map(child => child && typeof child === 'object'
        ? cloneHelperExpression(child, substitutions)
        : child)
      : value && typeof value === 'object'
        ? cloneHelperExpression(value, substitutions)
        : value;
  }
  return result;
}

function cloneAst(value) {
  if (Array.isArray(value)) return value.map(cloneAst);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAst(child)]));
}

function markUnmetered(value) {
  if (Array.isArray(value)) {
    for (const item of value) markUnmetered(item);
  } else if (value && typeof value === 'object') {
    value._nativeMetered = false;
    for (const child of Object.values(value)) markUnmetered(child);
  }
}

function expressionStepSources(expression) {
  const sources = [stepSource(expression)];
  for (const [key, child] of Object.entries(expression)) {
    if (key.startsWith('_')) continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object') sources.push(...expressionStepSources(item));
      }
    } else if (child && typeof child === 'object') {
      sources.push(...expressionStepSources(child));
    }
  }
  return sources;
}

function stepSource(node) {
  return { line: Number.isSafeInteger(node?._line) && node._line > 0 ? node._line : 0 };
}

function collectShadowedNames(value, names) {
  if (Array.isArray(value)) {
    for (const item of value) collectShadowedNames(item, names);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (value.type === 'TypedVar') names.add(value.name);
  if (value.type === 'For') names.add(value.varName);
  if (value.type === 'Function' && value.name) names.add(value.name);
  for (const [key, child] of Object.entries(value)) {
    if (!key.startsWith('_')) collectShadowedNames(child, names);
  }
}

function supportsStepPreflight(
  statements,
  insideLoop = false,
  moduloCountLoop = null,
  activeRangeLocalId = null,
) {
  for (const statement of statements) {
    switch (statement.op) {
      case 'local.init':
      case 'local.set':
        if (!supportsPreflightExpression(statement.value, activeRangeLocalId)) return false;
        break;
      case 'return':
        if (!supportsPreflightExpression(statement.value, activeRangeLocalId)) return false;
        break;
      case 'range.for':
        if (insideLoop
          || !supportsPreflightExpression(statement.start)
          || !supportsPreflightExpression(statement.end)
          || writesLocal(statement.body, statement.localId)
          || !supportsStepPreflight(
            statement.body,
            true,
            moduloCountLoop === statement,
            statement.start.op === 'const' && statement.start.value === 0
              ? statement.localId
              : activeRangeLocalId,
          )) return false;
        break;
      case 'if':
        if (!supportsPreflightExpression(statement.condition, activeRangeLocalId)
          || !supportsStepPreflight(statement.then, true, moduloCountLoop, activeRangeLocalId)
          || !supportsStepPreflight(statement.otherwise, true, moduloCountLoop, activeRangeLocalId)) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

function supportsPreflightExpression(expression, activeRangeLocalId = null) {
  if (!expression || typeof expression !== 'object') return false;
  switch (expression.op) {
    case 'const':
    case 'local.get':
      return true;
    case 'binary':
      if (!['+','-','*','/','%','==','===','!=','!==','<','<=','>','>='].includes(expression.operator)) {
        return false;
      }
      return supportsPreflightExpression(expression.left, activeRangeLocalId)
        && supportsPreflightExpression(expression.right, activeRangeLocalId);
    case 'unary':
      return ['+','-'].includes(expression.operator)
        && supportsPreflightExpression(expression.value, activeRangeLocalId);
    case 'conditional':
      return supportsPreflightExpression(expression.condition, activeRangeLocalId)
        && supportsPreflightExpression(expression.consequent, activeRangeLocalId)
        && supportsPreflightExpression(expression.alternate, activeRangeLocalId);
    default:
      return false;
  }
}

function moduloPredicateDivisor(condition, rangeLocalId) {
  if (condition?.op !== 'binary' || !['==', '==='].includes(condition.operator)) return null;
  let remainder;
  let zero;
  if (condition.left?.op === 'binary' && condition.left.operator === '%') {
    remainder = condition.left;
    zero = condition.right;
  } else if (condition.right?.op === 'binary' && condition.right.operator === '%') {
    remainder = condition.right;
    zero = condition.left;
  } else {
    return null;
  }
  if (remainder.left?.op !== 'local.get' || remainder.left.localId !== rangeLocalId
    || remainder.right?.op !== 'const' || !Number.isSafeInteger(remainder.right.value)
    || remainder.right.value === 0 || zero?.op !== 'const' || zero.value !== 0) return null;
  return Math.abs(remainder.right.value);
}

function writesLocal(statements, localId) {
  return statements.some(statement =>
    (statement.op === 'local.init' || statement.op === 'local.set')
      && statement.localId === localId);
}

function countNativeSteps(ir, args, remainingSteps, moduloCountReduction = null) {
  const parameterIndices = new Map(ir.params.map(parameter => [parameter.localId, parameter.index]));
  let steps = 0;

  const countExpression = expression => {
    const children = expression.op === 'binary'
      ? [expression.left, expression.right]
      : expression.op === 'unary'
        ? [expression.value]
        : [];
    return (expression.metered === false ? 0 : 1)
      + (expression.inlineStepPrefix?.length || 0)
      + (expression.inlineStepSources?.length || 0)
      + children.reduce((count, child) => count + countExpression(child), 0);
  };

  const boundValue = expression => {
    if (expression.op === 'const') return expression.value;
    if (expression.op === 'local.get') {
      const index = parameterIndices.get(expression.localId);
      return index === undefined ? null : args[index];
    }
    return null;
  };

  for (const statement of ir.body) {
    steps++;
    if (statement.op === 'local.init' || statement.op === 'local.set') {
      steps += countExpression(statement.value);
    } else if (statement.op === 'return') {
      steps += countExpression(statement.value);
      break;
    } else if (statement.op === 'range.for') {
      steps += countExpression(statement.start) + countExpression(statement.end);
      const start = boundValue(statement.start);
      const end = boundValue(statement.end);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
      const iterations = Math.max(0, end - start);
      if (!Number.isSafeInteger(iterations)) return null;
      if (moduloCountReduction?.statement === statement) {
        const conditional = statement.body[0];
        const thenSteps = countNativeStepsForStatements(
          conditional.then,
          countExpression,
        );
        if (!Number.isSafeInteger(thenSteps)) return null;
        const iterationSteps = 2 + countExpression(conditional.condition);
        const hits = countModuloMultiples(end, moduloCountReduction.divisor);
        const remaining = remainingSteps - steps;
        const fixedSteps = BigInt(iterations) * BigInt(iterationSteps);
        const conditionalSteps = hits * BigInt(thenSteps);
        const total = fixedSteps + conditionalSteps;
        if (thenSteps < 0 || total > BigInt(remaining)) return null;
        steps += Number(total);
        continue;
      }
      const remaining = remainingSteps - steps;
      const body = countNativeStepsForRangeBody(statement.body, statement.localId);
      if (!body) return null;
      const hits = body.divisor === null
        ? 0n
        : countModuloMultiples(end, body.divisor);
      const total = hits * BigInt(body.matchSteps)
        + (BigInt(iterations) - hits) * BigInt(body.otherSteps);
      if (body.matchSteps <= 0 || body.otherSteps <= 0 || total > BigInt(remaining)) return null;
      steps += Number(total);
    } else {
      return null;
    }
    if (!Number.isSafeInteger(steps) || steps > remainingSteps) return null;
  }
  return Number.isSafeInteger(steps) && steps <= remainingSteps ? steps : null;
}

function countNativeStepsForRangeBody(statements, rangeLocalId) {
  let matchSteps = 1;
  let otherSteps = 1;
  let divisor = null;
  for (const statement of statements) {
    if (statement.op !== 'local.init' && statement.op !== 'local.set') return null;
    const variants = countExpressionVariants(statement.value, rangeLocalId);
    if (!variants || (divisor !== null && variants.divisor !== null
      && divisor !== variants.divisor)) return null;
    if (variants.divisor !== null) divisor = variants.divisor;
    matchSteps += 1 + variants.baseSteps + variants.matchSteps;
    otherSteps += 1 + variants.baseSteps + variants.otherSteps;
  }
  return { divisor, matchSteps, otherSteps };
}

function countExpressionVariants(expression, rangeLocalId) {
  const ownSteps = (expression.metered === false ? 0 : 1)
    + (expression.inlineStepPrefix?.length || 0)
    + (expression.inlineStepSources?.length || 0);
  if (expression.op === 'conditional') {
    const divisor = moduloPredicateDivisor(expression.condition, rangeLocalId);
    const conditionSteps = countPreflightExpression(expression.condition);
    const matchSteps = countPreflightExpression(expression.consequent);
    const otherSteps = countPreflightExpression(expression.alternate);
    if (divisor === null || conditionSteps === null || matchSteps === null || otherSteps === null) {
      return null;
    }
    return {
      baseSteps: ownSteps + conditionSteps,
      matchSteps,
      otherSteps,
      divisor,
    };
  }

  const children = expression.op === 'binary'
    ? [expression.left, expression.right]
    : expression.op === 'unary'
      ? [expression.value]
      : [];
  let baseSteps = ownSteps;
  let matchSteps = 0;
  let otherSteps = 0;
  let divisor = null;
  for (const child of children) {
    const variants = countExpressionVariants(child, rangeLocalId);
    if (!variants || (divisor !== null && variants.divisor !== null
      && divisor !== variants.divisor)) return null;
    baseSteps += variants.baseSteps;
    matchSteps += variants.matchSteps;
    otherSteps += variants.otherSteps;
    if (variants.divisor !== null) divisor = variants.divisor;
  }
  return { baseSteps, matchSteps, otherSteps, divisor };
}

function countPreflightExpression(expression) {
  const children = expression.op === 'binary'
    ? [expression.left, expression.right]
    : expression.op === 'unary'
      ? [expression.value]
      : [];
  let steps = (expression.metered === false ? 0 : 1)
    + (expression.inlineStepPrefix?.length || 0)
    + (expression.inlineStepSources?.length || 0);
  for (const child of children) {
    const childSteps = countPreflightExpression(child);
    if (childSteps === null) return null;
    steps += childSteps;
  }
  return Number.isSafeInteger(steps) ? steps : null;
}

function countModuloMultiples(end, divisor) {
  const upper = BigInt(end);
  const magnitude = BigInt(divisor);
  return upper > 0n ? ((upper - 1n) / magnitude) + 1n : 0n;
}

function countNativeStepsForStatements(statements, countExpression) {
  let steps = 0;
  for (const statement of statements) {
    steps++;
    if (statement.op === 'local.init' || statement.op === 'local.set') {
      steps += countExpression(statement.value);
    } else if (statement.op !== 'return') {
      return Number.POSITIVE_INFINITY;
    }
  }
  return steps;
}
