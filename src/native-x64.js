import { verifyNativeIR } from './native-ir.js';
import { allocateNativeRegisters } from './native-register-allocation.js';

const BINARY_INSTRUCTIONS = new Map([
  ['+', [0xf2, 0x0f, 0x58, 0xc1]],
  ['-', [0xf2, 0x0f, 0x5c, 0xc1]],
  ['*', [0xf2, 0x0f, 0x59, 0xc1]],
  ['/', [0xf2, 0x0f, 0x5e, 0xc1]],
]);
const COMPARISONS = new Map([
  ['==', { set: 0x94, unordered: 'and' }],
  ['===', { set: 0x94, unordered: 'and' }],
  ['!=', { set: 0x95, unordered: 'or' }],
  ['!==', { set: 0x95, unordered: 'or' }],
  ['<', { set: 0x92, unordered: 'and' }],
  ['<=', { set: 0x96, unordered: 'and' }],
  ['>', { set: 0x97 }],
  ['>=', { set: 0x93 }],
]);
const METERING_STACK_SLOTS = 4;
const MAX_EXACT_TRIANGULAR_BOUND = 94_906_265;
const MAX_EXACT_MODULO_COUNT_BOUND = 4_503_599_627_370_495;

export function recognizeNativeModuloCountReduction(ir) {
  if (ir?.body?.length !== 3) return null;
  const [initializer, loop, result] = ir.body;
  if (initializer.op !== 'local.init'
    || initializer.value.op !== 'const'
    || initializer.value.value !== 0
    || loop.op !== 'range.for'
    || loop.start.op !== 'const'
    || loop.start.value !== 0
    || loop.body.length !== 1
    || loop.body[0].op !== 'if'
    || loop.body[0].otherwise.length !== 0
    || loop.body[0].then.length !== 1
    || result.op !== 'return'
    || result.value.op !== 'local.get'
    || result.value.localId !== initializer.localId) return null;

  const accumulator = ir.locals.find(item => item.id === initializer.localId);
  if (!accumulator?.mutable) return null;
  const increment = loop.body[0].then[0];
  if (increment.op !== 'local.set' || increment.localId !== initializer.localId
    || !isIncrementByOne(increment.value, initializer.localId)) return null;

  const condition = loop.body[0].condition;
  if (condition.op !== 'binary' || !['==', '==='].includes(condition.operator)) return null;
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
  if (!isLocal(remainder.left, loop.localId)
    || remainder.right?.op !== 'const'
    || !Number.isSafeInteger(remainder.right.value)
    || remainder.right.value === 0
    || zero?.op !== 'const'
    || zero.value !== 0) return null;

  const bound = loop.end;
  const parameter = bound.op === 'local.get'
    ? ir.params.find(item => item.localId === bound.localId)
    : null;
  if (bound.op !== 'const' && !parameter) return null;
  if (bound.op === 'const' && !Number.isSafeInteger(bound.value)) return null;

  return {
    statement: loop,
    kind: 'modulo-count',
    divisor: Math.abs(remainder.right.value),
    boundArgumentIndex: parameter?.index ?? null,
    constantBound: bound.op === 'const' ? bound.value : null,
    minimumBound: Number.MIN_SAFE_INTEGER,
    maxBound: MAX_EXACT_MODULO_COUNT_BOUND,
  };
}

export function emitWindowsX64ArraySum() {
  return Uint8Array.from([
    0x66, 0x0f, 0xef, 0xc0,
    0x48, 0x85, 0xd2,
    0x0f, 0x84, 0x15, 0x00, 0x00, 0x00,
    0xf2, 0x0f, 0x10, 0x09,
    0xf2, 0x0f, 0x58, 0xc1,
    0x48, 0x83, 0xc1, 0x08,
    0x48, 0xff, 0xca,
    0x0f, 0x85, 0xeb, 0xff, 0xff, 0xff,
    0xc3,
  ]);
}

export function emitWindowsX64(ir, { metered = true, registerAllocation = true } = {}) {
  if (ir?.kind !== 'function' || ir.version !== 1
    || typeof metered !== 'boolean'
    || typeof registerAllocation !== 'boolean'
    || !Array.isArray(ir.params) || ir.params.length > 4
    || !Array.isArray(ir.locals) || !Array.isArray(ir.body)
    || !verifyNativeIR(ir).valid) return null;
  const parameterLocalIds = new Set(ir.params.map(parameter => parameter.localId));
  const allRangeSlots = collectRangeSlots(ir.body, 0, parameterLocalIds);
  if (!allRangeSlots) return null;
  const allocation = registerAllocation
    ? allocateNativeRegisters(ir, allRangeSlots.keys())
    : {
      localRegisters: new Map(),
      rangeRegisters: new Map(),
      intervals: [],
      stats: {
        registerCount: 0,
        allocatedValues: 0,
        spilledValues: ir.locals.length - parameterLocalIds.size + allRangeSlots.size,
        peakLiveValues: 0,
      },
    };
  const localSlots = new Map();
  let nextStackSlot = 0;
  for (const local of ir.locals) {
    if (!allocation.localRegisters.has(local.id)) localSlots.set(local.id, nextStackSlot++);
  }
  const rangeSlots = new Map();
  for (const statement of allRangeSlots.keys()) {
    if (!allocation.rangeRegisters.has(statement)) rangeSlots.set(statement, nextStackSlot++);
  }
  const rangeReduction = recognizeNativeModuloCountReduction(ir) ?? recognizeRangeReduction(ir);
  const safeIntegerRangeArgumentIndices = collectModuloRangeArguments(ir.body, ir.params);
  if (!safeIntegerRangeArgumentIndices) return null;
  if (rangeReduction?.boundArgumentIndex !== null
    && rangeReduction?.boundArgumentIndex !== undefined) {
    safeIntegerRangeArgumentIndices.push(rangeReduction.boundArgumentIndex);
    const uniqueIndices = [...new Set(safeIntegerRangeArgumentIndices)];
    safeIntegerRangeArgumentIndices.splice(
      0,
      safeIntegerRangeArgumentIndices.length,
      ...uniqueIndices.sort((left, right) => left - right),
    );
  }
  const localRegisters = allocation.localRegisters;
  const rangeRegisters = allocation.rangeRegisters;
  const writer = new CodeWriter();
  const frameSizeOffset = writer.emitPrologue(metered);
  const stack = {
    localSlots,
    localRegisters,
    rangeSlots,
    rangeRegisters,
    rangeReduction,
    firstScratchSlot: nextStackSlot,
    scratchDepth: 0,
    maxScratchDepth: 0,
    nextLabel: 0,
    metered,
    reservedStackSlots: metered ? METERING_STACK_SLOTS : 0,
    errorExitLabel: metered ? null : undefined,
    lineLabels: new Map(),
  };
  if (metered) stack.errorExitLabel = stack.nextLabel++;
  for (const parameter of ir.params) {
    emitStoreXmm(writer, parameter.index, localSlots.get(parameter.localId), stack);
  }
  if (!emitStatements(writer, ir.body, stack)) return null;
  if (metered) {
    for (const [line, label] of stack.lineLabels) {
      writer.mark(label);
      writer.emit(0x41, 0xc7, 0x06,
        line & 0xff, (line >>> 8) & 0xff, (line >>> 16) & 0xff, (line >>> 24) & 0xff);
      writer.jump(stack.errorExitLabel);
    }
    writer.mark(stack.errorExitLabel);
    emitEpilogue(writer, true);
  }
  const frameSlots = stack.firstScratchSlot + stack.maxScratchDepth;
  const frameSize = Math.ceil(((stack.reservedStackSlots + frameSlots) * 8) / 16) * 16;
  if (!Number.isSafeInteger(frameSize) || frameSize > 0x7fffffff) return null;
  writer.patchInt32(frameSizeOffset, frameSize);
  if (!writer.resolveRelocations()) return null;
  return {
    platform: 'win32',
    architecture: 'x64',
    abi: metered ? 'windows-x64-double-metered' : 'windows-x64-double-preflight',
    code: Uint8Array.from(writer.bytes),
    frameSize,
    parameterCount: ir.params.length,
    registerAllocation: {
      ...allocation.stats,
      intervals: allocation.intervals,
    },
    maxInlineCallDepth: ir.maxInlineCallDepth ?? 0,
    finiteRangeArgumentIndices: rangeArgumentIndices(ir),
    safeIntegerRangeArgumentIndices,
    rangeReduction: rangeReduction
      ? {
        kind: rangeReduction.kind,
        ...(rangeReduction.divisor === undefined ? {} : { divisor: rangeReduction.divisor }),
        boundArgumentIndex: rangeReduction.boundArgumentIndex,
        constantBound: rangeReduction.constantBound,
        minimumBound: rangeReduction.minimumBound,
        maxBound: rangeReduction.maxBound ?? MAX_EXACT_TRIANGULAR_BOUND,
      }
      : null,
  };
}

function recognizeRangeReduction(ir) {
  if (ir.body.length !== 3) return null;
  const [initializer, loop, result] = ir.body;
  if (initializer.op !== 'local.init'
    || initializer.value.op !== 'const'
    || initializer.value.value !== 0
    || loop.op !== 'range.for'
    || loop.start.op !== 'const'
    || loop.start.value !== 0
    || loop.body.length !== 1
    || loop.body[0].op !== 'local.set'
    || loop.body[0].localId !== initializer.localId
    || result.op !== 'return'
    || result.value.op !== 'local.get'
    || result.value.localId !== initializer.localId) return null;

  const local = ir.locals.find(item => item.id === initializer.localId);
  if (!local?.mutable) return null;

  let kind;
  const reduction = loop.body[0].value;
  if (reduction.op !== 'binary' || reduction.operator !== '+') return null;
  if (isLocal(reduction.left, initializer.localId)
    && isLocal(reduction.right, loop.localId)) {
    kind = 'triangular-sum';
  } else if (isLocal(reduction.right, initializer.localId)
    && isLocal(reduction.left, loop.localId)) {
    kind = 'triangular-sum';
  } else if (isLocal(reduction.left, initializer.localId)
    && isOne(reduction.right)) {
    kind = 'unit-increment';
  } else if (isLocal(reduction.right, initializer.localId)
    && isOne(reduction.left)) {
    kind = 'unit-increment';
  } else if (isLocal(reduction.left, initializer.localId)
    && isParityAdjustedLoopDelta(reduction.right, loop.localId)) {
    kind = 'parity-adjusted-sum';
  } else if (isLocal(reduction.right, initializer.localId)
    && isParityAdjustedLoopDelta(reduction.left, loop.localId)) {
    kind = 'parity-adjusted-sum';
  } else {
    return null;
  }

  if (loop.end.op === 'const') {
    if (!Number.isSafeInteger(loop.end.value)
      || loop.end.value < 0 || loop.end.value > MAX_EXACT_TRIANGULAR_BOUND) return null;
    if (kind === 'triangular-sum' && loop.end.value === 0) return null;
    return {
      statement: loop,
      kind,
      boundArgumentIndex: null,
      constantBound: loop.end.value,
      minimumBound: kind === 'triangular-sum' ? 1 : 0,
    };
  }
  if (loop.end.op !== 'local.get') return null;
  const parameter = ir.params.find(item => item.localId === loop.end.localId);
  if (!parameter) return null;
  return {
    statement: loop,
    kind,
    boundArgumentIndex: parameter.index,
    constantBound: null,
    minimumBound: kind === 'triangular-sum' ? 1 : 0,
  };
}

function isLocal(expression, localId) {
  return expression?.op === 'local.get' && expression.localId === localId;
}

function isParityAdjustedLoopDelta(expression, rangeLocalId) {
  if (expression?.op !== 'conditional') return false;
  if (!moduloZeroConditionForLocal(expression.condition, rangeLocalId, 2)) return false;
  const evenPath = expression.consequent;
  const oddPath = expression.alternate;
  return (
    (isLocalPlusConstant(evenPath, rangeLocalId, 1) && isLocalMinusConstant(oddPath, rangeLocalId, 1))
    || (isLocalMinusConstant(evenPath, rangeLocalId, 1) && isLocalPlusConstant(oddPath, rangeLocalId, 1))
  );
}

function moduloZeroConditionForLocal(expression, localId, divisor) {
  if (expression?.op !== 'binary' || !['==', '==='].includes(expression.operator)) return false;
  let left = expression.left;
  let right = expression.right;
  if (left?.op === 'binary' && left.operator === '%') {
    const remainder = left;
    left = remainder.left;
    right = remainder.right;
    if (remainder.left?.op !== 'local.get' || remainder.left.localId !== localId) return false;
    if (!isConst(remainder.right, divisor)) return false;
    return isConst(expression.right, 0);
  }
  if (right?.op === 'binary' && right.operator === '%') {
    const remainder = right;
    left = remainder.left;
    right = remainder.right;
    if (remainder.left?.op !== 'local.get' || remainder.left.localId !== localId) return false;
    if (!isConst(remainder.right, divisor)) return false;
    return isConst(expression.left, 0);
  }
  return false;
}

function isConst(expression, value) {
  return expression?.op === 'const' && expression.value === value;
}

function isLocalPlusConstant(expression, localId, value) {
  if (expression?.op !== 'binary' || expression.operator !== '+') return false;
  return (isLocal(expression.left, localId) && isConst(expression.right, value))
    || (isLocal(expression.right, localId) && isConst(expression.left, value));
}

function isLocalMinusConstant(expression, localId, value) {
  if (expression?.op !== 'binary' || expression.operator !== '-') return false;
  return isLocal(expression.left, localId) && isConst(expression.right, value);
}

function isOne(expression) {
  return expression?.op === 'const' && expression.value === 1;
}

function isIncrementByOne(expression, localId) {
  return expression?.op === 'binary' && expression.operator === '+'
    && ((isLocal(expression.left, localId) && isOne(expression.right))
      || (isLocal(expression.right, localId) && isOne(expression.left)));
}

function collectModuloRangeArguments(statements, params) {
  const parameterIndices = new Map(params.map(parameter => [parameter.localId, parameter.index]));
  const argumentIndices = new Set();
  const inspectExpression = (expression, activeRange = null) => {
    if (!expression || typeof expression !== 'object') return true;
    if (expression.op === 'binary' && expression.operator === '%') {
      if (!activeRange
        || expression.left?.op !== 'local.get'
        || expression.left.localId !== activeRange.localId
        || expression.right?.op !== 'const'
        || !Number.isSafeInteger(expression.right.value)
        || expression.right.value === 0
        || writesLoopLocal(activeRange.body, activeRange.localId)) return false;
      for (const bound of [activeRange.start, activeRange.end]) {
        if (bound.op === 'const' && Number.isSafeInteger(bound.value)) continue;
        const index = bound.op === 'local.get' && parameterIndices.get(bound.localId);
        if (!Number.isSafeInteger(index)) return false;
        argumentIndices.add(index);
      }
    }
    if (expression.op === 'binary') {
      return inspectExpression(expression.left, activeRange)
        && inspectExpression(expression.right, activeRange);
    }
    if (expression.op === 'unary') return inspectExpression(expression.value, activeRange);
    if (expression.op === 'conditional') {
      return inspectExpression(expression.condition, activeRange)
        && inspectExpression(expression.consequent, activeRange)
        && inspectExpression(expression.alternate, activeRange);
    }
    return true;
  };
  const inspectStatements = (items, activeRange = null) => {
    for (const statement of items) {
      if (statement.op === 'local.init' || statement.op === 'local.set'
        || statement.op === 'return') {
        if (!inspectExpression(statement.value, activeRange)) return false;
      } else if (statement.op === 'if') {
        if (!inspectExpression(statement.condition, activeRange)
          || !inspectStatements(statement.then, activeRange)
          || !inspectStatements(statement.otherwise, activeRange)) return false;
      } else if (statement.op === 'range.for') {
        if (!inspectExpression(statement.start, activeRange)
          || !inspectExpression(statement.end, activeRange)
          || !inspectStatements(statement.body, statement)) return false;
      }
    }
    return true;
  };
  return inspectStatements(statements) ? [...argumentIndices].sort((left, right) => left - right) : null;
}

function writesLoopLocal(statements, localId) {
  return statements.some(statement =>
    ((statement.op === 'local.init' || statement.op === 'local.set')
      && statement.localId === localId)
    || (statement.op === 'if'
      && (writesLoopLocal(statement.then, localId)
        || writesLoopLocal(statement.otherwise, localId)))
    || (statement.op === 'range.for' && writesLoopLocal(statement.body, localId)));
}

function collectRangeSlots(statements, nextSlot, parameterLocalIds) {
  const slots = new Map();
  const pending = [...statements];
  while (pending.length) {
    const statement = pending.pop();
    if (statement?.op === 'range.for') {
      if (!isSafeRangeBound(statement.start, parameterLocalIds)
        || !isSafeRangeBound(statement.end, parameterLocalIds)) {
        return null;
      }
      slots.set(statement, nextSlot++);
      pending.push(...statement.body);
    } else if (statement?.op === 'if') {
      pending.push(...statement.then, ...statement.otherwise);
    }
  }
  return slots;
}

function isSafeRangeBound(expression, parameterLocalIds) {
  return expression?.op === 'const'
    ? Number.isFinite(expression.value)
    : expression?.op === 'local.get' && parameterLocalIds.has(expression.localId);
}

function rangeArgumentIndices(ir) {
  const parameters = new Map(ir.params.map(parameter => [parameter.localId, parameter.index]));
  const result = new Set();
  const pending = [...ir.body];
  while (pending.length) {
    const statement = pending.pop();
    if (statement?.op === 'range.for') {
      for (const bound of [statement.start, statement.end]) {
        if (bound.op === 'local.get') result.add(parameters.get(bound.localId));
      }
      pending.push(...statement.body);
    } else if (statement?.op === 'if') {
      pending.push(...statement.then, ...statement.otherwise);
    }
  }
  return [...result].sort((left, right) => left - right);
}

function emitStatements(writer, statements, state) {
  for (const statement of statements) {
    if (state.metered) emitTick(writer, statement.source, state);
    switch (statement.op) {
      case 'local.init':
      case 'local.set':
        if (!emitExpression(writer, statement.value, state)) return false;
        emitStoreLocal(writer, 0, statement.localId, state);
        break;
      case 'return':
        if (!emitExpression(writer, statement.value, state)) return false;
        emitEpilogue(writer, state.metered);
        break;
      case 'if':
        if (!emitExpression(writer, statement.condition, state)) return false;
        writer.emit(0x0f, 0x57, 0xc9);
        writer.emit(0x66, 0x0f, 0x2e, 0xc1);
        {
          const otherwise = state.nextLabel++;
          const end = state.nextLabel++;
          writer.branch(0x84, otherwise);
          if (!emitStatements(writer, statement.then, state)) return false;
          writer.jump(end);
          writer.mark(otherwise);
          if (!emitStatements(writer, statement.otherwise, state)) return false;
          writer.mark(end);
        }
        break;
      case 'range.for':
        if (!emitRangeLoop(writer, statement, state)) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

function emitRangeLoop(writer, statement, state) {
  if (state.rangeReduction?.statement === statement) {
    return emitRangeReduction(writer, state.rangeReduction, state);
  }
  if ((!state.localSlots.has(statement.localId) && !state.localRegisters.has(statement.localId))
    || (!state.rangeSlots.has(statement) && !state.rangeRegisters.has(statement))
    || !emitExpression(writer, statement.start, state)) return false;
  emitStoreLocal(writer, 0, statement.localId, state);
  if (!emitExpression(writer, statement.end, state)) return false;
  emitStoreRangeEnd(writer, 0, statement, state);

  const loop = state.nextLabel++;
  const end = state.nextLabel++;
  writer.mark(loop);
  emitLoadLocal(writer, 0, statement.localId, state);
  emitLoadRangeEnd(writer, 1, statement, state);
  writer.emit(0x66, 0x0f, 0x2e, 0xc1);
  writer.branch(0x83, end);
  if (state.metered) emitTick(writer, statement.source, state);
  if (!emitStatements(writer, statement.body, state)) return false;
  emitLoadLocal(writer, 0, statement.localId, state);
  emitLoadConstantToXmm(writer, 1, 1);
  writer.emit(...BINARY_INSTRUCTIONS.get('+'));
  emitStoreLocal(writer, 0, statement.localId, state);
  writer.jump(loop);
  writer.mark(end);
  return true;
}

function emitRangeReduction(writer, reduction, state) {
  const accumulatorStatement = reduction.kind === 'modulo-count'
    ? state.rangeReduction.statement.body[0].then[0]
    : state.rangeReduction.statement.body[0];
  const accumulatorId = accumulatorStatement.localId;
  if (!state.localSlots.has(accumulatorId) && !state.localRegisters.has(accumulatorId)) return false;
  if (reduction.kind === 'modulo-count') {
    const bound = state.rangeReduction.statement.end;
    if (bound.op === 'const') emitLoadConstant(writer, bound.value);
    else emitLoadLocal(writer, 0, bound.localId, state);
    emitLoadConstantToXmm(writer, 0, 1);
    writer.emit(0x66, 0x0f, 0x2e, 0xc1);
    const empty = state.nextLabel++;
    const done = state.nextLabel++;
    writer.branch(0x86, empty);
    emitLoadConstantToXmm(writer, 1, 1);
    writer.emit(...BINARY_INSTRUCTIONS.get('-'));
    emitLoadConstantToXmm(writer, reduction.divisor, 1);
    writer.emit(...BINARY_INSTRUCTIONS.get('/'));
    writer.emit(0x48, 0xf2, 0x0f, 0x2c, 0xc0, 0x48, 0x83, 0xc0, 0x01);
    writer.emit(0xf2, 0x48, 0x0f, 0x2a, 0xc0);
    writer.jump(done);
    writer.mark(empty);
    emitLoadConstant(writer, 0);
    writer.mark(done);
  } else if (reduction.kind === 'unit-increment') {
    const bound = state.rangeReduction.statement.end;
    if (bound.op === 'const') emitLoadConstant(writer, bound.value);
    else emitLoadLocal(writer, 0, bound.localId, state);
  } else if (reduction.kind === 'parity-adjusted-sum') {
    const bound = state.rangeReduction.statement.end;
    const boundExpression = bound.op === 'const'
      ? { op: 'const', type: 'number', value: bound.value, source: { line: 0 } }
      : { op: 'local.get', type: 'number', localId: bound.localId, source: { line: 0 } };
    const offset = {
      op: 'conditional',
      type: 'number',
      condition: {
        op: 'binary',
        type: 'boolean',
        operator: '===',
        left: {
          op: 'binary',
          type: 'number',
          operator: '%',
          left: boundExpression,
          right: { op: 'const', type: 'number', value: 2, source: { line: 0 } },
          source: { line: 0 },
        },
        right: { op: 'const', type: 'number', value: 0, source: { line: 0 } },
        source: { line: 0 },
      },
      consequent: { op: 'const', type: 'number', value: 0, source: { line: 0 } },
      alternate: { op: 'const', type: 'number', value: 1, source: { line: 0 } },
      source: { line: 0 },
    };
    const triangle = {
      op: 'binary',
      type: 'number',
      operator: '/',
      left: {
        op: 'binary',
        type: 'number',
        operator: '*',
        left: {
          op: 'binary',
          type: 'number',
          operator: '-',
          left: boundExpression,
          right: { op: 'const', type: 'number', value: 1, source: { line: 0 } },
          source: { line: 0 },
        },
        right: boundExpression,
        source: { line: 0 },
      },
      right: { op: 'const', type: 'number', value: 2, source: { line: 0 } },
      source: { line: 0 },
    };
    emitExpression(writer, {
      op: 'binary',
      type: 'number',
      operator: '+',
      left: triangle,
      right: offset,
      source: { line: 0 },
    }, state);
  } else {
    const bound = state.rangeReduction.statement.end;
    if (bound.op === 'const') emitLoadConstant(writer, bound.value);
    else emitLoadLocal(writer, 0, bound.localId, state);
    const scratch = state.firstScratchSlot + state.scratchDepth++;
    state.maxScratchDepth = Math.max(state.maxScratchDepth, state.scratchDepth);
    emitStoreXmm(writer, 0, scratch, state);
    emitLoadConstantToXmm(writer, 1, 1);
    writer.emit(...BINARY_INSTRUCTIONS.get('-'));
    emitLoadXmm(writer, 1, scratch, state);
    writer.emit(...BINARY_INSTRUCTIONS.get('*'));
    emitLoadConstantToXmm(writer, 2, 1);
    writer.emit(...BINARY_INSTRUCTIONS.get('/'));
    state.scratchDepth--;
  }
  emitStoreLocal(writer, 0, accumulatorId, state);
  return true;
}

function emitExpression(writer, expression, state) {
  if (state.metered) {
    for (const source of expression.inlineStepPrefix || []) emitTick(writer, source, state);
  }
  if (state.metered && expression.metered !== false) emitTick(writer, expression.source, state);
  if (state.metered) {
    for (const source of expression.inlineStepSources || []) emitTick(writer, source, state);
  }
  switch (expression.op) {
    case 'const':
      emitLoadConstant(writer, expression.value);
      return true;
    case 'local.get':
      emitLoadLocal(writer, 0, expression.localId, state);
      return true;
    case 'unary':
      if (expression.operator !== '+') return false;
      return emitExpression(writer, expression.value, state);
    case 'conditional':
      if (!emitExpression(writer, expression.condition, state)) return false;
      writer.emit(0x0f, 0x57, 0xc9);
      writer.emit(0x66, 0x0f, 0x2e, 0xc1);
      {
        const alternate = state.nextLabel++;
        const end = state.nextLabel++;
        writer.branch(0x84, alternate);
        if (!emitExpression(writer, expression.consequent, state)) return false;
        writer.jump(end);
        writer.mark(alternate);
        if (!emitExpression(writer, expression.alternate, state)) return false;
        writer.mark(end);
      }
      return true;
    case 'binary':
      if (COMPARISONS.has(expression.operator)) {
        return emitComparison(writer, expression, state);
      }
      if (expression.operator === '%') return emitModulo(writer, expression, state);
      if (!BINARY_INSTRUCTIONS.has(expression.operator)) return false;
      if (!emitExpression(writer, expression.left, state)) return false;
      {
        const scratch = state.firstScratchSlot + state.scratchDepth++;
        state.maxScratchDepth = Math.max(state.maxScratchDepth, state.scratchDepth);
        emitStoreXmm(writer, 0, scratch, state);
        if (!emitExpression(writer, expression.right, state)) {
          state.scratchDepth--;
          return false;
        }
        writer.emit(0x66, 0x0f, 0x28, 0xc8);
        emitLoadXmm(writer, 0, scratch, state);
        writer.emit(...BINARY_INSTRUCTIONS.get(expression.operator));
        state.scratchDepth--;
      }
      return true;
    default:
      return false;
  }
}

function emitModulo(writer, expression, state) {
  if (!emitExpression(writer, expression.left, state)) return false;
  const scratch = state.firstScratchSlot + state.scratchDepth++;
  state.maxScratchDepth = Math.max(state.maxScratchDepth, state.scratchDepth);
  emitStoreXmm(writer, 0, scratch, state);
  if (!emitExpression(writer, expression.right, state)) {
    state.scratchDepth--;
    return false;
  }
  writer.emit(0x66, 0x0f, 0x28, 0xc8);
  emitLoadXmm(writer, 0, scratch, state);
  writer.emit(
    0x48, 0xf2, 0x0f, 0x2c, 0xc0,
    0x48, 0xf2, 0x0f, 0x2c, 0xc9,
    0x48, 0x99,
    0x48, 0xf7, 0xf9,
    0xf2, 0x48, 0x0f, 0x2a, 0xc2,
  );
  state.scratchDepth--;
  return true;
}

function emitTick(writer, source, state) {
  const line = Number.isSafeInteger(source?.line) && source.line >= 0 && source.line <= 0x7fffffff
    ? source.line
    : 0;
  let label = state.lineLabels.get(line);
  if (label === undefined) {
    label = state.nextLabel++;
    state.lineLabels.set(line, label);
  }
  writer.emit(0x49, 0xff, 0xc7, 0x4d, 0x39, 0xef);
  writer.branch(0x87, label);
}

function emitEpilogue(writer, metered) {
  if (metered) {
    writer.emit(
      0x4d, 0x89, 0x3c, 0x24,
      0x4c, 0x8b, 0x65, 0xf8,
      0x4c, 0x8b, 0x6d, 0xf0,
      0x4c, 0x8b, 0x75, 0xe8,
      0x4c, 0x8b, 0x7d, 0xe0,
    );
  }
  writer.emit(0xc9, 0xc3);
}

function emitComparison(writer, expression, state) {
  if (!emitExpression(writer, expression.left, state)) return false;
  const scratch = state.firstScratchSlot + state.scratchDepth++;
  state.maxScratchDepth = Math.max(state.maxScratchDepth, state.scratchDepth);
  emitStoreXmm(writer, 0, scratch, state);
  if (!emitExpression(writer, expression.right, state)) {
    state.scratchDepth--;
    return false;
  }
  writer.emit(0x66, 0x0f, 0x28, 0xc8);
  emitLoadXmm(writer, 0, scratch, state);
  writer.emit(0x66, 0x0f, 0x2e, 0xc1);
  const comparison = COMPARISONS.get(expression.operator);
  writer.emit(0x0f, comparison.set, 0xc0);
  if (comparison.unordered) {
    writer.emit(0x0f, 0x9b, 0xc2);
    writer.emit(...(comparison.unordered === 'and'
      ? [0x20, 0xc2]
      : [0x08, 0xc2]));
  }
  writer.emit(0x0f, 0xb6, 0xc0);
  writer.emit(0xf2, 0x0f, 0x2a, 0xc0);
  state.scratchDepth--;
  return true;
}

function emitLoadConstant(writer, value) {
  emitLoadConstantToXmm(writer, value, 0);
}

function emitLoadConstantToXmm(writer, value, register) {
  const bits = new ArrayBuffer(8);
  new DataView(bits).setFloat64(0, value, true);
  writer.emit(0x48, 0xb8, ...new Uint8Array(bits), 0x66, 0x48, 0x0f, 0x6e, 0xc0 | (register << 3));
}

function emitLoadXmm(writer, register, slot, state) {
  writer.emit(0xf2, 0x0f, 0x10, 0x85 | (register << 3));
  writer.emitInt32(-((slot + state.reservedStackSlots + 1) * 8));
}

function emitLoadLocal(writer, register, localId, state) {
  const cached = state.localRegisters.get(localId);
  if (cached === undefined) emitLoadXmm(writer, register, state.localSlots.get(localId), state);
  else emitMoveXmm(writer, register, cached);
}

function emitStoreLocal(writer, register, localId, state) {
  const cached = state.localRegisters.get(localId);
  if (cached === undefined) emitStoreXmm(writer, register, state.localSlots.get(localId), state);
  else emitMoveXmm(writer, cached, register);
}

function emitLoadRangeEnd(writer, register, statement, state) {
  const cached = state.rangeRegisters.get(statement);
  if (cached === undefined) emitLoadXmm(writer, register, state.rangeSlots.get(statement), state);
  else emitMoveXmm(writer, register, cached);
}

function emitStoreRangeEnd(writer, register, statement, state) {
  const cached = state.rangeRegisters.get(statement);
  if (cached === undefined) emitStoreXmm(writer, register, state.rangeSlots.get(statement), state);
  else emitMoveXmm(writer, cached, register);
}

function emitMoveXmm(writer, target, source) {
  writer.emit(0x66, 0x0f, 0x28, 0xc0 | (target << 3) | source);
}

function emitStoreXmm(writer, register, slot, state) {
  writer.emit(0xf2, 0x0f, 0x11, 0x85 | (register << 3));
  writer.emitInt32(-((slot + state.reservedStackSlots + 1) * 8));
}

class CodeWriter {
  constructor() {
    this.bytes = [];
    this.labels = new Map();
    this.relocations = [];
  }

  emit(...bytes) {
    this.bytes.push(...bytes);
  }

  emitInt32(value) {
    this.emit(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  emitPrologue(metered) {
    this.emit(0x55, 0x48, 0x89, 0xe5, 0x48, 0x81, 0xec);
    const offset = this.bytes.length;
    this.emitInt32(0);
    if (metered) {
      this.emit(
        0x4c, 0x89, 0x65, 0xf8,
        0x4c, 0x89, 0x6d, 0xf0,
        0x4c, 0x89, 0x75, 0xe8,
        0x4c, 0x89, 0x7d, 0xe0,
        0x4c, 0x8b, 0x65, 0x30,
        0x4c, 0x8b, 0x6d, 0x38,
        0x4c, 0x8b, 0x75, 0x40,
        0x4d, 0x8b, 0x3c, 0x24,
      );
    }
    return offset;
  }

  patchInt32(offset, value) {
    const encoded = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
    this.bytes.splice(offset, encoded.length, ...encoded);
  }

  branch(condition, label) {
    this.emit(0x0f, condition);
    this.emitRelocation(label);
  }

  jump(label) {
    this.emit(0xe9);
    this.emitRelocation(label);
  }

  emitRelocation(label) {
    const offset = this.bytes.length;
    this.emitInt32(0);
    this.relocations.push({ label, offset });
  }

  mark(label) {
    this.labels.set(label, this.bytes.length);
  }

  resolveRelocations() {
    for (const relocation of this.relocations) {
      const target = this.labels.get(relocation.label);
      if (target === undefined) return false;
      const displacement = target - (relocation.offset + 4);
      if (displacement < -0x80000000 || displacement > 0x7fffffff) return false;
      this.patchInt32(relocation.offset, displacement);
    }
    return true;
  }
}
