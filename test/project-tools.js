import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPackageInstallPlan, getProjectTestPlans, inspectProject, listPackageAdapters, recordPackageDependency, runPackageInstall, runProjectTests, spawnNativeTool } from '../src/project-tools.js';

const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));

describe('project tools and native package adapters', () => {
  it('provides shell-free install plans for popular native package managers', () => {
    const examples = [
      ['npm', '@types/node@20.0.0', 'npm', ['install', '--', '@types/node@20.0.0']],
      ['pip', 'requests==2.32.0', 'python-test', ['-m', 'pip', 'install', '--', 'requests==2.32.0'], { pythonExecutable: 'python-test' }],
      ['cargo', 'serde@1.0.0', 'cargo', ['add', 'serde@1.0.0']],
      ['go', 'github.com/google/uuid@v1.6.0', 'go', ['get', 'github.com/google/uuid@v1.6.0']],
      ['dotnet', 'Newtonsoft.Json@13.0.1', 'dotnet', ['add', 'package', 'Newtonsoft.Json', '--version', '13.0.1']],
      ['composer', 'symfony/console:^7.0', 'composer', ['require', '--', 'symfony/console:^7.0']],
      ['gem', 'rails@7.1.0', 'bundle', ['add', 'rails', '--version', '7.1.0']],
      ['dart', 'http:^1.2.0', 'dart', ['pub', 'add', 'http:^1.2.0']],
      ['maven', 'org.slf4j:slf4j-api:2.0.16', 'mvn', ['dependency:get', '-Dartifact=org.slf4j:slf4j-api:2.0.16']],
      ['conan', 'fmt/11.0.2', 'conan', ['install', '--requires=fmt/11.0.2', '--build=missing']],
    ];

    for (const [manager, spec, executable, args, options] of examples) {
      const plan = createPackageInstallPlan(manager, spec, options);
      assert.equal(plan.executable, executable);
      assert.deepEqual(plan.args, args);
      assert.equal(plan.manager, manager);
      if (manager === 'maven') assert.match(plan.note, /Maven cache/);
      if (manager === 'conan') assert.match(plan.note, /toolchain/);
      if (manager === 'gem') assert.match(plan.note, /Gemfile\.lock/);
    }
    assert.equal(listPackageAdapters().length, examples.length);
  });

  it('rejects command injection, registry URLs, and unsupported managers', () => {
    for (const [manager, spec] of [
      ['npm', 'safe; whoami'],
      ['pip', 'https://example.invalid/package.whl'],
      ['cargo', '--help'],
      ['go', '-mod=vendor'],
      ['dotnet', '../unsafe'],
      ['composer', 'vendor/package --help'],
      ['gem', 'gem;whoami'],
      ['dart', '../unsafe'],
      ['maven', 'org.example:artifact -Dexec=whoami'],
      ['conan', '--help'],
      ['npm', 'safe\n'],
    ]) {
      assert.throws(() => createPackageInstallPlan(manager, spec), /Invalid|cannot contain/);
    }
    assert.throws(() => createPackageInstallPlan('unknown', 'name'), /Unsupported package manager/);
  });

  it('passes each package plan to the native launcher and propagates exit status', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-native-launch-'));
    const plans = [
      ['npm', 'zod@3.24.0'],
      ['pip', 'requests==2.32.0', { pythonExecutable: 'python-test' }],
      ['cargo', 'serde@1.0.0'],
      ['go', 'github.com/google/uuid@v1.6.0'],
      ['dotnet', 'Newtonsoft.Json@13.0.1'],
      ['composer', 'symfony/console:^7.0'],
      ['gem', 'rails@7.1.0'],
      ['dart', 'http:^1.2.0'],
      ['maven', 'org.slf4j:slf4j-api:2.0.16'],
      ['conan', 'fmt/11.0.2'],
    ];

    try {
      for (const [manager, spec, options] of plans) {
        const plan = createPackageInstallPlan(manager, spec, { ...options, directory });
        let calls = 0;
        const code = await runPackageInstall(plan, {
          directory,
          spawnCommand(receivedPlan, cwd) {
            calls++;
            assert.equal(receivedPlan, plan);
            assert.equal(cwd, directory);
            const child = new EventEmitter();
            queueMicrotask(() => child.emit('close', 0));
            return child;
          },
        });
        assert.equal(calls, 1, `${manager} should be launched exactly once`);
        assert.equal(code, 0, `${manager} successful status should pass through`);
      }

      const failingPlan = createPackageInstallPlan('cargo', 'serde@1.0.0');
      assert.equal(await runPackageInstall(failingPlan, {
        spawnCommand() {
          const child = new EventEmitter();
          queueMicrotask(() => child.emit('close', 7));
          return child;
        },
      }), 7);
      await assert.rejects(runPackageInstall(failingPlan, {
        spawnCommand() {
          const child = new EventEmitter();
          queueMicrotask(() => child.emit('error', new Error('manager unavailable')));
          return child;
        },
      }), /manager unavailable/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('launches Windows script-based managers through a safely quoted command wrapper', {
    skip: process.platform !== 'win32',
  }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide manager wrapper-'));
    try {
      const script = join(directory, 'fake-manager.cmd');
      writeFileSync(script, '@echo off\r\necho READY\r\necho %*\r\n');
      const child = spawnNativeTool({
        manager: 'bundle',
        executable: script,
        args: ['exec', 'rake test', 'left|right'],
      }, directory, { platform: 'win32' });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      assert.equal(code, 0, stderr);
      assert.match(stdout, /READY/);
      assert.match(stdout, /"rake test"/);
      assert.match(stdout, /"left\|right"/);
      assert.throws(() => spawnNativeTool({
        manager: 'bundle',
        executable: 'bundle',
        args: ['add', 'bad%PATH%'],
      }, directory, { platform: 'win32' }), /do not accept quotes, percent signs, or line breaks/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects Composer test scripts from composer.json', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-composer-tests-'));
    try {
      writeFileSync(join(directory, 'composer.json'), JSON.stringify({
        scripts: { test: 'phpunit' },
      }));
      assert.deepEqual(getProjectTestPlans(directory), [{
        manager: 'composer',
        executable: 'composer',
        args: ['test'],
        label: 'composer test',
      }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps pip installation bound to an active or project virtual environment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-python-env-'));
    const interpreter = join(directory, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
    try {
      mkdirSync(join(directory, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin'), { recursive: true });
      writeFileSync(interpreter, '');
      const plan = createPackageInstallPlan('pip', 'requests==2.32.0', { directory });
      assert.equal(plan.executable, interpreter);
      assert.deepEqual(plan.args, ['-m', 'pip', 'install', '--', 'requests==2.32.0']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records native dependencies and persists pip specs in requirements.txt', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-package-metadata-'));
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'native-demo' }));
      const npmPlan = createPackageInstallPlan('npm', '@types/node@20.0.0', { directory });
      recordPackageDependency(directory, npmPlan);
      let metadata = JSON.parse(readFileSync(join(directory, 'naide.pkg.json'), 'utf8'));
      assert.equal(metadata.name, 'native-demo');
      assert.equal(metadata.dependencies['@types/node'], '@types/node@20.0.0');

      writeFileSync(join(directory, 'requirements.txt'), 'requests>=2.0\n');
      const pipPlan = createPackageInstallPlan('pip', 'Requests==2.32.0', {
        directory,
        pythonExecutable: 'python-test',
      });
      recordPackageDependency(directory, pipPlan);
      metadata = JSON.parse(readFileSync(join(directory, 'naide.pkg.json'), 'utf8'));
      assert.equal(metadata.languageDependencies.pip.Requests, 'Requests==2.32.0');
      assert.equal(readFileSync(join(directory, 'requirements.txt'), 'utf8'), 'Requests==2.32.0\n');
      assert.deepEqual(readdirSync(directory).filter(name => /\.naide-[\da-f-]+\.(?:tmp|bak)$/.test(name)), []);

      const cargoPlan = createPackageInstallPlan('cargo', 'serde@1.0.0', { directory });
      recordPackageDependency(directory, cargoPlan);
      metadata = JSON.parse(readFileSync(join(directory, 'naide.pkg.json'), 'utf8'));
      assert.equal(metadata.languageDependencies.cargo.serde, 'serde@1.0.0');

      writeFileSync(join(directory, 'naide.pkg.json'), JSON.stringify({ name: 'minimal-metadata' }));
      recordPackageDependency(directory, cargoPlan);
      metadata = JSON.parse(readFileSync(join(directory, 'naide.pkg.json'), 'utf8'));
      assert.equal(metadata.languageDependencies.cargo.serde, 'serde@1.0.0');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails clearly rather than overwriting invalid NAIDE package metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-invalid-package-metadata-'));
    try {
      writeFileSync(join(directory, 'naide.pkg.json'), '{');
      const plan = createPackageInstallPlan('cargo', 'serde@1.0.0', { directory });
      assert.throws(() => recordPackageDependency(directory, plan), /naide\.pkg\.json is not valid JSON/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports project manifests, NAIDE files, lockfile gaps, and invalid package JSON', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-project-tools-'));
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: 'demo',
        dependencies: { express: '^4.0.0' },
        scripts: { test: 'node --test' },
      }));
      writeFileSync(join(directory, 'app.naide'), 'log "hello"\n');
      writeFileSync(join(directory, 'SPEC.naide'), 'syntax examples are not a project source file\n');
      mkdirSync(join(directory, 'src'), { recursive: true });
      mkdirSync(join(directory, 'node_modules', 'ignored-package'), { recursive: true });
      writeFileSync(join(directory, 'src', 'nested.naide'), 'int count = 1\n');
      writeFileSync(join(directory, 'node_modules', 'ignored-package', 'ignored.naide'), 'int count = "bad"\n');
      let report = inspectProject(directory);
      assert.equal(report.ok, true);
      assert.deepEqual(report.manifests, ['Node.js / npm']);
      assert.deepEqual(report.naideFiles, ['app.naide', 'src/nested.naide']);
      assert.ok(report.warnings.some(warning => warning.includes('lockfile')));
      assert.ok(report.checks.some(check => check.includes('test script')));
      assert.ok(report.checks.some(check => check.includes('app.naide compiles and passes type checks')));
      assert.ok(report.checks.some(check => check.includes('src/nested.naide compiles and passes type checks')));
      assert.ok(report.checks.some(check => check.includes('SPEC.naide language reference excluded')));

      writeFileSync(join(directory, 'package.json'), '{');
      report = inspectProject(directory);
      assert.equal(report.ok, false);
      assert.ok(report.errors.some(error => error.includes('not valid JSON')));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports malformed npm dependency and script sections', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-invalid-manifest-'));
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: 'invalid-manifest',
        dependencies: ['express'],
        scripts: { test: 42 },
      }));

      const report = inspectProject(directory);
      assert.equal(report.ok, false);
      assert.ok(report.errors.some(error => error.includes('"dependencies" must be an object')));
      assert.ok(report.errors.some(error => error.includes('"scripts.test" must be a non-empty command string')));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('type-checks NAIDE files and does not execute them during verify', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-verify-source-'));
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'verify-source' }));
      writeFileSync(join(directory, 'app.naide'), 'log "verify must not execute this"\nint count = 1\n');

      const validResult = spawnSync(process.execPath, [cliPath, 'verify', directory, '--json'], {
        encoding: 'utf8',
      });
      assert.equal(validResult.status, 0, validResult.stderr);
      const validReport = JSON.parse(validResult.stdout);
      assert.equal(validReport.ok, true);
      assert.ok(validReport.checks.some(check => check.includes('app.naide compiles and passes type checks')));
      assert.doesNotMatch(validResult.stdout, /verify must not execute this/);

      writeFileSync(join(directory, 'app.naide'), 'int count = "wrong"\n');
      const invalidResult = spawnSync(process.execPath, [cliPath, 'verify', directory, '--json'], {
        encoding: 'utf8',
      });
      assert.equal(invalidResult.status, 1);
      const invalidReport = JSON.parse(invalidResult.stdout);
      assert.equal(invalidReport.ok, false);
      assert.ok(invalidReport.errors.some(error => error.includes('app.naide:1 Type mismatch')));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('runs a configured npm test script through its native package manager', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-test-runner-'));
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: 'naide-test-runner-fixture',
        type: 'module',
        scripts: { test: 'node smoke.test.js' },
      }));
      writeFileSync(join(directory, 'smoke.test.js'), 'import assert from "node:assert/strict";\nassert.equal(2 + 2, 4);\nconsole.log("fixture tests passed");\n');

      const report = await runProjectTests(directory, { timeoutMs: 30_000 });
      assert.equal(report.plans.length, 1);
      assert.equal(report.plans[0].label, 'npm test');
      assert.equal(report.ok, true, report.outcomes[0]?.stderr || report.outcomes[0]?.error);
      assert.match(report.outcomes[0].stdout + report.outcomes[0].stderr, /fixture tests passed/);

      const cliResult = spawnSync(process.execPath, [cliPath, 'test', directory], { encoding: 'utf8' });
      assert.equal(cliResult.status, 0, cliResult.stdout + cliResult.stderr);
      assert.match(cliResult.stdout, /PASS npm test/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
