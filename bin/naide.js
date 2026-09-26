#!/usr/bin/env node

import { readFileSync, writeFileSync, unlinkSync, watch as fsWatch, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, basename, extname, join, relative } from 'path';
import { compile, compileAsync } from '../src/index.js';
import { spawn } from 'child_process';

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

const NAIDE_VERSION = '1.23.0';

function crashReport(err, context = {}) {
  const info = [
    `NAIDE v${NAIDE_VERSION}`,
    `Node ${process.version}`,
    `${process.platform} ${process.arch}`,
  ];
  if (context.file) info.push(`File: ${context.file}`);
  if (context.target) info.push(`Target: ${context.target}`);

  console.error(`\n  ┌─ NAIDE Internal Error ───────────────────────────`);
  console.error(`  │ ${err.message}`);
  console.error(`  │`);
  console.error(`  │ ${info.join(' | ')}`);
  if (err.stack) {
    const frames = err.stack.split('\n').slice(1, 4).map(l => l.trim());
    for (const f of frames) console.error(`  │   ${f}`);
  }
  console.error(`  │`);
  console.error(`  │ This is a compiler bug, not a syntax error.`);
  console.error(`  │ Report: https://github.com/irxk/naide/issues/new`);
  console.error(`  │   Include the .naide file and the info above.`);
  console.error(`  └──────────────────────────────────────────────────\n`);
}

process.on('uncaughtException', (err) => {
  crashReport(err);
  process.exit(99);
});

process.on('unhandledRejection', (reason) => {
  crashReport(reason instanceof Error ? reason : new Error(String(reason)));
  process.exit(99);
});

function checkDependencies(jsCode) {
  const depMap = {
    "from 'express'": { pkg: 'express', reason: 'server' },
    "from 'better-sqlite3'": { pkg: 'better-sqlite3', reason: 'db.sql "sqlite"' },
    "from 'pg'": { pkg: 'pg', reason: 'db.sql "postgres"' },
    "from 'ws'": { pkg: 'ws', reason: 'WebSocket (ws)' },
  };
  const missing = [];
  for (const [pattern, info] of Object.entries(depMap)) {
    if (jsCode.includes(pattern)) {
      try { _require.resolve(info.pkg); } catch {
        missing.push(info);
      }
    }
  }
  if (missing.length > 0) {
    console.log('\n  [NAIDE] Missing dependencies detected:\n');
    for (const m of missing) {
      console.log(`    npm install ${m.pkg}    # required for: ${m.reason}`);
    }
    console.log(`\n  Run: npm install ${missing.map(m => m.pkg).join(' ')}\n`);
  }
}

function remapError(err, sourceMap, sourceFile, sourceCode) {
  if (!err.stack || !sourceMap || sourceMap.length === 0) return;
  const lines = sourceCode.split('\n');
  const tempPattern = /\.naide_tmp_[^:]+\.mjs:(\d+)/g;
  let match;
  const remapped = [];
  while ((match = tempPattern.exec(err.stack)) !== null) {
    const jsLine = parseInt(match[1]) - 1;
    const srcLine = sourceMap[jsLine];
    if (srcLine && srcLine > 0) {
      remapped.push(srcLine);
    }
  }
  if (remapped.length > 0) {
    const srcLine = remapped[0];
    const context = [];
    const start = Math.max(0, srcLine - 3);
    const end = Math.min(lines.length, srcLine + 2);
    for (let i = start; i < end; i++) {
      const marker = i + 1 === srcLine ? ' >> ' : '    ';
      context.push(`${marker}${i + 1} | ${lines[i]}`);
    }
    console.error(`\n  [NAIDE Error] ${sourceFile}:${srcLine}\n`);
    console.error(context.join('\n'));
    console.error(`\n  ${err.message}\n`);
    return true;
  }
  return false;
}

const args = process.argv.slice(2);

const flags = {
  run: true,
  emit: false,
  ast: false,
  tokens: false,
  output: null,
  help: false,
  mode: null,
  mid: false,
  watch: false,
  debug: false,
  check: false,
  target: 'node',
  expand: false,
  project: false,
  write: null,
  replace: false,
};

const files = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '--emit': case '-e': flags.emit = true; flags.run = false; break;
    case '--ast': flags.ast = true; flags.run = false; break;
    case '--tokens': flags.tokens = true; flags.run = false; break;
    case '--output': case '-o': flags.output = args[++i]; break;
    case '--help': case '-h': flags.help = true; break;
    case '--x': case '-x': flags.mode = 'x'; break;
    case '--mid': flags.mid = true; flags.run = false; break;
    case '--watch': case '-w': flags.watch = true; break;
    case '--debug': case '-d': flags.debug = true; break;
    case '--check': flags.check = true; flags.run = false; break;
    case '--target': case '-t': flags.target = args[++i]; break;
    case '--expand': flags.expand = true; flags.run = false; break;
    case '--project': case '-p': flags.project = true; break;
    case '--write': flags.write = args[++i]; break;
    case '--replace': flags.replace = true; break;
    default: files.push(arg);
  }
}

// ── Code Generator (~~) ──
if (files[0] === 'gen' || files[0] === '~~') {
  const instruction = files.slice(1).join(' ');
  if (!instruction) {
    console.log(`
  NAIDE Agent Coder (~~)

  Usage:
    naide ~~ "REST API for users with auth"
    naide gen "todo app with database"
    naide gen "users and products and orders with auth"
    naide ~~ "ECサイト" --project

  Autonomous code generator with analysis, multi-entity support,
  relationship detection, and full auth routes. No AI, no network.

  Examples:
    naide ~~ "REST API for products with name price stock"
    naide ~~ "users and products with auth"            # multi-entity
    naide ~~ "SNS app"                                 # User+Post+Comment
    naide ~~ "ECサイト"                                 # User+Product+Order
    naide ~~ "予約システム"                              # User+Reservation
    naide ~~ "Discord bot with hello and help commands"
    naide ~~ "ユーザーと商品と注文の管理APIを認証付きで"   # JP multi-entity

  Project Mode (--project):
    naide ~~ "e-commerce app with auth" --project
    # Creates: app.naide, package.json, .env, .gitignore,
    #          Dockerfile, .dockerignore, README.md, openapi.json,
    #          admin.html, client.mjs

  Update existing project (re-run --project in same dir):
    naide ~~ "add users with auth" --project -o my-app
    naide ~~ "add products" --project -o my-app
    # Merges new entities, regenerates all supporting files

  File Write Mode:
    naide ~~ "add auth" app.naide              # merge into existing file
    naide ~~ "add websocket" --write app.naide # explicit --write
    naide ~~ "REST API" --write app.naide --replace  # overwrite file

  In .naide files:
    ~~ "REST API for users with auth"
    # Expands at compile time to full NAIDE code

  Debug:
    naide --expand app.naide     Show ~~ expansion results

  API:
    import { generate, generateProject, writeToFile } from 'naider';
    const result = generate("users and products with auth");
    console.log(result.analysis);  // agent analysis
    console.log(result.entities);  // ['User', 'Product']
    writeToFile("app.naide", "add auth");  // merge into file

  ── Keyword Cheat Sheet ──────────────────────────────────────

  Intent     server, api, rest, bot, cli, page, test, database,
             ai, crud, auth, websocket, mail, graphql
  Composite  todo, blog, chat, shop, fullstack, board,
             crm, inventory, booking, sns
  Platform   discord, slack, telegram, line
  DB Type    sqlite, postgres
  JP Intent  サーバー, 認証, ログイン, 会員, CRUD, 管理, データベース,
             ボット, テスト, ページ, メール, リアルタイム
  JP Entity  ユーザー, 商品, 記事, タスク, 注文, コメント, イベント,
             問い合わせ, 通知, カテゴリ, プロジェクト, 掲示板, 決済
  Fields     "with name email age" — auto-inferred types & validators
  Field Alias  e-mail→email, pwd→password, tel→phone, desc→description
  Relations  Auto-detected: User→Post, User→Order, Product→Order, etc.

  ────────────────────────────────────────────────────────────
`);
    process.exit(0);
  }

  const { generate, generateProject, updateProject, writeToFile } = await import('../src/gen.js');

  // Write mode: inject into existing .naide/.nx file
  const targetFile = instruction.match(/\S+\.(?:naide|nx)$/)?.[0];
  if (targetFile || flags.write) {
    const file = flags.write || targetFile;
    const cleanInstruction = targetFile ? instruction.replace(/\s+\S+\.(?:naide|nx)$/, '') : instruction;
    const mode = flags.replace ? 'replace' : 'append';
    const result = writeToFile(resolve(file), cleanInstruction, { mode });
    const a = result.analysis;
    process.stderr.write('\n  ── NAIDE Agent ──────────────────────────────────────────\n');
    process.stderr.write(`  Input:    "${a.instruction}"\n`);
    process.stderr.write(`  Action:   ${result.action} → ${file}\n`);
    if (a.entities.length > 0) {
      process.stderr.write(`  Entities: ${a.entities.map(e => `${e.name} (${e.fieldCount} fields)`).join(', ')}\n`);
    }
    process.stderr.write('  ────────────────────────────────────────────────────────\n\n');
    console.log(result.code);
    process.stderr.write(`  ── ${result.action}: ${file} (valid: ${result.valid}) ──\n`);
    process.exit(0);
  }

  // Project mode: generate or update project directory
  if (flags.project) {
    const isCurrentDir = instruction === '.' || instruction === './';
    let dir, result;

    if (isCurrentDir) {
      // naide gen . --project  → update current directory
      dir = '.';
      const outDir = resolve(dir);
      if (!existsSync(resolve(outDir, 'app.naide'))) {
        process.stderr.write('  Error: no app.naide found in current directory.\n');
        process.stderr.write('  Use naide ~~ "instruction" --project to create a new project.\n');
        process.exit(1);
      }
      process.stderr.write('  Error: use naide ~~ "instruction" --project in an existing project dir to update.\n');
      process.exit(1);
    }

    const primaryGuess = instruction.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'app';
    dir = flags.output || (primaryGuess + '-app');
    const outDir = resolve(dir);
    const isUpdate = existsSync(resolve(outDir, 'app.naide'));

    if (isUpdate) {
      result = updateProject(outDir, instruction);
    } else {
      result = generateProject(instruction);
    }

    const primaryName = (result.entities[0] || 'app').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!flags.output && !isUpdate) dir = primaryName + '-app';
    const finalDir = resolve(dir);
    if (!existsSync(finalDir)) mkdirSync(finalDir, { recursive: true });
    for (const f of result.files) {
      const fp = resolve(finalDir, f.path);
      writeFileSync(fp, f.content, 'utf-8');
    }
    const a = result.analysis;
    const mode = result.action === 'removed' ? 'Removed' : isUpdate ? 'Updated' : 'Created';
    process.stderr.write(`\n  ── NAIDE Agent (${mode}) ────────────────────────────────\n`);
    process.stderr.write(`  Input:    "${a.instruction || instruction}"\n`);
    if (a.entities.length > 0) {
      process.stderr.write(`  Entities: ${a.entities.map(e => `${e.name} (${e.fieldCount} fields)`).join(', ')}\n`);
    }
    if (a.relationships && a.relationships.length > 0) {
      for (const r of a.relationships) process.stderr.write(`  Relation: ${r.parent} 1→N ${r.child} (${r.fk})\n`);
    }
    if (result.removed && result.removed.length > 0) {
      process.stderr.write(`  Removed:  ${result.removed.join(', ')}\n`);
    }
    if (a.added && a.added.length > 0) {
      process.stderr.write(`  Added:    ${a.added.join(', ')}\n`);
    }
    process.stderr.write(`  Plan:\n`);
    for (const step of a.plan) process.stderr.write(`    + ${step}\n`);
    process.stderr.write(`  Files:    ${result.files.length} generated\n`);
    process.stderr.write('  ────────────────────────────────────────────────────────\n\n');
    console.log(`  Project ${mode.toLowerCase()}: ${dir}/`);
    for (const f of result.files) console.log(`    ${f.path}`);
    if (!isUpdate) console.log(`\n  cd ${dir} && npm install && npm run dev\n`);
    else console.log(`\n  Files regenerated. Run: npm run dev\n`);
    process.exit(0);
  }

  const result = generate(instruction);

  if (flags.output) {
    writeFileSync(flags.output, result.code, 'utf-8');
    console.log(`  Generated: ${flags.output} (${result.intents.join(' + ')})`);
  } else {
    // Agent-style analysis header
    const a = result.analysis;
    process.stderr.write('\n  ── NAIDE Agent ──────────────────────────────────────────\n');
    process.stderr.write(`  Input:    "${a.instruction}"\n`);
    if (a.entities.length > 0) {
      process.stderr.write(`  Entities: ${a.entities.map(e => `${e.name} (${e.fieldCount} fields)`).join(', ')}\n`);
    }
    if (a.relationships.length > 0) {
      for (const r of a.relationships) {
        process.stderr.write(`  Relation: ${r.parent} 1→N ${r.child} (${r.fk})\n`);
      }
    }
    process.stderr.write(`  Plan:\n`);
    for (const step of a.plan) {
      process.stderr.write(`    + ${step}\n`);
    }
    process.stderr.write('  ────────────────────────────────────────────────────────\n\n');

    console.log(result.code);

    const meta = [`[${result.intents.join(' + ')}]`];
    if (result.entities && result.entities.length > 1) {
      meta.push(`→ ${result.entities.join(', ')}`);
    } else if (result.schema) {
      meta.push(`→ ${result.schema}`);
    }
    meta.push(`valid: ${result.valid}`);
    if (result.fixed) meta.push('(auto-fixed)');
    process.stderr.write(`  ── gen ~~ ${meta.join(' ')} ──\n`);
    if (result.repairs.length > 0) {
      process.stderr.write('  Repairs:\n');
      for (const r of result.repairs) process.stderr.write(`    - ${r}\n`);
    }
    if (result.suggestion) {
      process.stderr.write(`\n${result.suggestion}\n`);
    }
  }
  process.exit(0);
}

// ── Expand Debug ──
if (flags.expand && files.length > 0) {
  const { expandDirectives } = await import('../src/gen.js');
  for (const file of files) {
    const filePath = resolve(file);
    const source = readFileSync(filePath, 'utf-8');
    const { source: expanded, expanded: didExpand } = expandDirectives(source);
    if (didExpand) {
      console.log(`  ── ${file} (expanded) ──\n`);
      console.log(expanded);
    } else {
      console.log(`  ${file}: no ~~ directives found`);
    }
  }
  process.exit(0);
}

// ── VS Code Extension Install ──
if (files[0] === 'vscode') {
  const os = await import('os');
  const extSrc = new URL('../vscode-naide', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const extName = 'irxk.naide-lang-1.1.0';
  const extDir = join(os.homedir(), '.vscode', 'extensions', extName);

  if (existsSync(extDir)) {
    console.log(`\n  NAIDE VS Code extension already installed at:\n  ${extDir}\n`);
    console.log('  To reinstall, delete the folder and run again.');
    process.exit(0);
  }

  const copyDir = (src, dest) => {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      if (statSync(srcPath).isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        writeFileSync(destPath, readFileSync(srcPath));
      }
    }
  };

  try {
    copyDir(extSrc, extDir);
    console.log(`\n  NAIDE VS Code extension installed!

  Location: ${extDir}

  Restart VS Code to activate.
  Features: syntax highlighting, LSP diagnostics, autocomplete, hover docs
`);
  } catch (e) {
    console.error(`  Error: ${e.message}`);
    console.log('\n  Manual install: copy vscode-naide/ to ~/.vscode/extensions/irxk.naide-lang-1.1.0/');
    process.exit(1);
  }
  process.exit(0);
}

// ── LSP ──
if (files[0] === 'lsp') {
  await import('../lsp/server.js');
  await new Promise(() => {});
}

// ── REPL ──
if (files[0] === 'repl' || (files.length === 0 && !flags.help)) {
  const { createInterface } = await import('readline');
  const { transpile } = await import('../src/index.js');

  console.log(`\n  NAIDE REPL v1.11.0 — type NAIDE code, see JavaScript output`);
  console.log(`  Type .exit to quit, .eval to toggle eval mode\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '>>> ',
  });

  let buffer = '';
  let inBlock = false;
  let evalMode = false;
  const evalContext = {};

  function processInput(code) {
    try {
      const js = transpile(code)
        .split('\n')
        .filter(l => !l.startsWith('import '))
        .join('\n')
        .trim();

      if (!js) return;

      if (evalMode) {
        const evalCode = js.replace(/\bconst\b/g, 'let');
        try {
          const result = (new Function('ctx', `with(ctx){${evalCode}; return typeof __last !== 'undefined' ? __last : undefined}`))(evalContext);
          if (result !== undefined) console.log(result);
        } catch (e) {
          try { (new Function('ctx', `with(ctx){${evalCode}}`))(evalContext); } catch (e2) { console.error(`  Error: ${e2.message}`); }
        }
      } else {
        console.log(js);
      }
    } catch (e) {
      console.error(`  ${e.message.split('\n')[0]}`);
    }
  }

  rl.prompt();
  rl.on('line', (line) => {
    if (line.trim() === '.exit') { rl.close(); process.exit(0); }
    if (line.trim() === '.eval') {
      evalMode = !evalMode;
      console.log(`  Eval mode: ${evalMode ? 'ON' : 'OFF'}`);
      rl.prompt();
      return;
    }

    if (inBlock) {
      if (line.trim() === '' && buffer.trim()) {
        processInput(buffer);
        buffer = '';
        inBlock = false;
        rl.setPrompt('>>> ');
      } else {
        buffer += '\n' + line;
        rl.prompt();
        return;
      }
    } else if (line.trim().endsWith(':') && !line.trim().startsWith('#')) {
      buffer = line;
      inBlock = true;
      rl.setPrompt('... ');
    } else if (line.trim()) {
      processInput(line);
    }
    rl.prompt();
  });

  rl.on('close', () => process.exit(0));

  // Keep the process running
  await new Promise(() => {});
}

// ── Format ──
if (files[0] === 'fmt') {
  const targets = files.slice(1);
  if (targets.length === 0) {
    console.log('  Usage: naide fmt <file.naide> [file2.naide ...]');
    process.exit(0);
  }

  for (const file of targets) {
    const filePath = resolve(file);
    try {
      const source = readFileSync(filePath, 'utf-8');
      const lines = source.split('\n');
      const result = [];
      let prevEmpty = false;

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (trimmed === '') {
          if (!prevEmpty) result.push('');
          prevEmpty = true;
          continue;
        }
        prevEmpty = false;

        const indent = line.match(/^(\s*)/)[1];
        const content = line.trimStart();
        const level = Math.round(indent.length / 2);
        let formatted = '  '.repeat(level) + content;

        // Remove trailing whitespace
        formatted = formatted.trimEnd();

        result.push(formatted);
      }

      // Remove trailing empty lines
      while (result.length > 0 && result[result.length - 1] === '') result.pop();
      const formatted = result.join('\n') + '\n';

      if (formatted !== source) {
        writeFileSync(filePath, formatted, 'utf-8');
        console.log(`  formatted: ${file}`);
      } else {
        console.log(`  unchanged: ${file}`);
      }
    } catch (e) {
      console.error(`  Error: ${file} — ${e.message}`);
    }
  }
  process.exit(0);
}

if (files[0] === 'init') {
  const dir = files[1] ? resolve(files[1]) : process.cwd();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const name = basename(dir === process.cwd() ? dir : dir);

  if (!existsSync(resolve(dir, 'package.json'))) {
    writeFileSync(resolve(dir, 'package.json'), JSON.stringify({
      name, version: '1.0.0', type: 'module',
      scripts: { start: 'naide app.naide', dev: 'naide -w app.naide', build: 'naide --emit app.naide -o dist/app.mjs' },
      dependencies: { naider: '^1.9.0' }
    }, null, 2) + '\n');
  }

  if (!existsSync(resolve(dir, 'app.naide'))) {
    writeFileSync(resolve(dir, 'app.naide'), `db "data/"

env:
  PORT int default(3000)

schema Item:
  id auto
  name str required min(1) max(100)
  done bool default(false)

server app port PORT:
  cors "*"
  cookie
  static "/public"
  crud "/api/items" Item

  get "/":
    ret.text "NAIDE server running"

  get "/api/health":
    ret {status: "ok", items: ItemStore.count()}
`);
  }

  if (!existsSync(resolve(dir, 'public'))) mkdirSync(resolve(dir, 'public'), { recursive: true });

  console.log(`\n  NAIDE project initialized!

  ${dir === process.cwd() ? '' : `  cd ${basename(dir)}\n`}  npm install
  npm run dev
`);
  process.exit(0);
}

if (files[0] === 'build') {
  const dir = resolve(files[1] || '.');
  const outDir = files[2] ? resolve(files[2]) : null;

  function walkDir(d) {
    const found = [];
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
        found.push(...walkDir(full));
      } else if (entry.endsWith('.naide') || entry.endsWith('.nx')) {
        found.push(full);
      }
    }
    return found;
  }

  const sourceFiles = walkDir(dir);
  if (sourceFiles.length === 0) {
    console.log('  No .naide or .nx files found.');
    process.exit(0);
  }

  console.log(`\n  NAIDE build — ${sourceFiles.length} file(s)\n`);
  let errors = 0;
  const schemaMap = {};
  const routeMap = {};

  for (const srcFile of sourceFiles) {
    const rel = relative(dir, srcFile);
    const mode = srcFile.endsWith('.nx') ? 'x' : 'naide';
    try {
      const source = readFileSync(srcFile, 'utf-8');
      const { js, ast } = compile(source, { mode });
      const outName = rel.replace(/\.(naide|nx)$/, '.mjs');
      const outPath = outDir ? join(outDir, outName) : join(dir, outName);
      const outDirPath = resolve(outPath, '..');
      if (!existsSync(outDirPath)) mkdirSync(outDirPath, { recursive: true });
      writeFileSync(outPath, js);
      console.log(`  ${rel} → ${outDir ? join(relative('.', outDir), outName) : outName}`);

      if (ast && ast.body) {
        for (const node of ast.body) {
          if (node.type === 'SchemaDecl' && node.name) {
            (schemaMap[node.name] = schemaMap[node.name] || []).push(rel);
          }
          if (node.type === 'Server' && node.routes) {
            for (const s of node.routes) {
              if (s.type === 'CrudDecl' && s.path) {
                const key = `CRUD ${s.path.raw || s.path}`;
                (routeMap[key] = routeMap[key] || []).push(rel);
              }
              if (s.type === 'Route' && s.path) {
                const key = `${(s.method || 'get').toUpperCase()} ${s.path.raw || s.path}`;
                (routeMap[key] = routeMap[key] || []).push(rel);
              }
            }
          }
        }
      }
    } catch (e) {
      const isSyntaxErr = e.message.includes('line ') || e.message.includes('Unexpected') || e.message.includes('Expected');
      if (isSyntaxErr) {
        console.error(`  FAIL ${rel}: ${e.message.split('\n')[0]}`);
      } else {
        crashReport(e, { file: rel });
      }
      errors++;
    }
  }

  let warnings = 0;
  for (const [name, files] of Object.entries(schemaMap)) {
    if (files.length > 1) {
      console.error(`  WARN: schema "${name}" defined in ${files.length} files: ${files.join(', ')}`);
      warnings++;
    }
  }
  for (const [route, files] of Object.entries(routeMap)) {
    if (files.length > 1) {
      console.error(`  WARN: route ${route} defined in ${files.length} files: ${files.join(', ')}`);
      warnings++;
    }
  }

  console.log(`\n  Done. ${sourceFiles.length - errors} compiled, ${errors} failed${warnings > 0 ? `, ${warnings} warning(s)` : ''}.`);
  process.exit(errors > 0 ? 1 : 0);
}

// ── Convert (NX ↔ NAIDE) ──
if (files[0] === 'convert') {
  const targets = files.slice(1);
  if (targets.length === 0) {
    console.log('  Usage: naide convert <file.nx|file.naide>');
    console.log('    .nx → .naide    Expand NX shorthand to readable NAIDE');
    console.log('    .naide → .nx    Compress NAIDE to AI-optimized NX');
    process.exit(0);
  }

  for (const file of targets) {
    const filePath = resolve(file);
    const ext = extname(file);
    try {
      const source = readFileSync(filePath, 'utf-8');

      if (ext === '.nx') {
        const { preprocess } = await import('../src/preprocess.js');
        const naide = preprocess(source);
        const outPath = filePath.replace(/\.nx$/, '.naide');
        writeFileSync(outPath, naide);
        console.log(`  ${file} → ${basename(outPath)}`);
      } else if (ext === '.naide') {
        const lines = source.split('\n');
        const nxLines = [];
        for (const line of lines) {
          let nx = line;
          nx = nx.replace(/^(\s*)#\s?(.*)/, '$1-- $2');
          nx = nx.replace(/^(\s*)fn\.async\s+/, '$1~f ');
          nx = nx.replace(/^(\s*)fn\s+/, '$1f ');
          nx = nx.replace(/^(\s*)use\s+\{(.+?)\}\s+from\s+/, '$1<{$2}');
          nx = nx.replace(/^(\s*)use\s+/, '$1<');
          nx = nx.replace(/\bret\b/, '>');
          nx = nx.replace(/\beach\s+(\w+)\s+in\s+/, '@$1<');
          nx = nx.replace(/\bawait\s+/, '~');
          nx = nx.replace(/\bstr\b/g, 's');
          nx = nx.replace(/\bint\b/g, 'i');
          nx = nx.replace(/\bnum\b/g, 'n');
          nx = nx.replace(/\bbool\b/g, 'b');
          nx = nx.replace(/\blist\b/g, 'l');
          nx = nx.replace(/\bmap\b/g, 'm');
          nx = nx.replace(/\bany\b/g, 'a');
          nx = nx.replace(/\bconsole\.log\b/, 'log');
          nxLines.push(nx);
        }
        const outPath = filePath.replace(/\.naide$/, '.nx');
        writeFileSync(outPath, nxLines.join('\n'));
        console.log(`  ${file} → ${basename(outPath)}`);
      } else {
        console.error(`  Unsupported: ${file} (use .naide or .nx)`);
      }
    } catch (e) {
      console.error(`  Error: ${file} — ${e.message}`);
    }
  }
  process.exit(0);
}

// ── Type Check ──
if (files[0] === 'check') {
  const targets = files.slice(1);
  if (targets.length === 0) {
    console.log('  Usage: naide check <file.naide|file.nx> [files...]');
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  for (const file of targets) {
    const filePath = resolve(file);
    try {
      const source = readFileSync(filePath, 'utf-8');
      const ext = extname(file);
      const mode = ext === '.nx' ? 'x' : 'naide';
      const result = compile(source, { mode, typeCheck: true });
      const { typeErrors } = result;

      if (typeErrors) {
        for (const e of typeErrors.errors) {
          console.log(`  ${file}:${e.line} ERROR: ${e.message}`);
          totalErrors++;
        }
        for (const w of typeErrors.warnings) {
          console.log(`  ${file}:${w.line} WARN: ${w.message}`);
          totalWarnings++;
        }
      }

      if (!typeErrors || (typeErrors.errors.length === 0 && typeErrors.warnings.length === 0)) {
        console.log(`  ${file}: OK`);
      }
    } catch (e) {
      console.error(`  ${file}: ${e.message.split('\n')[0]}`);
      totalErrors++;
    }
  }

  console.log(`\n  ${totalErrors} error(s), ${totalWarnings} warning(s)`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

// ── Package Ecosystem ──
if (files[0] === 'pkg') {
  const subcmd = files[1];

  if (!subcmd || subcmd === 'help') {
    console.log(`
  NAIDE Package Manager

  Usage:
    naide pkg init                Create naide.pkg.json manifest
    naide pkg install <name>      Install a NAIDE package from npm
    naide pkg publish             Publish current package to npm
    naide pkg list                List installed NAIDE packages
`);
    process.exit(0);
  }

  const pkgManifestPath = resolve('naide.pkg.json');

  if (subcmd === 'init') {
    if (existsSync(pkgManifestPath)) {
      console.log('  naide.pkg.json already exists.');
      process.exit(0);
    }
    const npmPkgPath = resolve('package.json');
    let name = 'my-naide-pkg';
    if (existsSync(npmPkgPath)) {
      try { name = JSON.parse(readFileSync(npmPkgPath, 'utf-8')).name || name; } catch {}
    }
    const manifest = {
      name,
      version: '1.0.0',
      description: '',
      main: 'index.naide',
      keywords: ['naide', 'naide-plugin'],
      exports: {},
      dependencies: {},
    };
    writeFileSync(pkgManifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\n  Created naide.pkg.json\n`);
    process.exit(0);
  }

  if (subcmd === 'install') {
    const pkgName = files[2];
    if (!pkgName) {
      console.log('  Usage: naide pkg install <package-name>');
      process.exit(1);
    }

    console.log(`  Installing ${pkgName}...`);
    const child = spawn('npm', ['install', pkgName], { stdio: 'inherit', shell: true });
    child.on('close', (code) => {
      if (code === 0) {
        if (existsSync(pkgManifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(pkgManifestPath, 'utf-8'));
            const npmPkg = resolve('node_modules', pkgName, 'package.json');
            if (existsSync(npmPkg)) {
              const ver = JSON.parse(readFileSync(npmPkg, 'utf-8')).version;
              manifest.dependencies[pkgName] = `^${ver}`;
              writeFileSync(pkgManifestPath, JSON.stringify(manifest, null, 2) + '\n');
            }
          } catch {}
        }
        console.log(`\n  Installed ${pkgName}`);
      }
      process.exit(code);
    });
    await new Promise(() => {});
  }

  if (subcmd === 'publish') {
    if (!existsSync(pkgManifestPath)) {
      console.log('  No naide.pkg.json found. Run: naide pkg init');
      process.exit(1);
    }

    const manifest = JSON.parse(readFileSync(pkgManifestPath, 'utf-8'));
    const npmPkgPath = resolve('package.json');
    if (!existsSync(npmPkgPath)) {
      writeFileSync(npmPkgPath, JSON.stringify({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        type: 'module',
        main: manifest.main,
        keywords: manifest.keywords,
        files: ['*.naide', '*.nx', 'src/', 'naide.pkg.json'],
      }, null, 2) + '\n');
    }

    console.log(`  Publishing ${manifest.name}@${manifest.version}...`);
    const child = spawn('npm', ['publish', '--access', 'public'], { stdio: 'inherit', shell: true });
    child.on('close', (code) => {
      if (code === 0) console.log(`\n  Published ${manifest.name}@${manifest.version}`);
      process.exit(code);
    });
    await new Promise(() => {});
  }

  if (subcmd === 'list') {
    if (!existsSync(pkgManifestPath)) {
      console.log('  No naide.pkg.json found.');
      process.exit(0);
    }
    const manifest = JSON.parse(readFileSync(pkgManifestPath, 'utf-8'));
    const deps = Object.entries(manifest.dependencies || {});
    if (deps.length === 0) {
      console.log('  No NAIDE packages installed.');
    } else {
      console.log('\n  NAIDE packages:\n');
      for (const [name, ver] of deps) {
        console.log(`    ${name}  ${ver}`);
      }
      console.log('');
    }
    process.exit(0);
  }

  console.log(`  Unknown subcommand: naide pkg ${subcmd}`);
  console.log('  Run: naide pkg help');
  process.exit(1);
}

// ── Deploy ──
if (files[0] === 'deploy') {
  const dir = resolve(files[1] || '.');

  const dockerfileContent = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npx naide build . dist
EXPOSE 3000
CMD ["node", "dist/app.mjs"]
`;

  const dockerignoreContent = `node_modules
.git
*.naide
*.nx
.naide_tmp_*
dist
`;

  writeFileSync(resolve(dir, 'Dockerfile'), dockerfileContent);
  writeFileSync(resolve(dir, '.dockerignore'), dockerignoreContent);

  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (!pkg.scripts) pkg.scripts = {};
    pkg.scripts['docker:build'] = 'docker build -t naide-app .';
    pkg.scripts['docker:run'] = 'docker run -p 3000:3000 naide-app';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  console.log(`\n  NAIDE deploy files generated!

  Files created:
    Dockerfile
    .dockerignore

  Commands:
    docker build -t naide-app .
    docker run -p 3000:3000 naide-app

  Or use npm scripts:
    npm run docker:build
    npm run docker:run
`);
  process.exit(0);
}

if (flags.help) {
  console.log(`
  NAIDE - Node AI Development Environment
  A language designed for AI-speed code generation

  Usage:
    naide                        Start interactive REPL
    naide <file.naide>           Run a NAIDE file
    naide <file.nx>              Run a NAIDE-X file (auto-detected)
    naide ~~ "instruction"       Generate NAIDE code from instruction (no AI)
    naide gen "instruction"      Same as ~~ (alias)
    naide init [dir]             Create a new NAIDE project
    naide build [dir] [outdir]   Transpile all files to JavaScript
    naide check <files...>       Type-check without running
    naide repl                   Start interactive REPL
    naide lsp                    Start language server (LSP)
    naide vscode                 Install VS Code extension
    naide deploy [dir]           Generate Dockerfile for deployment
    naide convert <files...>     Convert between .naide and .nx formats
    naide fmt <files...>         Format NAIDE files
    naide pkg init               Create naide.pkg.json manifest
    naide pkg install <name>     Install a NAIDE package
    naide pkg publish            Publish package to npm
    naide pkg list               List NAIDE dependencies
    naide --emit <file>          Output generated JavaScript
    naide --mid <file.nx>        Output intermediate NAIDE v1 (debug)
    naide -x <file.naide>        Force NAIDE-X mode
    naide -w <file.naide>        Watch mode (auto-restart on changes)
    naide -d <file>              Debug mode (Node.js inspector)

  Code Generation (~~):
    naide ~~ "instruction"       Generate code from instruction (no AI)
    naide gen "instruction"      Alias for ~~
    naide --expand <file>        Show ~~ directive expansion results
    In .naide files: ~~ "instruction" expands at compile time

  Targets (15):
    node    Node.js / JavaScript (default)
    bun     Bun-optimized JavaScript
    ts      TypeScript
    python  Python (Flask)
    go      Go (net/http)
    java    Java (HttpServer)
    rust    Rust (actix-web)
    cpp     C++ (cpp-httplib)
    c       C (libmicrohttpd)
    csharp  C# (ASP.NET)
    kotlin  Kotlin (Ktor)
    swift   Swift (Vapor)
    dart    Dart (shelf)
    php     PHP
    ruby    Ruby (Sinatra)

  Modes:
    .naide  Standard NAIDE (~40% fewer tokens than JS)
    .nx     NAIDE-X extreme (~80% fewer tokens than JS)

  Options:
    -e, --emit     Print generated JavaScript
    -o, --output   Write generated JavaScript to file
    -x             Force NAIDE-X mode
    -w, --watch    Watch mode: restart on file changes
    -d, --debug    Start with Node.js debugger (--inspect-brk)
    -t, --target   Compile target: node (default), bun, python/py
    --check        Type-check files without running
    --mid          Show intermediate NAIDE v1 (X mode only)
    --expand       Show ~~ directive expansion (debug)
    --ast          Print AST
    --tokens       Print tokens
    -h, --help     Show this help

  ~~ Keyword Cheat Sheet:
    Intent     server api rest bot cli page test database ai crud auth ws mail graphql
    Composite  todo blog chat shop fullstack board
    Platform   discord slack telegram line
    JP Intent  サーバー 認証 ログイン 会員 CRUD 管理 データベース ボット テスト ページ
    JP Entity  ユーザー 商品 記事 タスク 注文 コメント イベント 問い合わせ 掲示板 決済
    Fields     "with name email age done" → auto-inferred types
`);
  process.exit(0);
}

const runtimeUrl = new URL('../src/runtime.js', import.meta.url).href;

for (const file of files) {
  const filePath = resolve(file);
  let source;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`Error: Cannot read file '${file}'`);
    process.exit(1);
  }

  const ext = extname(file);
  const mode = flags.mode || (ext === '.nx' ? 'x' : 'naide');

  try {
    if (flags.mid && mode === 'x') {
      const { preprocess } = await import('../src/preprocess.js');
      console.log(preprocess(source));
      continue;
    }

    const runtimePath = flags.emit || flags.output ? 'naider/runtime' : runtimeUrl;

    if (flags.watch) {
      const tempFile = resolve(`.naide_tmp_${basename(file, ext)}.mjs`);
      let child = null;

      function start() {
        try {
          source = readFileSync(filePath, 'utf-8');
          const result = compile(source, { mode, runtimePath });
          writeFileSync(tempFile, result.js, 'utf-8');
          child = spawn(process.execPath, [tempFile], { stdio: 'inherit' });
          child.on('error', (err) => console.error(`[NAIDE] Process error: ${err.message}`));
          child.on('exit', (code) => {
            if (code !== null && code !== 0) console.log(`[NAIDE] Process exited with code ${code}`);
          });
        } catch (err) {
          console.error(`\n${err.message}`);
        }
      }

      function restart() {
        console.log('\n[NAIDE] Change detected. Restarting...');
        if (child) { child.kill(); child = null; }
        start();
      }

      console.log(`[NAIDE] Watch mode — ${file}`);
      start();

      let debounce = null;
      fsWatch(filePath, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(restart, 200);
      });

      process.on('SIGINT', () => {
        if (child) child.kill();
        try { unlinkSync(tempFile); } catch {}
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        if (child) child.kill();
        process.exit(0);
      });

      continue;
    }

    const useAsync = flags.target !== 'node';
    const result = useAsync
      ? await compileAsync(source, { mode, runtimePath, sourceFile: file, typeCheck: flags.check, target: flags.target })
      : compile(source, { mode, runtimePath, sourceFile: file, typeCheck: flags.check });

    if (flags.check) {
      const { typeErrors } = result;
      if (typeErrors) {
        for (const e of typeErrors.errors) console.log(`  ${file}:${e.line} ERROR: ${e.message}`);
        for (const w of typeErrors.warnings) console.log(`  ${file}:${w.line} WARN: ${w.message}`);
        if (typeErrors.errors.length === 0 && typeErrors.warnings.length === 0) console.log(`  ${file}: OK`);
      }
      continue;
    }

    if (flags.tokens) {
      console.log(JSON.stringify(result.tokens, null, 2));
      continue;
    }

    if (flags.ast) {
      console.log(JSON.stringify(result.ast, null, 2));
      continue;
    }

    const outputCode = result.code || result.js;
    const outputExt = flags.target === 'python' || flags.target === 'py' ? '.py' : '.mjs';

    if (flags.output) {
      writeFileSync(flags.output, outputCode, 'utf-8');
      console.log(`Written to ${flags.output}`);
      continue;
    }

    if (flags.emit) {
      console.log(outputCode);
      continue;
    }

    if (flags.target === 'python' || flags.target === 'py') {
      const outFile = flags.output || resolve(basename(file, ext) + '.py');
      writeFileSync(outFile, outputCode, 'utf-8');
      console.log(`  ${file} → ${basename(outFile)} (Python)`);
      continue;
    }

    if (flags.target === 'bun') {
      const tempFile = resolve(`.naide_tmp_${basename(file, ext)}.mjs`);
      writeFileSync(tempFile, outputCode, 'utf-8');
      console.log(`[NAIDE] Running with Bun — ${file}`);
      const bunChild = spawn('bun', ['run', tempFile], { stdio: 'inherit', shell: true });
      bunChild.on('close', (code) => {
        try { unlinkSync(tempFile); } catch {}
        process.exit(code || 0);
      });
      await new Promise(() => {});
    }

    // Run mode
    const tempFile = resolve(`.naide_tmp_${basename(file, ext)}.mjs`);
    writeFileSync(tempFile, result.js, 'utf-8');

    if (flags.debug) {
      console.log(`\n  [NAIDE] Debugger starting — ${file}`);
      console.log('  Open Chrome → chrome://inspect to connect\n');
      const debugChild = spawn(process.execPath, ['--inspect-brk', tempFile], { stdio: 'inherit' });
      debugChild.on('close', (code) => {
        try { unlinkSync(tempFile); } catch {}
        process.exit(code || 0);
      });
      process.on('SIGINT', () => {
        debugChild.kill();
        try { unlinkSync(tempFile); } catch {}
        process.exit(0);
      });
      await new Promise(() => {});
    }

    try {
      await import('file:///' + tempFile.replace(/\\/g, '/'));
    } catch (runErr) {
      if (!remapError(runErr, result.sourceMap, file, source)) {
        console.error(`\n${runErr.message}`);
      }
      if (process.env.NAIDE_DEBUG) console.error(runErr.stack);
    } finally {
      try {
        const { unlinkSync } = await import('fs');
        unlinkSync(tempFile);
      } catch {}
    }
  } catch (err) {
    const isSyntaxErr = err.message.includes('line ') || err.message.includes('Unexpected') || err.message.includes('Expected');
    if (isSyntaxErr) {
      console.error(`\n${err.message}`);
    } else {
      crashReport(err, { file, target: flags.target });
    }
    if (process.env.NAIDE_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}
