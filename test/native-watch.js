import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url));

test('native watch restarts changed server source and stops its child process', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-watch-'));
  const sourcePath = join(directory, 'app.naide');
  const source = version => [
    'server app port 0:',
    '  get "/version":',
    `    ret {version: "${version}"}`,
    '',
  ].join('\n');
  writeFileSync(sourcePath, source('one'));

  const watcher = spawn(process.execPath, [cliPath, '--watch', sourcePath], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  watcher.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  watcher.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });

  const waitFor = async (predicate, description) => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (predicate(output)) return;
      if (watcher.exitCode !== null) throw new Error(`Native watch exited early:\n${output}`);
      await delay(25);
    }
    throw new Error(`Timed out waiting for ${description}:\n${output}`);
  };

  try {
    const listeningPorts = text => [...text.matchAll(/Server running at http:\/\/127\.0\.0\.1:(\d+)/g)]
      .map(match => Number(match[1]));
    await waitFor(text => listeningPorts(text).length >= 1, 'the initial server');
    const firstPort = listeningPorts(output)[0];
    const firstResponse = await fetch(`http://127.0.0.1:${firstPort}/version`);
    assert.deepEqual(await firstResponse.json(), { version: 'one' });

    writeFileSync(sourcePath, source('two'));
    await waitFor(text => listeningPorts(text).length >= 2, 'the restarted server');
    const restartedPort = listeningPorts(output)[1];
    const restartedResponse = await fetch(`http://127.0.0.1:${restartedPort}/version`);
    assert.deepEqual(await restartedResponse.json(), { version: 'two' });

    const watcherExited = new Promise(resolve => watcher.once('exit', resolve));
    watcher.send('close');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Native watch did not stop:\n${output}`)), 8_000);
      watcherExited.then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await assert.rejects(fetch(`http://127.0.0.1:${restartedPort}/version`));
  } finally {
    if (watcher.exitCode === null) {
      if (watcher.connected) watcher.send('close');
      await Promise.race([
        new Promise(resolve => watcher.once('exit', resolve)),
        delay(3_000).then(() => null),
      ]);
      if (watcher.exitCode === null) watcher.kill();
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
