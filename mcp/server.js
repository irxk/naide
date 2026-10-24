#!/usr/bin/env node

import { resolve, dirname, isAbsolute } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { checkNaideSource, getDoctorReport, inspectProject, listPackageAdapters, runProjectTests } from '../src/project-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromServer = createRequire(import.meta.url);
const packageVersion = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')).version;
const SPEC_PATH = resolve(__dirname, '..', 'SPEC.naide');
const HOSTED_EXAMPLE_DIRECTORY = resolve(__dirname, '..', 'examples', 'mws-discord');

const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/;
const NPM_VERSION_RANGE = /^[0-9A-Za-z.*^~<>=|+ -]{1,100}$/;

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
  const spec = readFileSync(SPEC_PATH, 'utf8');
  const headings = [...spec.matchAll(/^# ---- (.+?) ----$/gm)];
  const specSections = headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? spec.length;
    return { title: heading[1], content: spec.slice(start, end).trim().slice(0, 8000) };
  });
  const selectedSections = topic
    ? specSections.filter(section => section.title.toLowerCase().includes(topic.toLowerCase())).slice(0, 5)
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
    syntax: [
      'Declare values with str/int/bool/float or auto; use mut to make reassignment explicit.',
      'Use fn name(args) -> returnType: with indented body and ret for return.',
      'Use if/elif/else, each item in items:, and async fn/await for familiar control flow.',
      'Use use { readFile } from "node:fs/promises" for Node imports, and declare npm libraries in dependencies before importing them.',
      'NAIDE uses indentation and colons for blocks; consult SPEC.naide rather than translating JavaScript syntax mechanically.',
    ],
    efficientWorkflow: [
      'Call naide_context with a topic when you need feature or syntax guidance.',
      'Read the matching SPEC.naide section or a relevant canonical example before writing unfamiliar constructs.',
      'Write the smallest complete .naide implementation and use naide_check on it.',
      'Use naide_compile to inspect generated code only when the host/runtime boundary needs diagnosis.',
      'Use naide_run or naide_test only when execution is requested and the project is trusted.',
    ],
    hostedNode: {
      manifest: 'nidpackage.json',
      uploadFiles: ['the .naide entry file', 'nidpackage.json'],
      main: 'node_modules/naider/bin/naide-host.js',
      entryField: 'naide.entry',
      dependenciesField: 'dependencies',
      limitation: 'The host must install npm dependencies from nidpackage.json and launch its main entry. Hosts that hard-code node <file>.naide without using this main/runner contract must add NAIDE loader support themselves.',
    },
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
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const TOOLS = [
  {
    name: 'naide_compile',
    description: 'Compile readable NAIDE source code to a target language.',
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
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'naide_generate',
    description: 'Generate NAIDE code from a natural language instruction. No AI — uses pattern matching and template composition with self-healing parser validation. Extremely lightweight, runs in microseconds.',
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
    description: 'Create a nidpackage.json for any hosted Node.js NAIDE application. It configures the NAIDE host runner as main, sets the .naide entry, and adds compatible npm dependencies.',
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
    description: 'Fast, structured NAIDE language and workflow context for AI coding. Returns design strengths, feature index, safe workflow, hosted Node.js contract, and available MCP tools. Call before implementing unfamiliar NAIDE work.',
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
    inputSchema: { type: 'object', properties: {} }
  }
];

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

    case 'naide_spec': {
      try {
        let spec = readFileSync(resolve(__dirname, '..', 'SPEC.naide'), 'utf-8');
        if (args.section) {
          const s = args.section.toLowerCase();
          const lines = spec.split('\n');
          const chunks = [];
          let capturing = false;
          for (const line of lines) {
            if (line.startsWith('# ---- ') && line.toLowerCase().includes(s)) capturing = true;
            else if (line.startsWith('# ---- ') && capturing) break;
            if (capturing) chunks.push(line);
          }
          if (chunks.length > 0) spec = chunks.join('\n');
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
  switch (msg.method) {
    case 'initialize':
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, prompts: {}, resources: {} },
        serverInfo: { name: 'naide-mcp', version: packageVersion }
      });
      break;

    case 'notifications/initialized':
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
          { name: 'getting_started_ja', description: '日本語でNAIDEの小さなプロジェクトを作成して確認する。' },
          { name: 'verify_changes_ja', description: 'AIが変更したNAIDEコードを実行せずに検査する。' },
          { name: 'secure_service_ja', description: '認証と安全な初期設定を備えたサービスを設計する。' },
          { name: 'polyglot_dependency_ja', description: '他言語パッケージの導入方法と明示的な連携方法を検討する。' },
          { name: 'naide_coding_ja', description: 'NAIDEの仕様と強みを踏まえ、実装・確認を高速に進める。' },
          { name: 'mws_discord_ja', description: 'MWSでNAIDE Discord Botを2ファイル構成で実行する。' },
        ],
      });
      break;

    case 'prompts/get': {
      const prompts = {
        getting_started: 'Help me create a small NAIDE project. Prefer readable .naide source, explain each step, and finish by running naide doctor and naide verify.',
        verify_changes: 'Review the requested NAIDE changes, then use naide_check on each changed .naide source and naide_verify on the project. These checks do not execute project code. Explain every diagnostic and fix only issues in scope. Do not use naide_run or naide_test unless I explicitly ask you to execute code or tests.',
        secure_service: 'Help me design a secure NAIDE service. Use authentication for sensitive routes, validate input, keep secrets in environment variables, bind development servers to localhost, and provide concrete verification steps. Do not claim security without evidence.',
        polyglot_dependency: 'Help me use this dependency from NAIDE. First identify its native language and package manager, then explain installation with naide pkg add where supported. Do not imply direct cross-language calls: select and explain an explicit process, HTTP, FFI, or generated-language adapter.',
        getting_started_ja: 'NAIDEの初心者向け小規模プロジェクトを作成してください。読みやすい.naideコードを使い、手順を日本語で説明し、最後にnaide doctorとnaide verifyで確認してください。',
        verify_changes_ja: '依頼されたNAIDEの変更を確認し、変更した各.naideコードにはnaide_check、プロジェクトにはnaide_verifyを使ってください。これらはプロジェクトコードを実行しません。診断を説明し、依頼の範囲内だけ修正してください。明示的にコードやテストの実行を求められない限り、naide_runやnaide_testは使わないでください。',
        secure_service_ja: '認証が必要なルート、入力検証、環境変数での秘密情報管理、localhostへの開発用バインドを含むNAIDEサービスを設計し、日本語で検証手順も示してください。根拠なく安全性を断言しないでください。',
        polyglot_dependency_ja: 'この依存パッケージをNAIDEプロジェクトで使う方法を日本語で提案してください。言語と標準パッケージマネージャーを特定し、対応していればnaide pkg addを案内してください。異なる言語間の直接呼び出しを約束せず、プロセス・HTTP・FFI・生成コードなど明示的な境界を選んでください。',
        naide_coding_ja: 'まずnaide_contextを呼び、必要に応じてtopicで仕様を絞り込んでください。NAIDEの簡潔な構文、型検査、Node/npm連携、組み込み機能を活用しつつ、仕様や実装状況を確認せずに機能対応を断言しないでください。小さく読みやすい.naide実装を作り、naide_checkで検査して診断を修正してください。実行やテストはユーザーが依頼した場合に行い、コンパイルターゲット間の機能差も明示してください。',
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
        respondError(msg.id, -32000, e.message);
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
