import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileAsync } from '../src/index.js';

const runtimeCases = [
  { target: 'node', command: 'node', extension: '.mjs' },
  { target: 'python', command: 'python', extension: '.py' },
  { target: 'bun', command: 'bun', extension: '.js' },
  {
    target: 'go',
    command: 'go',
    extension: '.go',
    versionArgs: ['version'],
    runArgs: (sourcePath) => ['run', sourcePath],
  },
  {
    target: 'c',
    command: 'gcc',
    extension: '.c',
    compileArgs: (sourcePath, executablePath) => ['-std=c11', sourcePath, '-o', executablePath],
  },
  {
    target: 'cpp',
    command: 'g++',
    extension: '.cpp',
    compileArgs: (sourcePath, executablePath) => ['-std=c++17', sourcePath, '-o', executablePath],
  },
];

function runtimeAvailable(command) {
  const runtime = runtimeCases.find(entry => entry.command === command);
  const result = spawnSync(command, runtime?.versionArgs || ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

describe('runtime-verified compiler targets', () => {
  for (const runtime of runtimeCases) {
    const available = runtimeAvailable(runtime.command);

    it(`runs generated ${runtime.target} code`, {
      skip: !available && process.env.CI !== 'true',
    }, async () => {
      assert.ok(available, `${runtime.command} must be installed in CI`);
      const { code } = await compileAsync(
        'int naideRuntimeSmoke = 42\nlog naideRuntimeSmoke',
        { target: runtime.target },
      );
      const directory = mkdtempSync(join(tmpdir(), 'naide-runtime-smoke-'));
      const sourcePath = join(directory, `smoke${runtime.extension}`);
      const executablePath = join(directory, process.platform === 'win32' ? 'smoke.exe' : 'smoke');

      try {
        writeFileSync(sourcePath, code);
        let command = runtime.command;
        let args = runtime.runArgs ? runtime.runArgs(sourcePath) : [sourcePath];

        if (runtime.compileArgs) {
          const build = spawnSync(command, runtime.compileArgs(sourcePath, executablePath), {
            encoding: 'utf8',
            timeout: 60_000,
          });
          assert.ifError(build.error);
          assert.equal(build.status, 0, build.stderr);

          if (runtime.target !== 'go') {
            command = executablePath;
            args = [];
          }
        }

        const result = spawnSync(command, args, {
          encoding: 'utf8',
          timeout: 30_000,
        });

        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), '42');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
