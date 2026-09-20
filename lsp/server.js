import { compile } from '../src/index.js';

const documents = new Map();
let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const lengthMatch = header.match(/Content-Length: (\d+)/);
    if (!lengthMatch) { buffer = buffer.slice(headerEnd + 4); continue; }
    const contentLength = parseInt(lengthMatch[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + contentLength) break;
    const content = buffer.slice(start, start + contentLength);
    buffer = buffer.slice(start + contentLength);
    try { handleMessage(JSON.parse(content)); } catch {}
  }
});

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function respond(id, result) { send({ jsonrpc: '2.0', id, result }); }
function notify(method, params) { send({ jsonrpc: '2.0', method, params }); }

function handleMessage(msg) {
  switch (msg.method) {
    case 'initialize':
      respond(msg.id, {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { triggerCharacters: ['.', '"'] },
          hoverProvider: true,
        }
      });
      break;

    case 'initialized': break;

    case 'textDocument/didOpen':
      documents.set(msg.params.textDocument.uri, msg.params.textDocument.text);
      validateDocument(msg.params.textDocument.uri);
      break;

    case 'textDocument/didChange':
      if (msg.params.contentChanges.length > 0) {
        documents.set(msg.params.textDocument.uri, msg.params.contentChanges[msg.params.contentChanges.length - 1].text);
        validateDocument(msg.params.textDocument.uri);
      }
      break;

    case 'textDocument/didClose':
      documents.delete(msg.params.textDocument.uri);
      notify('textDocument/publishDiagnostics', { uri: msg.params.textDocument.uri, diagnostics: [] });
      break;

    case 'textDocument/completion':
      respond(msg.id, getCompletions(msg.params));
      break;

    case 'textDocument/hover':
      respond(msg.id, getHover(msg.params));
      break;

    case 'shutdown':
      respond(msg.id, null);
      break;

    case 'exit':
      process.exit(0);
      break;

    default:
      if (msg.id !== undefined) respond(msg.id, null);
  }
}

function validateDocument(uri) {
  const text = documents.get(uri);
  if (!text) return;

  const mode = uri.endsWith('.nx') ? 'x' : 'naide';
  const diagnostics = [];

  try {
    const result = compile(text, { mode });

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('--')) continue;

      const typeMatch = line.match(/^(str|int|num|bool)\s+\w+\s*=\s*(.+)/);
      if (typeMatch) {
        const declType = typeMatch[1];
        const val = typeMatch[2].trim();
        if (declType === 'int' && /^["']/.test(val)) {
          diagnostics.push({
            range: { start: { line: i, character: 0 }, end: { line: i, character: lines[i].length } },
            severity: 2, source: 'naide',
            message: `Type hint: assigning string to int variable`
          });
        } else if (declType === 'str' && /^\d+$/.test(val)) {
          diagnostics.push({
            range: { start: { line: i, character: 0 }, end: { line: i, character: lines[i].length } },
            severity: 2, source: 'naide',
            message: `Type hint: assigning number to str variable`
          });
        } else if (declType === 'bool' && !['true', 'false'].includes(val) && !/\b(not|and|or|==|!=|>|<)\b/.test(val)) {
          diagnostics.push({
            range: { start: { line: i, character: 0 }, end: { line: i, character: lines[i].length } },
            severity: 2, source: 'naide',
            message: `Type hint: value may not be boolean`
          });
        }
      }
    }
  } catch (e) {
    const lineMatch = e.message.match(/line (\d+):(\d+)/);
    const line = lineMatch ? parseInt(lineMatch[1]) - 1 : 0;
    const col = lineMatch ? parseInt(lineMatch[2]) - 1 : 0;
    diagnostics.push({
      range: { start: { line, character: col }, end: { line, character: col + 20 } },
      severity: 1,
      source: 'naide',
      message: e.message.split('\n')[0].replace(/^\[NAIDE .*?\] /, '')
    });
  }

  notify('textDocument/publishDiagnostics', { uri, diagnostics });
}

function getCompletions() {
  const keywords = [
    'fn', 'ret', 'if', 'elif', 'else', 'each', 'for', 'while', 'match',
    'try', 'fail', 'ensure', 'server', 'model', 'schema', 'use', 'pub', 'mut',
    'log', 'typeof', 'instanceof', 'not', 'and', 'or', 'break', 'continue',
    'throw', 'new', 'await', 'test', 'assert', 'queue', 'job', 'db', 'env',
    'get', 'post', 'put', 'del', 'patch',
  ];
  const types = ['str', 'int', 'num', 'bool', 'list', 'map', 'any', 'json', 'void'];
  const features = [
    'cors', 'auth', 'crud', 'limit', 'cookie', 'session', 'static', 'ws', 'sse',
    'cache', 'view', 'upload', 'group', 'validate', 'openapi', 'error', 'mid', 'prompt',
  ];
  const builtins = [
    { label: 'uuid()', detail: 'Generate UUID v4', insertText: 'uuid()' },
    { label: 'hash(password)', detail: 'Hash password (scrypt)', insertText: 'hash(' },
    { label: 'verify(password, hash)', detail: 'Verify password', insertText: 'verify(' },
    { label: 'ai.ask(prompt)', detail: 'AI text generation', insertText: 'ai.ask(' },
    { label: 'ai.json(prompt, schema)', detail: 'AI structured JSON', insertText: 'ai.json(' },
    { label: 'ai.chat(messages)', detail: 'AI multi-turn chat', insertText: 'ai.chat(' },
    { label: 'ai.stream(prompt)', detail: 'AI streaming response', insertText: 'ai.stream(' },
    { label: 'ai.embed(text)', detail: 'AI text embeddings', insertText: 'ai.embed(' },
    { label: 'ai.similarity(a, b)', detail: 'Cosine similarity', insertText: 'ai.similarity(' },
    { label: 'api.get(url)', detail: 'HTTP GET', insertText: 'api.get(' },
    { label: 'api.post(url, body)', detail: 'HTTP POST', insertText: 'api.post(' },
    { label: 'prompt', detail: 'Reusable prompt template', insertText: 'prompt ' },
    { label: 'createMock(fn)', detail: 'Create mock function', insertText: 'createMock(' },
    { label: 'createSpy(obj, method)', detail: 'Spy on method', insertText: 'createSpy(' },
    { label: 'registerPlugin(name, setup)', detail: 'Register plugin', insertText: 'registerPlugin(' },
    { label: 'usePlugin(name)', detail: 'Use registered plugin', insertText: 'usePlugin(' },
  ];

  return [
    ...keywords.map(k => ({ label: k, kind: 14 })),
    ...types.map(t => ({ label: t, kind: 25 })),
    ...features.map(f => ({ label: f, kind: 14 })),
    ...builtins.map(b => ({ label: b.label, kind: 3, detail: b.detail, insertText: b.insertText })),
  ];
}

const HOVER_DOCS = {
  'fn': '**fn** — Define a function\n```naide\nfn name(params) -> type:\n  body\n```',
  'ret': '**ret** — Return / send response\n```naide\nret value\nret.html "<h1>Hello</h1>"\nret.status 404 {error: "Not found"}\n```',
  'server': '**server** — Create Express server\n```naide\nserver app port 3000:\n  cors "*"\n  get "/": ret {ok: true}\n```',
  'schema': '**schema** — Data schema with validation\n```naide\nschema User:\n  id auto\n  name str required min(2)\n```',
  'crud': '**crud** — Auto REST CRUD routes\n```naide\ncrud "/api/users" User\n```',
  'ai': '**ai** — Built-in AI/LLM integration\n```naide\nstr answer = await ai.ask("question")\nmap data = await ai.json("extract", {name: "str"})\nstr reply = await ai.chat(messages)\nfor await chunk of ai.stream("prompt"): ...\nlist vec = await ai.embed("text")\n```',
  'prompt': '**prompt** — Reusable prompt template\n```naide\nprompt summarize {lang: "en"}:\n  "Summarize in {lang}:"\n  "{text}"\n```\nUsage: `str p = summarize({text: "hello"})`',
  'db': '**db** — Database\n```naide\ndb "data/"              # JSON files\ndb.sql "sqlite" "app.db"  # SQLite\n```',
  'typeof': '**typeof** — Get type of expression\n```naide\nif typeof x == "string": log "str"\n```',
  'instanceof': '**instanceof** — Check instance type\n```naide\nif err instanceof TypeError: log "type error"\n```',
  'ensure': '**ensure** — Finally block (always runs)\n```naide\ntry:\n  risky()\nensure:\n  cleanup()\n```',
  'test': '**test** — Test case\n```naide\ntest "math": assert 1 + 1 == 2\n```',
  'queue': '**queue** — Async job queue\n```naide\nqueue tasks:\n  job "send" (data): log data\n```',
};

function getHover(params) {
  const text = documents.get(params.textDocument.uri);
  if (!text) return null;
  const line = text.split('\n')[params.position.line];
  if (!line) return null;
  const col = params.position.character;
  let start = col, end = col;
  while (start > 0 && /\w/.test(line[start - 1])) start--;
  while (end < line.length && /\w/.test(line[end])) end++;
  const word = line.slice(start, end);
  if (HOVER_DOCS[word]) return { contents: { kind: 'markdown', value: HOVER_DOCS[word] } };
  return null;
}
