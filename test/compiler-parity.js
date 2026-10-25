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
  it('keeps browser compiler frontend and type checker synchronized with the CLI', () => {
    for (const file of ['tokens.js', 'lexer.js', 'parser.js', 'typechecker.js']) {
      const cliSource = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      const browserSource = readFileSync(new URL(`../docs/src/${file}`, import.meta.url), 'utf8');
      assert.equal(browserSource, cliSource, `${file} should match between CLI and browser`);
    }
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
    const sources = [
      'fn greet(str name) -> str:\n  ret name\nlog greet(42)',
      [
        'fn render(str value) -> str:',
        '  ret value',
        'schema Widget:',
        '  value str',
        '  fn render(int value) -> int:',
        '    ret value',
        'fn renderLabel() -> str:',
        '  ret render("widget")',
        '',
      ].join('\n'),
    ];
    for (const source of sources) {
      const cli = compile(source, { typeCheck: true });
      const browser = compileBrowser(source, { typeCheck: true });
      assert.deepEqual(browser.typeErrors, cli.typeErrors);
    }
  });

  it('keeps new JavaScript interop syntax aligned in the browser compiler', () => {
    const source = [
      'any optional = maybe?.["value"]',
      'any called = callback?.("value")',
      'any loaded = import("./plugin.naide")',
      'mut num total = 2',
      'total *= 3',
      'total ??= 1',
      'bool strict = total === 6',
      'bool logical = true && false || true',
      '',
    ].join('\n');
    const cli = compile(source, { typeCheck: true });
    const browser = compileBrowser(source, { typeCheck: true });
    assert.equal(browser.js, cli.js);
    assert.deepEqual(browser.typeErrors, cli.typeErrors);
  });

  it('keeps expanded JavaScript syntax and runtime output aligned in the browser compiler', () => {
    const source = [
      'int hex = 0x2a',
      'bigint exact = 123_456n',
      'str message = `value=${hex}`',
      'bool matches = /value=\\d+/i.test(message)',
      'int power = 2 ** 3 ** 2',
      'mut int total = 0',
      'for item of [1, 2, 3]:',
      '  total += item',
      'mut int keys = 0',
      'for key in {a: 1, b: 2}:',
      '  keys++',
      'mut int runs = 0',
      'do:',
      '  runs++',
      'while runs < 2',
      'fn.gen values():',
      '  yield* [4, 5]',
      '',
    ].join('\n');
    const cli = compile(source, { typeCheck: true });
    const browser = compileBrowser(source, { typeCheck: true });
    assert.equal(browser.js, cli.js);
    assert.deepEqual(browser.typeErrors, cli.typeErrors);
  });

  it('keeps for-await loop output aligned in the browser compiler', () => {
    const source = [
      'fn.async collect(stream):',
      '  mut list values = []',
      '  for await value of stream:',
      '    values.push(value)',
      '  ret values',
      '',
    ].join('\n');
    const cli = compile(source, { typeCheck: true });
    const browser = compileBrowser(source, { typeCheck: true });
    assert.equal(browser.js, cli.js);
    assert.deepEqual(browser.typeErrors, cli.typeErrors);
    assert.match(cli.js, /for await \(const value of stream\)/);
  });

  it('rejects JavaScript-only syntax on non-JavaScript targets instead of emitting broken code', async () => {
    const source = 'fn.gen values():\n  yield 1';
    await assert.rejects(
      compileAsync(source, { target: 'python' }),
      /generator functions and yield.*supported only for JavaScript-generating targets/,
    );
    await assert.rejects(
      compileBrowserAsync(source, { target: 'python' }),
      /generator functions and yield.*supported only for JavaScript-generating targets/,
    );
    await assert.rejects(
      compileAsync('bigint value = Number("1")', { target: 'python' }),
      /BigInt declarations and annotations.*supported only for JavaScript-generating targets/,
    );
    await assert.rejects(
      compileBrowserAsync('bigint value = Number("1")', { target: 'python' }),
      /BigInt declarations and annotations.*supported only for JavaScript-generating targets/,
    );
  });
});
