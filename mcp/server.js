#!/usr/bin/env node

import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let compileModule = null;
async function getCompiler() {
  if (!compileModule) {
    compileModule = await import(resolve(__dirname, '..', 'src', 'index.js'));
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
    description: 'Compile NAIDE code to a target language. NAIDE is an AI-optimized language that transpiles to 15 targets.',
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
  const { compile, compileAsync } = await getCompiler();

  switch (name) {
    case 'naide_compile': {
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
      try {
        const result = compile(args.code);
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        let output = '';
        const fakeConsole = { log: (...a) => { output += a.map(String).join(' ') + '\n'; }, error: (...a) => { output += a.map(String).join(' ') + '\n'; } };
        const fn = new AsyncFunction('console', result.js);
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
        const { generate } = await import(resolve(__dirname, '..', 'src', 'gen.js'));
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

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

async function handleMessage(msg) {
  switch (msg.method) {
    case 'initialize':
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'naide-mcp', version: '1.21.0' }
      });
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      respond(msg.id, { tools: TOOLS });
      break;

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

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
    const len = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = buffer.slice(bodyStart, bodyStart + len);
    buffer = buffer.slice(bodyStart + len);
    try {
      handleMessage(JSON.parse(body));
    } catch (e) {
      process.stderr.write(`Parse error: ${e.message}\n`);
    }
  }
});

process.stderr.write('NAIDE MCP Server running on stdio\n');
