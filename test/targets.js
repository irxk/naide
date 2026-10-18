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
});
