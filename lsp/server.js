import { compile } from '../src/index.js';

const documents = new Map();
const symbolIndex = new Map();
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
          definitionProvider: true,
          referencesProvider: true,
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

    case 'textDocument/definition':
      respond(msg.id, getDefinition(msg.params));
      break;

    case 'textDocument/references':
      respond(msg.id, getReferences(msg.params));
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

  indexSymbols(uri, text);
  notify('textDocument/publishDiagnostics', { uri, diagnostics });
}

function indexSymbols(uri, text) {
  const symbols = { definitions: new Map(), references: new Map() };
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    const fnMatch = trimmed.match(/^(?:pub\s+)?(?:fn\.async|fn)\s+(\w+)\s*\(/);
    if (fnMatch) {
      const name = fnMatch[1];
      const col = line.indexOf(name);
      symbols.definitions.set(name, { line: i, col, kind: 'function' });
    }

    const varMatch = trimmed.match(/^(?:pub\s+)?(?:mut\s+)?(?:str|int|num|bool|list|map|any|json|void)\s+(\w+)\s*=/);
    if (varMatch) {
      const name = varMatch[1];
      const col = line.indexOf(name);
      symbols.definitions.set(name, { line: i, col, kind: 'variable' });
    }

    const modelMatch = trimmed.match(/^model\s+(\w+)/);
    if (modelMatch) {
      const name = modelMatch[1];
      const col = line.indexOf(name);
      symbols.definitions.set(name, { line: i, col, kind: 'class' });
    }

    const schemaMatch = trimmed.match(/^schema\s+(\w+)/);
    if (schemaMatch) {
      const name = schemaMatch[1];
      const col = line.indexOf(name);
      symbols.definitions.set(name, { line: i, col, kind: 'schema' });
    }

    const promptMatch = trimmed.match(/^prompt\s+(\w+)/);
    if (promptMatch) {
      const name = promptMatch[1];
      const col = line.indexOf(name);
      symbols.definitions.set(name, { line: i, col, kind: 'prompt' });
    }

    for (const def of symbols.definitions.keys()) {
      const re = new RegExp(`\\b${def}\\b`, 'g');
      let m;
      while ((m = re.exec(line)) !== null) {
        if (i === symbols.definitions.get(def)?.line && m.index === symbols.definitions.get(def)?.col) continue;
        if (!symbols.references.has(def)) symbols.references.set(def, []);
        symbols.references.get(def).push({ line: i, col: m.index });
      }
    }
  }

  symbolIndex.set(uri, symbols);
}

function getWordAtPosition(text, line, col) {
  const lines = text.split('\n');
  if (line >= lines.length) return null;
  const lineText = lines[line];
  let start = col, end = col;
  while (start > 0 && /\w/.test(lineText[start - 1])) start--;
  while (end < lineText.length && /\w/.test(lineText[end])) end++;
  return lineText.slice(start, end) || null;
}

function getDefinition(params) {
  const uri = params.textDocument.uri;
  const text = documents.get(uri);
  if (!text) return null;

  const word = getWordAtPosition(text, params.position.line, params.position.character);
  if (!word) return null;

  const symbols = symbolIndex.get(uri);
  if (!symbols) return null;

  const def = symbols.definitions.get(word);
  if (!def) return null;

  return {
    uri,
    range: {
      start: { line: def.line, character: def.col },
      end: { line: def.line, character: def.col + word.length },
    },
  };
}

function getReferences(params) {
  const uri = params.textDocument.uri;
  const text = documents.get(uri);
  if (!text) return [];

  const word = getWordAtPosition(text, params.position.line, params.position.character);
  if (!word) return [];

  const symbols = symbolIndex.get(uri);
  if (!symbols) return [];

  const results = [];

  const def = symbols.definitions.get(word);
  if (def) {
    results.push({
      uri,
      range: {
        start: { line: def.line, character: def.col },
        end: { line: def.line, character: def.col + word.length },
      },
    });
  }

  const refs = symbols.references.get(word) || [];
  for (const ref of refs) {
    results.push({
      uri,
      range: {
        start: { line: ref.line, character: ref.col },
        end: { line: ref.line, character: ref.col + word.length },
      },
    });
  }

  return results;
}

function getCompletions() {
  const keywords = [
    'fn', 'ret', 'if', 'elif', 'else', 'each', 'for', 'while', 'match',
    'try', 'fail', 'ensure', 'server', 'model', 'schema', 'use', 'pub', 'mut',
    'log', 'typeof', 'instanceof', 'not', 'and', 'or', 'break', 'continue',
    'throw', 'new', 'await', 'test', 'assert', 'queue', 'job', 'db', 'env',
    'get', 'post', 'put', 'del', 'patch', 'every', 'watch',
  ];
  const types = ['str', 'int', 'num', 'bool', 'list', 'map', 'any', 'json', 'void'];
  const features = [
    'cors', 'auth', 'crud', 'limit', 'cookie', 'session', 'static', 'ws', 'sse',
    'cache', 'view', 'upload', 'group', 'validate', 'openapi', 'error', 'mid', 'prompt',
    'page', 'cli', 'mail', 'graphql', 'desktop', 'screen',
    'oauth', 'pay', 'storage', 'pdf', 'i18n',
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
    { label: 'page "file.html":', detail: 'Generate HTML page', insertText: 'page ' },
    { label: 'cli name "desc":', detail: 'CLI application', insertText: 'cli ' },
    { label: 'mail "host" port:', detail: 'Email config', insertText: 'mail ' },
    { label: 'graphql "/path"', detail: 'GraphQL endpoint', insertText: 'graphql ' },
    { label: 'desktop name:', detail: 'Desktop app', insertText: 'desktop ' },
    { label: 'screen Name:', detail: 'Mobile screen', insertText: 'screen ' },
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
  'bot': '**bot** — Discord bot\n```naide\nbot myBot token "TOKEN":\n  on "ready":\n    log "Bot is online!"\n  on "message" (msg):\n    msg.reply("Pong!")\n  slash "hello" "Says hello":\n    interaction.reply("Hi!")\n```',
  'db': '**db** — Database\n```naide\ndb "data/"              # JSON files\ndb.sql "sqlite" "app.db"  # SQLite\n```',
  'typeof': '**typeof** — Get type of expression\n```naide\nif typeof x == "string": log "str"\n```',
  'instanceof': '**instanceof** — Check instance type\n```naide\nif err instanceof TypeError: log "type error"\n```',
  'ensure': '**ensure** — Finally block (always runs)\n```naide\ntry:\n  risky()\nensure:\n  cleanup()\n```',
  'test': '**test** — Test case\n```naide\ntest "math": assert 1 + 1 == 2\n```',
  'queue': '**queue** — Async job queue\n```naide\nqueue tasks:\n  job "send" (data): log data\n```',
  'page': '**page** — Generate HTML page\n```naide\npage "index.html":\n  title "My App"\n  h1 "Hello"\n  div "container":\n    p "Welcome"\n```',
  'cli': '**cli** — CLI application\n```naide\ncli myTool "description":\n  arg "name" str "Your name"\n  flag "v" "verbose" "Verbose output"\n  run (args):\n    log args.name\n```',
  'mail': '**mail** — Email sending\n```naide\nmail "smtp.gmail.com" 587:\n  user "me@gmail.com"\n  pass env.MAIL_PASS\n```',
  'graphql': '**graphql** — GraphQL endpoint (inside server)\n```naide\nserver app port 3000:\n  graphql "/graphql"\n```',
  'desktop': '**desktop** — Desktop app (Electron/pywebview)\n```naide\ndesktop myApp:\n  title "My App"\n  size 1024 768\n  load "index.html"\n```',
  'screen': '**screen** — Mobile screen (React Native/Kivy)\n```naide\nscreen Home:\n  text "Hello World"\n  button "Click Me"\n  input "Enter name"\n```',
  'every': '**every** — Scheduled task / cron\n```naide\nevery "5s":\n  log "tick"\nevery "*/5 * * * *":\n  log "cron"\n```',
  'oauth': '**oauth** — Social login (Google/GitHub)\n```naide\noauth "google" env.CLIENT_ID env.CLIENT_SECRET:\n  callback "/auth/callback"\n  scope "email profile"\n```',
  'pay': '**pay** — Payment (Stripe)\n```naide\npay "stripe" env.STRIPE_KEY:\n  webhook "/webhook"\n```\nUsage: `pay.checkout(items, successUrl, cancelUrl)`',
  'storage': '**storage** — Cloud storage (S3/GCS)\n```naide\nstorage "s3" env.BUCKET env.KEY env.SECRET:\n  region "ap-northeast-1"\n```\nUsage: `storage.upload(key, body)`, `storage.download(key)`',
  'pdf': '**pdf** — PDF generation\n```naide\npdf "report.pdf":\n  title "Report"\n  text "Hello"\n```',
  'i18n': '**i18n** — Internationalization\n```naide\ni18n "locales/":\n  default "en"\n  lang "en" "en.json"\n  lang "ja" "ja.json"\n```\nUsage: `i18n.t("key")`, `i18n.setLang("ja")`',
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
