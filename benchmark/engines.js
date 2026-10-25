#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ITERATIONS = 10_000;
const DEFAULT_SAMPLES = 5;
const ENGINE_NAMES = {
  naidevm: 'NaideVM',
  node: 'Node.js / V8',
  bun: 'Bun / JavaScriptCore',
  python: 'Python / CPython',
};

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
  if (!Number.isSafeInteger(options.iterations) || options.iterations < 1 || options.iterations > 10_000_000) {
    throw new Error('--iterations must be an integer between 1 and 10000000.');
  }
  if (!Number.isSafeInteger(options.samples) || options.samples < 3 || options.samples > 25) {
    throw new Error('--samples must be an integer between 3 and 25.');
  }
  return options;
}

function runnerSource(engine, mode, iterations, samples) {
  if (engine === 'naidevm') {
    const moduleUrl = pathToFileURL(resolve(ROOT, 'src', 'native-engine.js')).href;
    const naideSource = [
      'fn sumTo(int n) -> int:',
      '  mut int total = 0',
      '  each i in range(0, n):',
      '    total = total + i',
      '  ret total',
      'mut int result = 0',
    ].join('\n');
    const operation = `result = sumTo(${iterations})`;
    return `
      import { NaideVM } from ${JSON.stringify(moduleUrl)};
      const output = { log() {}, error() {} };
      const engine = new NaideVM({ output, maxSteps: 100000000 });
      const setup = engine.parse(${JSON.stringify(naideSource)});
      await engine.executeAsync(setup);
      const operation = engine.parse(${JSON.stringify(operation)});
      const timings = [];
      for (let sample = 0; sample < ${mode === 'startup' ? 1 : samples + 1}; sample++) {
        const started = performance.now();
        await engine.executeAsync(operation);
        const elapsedMs = performance.now() - started;
        if (sample > 0 || ${mode === 'startup'}) timings.push(elapsedMs);
      }
      const result = engine.global.get('result');
      const usage = process.resourceUsage();
      console.log(JSON.stringify({
        engine: 'naidevm',
        version: process.version,
        result,
        timings,
        maxRssBytes: usage.maxRSS * 1024,
      }));
    `;
  }
  if (engine === 'node' || engine === 'bun') {
    return `
      function sumTo(n) {
        let total = 0;
        for (let i = 0; i < n; i++) total += i;
        return total;
      }
      const timings = [];
      for (let sample = 0; sample < ${mode === 'startup' ? 1 : samples + 1}; sample++) {
        const started = performance.now();
        const result = sumTo(${iterations});
        const elapsedMs = performance.now() - started;
        if (sample > 0 || ${mode === 'startup'}) timings.push(elapsedMs);
        globalThis.benchmarkResult = result;
      }
      const usage = process.resourceUsage();
      console.log(JSON.stringify({
        engine: ${JSON.stringify(engine)},
        version: ${engine === 'bun' ? 'Bun.version' : 'process.version'},
        result: globalThis.benchmarkResult,
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

def sum_to(n):
    total = 0
    for i in range(n):
        total += i
    return total

timings = []
for sample in range(${mode === 'startup' ? 1 : samples + 1}):
    started = time.perf_counter_ns()
    result = sum_to(${iterations})
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
    ok = psapi.GetProcessMemoryInfo(
        process, ctypes.byref(counters), counters.cb
    )
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
  if (engine === 'naidevm' || engine === 'node') {
    return { executable: process.execPath, args: ['--input-type=module', '-e', source] };
  }
  if (engine === 'bun') return { executable: 'bun', args: ['-e', source] };
  return { executable: 'python', args: ['-c', source] };
}

function runEngine(engine, mode, iterations, samples) {
  const source = runnerSource(engine, mode, iterations, samples);
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
    throw new Error(`${ENGINE_NAMES[engine]} ${mode} runner failed:\n${result.stderr}`);
  }
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  const expected = iterations * (iterations - 1) / 2;
  if (report.result !== expected) {
    throw new Error(`${ENGINE_NAMES[engine]} returned ${report.result}; expected ${expected}.`);
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
  for (const [engine, executable, args] of [
    ['bun', 'bun', ['--version']],
    ['python', 'python', ['--version']],
  ]) {
    const detected = spawnSync(executable, args, { encoding: 'utf8', timeout: 10_000 });
    if (!detected.error && detected.status === 0) available.push(engine);
  }
  return available;
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const engines = detectRuntimes();
  const results = engines.map((engine) => {
    const startupSamples = Array.from({ length: options.samples }, () => {
      const { processElapsedMs } = runEngine(engine, 'startup', 1000, 1);
      return processElapsedMs;
    });
    const { report } = runEngine(engine, 'throughput', options.iterations, options.samples);
    const medianMs = median(report.timings);
    return {
      id: engine,
      name: ENGINE_NAMES[engine],
      version: report.version,
      startup: {
        medianMs: median(startupSamples),
        samplesMs: startupSamples,
      },
      throughput: {
        iterations: options.iterations,
        medianMs,
        iterationsPerSecond: Math.round(options.iterations / (medianMs / 1000)),
        samplesMs: report.timings,
      },
      peakRssBytes: report.maxRssBytes,
      correctness: {
        expected: options.iterations * (options.iterations - 1) / 2,
        actual: report.result,
        passed: true,
      },
    };
  });
  const result = {
    schemaVersion: 1,
    benchmark: 'sum-integer-range-v1',
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
      startupSamples: options.samples,
      statistic: 'Median; startup includes process launch and a 1000-iteration correctness run. Throughput excludes process startup and measures the same sumTo loop body.',
      workloadFeatures: ['integer range loop', 'mutable scalar', 'addition', 'function call', 'deterministic integer result'],
      peakRss: 'Operating-system process high-water RSS: Node/Bun process.resourceUsage().maxRSS; CPython GetProcessMemoryInfo on Windows or getrusage elsewhere.',
      limitations: 'Single machine and runtime versions; results vary by hardware, OS, runtime release, power mode, and background load. This microbenchmark is not a general language, application, compiler, or feature-parity ranking.',
    },
    workloadValidation: {
      requiredFeatures: [
        'integer range iteration',
        'mutable scalar assignment',
        'integer addition',
        'user-defined function call',
      ],
      passed: results.every(engine => engine.correctness.passed),
      implementationsPassed: results.filter(engine => engine.correctness.passed).length,
      implementationsMeasured: results.length,
      scope: 'These features were exercised together by one deterministic fixture. This is not a complete feature-coverage or language-parity score.',
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
