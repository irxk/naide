import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));

describe('non-compiler security protections', () => {
  it('rejects shell metacharacters in package specs before starting npm', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-package-injection-'));
    const marker = join(directory, 'injected.txt');
    const injection = process.platform === 'win32'
      ? `safe & echo NAIDE_INJECTED > "${marker}"`
      : `safe; touch "${marker}"`;

    try {
      const result = spawnSync(process.execPath, [cliPath, 'pkg', 'install', injection], {
        cwd: directory,
        encoding: 'utf8',
      });

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /expected a package name/);
      assert.equal(existsSync(marker), false, 'untrusted package input must never reach a shell');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('passes valid scoped package specs as literal npm arguments', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-package-args-'));
    const npmCli = join(directory, 'npm-cli.mjs');
    const capturedArgs = join(directory, 'npm-args.json');
    const packageSpec = '@naide-test/example@1.2.3';

    try {
      const captureScript = [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(capturedArgs)}, JSON.stringify(process.argv.slice(2)));`,
      ].join('\n');
      writeFileSync(npmCli, captureScript);

      const result = spawnSync(process.execPath, [cliPath, 'pkg', 'install', packageSpec], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, npm_execpath: npmCli },
      });

      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(capturedArgs, 'utf8')), ['install', '--', packageSpec]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records native npm dependencies after installation succeeds', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-package-add-'));
    const npmCli = join(directory, 'npm-cli.mjs');
    const capturedArgs = join(directory, 'npm-args.json');
    const packageSpec = '@naide-test/example@1.2.3';

    try {
      writeFileSync(npmCli, [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(capturedArgs)}, JSON.stringify(process.argv.slice(2)));`,
      ].join('\n'));

      const result = spawnSync(process.execPath, [cliPath, 'pkg', 'add', 'npm', packageSpec], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, npm_execpath: npmCli },
      });

      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(capturedArgs, 'utf8')), ['install', '--', packageSpec]);
      const metadata = JSON.parse(readFileSync(join(directory, 'naide.pkg.json'), 'utf8'));
      assert.equal(metadata.dependencies['@naide-test/example'], packageSpec);
      assert.match(result.stdout, /Recorded dependency in naide\.pkg\.json/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('protects sample API routes with bearer authentication and removes the public WebSocket echo', () => {
    const source = readFileSync(new URL('../message-app/app.naide', import.meta.url), 'utf8');
    const generated = compile(source).js;
    const admin = readFileSync(new URL('../message-app/admin.html', import.meta.url), 'utf8');
    const openapi = JSON.parse(readFileSync(new URL('../message-app/openapi.json', import.meta.url), 'utf8'));

    assert.match(source, /auth JWT_SECRET:/);
    assert.match(source, /protect "\/api\/\*"/);
    assert.match(source, /crud "\/api\/messages" Message/);
    assert.match(generated, /jwtAuth\(JWT_SECRET/);
    assert.doesNotMatch(source, /^\s*ws\s+/m);
    assert.doesNotMatch(generated, /WebSocketServer/);
    assert.doesNotMatch(admin, /\.innerHTML\s*=/);
    assert.match(admin, /Authorization/);
    assert.ok(openapi.security?.[0]?.BearerAuth, 'protected API documentation should require bearer authentication');
    assert.deepEqual(openapi.paths['/api/health'].get.security, [], 'health endpoint should remain public');
  });
});
