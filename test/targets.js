import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileAsync } from '../src/index.js';

const targets = [
  'node',
  'python',
  'bun',
  'typescript',
  'go',
  'java',
  'rust',
  'cpp',
  'c',
  'csharp',
  'kotlin',
  'swift',
  'dart',
  'php',
  'ruby',
];

describe('cross-target code generation smoke tests', () => {
  for (const target of targets) {
    it(`generates non-empty ${target} output containing the source sentinel`, async () => {
      const result = await compileAsync(
        'str naideTargetSmoke = "NAIDE_TARGET_SMOKE_SENTINEL"',
        { target },
      );

      assert.equal(result.target, target);
      assert.ok(result.code.trim().length > 0, `${target} output should not be empty`);
      assert.ok(
        result.code.includes('NAIDE_TARGET_SMOKE_SENTINEL'),
        `${target} output should retain the source sentinel`,
      );
    });
  }

  it('preserves declared Swift function return types', async () => {
    const result = await compileAsync(
      'fn answer() -> int:\n  ret 42',
      { target: 'swift' },
    );

    assert.match(result.code, /func answer\(\) -> Int/);
  });

  it('preserves C# function names and declared return types', async () => {
    const result = await compileAsync(
      'fn answer() -> int:\n  ret 42\nlog answer()',
      { target: 'csharp' },
    );

    assert.match(result.code, /static int answer\(\)/);
    assert.match(result.code, /answer\(\)/);
  });

  for (const target of ['c', 'rust']) {
    for (const [feature, declaration] of [
      ['CRUD', 'crud "/users" User'],
      ['authentication', 'auth "a-secret-that-is-long-enough-for-tests"'],
      ['WebSocket', 'ws "/socket":\n    on "message":\n      log "received"'],
    ]) {
      it(`${target} rejects unimplemented ${feature} generation instead of emitting TODOs`, async () => {
        const source = [
          'schema User:',
          '  id auto',
          '',
          'server app port 3000:',
          ...declaration.split('\n').map(line => `  ${line}`),
          '',
        ].join('\n');
        await assert.rejects(
          compileAsync(source, { target }),
          new RegExp(`${target === 'c' ? 'C' : 'Rust'} target does not support`),
        );
      });
    }
  }
});
