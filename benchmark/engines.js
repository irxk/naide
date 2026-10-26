#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { nativeMachineCodeAvailable } from '../src/native-machine-bridge.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ITERATIONS = 100_000;
const DEFAULT_SAMPLES = 7;
const SAMPLE_REPETITIONS = 5;
const ENGINE_NAMES = {
  naidevm: 'NaideVM',
  'naidevm-machine': 'NaideVM direct x64 JIT',
  'naidevm-tiered': 'NaideVM tiered x64 JIT',
  node: 'Node.js / V8',
  bun: 'Bun / JavaScriptCore',
  python: 'Python / CPython',
};

const WORKLOADS = [
  {
    id: 'integer-sum',
    name: 'Integer range sum',
    units: 'loop iterations',
    iterations: base => base,
    expected: n => n * (n - 1) / 2,
    naide: n => `
      fn benchmark(int n) -> int:
        mut int total = 0
        for i in 0..n:
          total = total + i
        ret total
      int n = ${n}
      mut int result = 0
    `,
    javascript: n => `
      function benchmark(n) {
        let total = 0;
        for (let i = 0; i < n; i++) total += i;
        return total;
      }
      const n = ${n};
      let result = 0;
    `,
    python: n => `
def benchmark(n):
    total = 0
    for i in range(n):
        total += i
    return total

n = ${n}
result = 0
`,
    invocation: 'result = benchmark(n)',
  },
  {
    id: 'branch-count',
    name: 'Branch-heavy loop',
    units: 'loop iterations',
    iterations: base => base,
    expected: n => Math.ceil(n / 3),
    naide: n => `
      fn benchmark(int n) -> int:
        mut int count = 0
        for i in 0..n:
          if i % 3 == 0:
            count = count + 1
        ret count
      int n = ${n}
      mut int result = 0
    `,
    javascript: n => `
      function benchmark(n) {
        let count = 0;
        for (let i = 0; i < n; i++) {
          if (i % 3 === 0) count++;
        }
        return count;
      }
      const n = ${n};
      let result = 0;
    `,
    python: n => `
def benchmark(n):
    count = 0
    for i in range(n):
        if i % 3 == 0:
            count += 1
    return count

n = ${n}
result = 0
`,
    invocation: 'result = benchmark(n)',
  },
  {
    id: 'function-calls',
    name: 'Function-call loop',
    units: 'function calls',
    iterations: base => Math.max(1_000, Math.floor(base / 10)),
    expected: n => n,
    naide: n => `
      fn increment(int value) -> int:
        ret value + 1
      fn benchmark(int n) -> int:
        mut int result = 0
        for i in 0..n:
          result = increment(result)
        ret result
      int n = ${n}
      mut int result = 0
    `,
    javascript: n => `
      function increment(value) { return value + 1; }
      function benchmark(n) {
        let result = 0;
        for (let i = 0; i < n; i++) result = increment(result);
        return result;
      }
      const n = ${n};
      let result = 0;
    `,
    python: n => `
def increment(value):
    return value + 1

def benchmark(n):
    result = 0
    for _ in range(n):
        result = increment(result)
    return result

n = ${n}
result = 0
`,
    invocation: 'result = benchmark(n)',
  },
  {
    id: 'collection-sum',
    name: 'Collection iteration',
    units: 'collection elements',
    iterations: () => 2_000,
    expected: n => n * (n - 1) / 2,
    naide: n => `
      list values = [${Array.from({ length: n }, (_, index) => index).join(', ')}]
      fn benchmark(list values) -> int:
        mut int total = 0
        for value of values:
          total = total + value
        ret total
      mut int result = 0
    `,
    javascript: n => `
      const values = Array.from({ length: ${n} }, (_, index) => index);
      function benchmark(values) {
        let total = 0;
        for (const value of values) total += value;
        return total;
      }
      let result = 0;
    `,
    python: n => `
values = list(range(${n}))

def benchmark(values):
    total = 0
    for value in values:
        total += value
    return total

result = 0
`,
    invocation: 'result = benchmark(values)',
  },
  {
    id: 'mixed-loop',
    name: 'Mixed arithmetic, branch, and calls',
    units: 'loop iterations',
    iterations: base => Math.max(1_000, Math.floor(base / 10)),
    expected: n => {
      let total = 0;
      for (let index = 0; index < n; index++) {
        total += index % 2 === 0 ? index + 1 : index - 1;
      }
      return total;
    },
    naide: n => `
      fn adjust(int value) -> int:
        if value % 2 == 0:
          ret value + 1
        ret value - 1
      fn benchmark(int n) -> int:
        mut int total = 0
        for i in 0..n:
          total = total + adjust(i)
        ret total
      int n = ${n}
      mut int result = 0
    `,
    javascript: n => `
      function adjust(value) {
        if (value % 2 === 0) return value + 1;
        return value - 1;
      }
      function benchmark(n) {
        let total = 0;
        for (let i = 0; i < n; i++) total += adjust(i);
        return total;
      }
      const n = ${n};
      let result = 0;
    `,
    python: n => `
def adjust(value):
    if value % 2 == 0:
        return value + 1
    return value - 1

def benchmark(n):
    total = 0
    for i in range(n):
        total += adjust(i)
    return total

n = ${n}
result = 0
`,
    invocation: 'result = benchmark(n)',
  },
];

function dedent(source) {
  const lines = source.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '').split(/\r?\n/);
  const indentation = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^\s*/)[0].length));
  return lines.map(line => line.slice(indentation)).join('\n');
}

function parseOptions(args) {
  const options = { iterations: DEFAULT_ITERATIONS, samples: DEFAULT_SAMPLES, output: null };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--iterations') options.iterations = Number(value), index++;
    else if (flag === '--samples') options.samples = Number(value), index++;
    else if (flag === '--json') options.output = value, index++;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!Number.isSafeInteger(options.iterations) || options.iterations < 10_000 || options.iterations > 10_000_000) {
    throw new Error('--iterations must be an integer between 10000 and 10000000.');
  }
  if (!Number.isSafeInteger(options.samples) || options.samples < 3 || options.samples > 25) {
    throw new Error('--samples must be an integer between 3 and 25.');
  }
  return options;
}

function runtimeSource(engine, workload, iterations, samples, mode) {
  const n = mode === 'startup' ? Math.min(iterations, 1_000) : workload.iterations(iterations);
  const invocation = workload.invocation;
  const repetitions = mode === 'startup' ? 1 : SAMPLE_REPETITIONS;
  if (engine.startsWith('naidevm')) {
    const moduleUrl = pathToFileURL(resolve(ROOT, 'src', 'native-engine.js')).href;
    const source = dedent(workload.naide(n));
    const nativeMachineCode = engine !== 'naidevm';
    const nativeMachineCodeThreshold = engine === 'naidevm-tiered' ? 5 : 0;
    return `
      import { NaideVM } from ${JSON.stringify(moduleUrl)};
      const output = { log() {}, error() {} };
      const engine = new NaideVM({
        output,
        maxSteps: 1000000000,
        nativeMachineCode: ${nativeMachineCode},
        nativeMachineCodeThreshold: ${nativeMachineCodeThreshold},
        nativeMachineCodeDiagnostics: ${nativeMachineCode},
      });
      await engine.executeAsync(${JSON.stringify(source)});
      const operation = engine.parse(${JSON.stringify(invocation)});
      const timings = [];
      let result;
      const sampleCount = ${mode === 'startup' ? 1 : samples + 1};
      for (let sample = 0; sample < sampleCount; sample++) {
        const started = performance.now();
        for (let repetition = 0; repetition < ${repetitions}; repetition++) await engine.executeAsync(operation);
        const elapsedMs = performance.now() - started;
        result = engine.global.get('result');
        if (sample > 0 || ${mode === 'startup'}) timings.push(elapsedMs);
      }
      const usage = process.resourceUsage();
      console.log(JSON.stringify({
        engine: 'naidevm',
        version: process.version,
        result,
        timings,
        nativeMachineCodeStats: engine.getNativeMachineCodeStats(),
        maxRssBytes: usage.maxRSS * 1024,
      }));
    `;
  }
  if (engine === 'node' || engine === 'bun') {
    return `
      ${workload.javascript(n)}
      const timings = [];
      const sampleCount = ${mode === 'startup' ? 1 : samples + 1};
      for (let sample = 0; sample < sampleCount; sample++) {
        const started = performance.now();
        for (let repetition = 0; repetition < ${repetitions}; repetition++) {
          result = ${invocation.replace('result = ', '')};
        }
        const elapsedMs = performance.now() - started;
        if (sample > 0 || ${mode === 'startup'}) timings.push(elapsedMs);
      }
      const usage = process.resourceUsage();
      console.log(JSON.stringify({
        engine: ${JSON.stringify(engine)},
        version: ${engine === 'bun' ? 'Bun.version' : 'process.version'},
        result,
        timings,
        maxRssBytes: usage.maxRSS * 1024,
      }));
    `;
  }
  return `
import json
import sys
import time
import platform

${workload.python(n)}
timings = []
sample_count = ${mode === 'startup' ? 1 : samples + 1}
for sample in range(sample_count):
    started = time.perf_counter_ns()
    for repetition in range(${repetitions}):
        ${invocation}
    elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
    if sample > 0 or ${mode === 'startup' ? 'True' : 'False'}:
        timings.append(elapsed_ms)

if sys.platform == 'win32':
    import ctypes
    from ctypes import wintypes
    class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [
            ('cb', wintypes.DWORD),
            ('PageFaultCount', wintypes.DWORD),
            ('PeakWorkingSetSize', ctypes.c_size_t),
            ('WorkingSetSize', ctypes.c_size_t),
            ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
            ('QuotaPagedPoolUsage', ctypes.c_size_t),
            ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
            ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
            ('PagefileUsage', ctypes.c_size_t),
            ('PeakPagefileUsage', ctypes.c_size_t),
        ]
    counters = PROCESS_MEMORY_COUNTERS()
    counters.cb = ctypes.sizeof(counters)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    psapi = ctypes.WinDLL('psapi', use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(PROCESS_MEMORY_COUNTERS),
        wintypes.DWORD,
    ]
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    process = kernel32.GetCurrentProcess()
    ok = psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb)
    if not ok:
        raise OSError('GetProcessMemoryInfo failed')
    max_rss_bytes = counters.PeakWorkingSetSize
else:
    import resource
    max_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    max_rss_bytes = int(max_rss if sys.platform == 'darwin' else max_rss * 1024)

print(json.dumps({
    'engine': 'python',
    'version': platform.python_version(),
    'result': result,
    'timings': timings,
    'maxRssBytes': max_rss_bytes,
}))
`;
}

function commandFor(engine, source) {
  if (engine.startsWith('naidevm') || engine === 'node') {
    return { executable: process.execPath, args: ['--input-type=module', '-e', source] };
  }
  if (engine === 'bun') return { executable: 'bun', args: ['-e', source] };
  return { executable: 'python', args: ['-c', source] };
}

function runEngine(engine, workload, mode, iterations, samples) {
  const source = runtimeSource(engine, workload, iterations, samples, mode);
  const { executable, args } = commandFor(engine, source);
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 1024 * 1024,
  });
  const processElapsedMs = performance.now() - started;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${ENGINE_NAMES[engine]} ${workload.id} ${mode} runner failed:\n${result.stderr}`);
  }
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  const count = workload.iterations(iterations);
  const expected = workload.expected(mode === 'startup' ? Math.min(iterations, 1_000) : count);
  if (report.result !== expected) {
    throw new Error(`${ENGINE_NAMES[engine]} returned ${report.result} for ${workload.id}; expected ${expected}.`);
  }
  return { report, processElapsedMs };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function detectRuntimes() {
  const available = ['naidevm', 'node'];
  if (nativeMachineCodeAvailable) {
    available.push('naidevm-machine', 'naidevm-tiered');
  }
  for (const [engine, executable, args] of [
    ['bun', 'bun', ['--version']],
    ['python', 'python', ['--version']],
  ]) {
    const detected = spawnSync(executable, args, { encoding: 'utf8', timeout: 10_000 });
    if (!detected.error && detected.status === 0) available.push(engine);
  }
  return available;
}

function benchmarkWorkload(engine, workload, options) {
  const { report } = runEngine(engine, workload, 'throughput', options.iterations, options.samples);
  const medianMs = median(report.timings);
  const iterations = workload.iterations(options.iterations);
  return {
    id: workload.id,
    name: workload.name,
    units: workload.units,
    iterations,
    sampleRepetitions: SAMPLE_REPETITIONS,
    operationsPerSample: iterations * SAMPLE_REPETITIONS,
    expected: workload.expected(iterations),
    throughput: {
      medianMs,
      operationsPerSecond: Math.round(iterations * SAMPLE_REPETITIONS / (medianMs / 1000)),
      samplesMs: report.timings,
    },
    nativeMachineCodeStats: report.nativeMachineCodeStats,
    runtimePeakRssBytes: report.maxRssBytes,
    peakRssBytes: report.maxRssBytes,
    correctness: {
      actual: report.result,
      passed: report.result === workload.expected(iterations),
    },
  };
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const engines = detectRuntimes();
  const results = engines.map(engine => {
    const startupSamples = Array.from({ length: options.samples }, () =>
      runEngine(engine, WORKLOADS[0], 'startup', options.iterations, 1));
    const workloads = WORKLOADS.map(workload => benchmarkWorkload(engine, workload, options));
    const runtimeVersion = startupSamples[0].report.version;
    const startupPeakRssBytes = Math.max(...startupSamples.map(sample => sample.report.maxRssBytes));
    return {
      id: engine,
      name: ENGINE_NAMES[engine],
      version: runtimeVersion,
      workloads,
      startup: {
        medianMs: median(startupSamples.map(sample => sample.processElapsedMs)),
        samplesMs: startupSamples.map(sample => sample.processElapsedMs),
        peakRssBytes: startupPeakRssBytes,
      },
      peakRssBytes: Math.max(startupPeakRssBytes, ...workloads.map(workload => workload.peakRssBytes)),
    };
  });
  const comparisons = WORKLOADS.map(workload => {
    const node = results.find(engine => engine.id === 'node')?.workloads.find(item => item.id === workload.id);
    const python = results.find(engine => engine.id === 'python')?.workloads.find(item => item.id === workload.id);
    const naidevm = results.find(engine => engine.id === 'naidevm')?.workloads.find(item => item.id === workload.id);
    const nativeTiers = results.filter(engine => engine.id.startsWith('naidevm-'));
    return {
      workload: workload.id,
      nodeOperationsPerSecond: node?.throughput.operationsPerSecond ?? null,
      pythonOperationsPerSecond: python?.throughput.operationsPerSecond ?? null,
      naidevmOperationsPerSecond: naidevm?.throughput.operationsPerSecond ?? null,
      naidevmBeatsNode: node && naidevm
        ? naidevm.throughput.operationsPerSecond > node.throughput.operationsPerSecond
        : null,
      naidevmBeatsPython: python && naidevm
        ? naidevm.throughput.operationsPerSecond > python.throughput.operationsPerSecond
        : null,
      nativeTiers: Object.fromEntries(nativeTiers.map(engine => {
        const nativeWorkload = engine.workloads.find(item => item.id === workload.id);
        return [engine.id, {
          operationsPerSecond: nativeWorkload?.throughput.operationsPerSecond ?? null,
          beatsNode: nativeWorkload && node
            ? nativeWorkload.throughput.operationsPerSecond > node.throughput.operationsPerSecond
            : null,
        }];
      })),
    };
  });
  const engineAcceptance = Object.fromEntries(results
    .filter(engine => engine.id.startsWith('naidevm'))
    .map(engine => [engine.id, comparisons.every(comparison => {
      if (engine.id === 'naidevm') return comparison.naidevmBeatsNode === true;
      return comparison.nativeTiers[engine.id]?.beatsNode === true;
    })]));
  const result = {
    schemaVersion: 3,
    benchmark: 'naidevm-representative-workloads-v3',
    generatedAt: new Date().toISOString(),
    host: {
      platform: `${os.type()} ${os.release()}`,
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model || 'Unknown',
      logicalCpus: os.cpus().length,
    },
    method: {
      iterations: options.iterations,
      samples: options.samples,
      warmupSamples: 1,
      sampleRepetitions: SAMPLE_REPETITIONS,
      statistic: 'Median of independent in-process batches after one warm-up batch. Each runtime executes the same deterministic workload; NAIDE setup and parsing are excluded from steady-state timing. Startup includes process launch, initialization, and one correctness execution.',
      memory: 'OS process high-water RSS. Node/Bun use process.resourceUsage(); CPython uses GetProcessMemoryInfo on Windows or getrusage elsewhere.',
      limitations: 'Single host and fixed local runtime versions. Workloads measure only their named constructs and do not establish general language or application performance.',
      executionPath: 'NaideVM is invoked through executeAsync(); the interpreter tier, direct Windows x64 machine-code tier, and hotness-tiered x64 machine-code tier are measured separately when the native bridge is available. Native tier diagnostics are enabled and included in each report.',
    },
    acceptance: {
      baselineEngine: 'node',
      requirement: 'Every workload must exceed Node.js/V8 independently for a tier to pass; no aggregate-only pass. CPython results remain descriptive.',
      comparisons,
      allWorkloadsBeatNodeByEngine: engineAcceptance,
    },
    engines: results,
  };
  const output = JSON.stringify(result, null, 2) + '\n';
  if (options.output) writeFileSync(resolve(options.output), output);
  console.log(output);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
