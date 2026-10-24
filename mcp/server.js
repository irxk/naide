#!/usr/bin/env node

import { resolve, dirname, isAbsolute } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { checkNaideSource, getDoctorReport, inspectProject, listPackageAdapters, runProjectTests } from '../src/project-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromServer = createRequire(import.meta.url);
const packageVersion = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')).version;

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
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`);
  process.stdout.write(buf);
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
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      if (buffer.length > 8192) {
        process.stderr.write('MCP error: rejected oversized message header\n');
        process.exit(1);
      }
      break;
    }
    if (headerEnd > 8192) {
      process.stderr.write('MCP error: rejected oversized message header\n');
      process.exit(1);
    }
    const header = buffer.toString('ascii', 0, headerEnd);
    const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/i);
    if (!match) {
      process.stderr.write('MCP error: missing Content-Length header\n');
      process.exit(1);
    }
    const len = Number(match[1]);
    if (!Number.isSafeInteger(len) || len > 32 * 1024 * 1024) {
      process.stderr.write('MCP error: rejected oversized or invalid message body\n');
      process.exit(1);
    }
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = buffer.toString('utf8', bodyStart, bodyStart + len);
    buffer = buffer.slice(bodyStart + len);
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
