import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const benchmarkPath = fileURLToPath(new URL('../benchmark/engines.js', import.meta.url));

test('engine benchmark validates one equivalent workload and records comparable measurements', () => {
  const result = spawnSync(process.execPath, [
    benchmarkPath,
    '--iterations',
    '1000',
    '--samples',
    '3',
  ], {
    encoding: 'utf8',
    timeout: 60_000,
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.benchmark, 'sum-integer-range-v1');
  assert.equal(report.method.iterations, 1000);
  assert.equal(report.method.samples, 3);
  assert.equal(report.workloadValidation.passed, true);
  assert.equal(report.workloadValidation.implementationsPassed, report.engines.length);
  assert.ok(report.workloadValidation.requiredFeatures.includes('integer range iteration'));
  assert.ok(report.engines.some(engine => engine.id === 'naidevm'));

  for (const engine of report.engines) {
    assert.equal(engine.correctness.passed, true, engine.name);
    assert.equal(engine.correctness.actual, 499500, engine.name);
    assert.ok(engine.startup.medianMs > 0, engine.name);
    assert.equal(engine.startup.samplesMs.length, 3, engine.name);
    assert.ok(engine.throughput.iterationsPerSecond > 0, engine.name);
    assert.equal(engine.throughput.samplesMs.length, 3, engine.name);
    assert.ok(engine.peakRssBytes > 0, engine.name);
  }
});
