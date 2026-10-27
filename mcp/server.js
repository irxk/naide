#!/usr/bin/env node

import { resolve, dirname, isAbsolute } from 'path';
import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { checkNaideSource, getDoctorReport, inspectProject, listPackageAdapters, runProjectTests } from '../src/project-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromServer = createRequire(import.meta.url);
const packageVersion = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')).version;
const SPEC_PATH = resolve(__dirname, '..', 'SPEC.naide');
const HOSTED_EXAMPLE_DIRECTORY = resolve(__dirname, '..', 'examples', 'mws-discord');
const KNOWLEDGE_ROOTS = ['SPEC.naide', 'README.md', 'docs', 'src', 'examples', 'benchmark', 'mcp', 'lsp', 'vscode-naide'];
const KNOWLEDGE_EXTENSIONS = new Set(['.naide', '.md', '.html', '.js', '.json', '.jsonc', '.css']);
const EXCLUDED_KNOWLEDGE_DIRECTORIES = new Set(['.git', 'node_modules', 'out', 'dist', 'coverage']);
const MCP_PROTOCOL_VERSION = '2026-07-28';
const MCP_SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';
const MCP_PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';

const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/;
const NPM_VERSION_RANGE = /^[0-9A-Za-z.*^~<>=|+ -]{1,100}$/;
const SPEC_TOPIC_ALIASES = {
  ai: ['AI / LLM'],
  async: ['非同期関数', 'await.all', 'iterator / post-test loops', 'generator functions'],
  authentication: ['サーバー定義', 'OAuth'],
  auth: ['サーバー定義', 'OAuth'],
  bot: ['Discord Bot', 'マルチプラットフォーム Bot'],
  browser: ['ページ生成', 'ブラウザーAPI'],
  cli: ['CLI アプリ'],
  cron: ['Cron / スケジュール'],
  database: ['データベース永続化', 'スキーマ定義', 'スキーマ継承'],
  db: ['データベース永続化', 'スキーマ定義'],
  discord: ['Discord Bot', 'マルチプラットフォーム Bot'],
  email: ['メール送信'],
  enum: ['enum'],
  error: ['エラーハンドリング'],
  function: ['関数', '非同期関数'],
  functions: ['関数', '非同期関数'],
  graphql: ['GraphQL'],
  html: ['ページ生成'],
  http: ['サーバー定義', 'HTTPクライアント', 'HTTPメソッド', 'リクエストバリデーション'],
  import: ['インポート', '動的インポート'],
  imports: ['インポート', '動的インポート'],
  interpreter: ['直接実行エンジン'],
  loop: ['ループ', 'iterator / post-test loops'],
  model: ['クラス (model)'],
  native: ['直接実行エンジン'],
  page: ['ページ生成'],
  schema: ['スキーマ定義', 'スキーマ継承'],
  server: ['サーバー定義'],
  type: ['型チェック', '変数宣言'],
  types: ['型チェック', '変数宣言'],
  variable: ['変数宣言'],
  variables: ['変数宣言'],
  web: ['ページ生成', 'ブラウザーAPI'],
};

function collectKnowledgeFiles() {
  const files = [];
  const visit = (relativePath) => {
    const absolutePath = resolve(__dirname, '..', relativePath);
    const stat = statSync(absolutePath);
    if (stat.isFile()) {
      const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase();
      if (KNOWLEDGE_EXTENSIONS.has(extension)) files.push(relativePath);
      return;
    }
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (entry.isDirectory() && EXCLUDED_KNOWLEDGE_DIRECTORIES.has(entry.name))) continue;
      const childPath = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) visit(childPath);
      else if (entry.isFile()) {
        const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        if (KNOWLEDGE_EXTENSIONS.has(extension)) files.push(childPath);
      }
    }
  };
  for (const root of KNOWLEDGE_ROOTS) visit(root);
  return files.sort();
}

const KNOWLEDGE_FILES = collectKnowledgeFiles();

function getSpecSections() {
  const spec = readFileSync(SPEC_PATH, 'utf8');
  const headings = [...spec.matchAll(/^# ---- (.+?) ----$/gm)];
  return headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? spec.length;
    return { title: heading[1], content: spec.slice(start, end).trim() };
  });
}

function getKnowledgeCatalog() {
  return {
    packageVersion,
    searchableFileCount: KNOWLEDGE_FILES.length,
    sources: [
      { path: 'SPEC.naide', purpose: 'Canonical syntax, language features, and language-level examples.' },
      { path: 'README.md and docs/', purpose: 'CLI, product guides, feature explanations, and published support boundaries.' },
      { path: 'src/', purpose: 'Current compiler, runtime, type checker, adapters, project tooling, and NaideVM implementation.' },
      { path: 'benchmark/', purpose: 'Reproducible cross-runtime NaideVM benchmark harness and workload definitions.' },
      { path: 'examples/', purpose: 'Runnable canonical NAIDE examples.' },
      { path: 'mcp/, lsp/, vscode-naide/', purpose: 'Current MCP, language-server, and VS Code integration behavior.' },
    ],
    usage: 'Use naide_search to retrieve focused evidence from these bundled first-party files. Use naide_spec or naide://spec for the complete language specification. Search results are implementation evidence, not a claim that every backend or target has feature parity.',
    exclusions: 'Workspace files, dependencies, build output, generated artifacts, and test fixtures are not indexed. naide://project only reports the selected project diagnostics.',
  };
}

function searchKnowledge(query, limit = 10) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [];
  for (const file of KNOWLEDGE_FILES) {
    const lines = readFileSync(resolve(__dirname, '..', file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const text = line.toLowerCase();
      const matchedTerms = terms.filter(term => text.includes(term));
      if (matchedTerms.length !== terms.length) return;
      const phraseMatch = text.includes(query.toLowerCase());
      const score = matchedTerms.length * 10 + (phraseMatch ? 5 : 0);
      const firstMatch = Math.min(...terms.map(term => text.indexOf(term)));
      const start = line.length > 700 ? Math.max(0, firstMatch - 200) : 0;
      const excerpt = `${start ? '...' : ''}${line.slice(start, start + 697)}${start + 697 < line.length ? '...' : ''}`;
      matches.push({ file, line: index + 1, excerpt, score });
    });
  }
  matches.sort((a, b) => b.score - a.score);
  const results = matches.slice(0, limit).map(({ score: _score, ...match }) => match);
  return {
    query,
    totalMatches: matches.length,
    returned: results.length,
    truncated: matches.length > results.length,
    results,
    guidance: 'Treat SPEC.naide as the language contract, source as implementation evidence, and examples as usage patterns. Verify target-specific behavior; code-generation smoke coverage is not full feature parity.',
  };
}

function validateNpmLibraries(libraries) {
  if (!libraries || typeof libraries !== 'object' || Array.isArray(libraries)) {
    return 'libraries must be an object mapping npm package names to version ranges.';
  }
  for (const [name, version] of Object.entries(libraries)) {
    if (name === 'naider' || name === 'discord.js'
      || !NPM_PACKAGE_NAME.test(name)
      || typeof version !== 'string'
      || !NPM_VERSION_RANGE.test(version)) {
      return `Invalid or reserved npm dependency: ${name}`;
    }
  }
  return null;
}

function createNidManifest(entry, dependencies = {}) {
  return {
    name: 'naide-hosted-app',
    version: '1.0.0',
    main: 'node_modules/naider/bin/naide-host.js',
    naide: { entry },
    dependencies: {
      naider: `^${packageVersion}`,
      ...dependencies,
    },
  };
}

function getAiGuide(topic) {
  const specSections = getSpecSections();
  const topicLower = topic?.toLowerCase();
  const aliases = topicLower
    ? [...(SPEC_TOPIC_ALIASES[topicLower] || []), topicLower]
    : [];
  const selectedSections = topic
    ? specSections.filter(section => {
      const title = section.title.toLowerCase();
      const content = section.content.toLowerCase();
      return aliases.some(alias => title.includes(alias.toLowerCase()))
        || (topicLower.length >= 3 && content.includes(topicLower));
    }).slice(0, 5)
    : [];

  return {
    identity: 'NAIDE is a readable, typed, single-syntax language for people and AI, with a compiler, Node.js runtime integration, built-in application constructs, and editor/MCP tooling.',
    strengths: [
      'Readable indentation-based syntax with explicit types, inference via auto, and explicit mutability via mut.',
      'One canonical .naide source can be checked, run, compiled, imported into Node.js, and used with npm dependencies.',
      'Batteries-included constructs cover server routes, schemas, CRUD, authentication, validation, databases, AI, bots, scheduled tasks, and more; consult the spec before assuming a construct or backend is complete.',
      'Native-Meld allows Node.js to load .naide modules while preserving Node built-ins and npm imports; hosted Node apps use nidpackage.json and naider/bin/naide-host.js as the package main.',
      'The compiler has 15 output targets, but backend feature coverage differs. Treat CI smoke coverage as a baseline, not a guarantee of full feature parity.',
      'Type checking and naide_check catch errors without executing project code; use them before runtime tests.',
    ],
    capabilityBoundaries: [
      'The page construct builds static HTML from nested elements and safe attributes. Use naide init <dir> --template web for a NAIDE-only website starter, then naide dev <dir> for local build, static serving, live reload, and visible build errors.',
      'An experimental direct AST interpreter is available through naide native <file.naide>; it supports core constructs, synchronous and asynchronous generators with standalone yield/yield* (async generators may await while producing values), for-await loops in async functions and async generators, generator-aware bounded synchronous/asynchronous iterable collection helpers including streaming zip, chunk, partition, groupBy, count, and unique operations, models with new/defaulted fields/custom init(params) initializers/self methods/initialized static fields/static and async static methods/inherited statics/async methods/single inheritance/super.method() overrides (including static self and async super calls; pub model exports), frozen zero-based enums (including pub enum exports), fn.async, await, await.all, cooperative task coordination via task.spawn/all/race/map/sleep, bounded FIFO message channels via task.channel with cancellable send/receive waiters, cancellation via task.controller and task.withTimeout, relative .naide imports, and installed NAIDE source packages found in node_modules when they declare an in-package .naide main in naide.pkg.json. Package subpaths require exact exports mappings to in-package .naide files; escaping symlink targets are rejected. JavaScript-only npm packages and Node.js built-ins are not loaded. It also provides project-confined async file I/O via io.readText/writeText/appendText/exists/listDir, HTTP(S) requests via http.request/get/post, and limited host context via runtime.args/env/cwd/platform/arch/exitCode. Environment variables are explicit opt-in only; arbitrary process access and shell execution are not exposed. Runtime errors include source-line locations and function/file stack frames when available. Iterable consumption is bounded by the native step budget and closes iterators on early termination. Cancellation is cooperative and operations that ignore AbortSignal may continue. task.map provides bounded I/O concurrency but task coordination does not provide CPU parallelism. HTTP uses host Fetch and has no allowlist; do not treat the interpreter as an OS sandbox. Nested yield expressions, arbitrary JavaScript classes, and framework declarations still require the existing compiler/runtime path. An opt-in Windows x64 native-machine-code JIT is available for selected guarded hot functions, alongside the default interpreter and fast tier. In the canonical seven-sample, nine-workload Windows x64 benchmark, both native tiers exceeded V8 in that run; Map and Set are near parity and Set reruns fluctuate around V8. These fixture-specific results are not a general application speed guarantee, and the default interpreter does not inherit the native-tier benchmark results.',
      'The naide:browser built-in exposes DOM selection/events, Canvas 2D, animation frames, observable state stores (state/get/set/update/subscribe), and text/value/class bindings with cleanup functions. It is not a complete typed DOM or every browser API.',
      'Direct Web API access is available by importing browser globals from naide:browser or using browser.globalThis/window. Use naide build . build --bundle-browser to bundle installed browser-compatible npm packages into page modules; remote ESM imports can use a page import map. Node-only npm packages cannot run in browsers.',
      'JavaScript-generation parity is a practical subset for Node.js, Bun, TypeScript, and browser output, not a parser for raw JavaScript. It includes BigInt/numeric and regex literals, backtick interpolation, JS arithmetic/bitwise/update/ternary operators, iterator and post-test loops, and fn.gen/fn.async.gen with yield. Use match for switch-like branches; decorators, labels, and direct JS class/import/export syntax remain unsupported.',
      'The desktop construct describes a desktop shell, but Electron still needs a host/runtime boundary. Generated JavaScript is build output, not authored NAIDE behavior.',
      'If a required browser feature is outside the built-in helpers and available Web APIs, tell the user the concrete NAIDE limitation and ask the user whether they approve a minimal JS/TS bridge before authoring one.',
    ],
    syntax: [
      'Declare values with str/int/bool/float or auto; use mut to make reassignment explicit.',
      'Use fn name(args) -> returnType: with indented body and ret for return.',
      'Use if/elif/else, each item in items:, and async fn/await for familiar control flow.',
      'JavaScript-compatible syntax includes optional calls/indexes, native dynamic import, strict equality, logical operators, numeric/regex/template literals, exponent and bitwise operators, ++/--, JS ternary, for-of/for-in, do-while, and generators via fn.gen/fn.async.gen with yield/yield*.',
      'Use use { readFile } from "node:fs/promises" for Node imports, and declare npm libraries in dependencies before importing them.',
      'NAIDE uses indentation and colons for blocks; consult SPEC.naide rather than translating JavaScript syntax mechanically.',
    ],
    efficientWorkflow: [
      'Call naide_context with a topic when you need feature or syntax guidance.',
      'Use naide_search to search the bundled documentation, examples, and current implementation when the relevant behavior is unclear; use naide_spec for canonical language rules.',
      'Read the matching SPEC.naide section or a relevant canonical example before writing unfamiliar constructs.',
      'For a small browser site, scaffold with naide init <dir> --template web and run naide dev <dir>; keep page/client behavior in .naide and styles in CSS.',
      'Write the application logic in .naide first and use naide_check on it. Keep generated JavaScript as build output, not as the authored source.',
      'Use naide native <file.naide> to experiment with direct AST execution; async functions, await.all, bounded task.map concurrency, FIFO task channels with cancellable waiters, cooperative cancellation/timeouts, relative .naide module imports, project-confined io file operations, HTTP(S) via http helpers, and explicit runtime metadata/args work. Environment values must be opted in by name, and no shell execution is provided. These tasks do not provide CPU parallelism; bare npm/Node imports, generators, classes, and framework constructs are not yet supported.',
      'When nidpackage.json exists or the user requests it, put npm dependencies there; do not create package.json or package-lock.json unless explicitly requested or a host demonstrably requires them.',
      'Do not author JavaScript for gaps in NAIDE without explicit user approval. Explain the unsupported feature and ask first; the user may choose a NAIDE-supported alternative.',
      'Use naide_compile to inspect generated code only when the host/runtime boundary needs diagnosis; do not present its JavaScript output as the project source.',
      'Use naide_run or naide_test only when execution is requested and the project is trusted.',
    ],
    projectConventions: [
      'NAIDE-first: the primary implementation and business logic belong in .naide files, not JavaScript.',
      'If nidpackage.json exists, preserve and update it for npm dependencies. Do not add a competing package.json or package-lock.json unless the user asks or a verified host requirement makes it necessary.',
      'Do not create authored .js/.jsx/.mjs/.cjs/.ts/.tsx files, inline JavaScript, duplicate logic, or loader bootstraps unless the user explicitly approves JavaScript. This applies even when the AI believes JavaScript would be easier or necessary.',
      'If NAIDE cannot currently express a requested browser/host feature, do not silently fall back to JavaScript. Explain the specific NAIDE limitation and ask permission before adding any JavaScript or TypeScript.',
      'HTML, CSS, images, and other non-JavaScript assets are fine when the requested product needs them. Keep application behavior in .naide; generated compiler output may go under build/ but must not become authored source.',
      'When creating or changing NAIDE code, validate it with naide_check; do not switch to plain JS just because the requested result is a website or application.',
    ],
    hostedNode: {
      manifest: 'nidpackage.json',
      uploadFiles: ['the .naide entry file', 'nidpackage.json'],
      main: 'node_modules/naider/bin/naide-host.js',
      entryField: 'naide.entry',
      dependenciesField: 'dependencies',
      limitation: 'The host must install npm dependencies from nidpackage.json and launch its main entry. Hosts that hard-code node <file>.naide without using this main/runner contract must add NAIDE loader support themselves.',
    },
    knowledgeSources: getKnowledgeCatalog(),
    mcpTools: TOOLS.map(tool => ({ name: tool.name, description: tool.description })),
    specIndex: specSections.map(section => section.title),
    ...(topic ? { requestedSpecSections: selectedSections } : {}),
    ...(topic && selectedSections.length === 0 ? { topicNotFound: topic, hint: 'Use the naide://spec resource to search the complete language specification.' } : {}),
  };
}

function resolveRunImport(specifier) {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const path = isAbsolute(specifier) ? specifier : resolve(process.cwd(), specifier);
    return pathToFileURL(path).href;
  }
  const requireFromProject = createRequire(resolve(process.cwd(), '__naide_mcp_run__.cjs'));
  try {
    const path = requireFromProject.resolve(specifier);
    return isAbsolute(path) ? pathToFileURL(path).href : path;
  } catch (projectError) {
    try {
      const path = requireFromServer.resolve(specifier);
      return isAbsolute(path) ? pathToFileURL(path).href : path;
    } catch {
      throw projectError;
    }
  }
}

let compileModule = null;
async function getCompiler() {
  if (!compileModule) {
    compileModule = await import(pathToFileURL(resolve(__dirname, '..', 'src', 'index.js')).href);
  }
  return compileModule;
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result: { resultType: 'complete', ...result } });
}

function respondError(id, code, message, data) {
  send({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

function validateRequestMetadata(message) {
  const metadata = message.params?._meta;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { code: -32602, message: 'Request params must include _meta metadata.' };
  }
  const protocolVersion = metadata[MCP_PROTOCOL_VERSION_KEY];
  if (protocolVersion !== MCP_PROTOCOL_VERSION) {
    return {
      code: -32022,
      message: 'Unsupported protocol version',
      data: { supported: [MCP_PROTOCOL_VERSION], requested: protocolVersion ?? null },
    };
  }
  const clientInfo = metadata['io.modelcontextprotocol/clientInfo'];
  const clientCapabilities = metadata['io.modelcontextprotocol/clientCapabilities'];
  if (!clientInfo || typeof clientInfo.name !== 'string' || typeof clientInfo.version !== 'string'
    || !clientCapabilities || typeof clientCapabilities !== 'object' || Array.isArray(clientCapabilities)) {
    return {
      code: -32602,
      message: '_meta must include valid clientInfo and clientCapabilities.',
    };
  }
  return null;
}

const TOOLS = [
  {
    name: 'naide_compile',
    description: 'Compile readable NAIDE source code to a target language. Output is generated code for inspection/building; keep .naide as the authored source and do not replace the project with the generated JavaScript.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'NAIDE source code to compile' },
        target: {
          type: 'string',
          description: 'Target language (default: node)',
          enum: ['node', 'python', 'bun', 'typescript', 'go', 'java', 'rust', 'cpp', 'c', 'csharp', 'kotlin', 'swift', 'dart', 'php', 'ruby']
        }
      },
      required: ['code']
    }
  },
  {
    name: 'naide_check',
    description: 'Compile and type-check NAIDE source without executing it. Returns structured diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'NAIDE source code to check' },
        sourceFile: { type: 'string', description: 'Optional source filename used in diagnostics' },
      },
      required: ['code']
    }
  },
  {
    name: 'naide_run',
    description: 'Compile NAIDE code to JavaScript and execute it. Returns stdout output.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'NAIDE source code to run' }
      },
      required: ['code']
    }
  },
  {
    name: 'naide_targets',
    description: 'List all available NAIDE compilation targets with details.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'naide_generate',
    description: 'Generate authored NAIDE (.naide) source from a natural-language instruction. The output is NAIDE, not JavaScript. No AI — uses pattern matching and template composition with self-healing parser validation.',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'Natural language instruction (e.g. "REST API for users with auth", "Discord bot", "todo app")' },
        port: { type: 'number', description: 'Server port (default: 3000)' },
        schemaName: { type: 'string', description: 'Override schema/entity name' }
      },
      required: ['instruction']
    }
  },
  {
    name: 'naide_mws_discord_template',
    description: 'Return the two upload files for a hosted Node.js Discord bot: discord-bot.naide and nidpackage.json. The package manifest selects NAIDE’s installed host runner, so no JavaScript bootstrap file is uploaded. Add compatible npm packages through libraries.',
    inputSchema: {
      type: 'object',
      properties: {
        libraries: {
          type: 'object',
          description: 'Optional additional npm dependencies, for example {"@discordjs/voice":"^0.19.0"}.',
          additionalProperties: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'naide_hosted_manifest',
    description: 'Create only a nidpackage.json for a hosted Node.js NAIDE application. Do not create package.json or JavaScript bootstrap files. It configures the NAIDE host runner as main, sets the .naide entry, and adds compatible npm dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: 'string', description: 'Relative .naide entry path, such as app.naide.' },
        libraries: {
          type: 'object',
          description: 'Additional npm packages mapped to version ranges.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['entry'],
    },
  },
  {
    name: 'naide_context',
    description: 'Fast, structured NAIDE language and workflow context for AI coding. Enforces NAIDE-only application source by default: no authored JS/TS unless the user explicitly approves it. If a requested feature is unsupported, ask before switching to JS. Also preserves nidpackage.json. Returns syntax, feature index, workflow, hosted Node.js contract, and MCP tools.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Optional topic filter matching NAIDE spec section headings, such as server, schema, async, bot, or type.' },
      },
    },
  },
  {
    name: 'naide_spec',
    description: 'Get the NAIDE language specification. Use this to understand NAIDE syntax before writing code.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Optional section to retrieve (e.g. "variables", "functions", "server"). Omit for full spec.'
        }
      }
    }
  },
  {
    name: 'naide_doctor',
    description: 'Diagnose the local Node.js runtime, installed language tools, and project manifests.',
    inputSchema: {
      type: 'object',
      properties: { directory: { type: 'string', description: 'Project directory (defaults to the current directory)' } }
    }
  },
  {
    name: 'naide_verify',
    description: 'Validate project manifests and summarize NAIDE files and setup warnings without running project code.',
    inputSchema: {
      type: 'object',
      properties: { directory: { type: 'string', description: 'Project directory (defaults to the current directory)' } }
    }
  },
  {
    name: 'naide_test',
    description: 'Run detected native project test suites. This executes project-configured test code with the current user permissions.',
    inputSchema: {
      type: 'object',
      properties: { directory: { type: 'string', description: 'Project directory (defaults to the current directory)' } }
    }
  },
  {
    name: 'naide_package_managers',
    description: 'List supported native package ecosystems and explain the limits of cross-language package interoperability.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'naide_search',
    title: 'Search NAIDE Knowledge',
    description: 'Search the bundled NAIDE language specification, README and guides, examples, compiler/runtime source, and MCP/LSP/VS Code implementation. Use this before concluding that a syntax feature, runtime behavior, target, or integration is unsupported. Results include file paths and line numbers; source implementation does not imply full target parity.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'One or more words or a phrase to find in first-party NAIDE documentation and source.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum evidence snippets to return (default 10).' },
      },
      required: ['query'],
    },
  }
].map(tool => ({
  ...tool,
  title: tool.title || tool.name
    .replace(/^naide_/, '')
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' '),
  annotations: tool.name === 'naide_run' || tool.name === 'naide_test'
    ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}));

const TARGETS_INFO = [
  { name: 'node', language: 'JavaScript (ES Modules)', server: 'Express', flag: 'default' },
  { name: 'python', language: 'Python', server: 'Flask', flag: '--target python' },
  { name: 'bun', language: 'JavaScript (Bun)', server: 'Bun.serve', flag: '--target bun' },
  { name: 'typescript', language: 'TypeScript', server: 'Express', flag: '--target ts' },
  { name: 'go', language: 'Go', server: 'net/http', flag: '--target go' },
  { name: 'java', language: 'Java', server: 'HttpServer', flag: '--target java' },
  { name: 'rust', language: 'Rust', server: 'actix-web', flag: '--target rust' },
  { name: 'cpp', language: 'C++', server: 'cpp-httplib', flag: '--target cpp' },
  { name: 'c', language: 'C', server: 'libmicrohttpd', flag: '--target c' },
  { name: 'csharp', language: 'C#', server: 'ASP.NET', flag: '--target csharp' },
  { name: 'kotlin', language: 'Kotlin', server: 'Ktor', flag: '--target kotlin' },
  { name: 'swift', language: 'Swift', server: 'Vapor', flag: '--target swift' },
  { name: 'dart', language: 'Dart', server: 'shelf', flag: '--target dart' },
  { name: 'php', language: 'PHP', server: 'Built-in / Laravel', flag: '--target php' },
  { name: 'ruby', language: 'Ruby', server: 'Sinatra', flag: '--target ruby' },
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'naide_check': {
      if (typeof args.code !== 'string') {
        return {
          content: [{ type: 'text', text: 'The code argument must be a string.' }],
          isError: true,
        };
      }
      const report = checkNaideSource(args.code, args.sourceFile);
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
        ...(!report.ok ? { isError: true } : {}),
      };
    }

    case 'naide_compile': {
      const { compile, compileAsync } = await getCompiler();
      const target = args.target || 'node';
      try {
        if (target === 'node') {
          const result = compile(args.code);
          return { content: [{ type: 'text', text: result.js }] };
        }
        const result = await compileAsync(args.code, { target });
        return { content: [{ type: 'text', text: result.code }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Compilation error: ${e.message}` }], isError: true };
      }
    }

    case 'naide_run': {
      const { compile } = await getCompiler();
      try {
        const result = compile(args.code);
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        let output = '';
        const fakeConsole = { log: (...a) => { output += a.map(String).join(' ') + '\n'; }, error: (...a) => { output += a.map(String).join(' ') + '\n'; } };
        const executable = result.js.replace(
          /^\s*import\s+(.+?)\s+from\s+(['"])([^'"\r\n]+)\2;\s*$/gm,
          (_statement, clause, _quote, specifier) => {
            const resolvedImport = resolveRunImport(specifier);
            const module = `await import(${JSON.stringify(resolvedImport)})`;
            const bindings = clause.trim();
            if (bindings.startsWith('{')) {
              return `const ${bindings.replace(/\bas\b/g, ':')} = ${module};`;
            }
            if (bindings.startsWith('* as ')) {
              return `const ${bindings.slice(5)} = ${module};`;
            }
            const defaultAndNamed = bindings.match(/^([A-Za-z_$][\w$]*)\s*,\s*(\{[^}]+\})$/);
            if (defaultAndNamed) {
              return `const { default: ${defaultAndNamed[1]}, ${defaultAndNamed[2].slice(1, -1).replace(/\bas\b/g, ':')} } = ${module};`;
            }
            if (/^[A-Za-z_$][\w$]*$/.test(bindings)) {
              return `const { default: ${bindings} } = ${module};`;
            }
            return _statement;
          },
        );
        const fn = new AsyncFunction('console', executable);
        await fn(fakeConsole);
        return { content: [{ type: 'text', text: output || '(no output)' }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }

    case 'naide_targets': {
      const text = TARGETS_INFO.map(t => `${t.name.padEnd(12)} ${t.language.padEnd(25)} ${t.server.padEnd(20)} ${t.flag}`).join('\n');
      return { content: [{ type: 'text', text: `NAIDE Compilation Targets (15):\n\n${'Target'.padEnd(12)} ${'Language'.padEnd(25)} ${'Server'.padEnd(20)} Flag\n${'─'.repeat(75)}\n${text}` }] };
    }

    case 'naide_generate': {
      try {
        const { generate } = await import(pathToFileURL(resolve(__dirname, '..', 'src', 'gen.js')).href);
        const opts = {};
        if (args.port) opts.port = args.port;
        if (args.schemaName) opts.schemaName = args.schemaName;
        const result = generate(args.instruction, opts);
        const meta = `[${result.intents.join(' + ')}]${result.schema ? ` → ${result.schema}` : ''} | valid: ${result.valid}${result.fixed ? ' (auto-fixed)' : ''}`;
        return { content: [{ type: 'text', text: `${result.code}\n# ${meta}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Generation error: ${e.message}` }], isError: true };
      }
    }

    case 'naide_mws_discord_template': {
      const libraries = args.libraries ?? {};
      const invalidLibrary = validateNpmLibraries(libraries);
      if (invalidLibrary) return { content: [{ type: 'text', text: invalidLibrary }], isError: true };

      const dependencies = { 'discord.js': '^14.27.0', ...libraries };
      const exampleDirectory = HOSTED_EXAMPLE_DIRECTORY;
      const files = [
        { path: 'discord-bot.naide', content: readFileSync(resolve(exampleDirectory, 'discord-bot.naide'), 'utf8') },
        {
          path: 'nidpackage.json',
          content: `${JSON.stringify(createNidManifest('discord-bot.naide', dependencies), null, 2)}\n`,
        },
      ];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            files,
            mws: {
              startupFile: 'node_modules/naider/bin/naide-host.js (set nidpackage.json main to this so the host can auto-detect it)',
              startAction: 'Let MWS install nidpackage.json dependencies, then press Start.',
              botToken: 'Set BOT_TOKEN as a secret environment variable in MWS.',
            },
            limitation: 'This two-file layout depends on the host installing dependencies from nidpackage.json and launching its main field. Hosts that ignore that manifest contract must configure the NAIDE host runner as their startup file.',
          }, null, 2),
        }],
      };
    }

    case 'naide_hosted_manifest': {
      const entry = args.entry;
      if (typeof entry !== 'string' || !/^(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!\/)(?![A-Za-z]:)[A-Za-z0-9._/-]+\.naide$/.test(entry)) {
        return { content: [{ type: 'text', text: 'entry must be a relative .naide file path inside the project.' }], isError: true };
      }
      const libraries = args.libraries ?? {};
      const invalidLibrary = validateNpmLibraries(libraries);
      if (invalidLibrary) return { content: [{ type: 'text', text: invalidLibrary }], isError: true };
      const manifest = createNidManifest(entry, libraries);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            file: { path: 'nidpackage.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
            run: 'The host installs dependencies from nidpackage.json and launches its main field. This runs the selected .naide file through the NAIDE host runner.',
            compatibility: 'The host must honor nidpackage.json dependencies and main. Otherwise, set node_modules/naider/bin/naide-host.js as its startup file explicitly.',
          }, null, 2),
        }],
      };
    }

    case 'naide_context': {
      const topic = typeof args.topic === 'string' ? args.topic.trim() : '';
      return {
        content: [{ type: 'text', text: JSON.stringify(getAiGuide(topic || undefined), null, 2) }],
      };
    }

    case 'naide_search': {
      if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200) {
        return { content: [{ type: 'text', text: 'query must be a non-empty string of at most 200 characters.' }], isError: true };
      }
      const limit = args.limit ?? 10;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        return { content: [{ type: 'text', text: 'limit must be an integer from 1 to 20.' }], isError: true };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(searchKnowledge(args.query.trim(), limit), null, 2) }],
      };
    }

    case 'naide_spec': {
      try {
        let spec = readFileSync(resolve(__dirname, '..', 'SPEC.naide'), 'utf-8');
        if (args.section !== undefined) {
          if (typeof args.section !== 'string' || !args.section.trim()) {
            return { content: [{ type: 'text', text: 'section must be a non-empty string when provided.' }], isError: true };
          }
          const sectionQuery = args.section.trim().toLowerCase();
          const aliases = [...(SPEC_TOPIC_ALIASES[sectionQuery] || []), sectionQuery];
          let sections = getSpecSections().filter(section =>
            aliases.some(alias => section.title.toLowerCase().includes(alias.toLowerCase())));
          if (!sections.length && sectionQuery.length >= 3) {
            sections = getSpecSections()
              .filter(section => section.content.toLowerCase().includes(sectionQuery))
              .slice(0, 5);
          }
          if (!sections.length) {
            return {
              content: [{
                type: 'text',
                text: `No specification section matched "${args.section}". Use naide_search or omit section to read the full spec. Available section titles: ${getSpecSections().map(section => section.title).join(', ')}`,
              }],
              isError: true,
            };
          }
          spec = sections.map(section => `# ---- ${section.title} ----\n${section.content}`).join('\n\n');
        }
        return { content: [{ type: 'text', text: spec }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error reading spec: ${e.message}` }], isError: true };
      }
    }

    case 'naide_doctor': {
      const directory = typeof args.directory === 'string' ? resolve(args.directory) : process.cwd();
      return { content: [{ type: 'text', text: JSON.stringify(await getDoctorReport(directory), null, 2) }] };
    }

    case 'naide_verify': {
      const directory = typeof args.directory === 'string' ? resolve(args.directory) : process.cwd();
      const report = inspectProject(directory);
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
        ...(report.ok ? {} : { isError: true }),
      };
    }

    case 'naide_test': {
      const directory = typeof args.directory === 'string' ? resolve(args.directory) : process.cwd();
      const report = await runProjectTests(directory);
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
        ...(report.ok ? {} : { isError: true }),
      };
    }

    case 'naide_package_managers': {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            adapters: listPackageAdapters(),
            interoperability: 'Packages are installed with their ecosystem-native manager and run in their native runtime. Calling a package from NAIDE requires an explicit process, HTTP, FFI, or generated-language adapter; arbitrary libraries cannot be called directly across languages.',
          }, null, 2),
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

async function handleMessage(msg) {
  if (msg.id === undefined) return;

  const metadataError = validateRequestMetadata(msg);
  if (metadataError) {
    respondError(msg.id, metadataError.code, metadataError.message, metadataError.data);
    return;
  }
  if (msg.method === 'tools/call'
    && (!msg.params || typeof msg.params.name !== 'string'
      || (msg.params.arguments !== undefined
        && (!msg.params.arguments || typeof msg.params.arguments !== 'object' || Array.isArray(msg.params.arguments))))) {
    respondError(msg.id, -32602, 'tools/call params must include a tool name and an object of arguments.');
    return;
  }

  switch (msg.method) {
    case 'server/discover':
      respond(msg.id, {
        supportedVersions: [MCP_PROTOCOL_VERSION],
        capabilities: { tools: {}, prompts: {}, resources: {} },
        _meta: { [MCP_SERVER_INFO_KEY]: { name: 'naide-mcp', version: packageVersion } },
        instructions: [
          'NAIDE-FIRST CODING RULES:',
          '1. When the user asks for NAIDE, author the primary application and business logic in .naide. Do not silently substitute JavaScript/TypeScript or deliver mostly .js files.',
          '2. Keep .naide as the source of truth. Do not check in or present compiler-generated JavaScript as authored source unless the user explicitly requests generated output.',
          '3. If nidpackage.json exists or is requested, add/update npm dependencies there. Do not create a competing package.json or package-lock.json unless the user explicitly requests it or you verify the selected host requires it.',
          '4. Never create authored .js/.jsx/.mjs/.cjs/.ts/.tsx files, inline JavaScript, or JavaScript bootstraps unless the user explicitly approves JavaScript. Do not decide on the user behalf that JavaScript is necessary.',
          '5. Before concluding that a NAIDE syntax, runtime feature, compiler target, or integration is unsupported, search with naide_search, read the relevant SPEC.naide section, and inspect canonical examples. Treat the specification as the language contract and source as implementation evidence; do not infer complete target parity from a code match.',
          '6. If a requested capability is still not expressible in NAIDE, stop before implementing it in JavaScript. State the concrete limitation and ask whether the user wants to approve a minimal JS/TS bridge or choose a NAIDE-supported alternative.',
          '7. HTML, CSS, and media assets are allowed. Keep all application behavior in .naide. Generated compiler output may be written under build/ only and is not a substitute for NAIDE source.',
          '8. Before coding, inspect the existing files and manifests, consult naide_context and the relevant spec section, then list the intended files. After editing .naide, run naide_check and fix reported diagnostics.',
          '9. Browser support: page generates static HTML with nested elements and safe attributes. Use naide init <dir> --template web and naide dev <dir> for a NAIDE-first site starter, local static server, bundling, live reload, and build diagnostics. Import naide:browser from a separate .naide client module for DOM selection/events, Canvas 2D, and Web API globals. Node-only packages and APIs are not browser-compatible.',
        ].join('\n'),
      });
      break;

    case 'tools/list':
      respond(msg.id, { tools: TOOLS });
      break;

    case 'prompts/list':
      respond(msg.id, {
        prompts: [
          { name: 'getting_started', description: 'Create and verify a small NAIDE project.' },
          { name: 'verify_changes', description: 'Check AI-authored NAIDE changes without executing project code.' },
          { name: 'secure_service', description: 'Design a NAIDE service with authentication, safe defaults, and a verification checklist.' },
          { name: 'polyglot_dependency', description: 'Choose a native package manager and a safe bridge for using a foreign-language package.' },
          { name: 'naide_first', description: 'Implement the requested application primarily in NAIDE and preserve the project manifest convention.' },
          { name: 'getting_started_ja', description: '日本語でNAIDEの小さなプロジェクトを作成して確認する。' },
          { name: 'verify_changes_ja', description: 'AIが変更したNAIDEコードを実行せずに検査する。' },
          { name: 'secure_service_ja', description: '認証と安全な初期設定を備えたサービスを設計する。' },
          { name: 'polyglot_dependency_ja', description: '他言語パッケージの導入方法と明示的な連携方法を検討する。' },
          { name: 'naide_coding_ja', description: 'ユーザーの許可なくJSを作らず、NAIDEで実現できない場合は先に確認する。' },
          { name: 'mws_discord_ja', description: 'MWSでNAIDE Discord Botを2ファイル構成で実行する。' },
        ],
      });
      break;

    case 'prompts/get': {
      const prompts = {
        getting_started: 'Help me create a small NAIDE project. Keep all application behavior in readable .naide source; do not substitute JavaScript/TypeScript or add duplicate JS implementation. Never create authored JS/TS files or inline JavaScript unless I explicitly approve it. If NAIDE lacks a requested capability, explain the specific gap and ask me before adding JS/TS; do not decide for me. If nidpackage.json exists or is requested, use it for npm dependencies and do not add package.json/package-lock.json unless I explicitly ask or a verified host requirement demands it. Use HTML/CSS/assets as needed. Explain each step, run naide_check on NAIDE files, and finish with naide doctor and naide verify.',
        verify_changes: 'Review the requested NAIDE changes, then use naide_check on each changed .naide source and naide_verify on the project. These checks do not execute project code. Explain every diagnostic and fix only issues in scope. Do not use naide_run or naide_test unless I explicitly ask you to execute code or tests.',
        secure_service: 'Help me design a secure NAIDE service. Use authentication for sensitive routes, validate input, keep secrets in environment variables, bind development servers to localhost, and provide concrete verification steps. Do not claim security without evidence.',
        polyglot_dependency: 'Help me use this dependency from NAIDE. First identify its native language and package manager, then explain installation with naide pkg add where supported. Do not imply direct cross-language calls: select and explain an explicit process, HTTP, FFI, or generated-language adapter.',
        getting_started_ja: 'NAIDEの初心者向け小規模プロジェクトを作成してください。アプリケーションの動作はすべて読みやすい.naideに実装し、JavaScript/TypeScriptへ置き換えたり.jsに重複実装したりしないでください。Webサイトは naide init <dir> --template web で作成し、naide dev <dir> で実行できます。page構文には入れ子要素、安全なHTML属性、フォームの記述があり、ブラウザー動作は naide:browser をimportした別の.naideクライアントモジュールに書けます。CSS/画像など静的アセットは利用できます。ユーザーが明示的に許可するまで、アプリの.js/.jsx/.mjs/.cjs/.ts/.tsxファイルやHTML内のJavaScriptを作成しないでください。NAIDEで要求機能を実現できない場合は、具体的な制約を説明してから、JS/TSブリッジを追加してよいかユーザーに確認してください。nidpackage.jsonが指定された場合はそれを保ち、明示依頼か確認済みの要件なしにpackage.json/package-lock.jsonを追加しないでください。手順を日本語で説明し、naide_checkと実際のWebビルドで確認してください。',
        verify_changes_ja: '依頼されたNAIDEの変更を確認し、変更した各.naideコードにはnaide_check、プロジェクトにはnaide_verifyを使ってください。これらはプロジェクトコードを実行しません。診断を説明し、依頼の範囲内だけ修正してください。明示的にコードやテストの実行を求められない限り、naide_runやnaide_testは使わないでください。',
        secure_service_ja: '認証が必要なルート、入力検証、環境変数での秘密情報管理、localhostへの開発用バインドを含むNAIDEサービスを設計し、日本語で検証手順も示してください。根拠なく安全性を断言しないでください。',
        polyglot_dependency_ja: 'この依存パッケージをNAIDEプロジェクトで使う方法を日本語で提案してください。言語と標準パッケージマネージャーを特定し、対応していればnaide pkg addを案内してください。異なる言語間の直接呼び出しを約束せず、プロセス・HTTP・FFI・生成コードなど明示的な境界を選んでください。',
        naide_first: 'Implement this request as a NAIDE-first project. Before coding, inspect existing files/manifests, call naide_context, consult the relevant spec, and list intended files. Put application behavior in readable .naide files. For a small website, use naide init <dir> --template web and naide dev <dir>; the page DSL supports nested elements and safe attributes, while browser behavior belongs in a .naide client module using naide:browser. CSS and media assets are allowed. Never create authored .js/.jsx/.mjs/.cjs/.ts/.tsx files, inline JavaScript, duplicate implementations, or JS bootstraps unless the user explicitly approves JavaScript. If a requested capability is unsupported, explain the concrete gap and ask before adding a JS/TS bridge. If nidpackage.json exists or is requested, preserve it and do not create package.json/package-lock.json unless explicitly requested or a verified requirement needs it. Generated compiler output belongs in build/, not as authored source. Run naide_check and a web build on changed website sources.',
        naide_coding_ja: 'まず既存ファイルとmanifestを確認し、作成予定ファイルを列挙してから着手してください。naide_contextと関連仕様を読み、アプリケーションの動作はすべて.naideに実装してください。Webサイトは naide init <dir> --template web で雛形を作り、naide dev <dir> でビルド・静的配信・ライブリロードできます。page構文は入れ子要素と安全な属性に対応し、ブラウザー動作は naide:browser を使う別の.naideクライアントモジュールに書きます。CSS/画像などは使えます。ユーザーの明示許可がない限り、アプリ用の.js/.jsx/.mjs/.cjs/.ts/.tsxファイル、HTML内JavaScript、JS重複実装、JSブートストラップを作らないでください。NAIDEで表現できない機能があれば具体的な制約を説明し、JS/TSブリッジを追加してよいかユーザーに確認してください。nidpackage.jsonがある場合は維持し、明示依頼や確認済み要件なしにpackage.json/package-lock.jsonを追加しないでください。生成コードはbuild/に出力し、ソース扱いしないでください。.naideを変更したらnaide_checkと naide dev で検証してください。',
        mws_discord_ja: 'MWSでNAIDE製Discord Botを作成してください。まずnaide_mws_discord_templateを呼び出し、返されたdiscord-bot.naideとnidpackage.jsonの2ファイルを作成してください。追加npmライブラリはnidpackage.jsonのdependenciesに追加し、.naideからNode/npmモジュールとしてimportしてください。manifestのmainはnode_modules/naider/bin/naide-host.js、naide.entryはdiscord-bot.naideです。MWSがnidpackage.jsonから依存をインストールしmainを実行するか確認してください。そうしない場合は起動ファイルにNAIDE host runnerを設定します。作成後naide_checkで確認し、BOT_TOKENはソースではなくMWSの秘密環境変数に設定してください。',
      };
      const prompt = prompts[msg.params?.name];
      if (!prompt) {
        respondError(msg.id, -32602, `Unknown prompt: ${msg.params?.name}`);
      } else {
        respond(msg.id, { description: prompt, messages: [{ role: 'user', content: { type: 'text', text: prompt } }] });
      }
      break;
    }

    case 'resources/list':
      respond(msg.id, {
        resources: [
          { uri: 'naide://spec', name: 'NAIDE language specification', mimeType: 'text/plain', description: 'Canonical NAIDE syntax and language reference.' },
          { uri: 'naide://ai-guide', name: 'NAIDE AI coding guide', mimeType: 'application/json', description: 'AI-oriented overview of NAIDE strengths, idioms, feature index, hosted Node.js setup, and MCP workflow.' },
          { uri: 'naide://knowledge', name: 'NAIDE knowledge catalog', mimeType: 'application/json', description: 'Searchable first-party documentation, examples, implementation coverage, and knowledge boundaries.' },
          { uri: 'naide://package-ecosystems', name: 'Native package ecosystems', mimeType: 'application/json', description: 'Supported NAIDE package manager adapters and interoperability guidance.' },
          { uri: 'naide://project', name: 'Current project diagnostics', mimeType: 'application/json', description: 'A read-only summary of project setup in the server working directory.' },
        ],
      });
      break;

    case 'resources/read': {
      const uri = msg.params?.uri;
      let text;
      let mimeType = 'text/plain';
      if (uri === 'naide://spec') {
        text = readFileSync(resolve(__dirname, '..', 'SPEC.naide'), 'utf-8');
      } else if (uri === 'naide://ai-guide') {
        mimeType = 'application/json';
        text = JSON.stringify(getAiGuide(), null, 2);
      } else if (uri === 'naide://knowledge') {
        mimeType = 'application/json';
        text = JSON.stringify(getKnowledgeCatalog(), null, 2);
      } else if (uri === 'naide://package-ecosystems') {
        mimeType = 'application/json';
        text = JSON.stringify({
          adapters: listPackageAdapters(),
          interoperability: 'A native package is not automatically callable from a different language runtime. Use an explicit process, HTTP, FFI, or generated-language adapter.',
        }, null, 2);
      } else if (uri === 'naide://project') {
        mimeType = 'application/json';
        text = JSON.stringify(inspectProject(process.cwd()), null, 2);
      } else {
        respondError(msg.id, -32602, `Unknown resource: ${uri}`);
        break;
      }
      respond(msg.id, { contents: [{ uri, mimeType, text }] });
      break;
    }

    case 'tools/call':
      try {
        const result = await handleToolCall(msg.params.name, msg.params.arguments || {});
        respond(msg.id, result);
      } catch (e) {
        respond(msg.id, {
          content: [{ type: 'text', text: e.message }],
          isError: true,
        });
      }
      break;

    case 'ping':
      respond(msg.id, {});
      break;

    default:
      if (msg.id !== undefined) {
        respondError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const lineEnd = buffer.indexOf('\n');
    if (lineEnd === -1) {
      if (buffer.length > 32 * 1024 * 1024) {
        process.stderr.write('MCP error: rejected oversized message\n');
        process.exit(1);
      }
      break;
    }
    if (lineEnd > 32 * 1024 * 1024) {
      process.stderr.write('MCP error: rejected oversized message\n');
      process.exit(1);
    }
    const body = buffer.toString('utf8', 0, lineEnd).replace(/\r$/, '');
    buffer = buffer.slice(lineEnd + 1);
    if (!body) continue;
    try {
      const message = JSON.parse(body);
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        respondError(null, -32600, 'Invalid Request');
        continue;
      }
      handleMessage(message).catch((error) => {
        process.stderr.write(`MCP request error: ${error.message}\n`);
        if (message.id !== undefined) respondError(message.id, -32603, 'Internal error');
      });
    } catch (e) {
      respondError(null, -32700, `Parse error: ${e.message}`);
    }
  }
});

process.stderr.write('NAIDE MCP Server running on stdio\n');
