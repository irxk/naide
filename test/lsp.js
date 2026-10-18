import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../lsp/server.js', import.meta.url));

function frame(message) {
  const content = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${content.length}\r\n\r\n`, 'ascii'),
    content,
  ]);
}

function parseFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n', offset, 'ascii');
    assert.notEqual(headerEnd, -1, 'response should contain a complete LSP header');
    const header = buffer.toString('ascii', offset, headerEnd);
    const length = Number(header.match(/Content-Length: (\d+)/i)?.[1]);
    assert.ok(Number.isInteger(length), 'response should include Content-Length');
    const start = headerEnd + 4;
    const end = start + length;
    assert.ok(end <= buffer.length, 'response should contain a complete LSP body');
    messages.push(JSON.parse(buffer.toString('utf8', start, end)));
    offset = end;
  }
  return messages;
}

describe('NAIDE language server', () => {
  it('frames Unicode documents by UTF-8 byte length and shares type diagnostics', () => {
    const uri = 'file:///workspace/日本語.naide';
    const input = Buffer.concat([
      frame({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri,
            languageId: 'naide',
            version: 1,
            text: 'str message = "こんにちは"\nfn greet(str name) -> str:\n  ret name\ngreet(42)',
          },
        },
      }),
      frame({ jsonrpc: '2.0', id: 1, method: 'shutdown' }),
    ]);
    const result = spawnSync(process.execPath, [serverPath], { input, encoding: 'buffer' });

    assert.equal(result.status, 0, result.stderr.toString('utf8'));
    const diagnostics = parseFrames(result.stdout)
      .find(message => message.method === 'textDocument/publishDiagnostics');
    assert.ok(diagnostics, 'server should publish diagnostics before handling the next request');
    assert.equal(diagnostics.params.uri, uri);
    assert.ok(
      diagnostics.params.diagnostics.some(
        diagnostic => diagnostic.message.includes("Argument 'name' of 'greet' expects str but got int"),
      ),
      'LSP should report the same call type error as `naide check`',
    );
  });

  it('rejects oversized frames instead of retaining unbounded input', () => {
    const result = spawnSync(
      process.execPath,
      [serverPath],
      { input: 'Content-Length: 33554433\r\n\r\n', encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /rejected an oversized or invalid message body/);
  });

  it('returns Invalid Request for a null message and continues serving', () => {
    const invalidMessage = Buffer.from('Content-Length: 4\r\n\r\nnull', 'utf8');
    const input = Buffer.concat([
      invalidMessage,
      frame({ jsonrpc: '2.0', id: 7, method: 'shutdown' }),
    ]);
    const result = spawnSync(process.execPath, [serverPath], { input, encoding: 'buffer' });

    assert.equal(result.status, 0, result.stderr.toString('utf8'));
    const messages = parseFrames(result.stdout);
    assert.deepEqual(messages[0], {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    });
    assert.deepEqual(messages[1], { jsonrpc: '2.0', id: 7, result: null });
  });

  it('resolves identifiers across open files without matching comments or strings', () => {
    const definitionUri = 'file:///workspace/definitions.naide';
    const usageUri = 'file:///workspace/usage.naide';
    const open = (uri, text) => ({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: { textDocument: { uri, languageId: 'naide', version: 1, text } },
    });
    const input = Buffer.concat([
      frame(open(definitionUri, 'fn count() -> int:\n  ret 1')),
      frame(open(usageUri, 'log count()\nlog "count"\n# count')),
      frame({
        jsonrpc: '2.0',
        id: 1,
        method: 'textDocument/definition',
        params: { textDocument: { uri: usageUri }, position: { line: 0, character: 6 } },
      }),
      frame({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/references',
        params: { textDocument: { uri: usageUri }, position: { line: 0, character: 6 } },
      }),
      frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
    ]);
    const result = spawnSync(process.execPath, [serverPath], { input, encoding: 'buffer' });

    assert.equal(result.status, 0, result.stderr.toString('utf8'));
    const messages = parseFrames(result.stdout);
    const definition = messages.find(message => message.id === 1);
    const references = messages.find(message => message.id === 2);
    assert.equal(definition.result.uri, definitionUri);
    assert.deepEqual(definition.result.range.start, { line: 0, character: 3 });
    assert.equal(references.result.length, 2, 'only the declaration and code reference should be returned');
    assert.deepEqual(
      references.result.map(location => location.uri).sort(),
      [definitionUri, usageUri].sort(),
    );
  });

  it('provides prefix-filtered project completions and document symbols', () => {
    const uri = 'file:///workspace/completions.naide';
    const input = Buffer.concat([
      frame({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri,
            languageId: 'naide',
            version: 1,
            text: 'fn countItems() -> int:\n  ret 1\nlog cou',
          },
        },
      }),
      frame({
        jsonrpc: '2.0',
        id: 1,
        method: 'textDocument/completion',
        params: { textDocument: { uri }, position: { line: 2, character: 7 } },
      }),
      frame({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/documentSymbol',
        params: { textDocument: { uri } },
      }),
      frame({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
    ]);
    const result = spawnSync(process.execPath, [serverPath], { input, encoding: 'buffer' });

    assert.equal(result.status, 0, result.stderr.toString('utf8'));
    const messages = parseFrames(result.stdout);
    const completions = messages.find(message => message.id === 1).result;
    const symbols = messages.find(message => message.id === 2).result;
    assert.ok(completions.some(item => item.label === 'countItems'));
    assert.ok(completions.every(item => item.label.startsWith('cou')));
    assert.deepEqual(symbols.map(symbol => symbol.name), ['countItems']);
  });

  it('refreshes diagnostics after full-document edits and clears them on close', () => {
    const uri = 'file:///workspace/edit-loop.naide';
    const input = Buffer.concat([
      frame({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri,
            languageId: 'naide',
            version: 1,
            text: 'int count = "wrong"\n',
          },
        },
      }),
      frame({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text: 'int count = 1\n' }],
        },
      }),
      frame({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: { textDocument: { uri } },
      }),
      frame({ jsonrpc: '2.0', id: 1, method: 'shutdown' }),
    ]);
    const result = spawnSync(process.execPath, [serverPath], { input, encoding: 'buffer' });

    assert.equal(result.status, 0, result.stderr.toString('utf8'));
    const diagnostics = parseFrames(result.stdout)
      .filter(message => message.method === 'textDocument/publishDiagnostics');
    assert.equal(diagnostics.length, 3);
    assert.ok(diagnostics[0].params.diagnostics.some(item => item.message.includes('Type mismatch')));
    assert.deepEqual(diagnostics[1].params.diagnostics, []);
    assert.deepEqual(diagnostics[2].params.diagnostics, []);
  });
});
