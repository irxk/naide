const XMM_REGISTERS = [2, 3, 4, 5];

export function allocateNativeRegisters(ir, rangeStatements = []) {
  const ranges = new Map();
  const rangeIndices = new Map([...rangeStatements].map((statement, index) => [statement, index]));
  let position = 0;

  const rangeFor = key => {
    let interval = ranges.get(key);
    if (!interval) {
      interval = { key, start: null, end: null };
      ranges.set(key, interval);
    }
    return interval;
  };
  const define = (key, at) => {
    const interval = rangeFor(key);
    interval.start = interval.start === null ? at : Math.min(interval.start, at);
    interval.end = interval.end === null ? at : Math.max(interval.end, at);
  };
  const use = (key, at) => {
    const interval = rangeFor(key);
    interval.start = interval.start === null ? 0 : Math.min(interval.start, at);
    interval.end = interval.end === null ? at : Math.max(interval.end, at);
  };

  const visitExpression = expression => {
    if (!expression || typeof expression !== 'object') return;
    const at = position++;
    if (expression.op === 'local.get') use(expression.localId, at);
    if (expression.op === 'binary') {
      visitExpression(expression.left);
      visitExpression(expression.right);
    } else if (expression.op === 'unary') {
      visitExpression(expression.value);
    } else if (expression.op === 'conditional') {
      visitExpression(expression.condition);
      visitExpression(expression.consequent);
      visitExpression(expression.alternate);
    }
  };

  const visitStatements = statements => {
    for (const statement of statements) {
      switch (statement.op) {
        case 'local.init':
        case 'local.set':
          visitExpression(statement.value);
          define(statement.localId, position++);
          break;
        case 'return':
          visitExpression(statement.value);
          position++;
          break;
        case 'if':
          visitExpression(statement.condition);
          position++;
          visitStatements(statement.then);
          visitStatements(statement.otherwise);
          position++;
          break;
        case 'range.for': {
          visitExpression(statement.start);
          visitExpression(statement.end);
          const start = position++;
          define(statement.localId, start);
          define(statement, start);
          visitStatements(statement.body);
          const end = position++;
          use(statement.localId, end);
          use(statement, end);
          break;
        }
      }
    }
  };
  visitStatements(ir.body);

  const parameterIds = new Set(ir.params.map(parameter => parameter.localId));
  const intervals = [...ranges.entries()]
    .filter(([key]) => typeof key === 'number' ? !parameterIds.has(key) : rangeIndices.has(key))
    .map(([key, interval]) => ({
      key,
      kind: typeof key === 'number' ? 'local' : 'range-end',
      id: typeof key === 'number' ? key : rangeIndices.get(key),
      start: interval.start ?? 0,
      end: interval.end ?? interval.start ?? 0,
      register: null,
    }))
    .sort((left, right) => left.start - right.start || right.end - left.end);

  const active = [];
  const freeRegisters = [...XMM_REGISTERS];
  let peakLiveValues = 0;
  for (const interval of intervals) {
    for (let index = active.length - 1; index >= 0; index--) {
      if (active[index].end < interval.start) {
        freeRegisters.push(active[index].register);
        active.splice(index, 1);
      }
    }

    if (freeRegisters.length > 0) {
      interval.register = freeRegisters.pop();
      active.push(interval);
    } else {
      let longestIndex = 0;
      for (let index = 1; index < active.length; index++) {
        if (active[index].end > active[longestIndex].end) longestIndex = index;
      }
      if (active[longestIndex].end > interval.end) {
        const displaced = active[longestIndex];
        interval.register = displaced.register;
        displaced.register = null;
        active[longestIndex] = interval;
      }
    }
    peakLiveValues = Math.max(peakLiveValues, active.length);
  }

  const localRegisters = new Map();
  const rangeRegisters = new Map();
  for (const interval of intervals) {
    if (interval.register === null) continue;
    if (interval.kind === 'local') localRegisters.set(interval.key, interval.register);
    else rangeRegisters.set(interval.key, interval.register);
  }

  return {
    localRegisters,
    rangeRegisters,
    intervals: intervals.map(({ kind, id, start, end, register }) =>
      ({ kind, id, start, end, register })),
    stats: {
      registerCount: XMM_REGISTERS.length,
      allocatedValues: intervals.filter(interval => interval.register !== null).length,
      spilledValues: intervals.filter(interval => interval.register === null).length,
      peakLiveValues,
    },
  };
}
