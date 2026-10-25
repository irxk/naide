import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));

describe('new project onboarding', () => {
  it('scaffolds a project with compatible dependencies and a compilable starter app', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-onboarding-'));

    try {
      const init = spawnSync(process.execPath, [cliPath, 'init', directory], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(init.status, 0, init.stderr);

      const project = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      assert.equal(project.dependencies.naider, `^${packageJson.version}`);
      assert.ok(project.dependencies.express, 'the generated server imports Express');
      assert.equal(project.scripts.start, 'node -r dotenv/config --enable-source-maps --import naider/register app.naide');
      assert.equal(project.scripts.dev, 'node -r dotenv/config --watch --enable-source-maps --import naider/register app.naide');
      assert.equal(project.scripts.check, 'naide check app.naide');
      assert.equal(project.scripts.test, 'node --test');
      assert.ok(existsSync(join(directory, 'dist')), 'the generated build script needs its output directory');
      assert.ok(existsSync(join(directory, 'test', 'api.test.js')), 'the starter should include an API smoke test');
      assert.match(readFileSync(join(directory, '.env'), 'utf8'), /^JWT_SECRET=[a-f0-9]{64}\n$/);
      assert.match(readFileSync(join(directory, '.gitignore'), 'utf8'), /^\.env$/m);

      const appSource = readFileSync(join(directory, 'app.naide'), 'utf8');
      const starterTestCheck = spawnSync(process.execPath, ['--check', join(directory, 'test', 'api.test.js')], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(starterTestCheck.status, 0, starterTestCheck.stdout + starterTestCheck.stderr);
      assert.match(appSource, /cors \["http:\/\/localhost:3000", "http:\/\/localhost:5173"\]/);
      assert.doesNotMatch(appSource, /cors "\*"/);
      assert.match(appSource, /auth JWT_SECRET:[\s\S]*protect "\/api\/\*"/);
      assert.match(appSource, /limit "\/api\/auth\/\*" 10 "1m"/);
      assert.match(appSource, /password str required min\(12\) max\(256\)/);
      assert.match(appSource, /password.length > 128/);
      assert.match(appSource, /public "\/api\/health"/);

      const check = spawnSync(process.execPath, [cliPath, 'check', join(directory, 'app.naide')], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(check.status, 0, check.stdout + check.stderr);
      assert.match(check.stdout, /0 error\(s\), 0 warning\(s\)/);

      const invalidSource = join(directory, 'invalid.naide');
      writeFileSync(invalidSource, 'int count = "wrong"\n');
      const invalidCheck = spawnSync(process.execPath, [cliPath, 'check', invalidSource], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(invalidCheck.status, 1);
      assert.match(invalidCheck.stdout, /Type mismatch: cannot assign str to int/);

      const emit = spawnSync(process.execPath, [cliPath, '--emit', join(directory, 'app.naide')], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(emit.status, 0, emit.stdout + emit.stderr);
      assert.match(emit.stdout, /from 'express'/);

      const buildPath = join(directory, 'dist', 'app.mjs');
      const build = spawnSync(process.execPath, [cliPath, '--emit', join(directory, 'app.naide'), '-o', buildPath], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(build.status, 0, build.stdout + build.stderr);
      assert.ok(existsSync(buildPath), 'the generated build script output path should be writable');

      const repl = spawnSync(process.execPath, [cliPath], {
        cwd: root,
        input: '.exit\n',
        encoding: 'utf8',
      });
      assert.equal(repl.status, 0, repl.stderr);
      assert.match(repl.stdout, new RegExp(`NAIDE REPL v${packageJson.version.replaceAll('.', '\\.')}`));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds starter tooling to existing package.json without replacing user scripts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-existing-project-'));

    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: 'existing-app',
        scripts: { dev: 'vite --host' },
        dependencies: { vite: '^6.0.0' },
      }));

      const init = spawnSync(process.execPath, [cliPath, 'init', directory], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(init.status, 0, init.stderr);

      const project = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      assert.equal(project.scripts.dev, 'vite --host');
      assert.equal(project.scripts.check, 'naide check app.naide');
      assert.equal(project.dependencies.vite, '^6.0.0');
      assert.equal(project.dependencies.naider, `^${packageJson.version}`);
      assert.equal(project.dependencies.dotenv, '^16.4.7');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
