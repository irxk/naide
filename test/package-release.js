import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('npm package contains required CLI, runtime, and linked documentation files only', () => {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'run this package-content check through npm');

  const result = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);

  const [pack] = JSON.parse(result.stdout);
  const paths = new Set(pack.files.map(file => file.path));
  for (const requiredFile of [
    'bin/naide.js',
    'src/index.js',
    'src/runtime.js',
    'src/native.js',
    'src/generator-rust.js',
    'docs/release-readiness.md',
    'docs/guide.html',
    'docs/naidevm.html',
    'docs/naidevm-benchmark.json',
    'docs/src/parser.js',
    'benchmark/engines.js',
    'README.md',
    'SPEC.naide',
    'LICENSE',
  ]) {
    assert.ok(paths.has(requiredFile), `npm package should include ${requiredFile}`);
  }
  assert.ok(
    [...paths].every(path => !path.startsWith('test/') && !path.startsWith('.github/')),
    'test and CI-only files should not be published',
  );
});

test('packed npm artifact installs cleanly and its CLI compiles a NAIDE file', () => {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'run this package-install check through npm');
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'naide-package-install-'));
  const installDirectory = join(temporaryDirectory, 'consumer');

  try {
    const packed = spawnSync(process.execPath, [
      npmCli,
      'pack',
      '--json',
      '--pack-destination',
      temporaryDirectory,
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.ifError(packed.error);
    assert.equal(packed.status, 0, packed.stderr);
    const [{ filename }] = JSON.parse(packed.stdout);

    const installed = spawnSync(process.execPath, [
      npmCli,
      'install',
      '--prefix',
      installDirectory,
      join(temporaryDirectory, filename),
      '--omit=optional',
      '--no-audit',
      '--no-fund',
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.ifError(installed.error);
    assert.equal(installed.status, 0, installed.stderr);

    const sourcePath = join(temporaryDirectory, 'smoke.naide');
    writeFileSync(sourcePath, 'log "packed-install-ok"');
    const cliPath = join(installDirectory, 'node_modules', 'naider', 'bin', 'naide.js');
    const compiled = spawnSync(process.execPath, [cliPath, '--emit', sourcePath], {
      cwd: installDirectory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(compiled.error);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.match(compiled.stdout, /packed-install-ok/);

    const direct = spawnSync(process.execPath, [cliPath, sourcePath], {
      cwd: installDirectory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(direct.error);
    assert.equal(direct.status, 0, `${direct.stdout}\n${direct.stderr}`);
    assert.match(direct.stdout, /packed-install-ok/);

    assert.equal(
      existsSync(join(installDirectory, 'node_modules', 'esbuild')),
      false,
      'optional browser bundler should not be installed when optional dependencies are omitted',
    );

    const checked = spawnSync(process.execPath, [cliPath, 'check', sourcePath], {
      cwd: installDirectory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(checked.error);
    assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
    assert.match(checked.stdout, /OK/);

    const checkedWithFlag = spawnSync(process.execPath, [cliPath, '--check', sourcePath], {
      cwd: installDirectory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(checkedWithFlag.error);
    assert.equal(checkedWithFlag.status, 0, `${checkedWithFlag.stdout}\n${checkedWithFlag.stderr}`);
    assert.match(checkedWithFlag.stdout, /OK/);

    const nativeSmokePath = join(installDirectory, 'native-smoke.mjs');
    writeFileSync(nativeSmokePath, [
      "import { runNativeAsync } from 'naider/native';",
      "const result = await runNativeAsync('int answer = 40 + 2');",
      "if (result.globals.get('answer') !== 42) process.exit(1);",
    ].join('\n'));
    const native = spawnSync(process.execPath, [nativeSmokePath], {
      cwd: installDirectory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(native.error);
    assert.equal(native.status, 0, `${native.stdout}\n${native.stderr}`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
