import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '../src/index.js';
import { runNativeFileAsync } from '../src/native-engine.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function startServer(directory, port, secret) {
  const child = spawn(process.execPath, [join(directory, 'app.mjs')], {
    cwd: directory,
    env: { ...process.env, JWT_SECRET: secret, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  return { child, get output() { return output; } };
}

async function waitForHealth(server, baseUrl) {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.child.exitCode !== null) throw new Error(`Starter server exited early:\n${server.output}`);
    try {
      health = await fetch(`${baseUrl}/api/health`);
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(health, `Starter server did not become ready:\n${server.output}`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  const closed = new Promise(resolve => server.child.once('close', resolve));
  if (server.child.connected) server.child.send('close');
  await Promise.race([closed, delay(3_000)]);
  if (server.child.exitCode === null) {
    server.child.kill();
    await Promise.race([closed, delay(3_000)]);
  }
}

test('generated API starter runs auth, validation, and user-scoped CRUD over HTTP', async () => {
  const directory = mkdtempSync(join(root, '.naide_tmp_api-e2e-'));
  const port = await reservePort();
  const secret = 'naide-integration-test-secret-at-least-32-bytes';
  let server;

  try {
    const init = await new Promise((resolve, reject) => {
      const result = spawn(process.execPath, [cliPath, 'init', directory], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      test('generated API starter runs directly through the native interpreter', async () => {
        const directory = mkdtempSync(join(root, '.naide_tmp_native-api-'));
        const secret = 'naide-native-integration-secret-at-least-32-bytes';
        let app;
        try {
          const init = await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [cliPath, 'init', directory], {
              cwd: root,
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stderr = '';
            child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
            child.once('error', reject);
            child.once('exit', code => resolve({ code, stderr }));
          });
          assert.equal(init.code, 0, init.stderr);

          const result = await runNativeFileAsync(join(directory, 'app.naide'), {
            runtime: { env: { PORT: '0', JWT_SECRET: secret } },
            output: { log() {}, error() {}, warn() {}, info() {} },
          });
          app = result.globals.get('app');
          const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

          const health = await fetch(`${baseUrl}/api/health`);
          assert.equal(health.status, 200);
          assert.deepEqual(await health.json(), { status: 'ok' });

          const registration = await fetch(`${baseUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: 'Native User',
              email: `native-${Date.now()}@example.com`,
              password: 'correct-horse-battery-staple',
            }),
          });
          assert.equal(registration.status, 201);
          const account = await registration.json();
          assert.ok(account.token);
          assert.equal(account.user.password, undefined);

          const headers = {
            authorization: `Bearer ${account.token}`,
            'content-type': 'application/json',
          };
          const created = await fetch(`${baseUrl}/api/items`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: 'Direct item' }),
          });
          assert.equal(created.status, 201);
          const item = await created.json();

          const listed = await fetch(`${baseUrl}/api/items`, { headers });
          assert.equal(listed.status, 200);
          assert.deepEqual((await listed.json()).data.map(value => value.id), [item.id]);
        } finally {
          await app?.close();
          rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      });
      let stdout = '';
      let stderr = '';
      result.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      result.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      result.once('error', reject);
      result.once('exit', code => resolve({ code, stdout, stderr }));
    });
    assert.equal(init.code, 0, init.stderr);

    const appSource = readFileSync(join(directory, 'app.naide'), 'utf8');
    const compiled = compile(appSource, {
      runtimePath: pathToFileURL(join(root, 'src', 'runtime.js')).href,
      sourceFile: join(directory, 'app.naide'),
      typeCheck: true,
    });
    assert.deepEqual(compiled.typeErrors.errors, []);
    const listenCall = 'app.listen(PORT, () => {';
    assert.ok(compiled.js.includes(listenCall), 'generated starter should create its HTTP listener');
    const testServerCode = compiled.js.replace(listenCall, `const __naideServer = ${listenCall}`)
      + '\nprocess.on("message", message => { if (message === "close") __naideServer.close(() => process.exit(0)); });\n';
    writeFileSync(join(directory, 'app.mjs'), testServerCode);

    server = startServer(directory, port, secret);

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(server, baseUrl);

    const unauthenticated = await fetch(`${baseUrl}/api/items`);
    assert.equal(unauthenticated.status, 401, `${await unauthenticated.text()}\n${server.output}`);

    const invalidRegistration = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Invalid', email: 'invalid@example.com', password: 'short' }),
    });
    assert.equal(invalidRegistration.status, 400);

    const register = async (name, email) => {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password: 'correct-horse-battery-staple' }),
      });
      const responseBody = await response.text();
      assert.equal(response.status, 201, responseBody);
      const account = JSON.parse(responseBody);
      assert.ok(account.token);
      assert.equal(account.user.password, undefined);
      return account;
    };

    const user = await register('Primary User', `primary-${Date.now()}@example.com`);
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.user.email, password: 'correct-horse-battery-staple' }),
    });
    assert.equal(login.status, 200);
    assert.ok((await login.json()).token);

    const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.user.email, password: 'incorrect-password' }),
    });
    assert.equal(invalidLogin.status, 401);

    const authHeaders = { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' };
    const invalidItem = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: '' }),
    });
    assert.equal(invalidItem.status, 400);

    const created = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Private item' }),
    });
    assert.equal(created.status, 201);
    const item = await created.json();

    const userItems = await fetch(`${baseUrl}/api/items`, { headers: authHeaders });
    assert.equal(userItems.status, 200);
    assert.equal((await userItems.json()).data[0].id, item.id);

    const otherUser = await register('Other User', `other-${Date.now()}@example.com`);
    const otherItems = await fetch(`${baseUrl}/api/items`, {
      headers: { Authorization: `Bearer ${otherUser.token}` },
    });
    assert.deepEqual((await otherItems.json()).data, []);

    const hiddenItem = await fetch(`${baseUrl}/api/items/${item.id}`, {
      headers: { Authorization: `Bearer ${otherUser.token}` },
    });
    assert.equal(hiddenItem.status, 404);

    const updated = await fetch(`${baseUrl}/api/items/${item.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ done: true }),
    });
    const updatedBody = await updated.text();
    assert.equal(updated.status, 200, updatedBody);
    assert.equal(JSON.parse(updatedBody).done, true);

    for (let attempt = 0; attempt < 5; attempt++) {
      const rejectedLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.user.email, password: 'incorrect-password' }),
      });
      assert.equal(rejectedLogin.status, 401);
    }
    const rateLimitedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.user.email, password: 'incorrect-password' }),
    });
    assert.equal(rateLimitedLogin.status, 429);

    await stopServer(server);
    server = startServer(directory, port, secret);
    await waitForHealth(server, baseUrl);
    const restoredItems = await fetch(`${baseUrl}/api/items`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    assert.equal(restoredItems.status, 200);
    const restoredItem = (await restoredItems.json()).data.find(value => value.id === item.id);
    assert.equal(restoredItem.done, true, 'file-backed item updates should survive a server restart');

    const deleted = await fetch(`${baseUrl}/api/items/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${user.token}` },
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).deleted, true);

    assert.ok(existsSync(join(directory, 'data', 'User.json')));
    assert.ok(existsSync(join(directory, 'data', 'Item.json')));
  } finally {
    await stopServer(server);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
