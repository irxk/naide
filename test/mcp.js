import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../mcp/server.js', import.meta.url));
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const protocolVersion = '2026-07-28';

function messageLine(message, { includeMetadata = true } = {}) {
  if (includeMetadata && message && message.id !== undefined && typeof message.method === 'string') {
    const params = message.params && typeof message.params === 'object' ? message.params : {};
    message = {
      ...message,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': protocolVersion,
          'io.modelcontextprotocol/clientInfo': { name: 'naide-test', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
          ...params._meta,
        },
      },
    };
  }
  return Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
}

function parseMessages(buffer) {
  return buffer.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
}

describe('NAIDE MCP server', () => {
  it('uses modern stateless MCP metadata and offers project tools, prompts, and resources', () => {
    const input = Buffer.concat([
      messageLine({ jsonrpc: '2.0', id: 1, method: 'server/discover' }),
      messageLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      messageLine({ jsonrpc: '2.0', id: 3, method: 'prompts/list' }),
      messageLine({ jsonrpc: '2.0', id: 11, method: 'prompts/get', params: { name: 'mws_discord_ja' } }),
      messageLine({ jsonrpc: '2.0', id: 12, method: 'resources/read', params: { uri: 'naide://ai-guide' } }),
      messageLine({ jsonrpc: '2.0', id: 16, method: 'prompts/get', params: { name: 'naide_coding_ja' } }),
      messageLine({ jsonrpc: '2.0', id: 17, method: 'prompts/get', params: { name: 'naide_first' } }),
      messageLine({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'naide://spec' } }),
      messageLine({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'naide_package_managers', arguments: {} } }),
      messageLine({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'naide_check',
          arguments: { code: 'log "CHECK_MUST_NOT_EXECUTE"\nint count = 1\n', sourceFile: 'app.naide' },
        },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'naide_check', arguments: { code: 'int count = "wrong"\n' } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'naide_run', arguments: { code: 'log uuid()\n' } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'naide_generate', arguments: { instruction: 'REST API for users with auth' } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'naide_mws_discord_template',
          arguments: { libraries: { '@discordjs/voice': '^0.19.0' } },
        },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'naide_hosted_manifest',
          arguments: { entry: 'src/app.naide', libraries: { express: '^5.0.0' } },
        },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: { name: 'naide_hosted_manifest', arguments: { entry: '../outside.naide' } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: { name: 'naide_context', arguments: { topic: 'Discord' } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 18,
        method: 'tools/call',
        params: { name: 'naide_search', arguments: { query: 'MCP_PROTOCOL_VERSION', limit: 3 } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 19,
        method: 'tools/call',
        params: { name: 'naide_search', arguments: { query: '   ' } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: { name: 'naide_spec', arguments: { section: 'server' } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: { name: 'naide_spec', arguments: { section: 'missing-section' } },
      }),
      messageLine({
        jsonrpc: '2.0',
        id: 22,
        method: 'resources/read',
        params: { uri: 'naide://knowledge' },
      }),
      messageLine({ jsonrpc: '2.0', id: 23, method: 'resources/list' }),
      messageLine({ jsonrpc: '2.0', id: 24, method: 'tools/call' }),
    ]);
    const result = spawnSync(process.execPath, [serverPath], { input, encoding: 'buffer' });

    assert.equal(result.status, 0, result.stderr.toString('utf8'));
    const messages = parseMessages(result.stdout);
    const discovery = messages.find(message => message.id === 1);
    const tools = messages.find(message => message.id === 2).result.tools;
    const prompts = messages.find(message => message.id === 3).result.prompts;
    const mwsPrompt = messages.find(message => message.id === 11).result;
    const spec = messages.find(message => message.id === 4).result.contents[0].text;
    const aiGuide = JSON.parse(messages.find(message => message.id === 12).result.contents[0].text);
    const codingPrompt = messages.find(message => message.id === 16).result.messages[0].content.text;
    const naideFirstPrompt = messages.find(message => message.id === 17).result.messages[0].content.text;
    const packageInfo = messages.find(message => message.id === 5).result.content[0].text;
    const validCheck = messages.find(message => message.id === 6).result;
    const invalidCheck = messages.find(message => message.id === 7).result;
    const runtimeResponse = messages.find(message => message.id === 8);
    assert.ok(runtimeResponse, JSON.stringify(messages));
    assert.ok(runtimeResponse.result, `${JSON.stringify(runtimeResponse)}; stderr: ${result.stderr.toString('utf8')}`);
    const runtimeResult = runtimeResponse.result;

    assert.equal(discovery.result.resultType, 'complete');
    assert.deepEqual(discovery.result.supportedVersions, [protocolVersion]);
    assert.ok(discovery.result.capabilities.tools);
    assert.ok(discovery.result.capabilities.prompts);
    assert.ok(discovery.result.capabilities.resources);
    assert.match(discovery.result.instructions, /Never create authored \.js.*unless the user explicitly approves JavaScript/i);
    assert.match(discovery.result.instructions, /ask whether the user wants to approve a minimal JS\/TS bridge/i);
    assert.match(discovery.result.instructions, /do not create a competing package\.json or package-lock\.json/i);
    assert.match(discovery.result.instructions, /all application behavior in \.naide/i);
    assert.equal(discovery.result._meta['io.modelcontextprotocol/serverInfo'].name, 'naide-mcp');
    assert.equal(discovery.result._meta['io.modelcontextprotocol/serverInfo'].version, packageVersion);
    assert.equal(messages.find(message => message.id === 2).result.resultType, 'complete');
    assert.equal(messages.find(message => message.id === 3).result.resultType, 'complete');
    assert.ok(tools.some(tool => tool.name === 'naide_doctor'));
    assert.ok(tools.some(tool => tool.name === 'naide_verify'));
    assert.ok(tools.some(tool => tool.name === 'naide_test'));
    assert.ok(tools.some(tool => tool.name === 'naide_mws_discord_template'));
    assert.ok(tools.some(tool => tool.name === 'naide_hosted_manifest'));
    assert.ok(tools.some(tool => tool.name === 'naide_context'));
    assert.ok(tools.some(tool => tool.name === 'naide_search'));
    assert.ok(tools.every(tool => tool.title && tool.annotations));
    assert.equal(tools.find(tool => tool.name === 'naide_search').annotations.readOnlyHint, true);
    assert.equal(tools.find(tool => tool.name === 'naide_run').annotations.destructiveHint, true);
    assert.ok(prompts.some(prompt => prompt.name === 'polyglot_dependency'));
    assert.ok(prompts.some(prompt => prompt.name === 'verify_changes_ja'));
    assert.ok(prompts.some(prompt => prompt.name === 'naide_coding_ja'));
    assert.ok(prompts.some(prompt => prompt.name === 'naide_first'));
    assert.match(codingPrompt, /アプリケーションの動作はすべて\.naide/);
    assert.match(codingPrompt, /ユーザーの明示許可がない限り/);
    assert.match(codingPrompt, /NAIDEで表現できない機能があれば.*ユーザーに確認/);
    assert.match(codingPrompt, /naide init <dir> --template web.*naide dev <dir>/);
    assert.match(codingPrompt, /package\.json\/package-lock\.json/);
    assert.match(naideFirstPrompt, /Never create authored \.js/);
    assert.ok(aiGuide.strengths.some(strength => strength.includes('Node.js')));
    assert.ok(aiGuide.specIndex.includes('Discord Bot'));
    assert.ok(aiGuide.syntax.some(rule => rule.includes('native dynamic import')));
    assert.ok(aiGuide.syntax.some(rule => rule.includes('fn.gen/fn.async.gen')));
    assert.ok(aiGuide.hostedNode.main.includes('naide-host.js'));
    assert.ok(aiGuide.capabilityBoundaries.some(boundary => boundary.includes('static HTML')));
    assert.ok(aiGuide.capabilityBoundaries.some(boundary => boundary.includes('naide dev')));
    assert.ok(aiGuide.capabilityBoundaries.some(boundary => boundary.includes('--bundle-browser')));
    assert.ok(aiGuide.capabilityBoundaries.some(boundary => boundary.includes('native-machine-code JIT')));
    assert.ok(aiGuide.capabilityBoundaries.some(boundary => boundary.includes('nine-workload')));
    assert.ok(aiGuide.capabilityBoundaries.some(boundary => boundary.includes('not a parser for raw JavaScript')));
    assert.ok(aiGuide.capabilityBoundaries.some(boundary => /ask the user/i.test(boundary)));
    assert.ok(aiGuide.projectConventions.some(rule => rule.includes('competing package.json')));
    assert.ok(aiGuide.projectConventions.some(rule => rule.includes('unless the user explicitly approves JavaScript')));
    assert.ok(aiGuide.knowledgeSources.searchableFileCount > 0);
    assert.ok(aiGuide.efficientWorkflow.some(rule => rule.includes('naide_search')));
    assert.match(spec, /人間とAI/);
    assert.match(packageInfo, /process, HTTP, FFI/);
    assert.equal(JSON.parse(validCheck.content[0].text).ok, true);
    assert.doesNotMatch(validCheck.content[0].text, /CHECK_MUST_NOT_EXECUTE/);
    assert.equal(invalidCheck.isError, true);
    assert.match(invalidCheck.content[0].text, /Type mismatch: cannot assign str to int/);
    assert.equal(runtimeResult.isError, undefined);
    assert.match(runtimeResult.content[0].text, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/i);
    const generated = messages.find(message => message.id === 9).result;
    assert.equal(generated.isError, undefined);
    assert.ok(generated.content[0].text.length > 0);
    assert.ok(prompts.some(prompt => prompt.name === 'mws_discord_ja'));
    assert.match(mwsPrompt.messages[0].content.text, /2ファイル/);
    assert.match(mwsPrompt.messages[0].content.text, /main/);
    const mwsTemplate = JSON.parse(messages.find(message => message.id === 10).result.content[0].text);
    assert.deepEqual(mwsTemplate.files.map(file => file.path), [
      'discord-bot.naide',
      'nidpackage.json',
    ]);
    assert.equal(JSON.parse(mwsTemplate.files[1].content).dependencies['@discordjs/voice'], '^0.19.0');
    assert.equal(JSON.parse(mwsTemplate.files[1].content).main, 'node_modules/naider/bin/naide-host.js');
    assert.equal(JSON.parse(mwsTemplate.files[1].content).naide.entry, 'discord-bot.naide');
    assert.match(mwsTemplate.limitation, /installing dependencies/);
    const hostedManifest = JSON.parse(messages.find(message => message.id === 13).result.content[0].text);
    assert.equal(hostedManifest.file.path, 'nidpackage.json');
    assert.equal(JSON.parse(hostedManifest.file.content).naide.entry, 'src/app.naide');
    assert.equal(JSON.parse(hostedManifest.file.content).dependencies.express, '^5.0.0');
    const invalidManifest = messages.find(message => message.id === 14).result;
    assert.equal(invalidManifest.isError, true);
    assert.match(invalidManifest.content[0].text, /relative \.naide/);
    const topicContext = JSON.parse(messages.find(message => message.id === 15).result.content[0].text);
    assert.ok(topicContext.requestedSpecSections.some(section => section.title === 'Discord Bot'));
    const search = JSON.parse(messages.find(message => message.id === 18).result.content[0].text);
    assert.ok(search.results.some(result => result.file === 'mcp/server.js'));
    assert.equal(messages.find(message => message.id === 19).result.isError, true);
    assert.match(messages.find(message => message.id === 20).result.content[0].text, /サーバー定義/);
    assert.equal(messages.find(message => message.id === 21).result.isError, true);
    const knowledge = JSON.parse(messages.find(message => message.id === 22).result.contents[0].text);
    assert.ok(knowledge.searchableFileCount > 0);
    assert.ok(knowledge.sources.some(source => source.path === 'src/'));
    assert.ok(knowledge.sources.some(source => source.path === 'benchmark/'));
    assert.ok(messages.find(message => message.id === 23).result.resources.some(resource => resource.uri === 'naide://knowledge'));
    assert.equal(messages.find(message => message.id === 24).error.code, -32602);
  });

  it('requires modern per-request metadata and rejects legacy protocol handshakes', () => {
    const input = Buffer.concat([
      messageLine({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } },
      }),
      messageLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { includeMetadata: false }),
      messageLine({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2024-11-05' } }),
    ]);
    const result = spawnSync(process.execPath, [serverPath], { input, encoding: 'buffer' });

    assert.equal(result.status, 0, result.stderr.toString('utf8'));
    const messages = parseMessages(result.stdout);
    assert.equal(messages[0].error.code, -32022);
    assert.deepEqual(messages[0].error.data, {
      supported: [protocolVersion],
      requested: '2025-11-25',
    });
    assert.equal(messages[1].error.code, -32602);
    assert.match(messages[1].error.message, /_meta/);
    assert.equal(messages[2].error.code, -32601);
    assert.match(messages[2].error.message, /initialize/);
  });

  it('does not answer JSON-RPC notifications', () => {
    const result = spawnSync(process.execPath, [serverPath], {
      input: messageLine({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 1 },
      }),
      encoding: 'buffer',
    });

    assert.equal(result.status, 0, result.stderr.toString('utf8'));
    assert.equal(result.stdout.toString('utf8'), '');
  });

  it('rejects oversized messages', () => {
    const result = spawnSync(
      process.execPath,
      [serverPath],
      { input: `${'x'.repeat(32 * 1024 * 1024 + 1)}\n`, encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rejected oversized message/);
  });

  it('returns a JSON-RPC error for non-object messages', () => {
    const result = spawnSync(process.execPath, [serverPath], {
      input: messageLine(null),
      encoding: 'buffer',
    });
    assert.equal(result.status, 0);
    assert.deepEqual(parseMessages(result.stdout)[0].error.code, -32600);
  });
});
