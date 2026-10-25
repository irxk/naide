import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createNativeServices, NATIVE_ADAPTER_DEPENDENCIES } from '../src/native-adapters.js';
import { getReleaseStatus } from '../src/release-status.js';
import { runNativeAsync } from '../src/native-engine.js';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('native OAuth adapters enforce provider, state, PKCE, origin, and one-time callback checks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-oauth-adapter-'));
  const calls = [];
  const services = createNativeServices(directory, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === 'https://oauth2.googleapis.com/token') {
        return jsonResponse({ access_token: 'access-token', token_type: 'Bearer' });
      }
      return jsonResponse({ sub: 'user-1', email: 'user@example.test' });
    },
  });

  try {
    const { globals } = await runNativeAsync([
      'oauth "google" "client-id" "client-secret":',
      '  callback "/auth/callback"',
      '  scope "openid email"',
      'map authorization = oauth.begin({origin: "https://app.example.test"})',
      '',
    ].join('\n'), {
      nativeServices: services,
    });
    const oauth = globals.get('oauth');
    const authorization = globals.get('authorization');
    const authorizationUrl = new URL(authorization.url);
    assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
    assert.equal(authorizationUrl.searchParams.get('redirect_uri'), 'https://app.example.test/auth/callback');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorizationUrl.searchParams.get('state'), authorization.state);

    const result = await oauth.exchange({
      code: 'authorization-code',
      state: authorization.state,
      origin: 'https://app.example.test',
    });
    assert.deepEqual(result.profile, { sub: 'user-1', email: 'user@example.test' });
    assert.match(calls[0].options.body.toString(), /client_secret=client-secret/);
    assert.equal(calls[1].options.headers.authorization, 'Bearer access-token');
    await assert.rejects(
      oauth.exchange({ code: 'authorization-code', state: authorization.state }),
      /invalid, expired, or has already been used/,
    );

    const next = oauth.begin({ origin: 'https://app.example.test' });
    await assert.rejects(
      oauth.exchange({ code: 'authorization-code', state: next.state, origin: 'https://attacker.example.test' }),
      /origin does not match/,
    );
    await assert.rejects(
      Promise.resolve().then(() => services.oauth({
        provider: 'unknown',
        clientId: 'id',
        clientSecret: 'secret',
      })),
      /does not support provider/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native Stripe adapter builds checkout requests and verifies signed webhooks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-stripe-adapter-'));
  const calls = [];
  const services = createNativeServices(directory, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ id: 'cs_test_1', url: 'https://checkout.stripe.test/session' });
    },
  });
  const payments = services.payments({
    provider: 'stripe',
    secretKey: 'sk_test_secret',
    webhookSecret: 'whsec_test_secret',
    successUrl: 'https://app.example.test/success',
    cancelUrl: 'https://app.example.test/cancel',
  });

  try {
    const session = await payments.createCheckoutSession({
      items: [{ name: 'NAIDE license', unitAmount: 1200, currency: 'USD', quantity: 2 }],
    });
    assert.equal(session.id, 'cs_test_1');
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(calls[0].options.headers.authorization, 'Bearer sk_test_secret');
    const form = new URLSearchParams(calls[0].options.body);
    assert.equal(form.get('line_items[0][price_data][unit_amount]'), '1200');
    assert.equal(form.get('line_items[0][quantity]'), '2');
    assert.equal(form.get('success_url'), 'https://app.example.test/success');

    const rawBody = JSON.stringify({ id: 'evt_test_1', type: 'checkout.session.completed' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', 'whsec_test_secret')
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    assert.deepEqual(
      payments.verifyWebhook(rawBody, `t=${timestamp},v1=${signature}`),
      { id: 'evt_test_1', type: 'checkout.session.completed' },
    );
    assert.throws(
      () => payments.verifyWebhook(rawBody, `t=${timestamp},v1=${'0'.repeat(64)}`),
      /signature is invalid/,
    );
    await assert.rejects(
      payments.createCheckoutSession({ items: [] }),
      /non-empty items array/,
    );
    const { globals } = await runNativeAsync([
      'pay "stripe" "sk_test_secret":',
      '  webhook_secret "whsec_test_secret"',
      '',
    ].join('\n'), { nativeServices: services });
    assert.deepEqual(
      globals.get('pay').verifyWebhook(rawBody, `t=${timestamp},v1=${signature}`),
      { id: 'evt_test_1', type: 'checkout.session.completed' },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native image adapter applies supported operations and rejects escaped watermark files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-image-adapter-'));
  const calls = [];
  const processor = {
    resize: (...args) => { calls.push(['resize', ...args]); return processor; },
    rotate: (...args) => { calls.push(['rotate', ...args]); return processor; },
    grayscale: () => { calls.push(['grayscale']); return processor; },
    flip: () => { calls.push(['flip']); return processor; },
    toFormat: (...args) => { calls.push(['format', ...args]); return processor; },
    toFile: async path => { calls.push(['toFile', path]); return { format: 'png' }; },
  };
  const services = createNativeServices(directory, {
    loadPackage: async name => {
      assert.equal(name, 'sharp');
      return { default: input => { calls.push(['input', input]); return processor; } };
    },
  });

  try {
    await services.image({
      input: join(directory, 'input.png'),
      output: join(directory, 'output.webp'),
      projectDirectory: directory,
      operations: [
        { op: 'resize', args: [320, 240] },
        { op: 'rotate', args: [90] },
        { op: 'grayscale', args: [] },
        { op: 'flip', args: [] },
        { op: 'format', args: ['webp'] },
      ],
    });
    assert.deepEqual(calls.map(([name]) => name), ['input', 'resize', 'rotate', 'grayscale', 'flip', 'format', 'toFile']);
    await assert.rejects(
      services.image({
        input: join(directory, 'input.png'),
        output: join(directory, 'output.png'),
        projectDirectory: directory,
        operations: [{ op: 'watermark', args: ['../outside.png'] }],
      }),
      /escapes the project directory/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native PDF adapter awaits file completion and fails on unsupported elements', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-pdf-adapter-'));
  class FakeDocument extends EventEmitter {
    pipe(output) { this.output = output; return output; }
    fontSize() { return this; }
    text(value) { this.output.write(`${value}\n`); return this; }
    moveDown() { return this; }
    addPage() { return this; }
    end() { this.output.end(); }
    destroy(error) { this.output.destroy(error); }
  }
  const services = createNativeServices(directory, {
    loadPackage: async name => {
      assert.equal(name, 'pdfkit');
      return { default: FakeDocument };
    },
  });
  const filename = join(directory, 'report.pdf');

  try {
    await services.pdf({
      filename,
      elements: [
        { tag: 'title', args: ['Quarterly report'] },
        { tag: 'text', args: ['Verified output'] },
      ],
    });
    assert.match(readFileSync(filename, 'utf8'), /Quarterly report[\s\S]*Verified output/);
    await assert.rejects(
      services.pdf({
        filename: join(directory, 'invalid.pdf'),
        elements: [{ tag: 'unknown', args: [] }],
      }),
      /does not support element 'unknown'/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native WebSocket adapter dispatches JSON messages and closes the host server', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-ws-adapter-'));
  let connection;
  let server;
  class FakeConnection extends EventEmitter {
    readyState = 1;
    send(value) { this.sent = value; }
    close(code, reason) {
      this.readyState = 3;
      this.emit('close', code, Buffer.from(reason));
    }
    terminate() { this.readyState = 3; }
  }
  class FakeWebSocketServer extends EventEmitter {
    clients = new Set();
    handleUpgrade(_request, _socket, _head, callback) {
      connection = new FakeConnection();
      this.clients.add(connection);
      callback(connection);
    }
    close(callback) { callback(); }
  }
  const services = createNativeServices(directory, {
    loadPackage: async name => {
      assert.equal(name, 'ws');
      return {
        WebSocket: { OPEN: 1 },
        WebSocketServer: class extends FakeWebSocketServer {
          constructor(options) {
            super();
            assert.deepEqual(options, { noServer: true, maxPayload: 1_048_576, perMessageDeflate: false });
            server = this;
          }
        },
      };
    },
  });

  try {
    const messages = [];
    const adapter = await services.websocket({
      events: {
        message: (payload, client) => {
          messages.push(payload);
          client.send({ accepted: true });
        },
      },
    });
    adapter.handler({}, {}, Buffer.alloc(0));
    connection.emit('message', Buffer.from('{"kind":"hello"}'), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(messages, [{ kind: 'hello' }]);
    assert.equal(connection.sent, '{"accepted":true}');
    await adapter.close();
    assert.ok(server);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native GraphQL adapter exposes generated schema fields and native model stores over HTTP', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-graphql-adapter-'));
  const schemaSources = [];
  const services = createNativeServices(directory, {
    loadPackage: async name => {
      assert.equal(name, 'graphql');
      return {
        buildSchema: source => {
          schemaSources.push(source);
          return { source };
        },
        graphql: async ({ rootValue, source }) => ({
          data: { widgets: source.includes('widgets') ? rootValue.widgets() : [] },
        }),
      };
    },
  });
  const { globals } = await runNativeAsync([
    'schema Widget:',
    '  id auto',
    '  name str required',
    'server app port 0:',
    '  graphql "/graphql"',
    'WidgetStore.create({name: "first"})',
    '',
  ].join('\n'), { nativeServices: services });
  const app = globals.get('app');

  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ widgets { id name } }' }),
    });
    const responseBody = await response.json();
    assert.equal(responseBody.data.widgets.length, 1);
    assert.equal(responseBody.data.widgets[0].name, 'first');
    assert.equal(typeof responseBody.data.widgets[0].id, 'string');
    assert.match(schemaSources[0], /type Widget/);
    assert.match(schemaSources[0], /widgets: \[Widget\]/);
    const invalid = await fetch(`http://127.0.0.1:${app.server.address().port}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: [] }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('adapter installation metadata lists only optional integrations with concrete implementations', () => {
  assert.deepEqual(NATIVE_ADAPTER_DEPENDENCIES, {
    image: ['sharp'],
    pdf: ['pdfkit'],
    graphql: ['graphql'],
    websocket: ['ws'],
  });
});

test('release status reports the verified support boundaries and pending release gate', () => {
  const status = getReleaseStatus();
  assert.equal(status.targetCount, 15);
  assert.deepEqual(status.verifiedOptionalAdapters, ['image', 'pdf', 'graphql', 'websocket']);
  assert.deepEqual(status.explicitUnsupported.c, ['crud', 'auth', 'websocket']);
  assert.match(status.recommendation, /hosted CI/i);

  const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));
  const result = spawnSync(process.execPath, [cliPath, 'status'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Local evidence: 98\/100/);
  assert.match(result.stdout, /Verified optional adapters: image, pdf, graphql, websocket/);
});

test('native adapter CLI installs only the requested project dependency', () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-adapter-install-'));
  const fakeNpm = join(directory, 'npm-cli.mjs');
  const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));
  writeFileSync(fakeNpm, [
    'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    'import { resolve, dirname } from "node:path";',
    'const cwd = process.cwd();',
    'const manifestPath = resolve(cwd, "package.json");',
    'const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { name: "adapter-test" };',
    'manifest.dependencies ||= {};',
    'manifest.dependencies.sharp = "1.0.0";',
    'writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\\n");',
    'const packageDirectory = resolve(cwd, "node_modules/sharp");',
    'mkdirSync(packageDirectory, { recursive: true });',
    'writeFileSync(resolve(packageDirectory, "package.json"), JSON.stringify({name:"sharp",version:"1.0.0",main:"index.js"}));',
    'writeFileSync(resolve(packageDirectory, "index.js"), "module.exports = function sharp() {};\\n");',
    '',
  ].join('\n'));

  try {
    const result = spawnSync(process.execPath, [cliPath, 'adapter', 'install', 'image'], {
      cwd: directory,
      env: { ...process.env, npm_execpath: fakeNpm },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Installed the image adapter dependencies: sharp/);
    assert.equal(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).dependencies.sharp, '1.0.0');
    assert.ok(existsSync(join(directory, 'node_modules', 'sharp', 'index.js')));

    const builtIn = spawnSync(process.execPath, [cliPath, 'adapter', 'install', 'oauth'], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(builtIn.status, 0, builtIn.stdout + builtIn.stderr);
    assert.match(builtIn.stdout, /built into NAIDE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native Stripe webhooks verify the exact raw bytes received by an HTTP route', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-stripe-webhook-'));
  const webhookSecret = 'whsec_native_server_test';
  const { globals } = await runNativeAsync([
    'pay "stripe" "sk_test_secret":',
    '  webhook_secret "whsec_native_server_test"',
    'server app port 0:',
    '  post "/webhook":',
    '    res.json(pay.verifyWebhook(req.rawBody, req.headers["stripe-signature"]))',
    '',
  ].join('\n'), {
    nativeServices: createNativeServices(directory),
  });
  const app = globals.get('app');
  try {
    const rawBody = '{"id":"evt_native","type":"checkout.session.completed"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    const signedResponse = await fetch(`http://127.0.0.1:${app.server.address().port}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${signature}`,
      },
      body: rawBody,
    });
    assert.equal(signedResponse.status, 200);
    assert.deepEqual(await signedResponse.json(), { id: 'evt_native', type: 'checkout.session.completed' });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
