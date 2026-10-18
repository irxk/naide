import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, compileAsync } from '../src/index.js';
import { compile as compileBrowser, compileAsync as compileBrowserAsync } from '../docs/src/index.js';

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

const examples = [
  'int count = 42\nstr label = "same output"',
  'schema User extends Entity:\n  email str required\nschema Entity:\n  id auto\n  name str required',
  'bool enabled = true\nnum ratio = 1.5\nlog enabled ratio',
  'fn add(int left, int right) -> int:\n  ret left + right\nint total = add(2, 3)',
  'if 2 > 1:\n  log "yes"\nelif 1 > 2:\n  log "no"\nelse:\n  log "fallback"',
  'each item in [1, 2, 3]:\n  log item',
  'str greeting = "こんにちは"',
  'server app port 3000:\n  get "/health":\n    ret {ok: true}',
];

describe('CLI and browser compiler parity', () => {
  it('keeps the browser type checker synchronized with the CLI implementation', () => {
    const cliChecker = readFileSync(new URL('../src/typechecker.js', import.meta.url), 'utf8');
    const browserChecker = readFileSync(new URL('../docs/src/typechecker.js', import.meta.url), 'utf8');
    assert.equal(browserChecker, cliChecker);
  });

  for (const target of targets) {
    for (const [exampleIndex, source] of examples.entries()) {
      it(`keeps ${target} output aligned for example ${exampleIndex + 1}`, async () => {
        const [cli, browser] = await Promise.all([
          compileAsync(source, { target }),
          compileBrowserAsync(source, { target }),
        ]);

        assert.equal(browser.code, cli.code);
      });
    }
  }

  it('returns matching type diagnostics for CLI and browser compilers', () => {
    const source = 'fn greet(str name) -> str:\n  ret name\nlog greet(42)';
    const cli = compile(source, { typeCheck: true });
    const browser = compileBrowser(source, { typeCheck: true });
    assert.deepEqual(browser.typeErrors, cli.typeErrors);
  });
});
