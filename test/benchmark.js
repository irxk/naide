import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const benchmarkPath = fileURLToPath(new URL('../benchmark/engines.js', import.meta.url));

test('engine benchmark validates one equivalent workload and records comparable measurements', () => {
  const result = spawnSync(process.execPath, [
    benchmarkPath,
    '--iterations',
    '10000',
    '--samples',
    '3',
  ], {
    encoding: 'utf8',
    timeout: 60_000,
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.benchmark, 'naidevm-representative-workloads-v3');
  assert.equal(report.method.iterations, 10000);
  assert.equal(report.method.samples, 3);
  assert.equal(report.method.sampleRepetitions, 5);
  assert.equal(report.acceptance.baselineEngine, 'node');
  assert.equal(report.acceptance.comparisons.length, 5);
  assert.ok(report.engines.some(engine => engine.id === 'naidevm'));
  assert.ok(report.engines.some(engine => engine.id === 'node'));
  assert.ok(report.engines.some(engine => engine.id === 'python'));
  if (report.engines.some(engine => engine.id === 'naidevm-machine')) {
    assert.ok(report.engines.some(engine => engine.id === 'naidevm-tiered'));
  }

  for (const engine of report.engines) {
    assert.ok(engine.startup.medianMs > 0, engine.name);
    assert.equal(engine.startup.samplesMs.length, 3, engine.name);
    assert.ok(engine.workloads.length === 5, engine.name);
    assert.ok(engine.peakRssBytes > 0, engine.name);
    for (const workload of engine.workloads) {
      assert.equal(workload.correctness.passed, true, `${engine.name}: ${workload.id}`);
      assert.equal(workload.correctness.actual, workload.expected, `${engine.name}: ${workload.id}`);
      assert.ok(workload.throughput.operationsPerSecond > 0, `${engine.name}: ${workload.id}`);
      assert.equal(workload.throughput.samplesMs.length, 3, `${engine.name}: ${workload.id}`);
      assert.equal(workload.sampleRepetitions, 5, `${engine.name}: ${workload.id}`);
    }
  }

  for (const comparison of report.acceptance.comparisons) {
    const naidevm = report.engines.find(engine => engine.id === 'naidevm')
      .workloads.find(workload => workload.id === comparison.workload);
    const node = report.engines.find(engine => engine.id === 'node')
      .workloads.find(workload => workload.id === comparison.workload);
    const python = report.engines.find(engine => engine.id === 'python')
      .workloads.find(workload => workload.id === comparison.workload);
    assert.equal(comparison.nodeOperationsPerSecond, node.throughput.operationsPerSecond);
    assert.equal(comparison.naidevmOperationsPerSecond, naidevm.throughput.operationsPerSecond);
    assert.equal(comparison.naidevmBeatsNode,
      naidevm.throughput.operationsPerSecond > node.throughput.operationsPerSecond);
    assert.equal(comparison.nativeTiers['naidevm-machine'] !== undefined,
      report.engines.some(engine => engine.id === 'naidevm-machine'));
    for (const tierId of ['naidevm-machine', 'naidevm-tiered']) {
      const tier = report.engines.find(engine => engine.id === tierId);
      if (!tier) continue;
      const tierWorkload = tier.workloads.find(workload => workload.id === comparison.workload);
      assert.equal(comparison.nativeTiers[tierId].operationsPerSecond,
        tierWorkload.throughput.operationsPerSecond);
      assert.equal(comparison.nativeTiers[tierId].beatsNode,
        tierWorkload.throughput.operationsPerSecond > node.throughput.operationsPerSecond);
      assert.ok(tierWorkload.nativeMachineCodeStats);
    }
    assert.equal(comparison.pythonOperationsPerSecond, python.throughput.operationsPerSecond);
    assert.equal(comparison.naidevmBeatsPython,
      naidevm.throughput.operationsPerSecond > python.throughput.operationsPerSecond);
  }
});
