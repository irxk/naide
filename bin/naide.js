#!/usr/bin/env node

import { readFileSync, writeFileSync, unlinkSync, watch as fsWatch, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'fs';
import { resolve, basename, dirname, extname, isAbsolute, join, relative, sep } from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'node:url';
import { runNativeFileAsync } from '../src/native-engine.js';
import { spawn } from 'child_process';

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

const NAIDE_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

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

function reportRetiredNx(file) {
  console.error(`  Error: ${file} uses retired NAIDE-X syntax. Use standard NAIDE syntax in a .naide file.`);
}

function parseNpmPackageSpec(spec) {
  const match = spec.match(/^(?<name>@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)(?:@(?<version>latest|[A-Za-z][A-Za-z0-9._-]*|[~^]?v?\d+(?:\.\d+){0,2}(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?))?$/);
  return match ? { name: match.groups.name, version: match.groups.version } : null;
}

function spawnNpm(args, options = {}) {
  const npmCliCandidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(dirname(process.execPath)), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean).map(path => resolve(path));
  const npmCli = npmCliCandidates.find(path => existsSync(path));

  if (npmCli) return spawn(process.execPath, [npmCli, ...args], options);
  if (process.platform !== 'win32') return spawn('npm', args, options);
  throw new Error('Could not locate npm-cli.js. Run this command from an npm installation or set npm_execpath.');
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
  watch: false,
  debug: false,
  check: false,
  target: 'node',
  expand: false,
  project: false,
  write: null,
  replace: false,
  native: false,
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
    case '--watch': case '-w': flags.watch = true; break;
    case '--debug': case '-d': flags.debug = true; break;
    case '--check': flags.check = true; flags.run = false; break;
    case '--target': case '-t': flags.target = args[++i]; break;
    case '--expand': flags.expand = true; flags.run = false; break;
    case '--project': case '-p': flags.project = true; break;
    case '--write': flags.write = args[++i]; break;
    case '--replace': flags.replace = true; break;
    case '--native': flags.native = true; break;
    default: files.push(arg);
  }
}

if (files[0] === 'doctor') {
  const { getDoctorReport } = await import('../src/project-tools.js');
  const directory = files[1] && !files[1].startsWith('--') ? files[1] : '.';
  const report = await getDoctorReport(resolve(directory));
  if (files.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n  NAIDE doctor — ${report.project.directory}`);
    console.log(`  Node.js ${report.node.version}${report.node.supported ? '' : ' (unsupported; NAIDE requires >=18)'}`);
    console.log(`  Platform: ${report.platform}`);
    console.log(`  Project manifests: ${report.project.manifests.join(', ') || 'none found'}`);
    for (const tool of report.tools) {
      console.log(`  ${tool.available ? 'OK' : '--'} ${tool.executable}${tool.version ? ` (${tool.version})` : ''}`);
    }
    for (const check of report.project.checks) console.log(`  OK ${check}`);
    for (const warning of report.project.warnings) console.log(`  WARN ${warning}`);
    for (const error of report.project.errors) console.error(`  ERROR ${error}`);
    console.log(`\n  ${report.project.ok ? 'Project checks passed.' : 'Project checks found errors.'}`);
  }
  process.exit(report.node.supported && report.project.ok ? 0 : 1);
}

if (files[0] === 'verify') {
  const { inspectProject } = await import('../src/project-tools.js');
  const directory = resolve(files[1] && !files[1].startsWith('--') ? files[1] : '.');
  const report = inspectProject(directory);
  if (files.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n  NAIDE verify — ${report.directory}`);
    for (const check of report.checks) console.log(`  OK ${check}`);
    for (const warning of report.warnings) console.log(`  WARN ${warning}`);
    for (const error of report.errors) console.error(`  ERROR ${error}`);
    console.log(`\n  ${report.ok ? 'Project verification passed.' : 'Project verification failed.'}`);
  }
  process.exit(report.ok ? 0 : 1);
}

if (files[0] === 'test') {
  const { runProjectTests } = await import('../src/project-tools.js');
  const directory = files[1] && !files[1].startsWith('--') ? files[1] : '.';
  let report;
  try {
    report = await runProjectTests(resolve(directory));
  } catch (error) {
    console.error(`  Could not inspect test project: ${error.message}`);
    process.exit(1);
  }
  if (report.plans.length === 0) {
    console.error('  No configured native test suite found. Add a test script or a supported test project.');
    process.exit(1);
  }
  for (const outcome of report.outcomes) {
    console.log(`\n  > ${outcome.label}`);
    if (outcome.stdout) process.stdout.write(outcome.stdout);
    if (outcome.stderr) process.stderr.write(outcome.stderr);
    if (outcome.error) console.error(`  ${outcome.error}`);
    console.log(`  ${outcome.code === 0 ? 'PASS' : 'FAIL'} ${outcome.label}`);
  }
  process.exit(report.ok ? 0 : 1);
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

  // Write mode: inject into existing .naide file
  const targetFile = instruction.match(/\S+\.naide$/)?.[0];
  if (targetFile || flags.write) {
    const file = flags.write || targetFile;
    const cleanInstruction = targetFile ? instruction.replace(/\s+\S+\.naide$/, '') : instruction;
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

    const isGame = result.analysis && result.analysis.gameType;
    const isApp = result.analysis && result.analysis.appType;
    if (isGame && !flags.output && !isUpdate) {
      dir = result.analysis.gameType + '-game';
    } else if (isApp && !flags.output && !isUpdate) {
      dir = result.analysis.appType + '-app';
    } else {
      const primaryName = (result.entities[0] || 'app').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!flags.output && !isUpdate) dir = primaryName + '-app';
    }
    const finalDir = resolve(dir);
    if (!existsSync(finalDir)) mkdirSync(finalDir, { recursive: true });
    for (const f of result.files) {
      const fp = resolve(finalDir, f.path);
      const fpDir = resolve(fp, '..');
      if (!existsSync(fpDir)) mkdirSync(fpDir, { recursive: true });
      writeFileSync(fp, f.content, 'utf-8');
    }
    const a = result.analysis;
    const mode = result.action === 'removed' ? 'Removed' : isUpdate ? 'Updated' : 'Created';
    process.stderr.write(`\n  ── NAIDE Agent (${mode}) ────────────────────────────────\n`);
    process.stderr.write(`  Input:    "${a.instruction || instruction}"\n`);
    if (a.gameType) {
      process.stderr.write(`  Type:     Game (${a.gameType})\n`);
    } else if (a.entities.length > 0) {
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
    if (isGame && !isUpdate) console.log(`\n  Open ${dir}/index.html in a browser, or:\n  cd ${dir} && npm install && npm run dev\n`);
    else if (!isUpdate) console.log(`\n  cd ${dir} && npm install && npm run dev\n`);
    else console.log(`\n  Files regenerated. Run: npm run dev\n`);
    process.exit(0);
  }

  // Multi-target generation (D6)
  if (flags.target && flags.target !== 'naide') {
    const { generateForTarget, generateAllTargets } = await import('../src/gen.js');
    if (flags.target === 'all') {
      const result = await generateAllTargets(instruction);
      if (!result.valid) {
        process.stderr.write(`  Error: generated NAIDE code is invalid\n`);
        process.exit(1);
      }
      const succeeded = Object.entries(result.targets).filter(([, v]) => !v.error);
      const failed = Object.entries(result.targets).filter(([, v]) => v.error);
      process.stderr.write(`\n  ── Multi-Target Generation (${succeeded.length}/${Object.keys(result.targets).length} targets) ──\n`);
      for (const [t, v] of succeeded) {
        if (flags.output) {
          const outPath = flags.output.replace(/\.\w+$/, v.ext);
          writeFileSync(outPath, v.code, 'utf-8');
          console.log(`  ${t}: ${outPath}`);
        } else {
          console.log(`\n  ── ${t} (${v.ext}) ──\n`);
          console.log(v.code);
        }
      }
      if (failed.length > 0) {
        process.stderr.write(`  Failed: ${failed.map(([t, v]) => `${t} (${v.error.slice(0, 50)})`).join(', ')}\n`);
      }
      process.exit(0);
    }
    const result = await generateForTarget(instruction, flags.target);
    if (result.compiled) {
      if (flags.output) {
        writeFileSync(flags.output, result.compiled, 'utf-8');
        console.log(`  Generated: ${flags.output} (${flags.target})`);
      } else {
        console.log(result.compiled);
      }
    } else {
      process.stderr.write(`  Error compiling to ${flags.target}: ${result.compileError || 'unknown'}\n`);
      console.log(result.code);
    }
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
  const extName = 'irxk.naide-lang-2.0.2';
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
    console.log('\n  Manual install: copy vscode-naide/ to ~/.vscode/extensions/irxk.naide-lang-2.0.2/');
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

  console.log(`\n  NAIDE REPL v${NAIDE_VERSION} — type NAIDE code, see JavaScript output`);
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

if (files[0] === 'mws' && files[1] === 'discord') {
  const { compile } = await import('../src/index.js');
  const dir = resolve(files[2] || './naide-mws-discord');
  if (existsSync(dir)) {
    const entries = readdirSync(dir);
    if (entries.length > 0) {
      console.error(`  Error: refusing to overwrite files in ${dir}. Choose an empty or new directory.`);
      process.exit(1);
    }
  } else {
    mkdirSync(dir, { recursive: true });
  }

  const source = `bot myBot token process.env.BOT_TOKEN:
  on "ready":
    log "NAIDE bot is online!"
  slash "ping" "Check whether the bot is online":
    interaction.reply("Pong!")
`;
  compile(source, { sourceFile: resolve(dir, 'bot.naide') });
  const projectPackage = {
    name: basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'naide-discord-bot',
    version: '1.0.0',
    private: true,
    type: 'module',
    main: 'node_modules/naider/bin/naide-host.js',
    engines: { node: '>=18.19.0' },
    scripts: { start: 'node --enable-source-maps node_modules/naider/bin/naide-host.js' },
    dependencies: { naider: `^${NAIDE_VERSION}`, 'discord.js': '^14.27.0' },
  };
  const hostedManifest = {
    name: projectPackage.name,
    version: projectPackage.version,
    main: 'node_modules/naider/bin/naide-host.js',
    naide: { entry: 'bot.naide' },
    dependencies: projectPackage.dependencies,
  };
  writeFileSync(resolve(dir, 'bot.naide'), source, { flag: 'wx' });
  writeFileSync(resolve(dir, 'package.json'), `${JSON.stringify(projectPackage, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(resolve(dir, 'nidpackage.json'), `${JSON.stringify(hostedManifest, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(resolve(dir, '.gitignore'), 'node_modules/\n.env\n', { flag: 'wx' });
  writeFileSync(resolve(dir, 'MWS.md'), `# NAIDE Discord bot for MWS

The NAIDE source is \`bot.naide\`. \`nidpackage.json\` declares its entry, the NAIDE host runner, and npm dependencies. The runner registers NAIDE's loader and imports the source; no JavaScript bootstrap is needed.

## Run locally

\`\`\`powershell
npm install
$env:BOT_TOKEN = "your Discord bot token"
npm start
\`\`\`

## Deploy on MWS

1. In Discord Developer Portal, create an application and bot. Copy the bot token; never put it in either source file.
2. Invite the bot to your server with the \`bot\` and \`applications.commands\` scopes and permission to send messages.
3. Create a Node.js Discord bot on [MWS](https://cloud.puratya.com/) and upload \`bot.naide\` and \`nidpackage.json\`.
4. Let MWS install dependencies from \`nidpackage.json\`. Set the secret environment variable \`BOT_TOKEN\` to the bot token in the MWS bot settings.
5. The two-file layout requires MWS to launch the manifest's \`main\`; if MWS does not honor that convention, select \`node_modules/naider/bin/naide-host.js\` as the startup file. Check the host's behavior before relying on automatic detection.
6. In Discord, run \`/ping\`; the bot should answer \`Pong!\`.

Optionally set \`DISCORD_GUILD_ID\` to your test server's ID for near-immediate slash-command updates. If it is unset, commands are registered globally and Discord may take time to propagate them.

The starter uses a slash command and does not request the privileged Message Content intent. If you add a NAIDE \`on "message"\` handler, Discord requires enabling Message Content Intent in the Developer Portal.

Edit \`bot.naide\` and upload/redeploy it with \`nidpackage.json\`. The installed Native-Meld loader compiles and runs the \`.naide\` file directly inside the Node.js runtime. No precompiled bot JS is generated.
`, { flag: 'wx' });
  console.log(`\n  Created a Native-Meld Discord bot project in ${dir}`);
  console.log('  The host runner registers Native-Meld and starts bot.naide directly; it is not compiled bot output.');
  console.log('  Upload bot.naide and nidpackage.json to a host that honors the manifest, then set BOT_TOKEN.');
  console.log('  For local use: npm install, set BOT_TOKEN, then run npm start.');
  console.log('  See MWS.md for deployment and Discord Developer Portal instructions.');
  process.exit(0);
}

if (files[0] === 'init') {
  const templateFlagIndex = files.indexOf('--template');
  if (templateFlagIndex !== -1) {
    const templateName = files[templateFlagIndex + 1];
    if (templateName !== 'web') {
      console.error(`  Error: Unsupported project template '${templateName || ''}'. Available template: web.`);
      process.exit(1);
    }
    const projectPath = files.slice(1).find((value, index, values) =>
      !value.startsWith('--') && values[index - 1] !== '--template');
    const dir = projectPath ? resolve(projectPath) : process.cwd();
    mkdirSync(dir, { recursive: true });
    const templateDirectory = fileURLToPath(new URL('../examples/web/', import.meta.url));
    for (const file of ['app.naide', 'client.naide', 'styles.css']) {
      const destination = join(dir, file);
      if (!existsSync(destination)) {
        writeFileSync(destination, readFileSync(join(templateDirectory, file), 'utf8'), { flag: 'wx' });
      }
    }
    const manifestPath = join(dir, 'nidpackage.json');
    if (!existsSync(manifestPath)) {
      const name = basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      writeFileSync(manifestPath, JSON.stringify({
        name: name || 'naide-web-app',
        version: '1.0.0',
        private: true,
        naide: { entry: 'app.naide', target: 'browser' },
        dependencies: {},
      }, null, 2) + '\n', { flag: 'wx' });
    }
    console.log(`\n  Created a NAIDE web project in ${dir}`);
    console.log('  Start it with: naide dev .');
    console.log('  Project source is in app.naide, client.naide, and styles.css.');
    process.exit(0);
  }

  const dir = files[1] ? resolve(files[1]) : process.cwd();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const name = basename(dir === process.cwd() ? dir : dir);

  const packagePath = resolve(dir, 'package.json');
  const defaultScripts = {
    start: 'node -r dotenv/config --enable-source-maps --import naider/register app.naide',
    dev: 'node -r dotenv/config --watch --enable-source-maps --import naider/register app.naide',
    check: 'naide check app.naide',
    test: 'node --test',
    build: 'naide --emit app.naide -o dist/app.mjs',
  };
  const projectPackage = existsSync(packagePath)
    ? JSON.parse(readFileSync(packagePath, 'utf8'))
    : { name, version: '1.0.0', type: 'module' };
  let packageChanged = false;
  projectPackage.scripts ||= {};
  for (const [script, command] of Object.entries(defaultScripts)) {
    if (!projectPackage.scripts[script]) {
      projectPackage.scripts[script] = command;
      packageChanged = true;
    }
  }
  projectPackage.dependencies ||= {};
  for (const [dependency, version] of Object.entries({
    naider: `^${NAIDE_VERSION}`,
    express: '^4.21.2',
    dotenv: '^16.4.7',
  })) {
    if (!projectPackage.dependencies[dependency] && !projectPackage.devDependencies?.[dependency]) {
      projectPackage.dependencies[dependency] = version;
      packageChanged = true;
    }
  }
  if (packageChanged || !existsSync(packagePath)) {
    writeFileSync(packagePath, JSON.stringify(projectPackage, null, 2) + '\n');
  }

  if (!existsSync(resolve(dir, 'app.naide'))) {
    writeFileSync(resolve(dir, 'app.naide'), `db "data/"

env:
  PORT int default(3000)
  JWT_SECRET str required

schema User:
  id auto
  name str required min(1) max(80)
  email str required email max(254)
  password str required min(12) max(256)

schema Item:
  id auto
  ownerId str required
  name str required min(1) max(100)
  done bool default(false)

server app port PORT:
  cors ["http://localhost:3000", "http://localhost:5173"]
  limit "/api/*" 60 "1m"
  limit "/api/auth/*" 10 "1m"
  auth JWT_SECRET:
    protect "/api/*"
    public "/api/auth/register"
    public "/api/auth/login"
    public "/api/health"
  static "/public"

  get "/":
    ret {name: "NAIDE API", health: "/api/health"}

  get "/api/health":
    ret {status: "ok"}

  post "/api/auth/register" (req, res):
    if typeof req.body.name != "string" or typeof req.body.email != "string" or typeof req.body.password != "string":
      ret.status 400 {error: "name, email, and password are required"}
    if req.body.name.length < 1 or req.body.name.length > 80 or req.body.email.length > 254:
      ret.status 400 {error: "name or email is too long"}
    if req.body.password.length < 12 or req.body.password.length > 128:
      ret.status 400 {error: "password must be between 12 and 128 characters"}
    str email = req.body.email.toLowerCase().trim()
    if UserStore.where({email})[0]:
      ret.status 409 {error: "An account with that email already exists"}
    str hashed = hash(req.body.password)
    auto user = UserStore.create({name: req.body.name.trim(), email, password: hashed})
    if user.error:
      ret.status 400 {errors: user.error}
    auto token = auth.sign({id: user.id})
    ret.status 201 {token, user: {id: user.id, name: user.name, email: user.email}}

  post "/api/auth/login" (req, res):
    if typeof req.body.email != "string" or typeof req.body.password != "string":
      ret.status 401 {error: "Invalid credentials"}
    if req.body.password.length > 128:
      ret.status 401 {error: "Invalid credentials"}
    str email = req.body.email.toLowerCase().trim()
    auto user = UserStore.where({email})[0]
    if not user:
      ret.status 401 {error: "Invalid credentials"}
    if not verify(req.body.password, user.password):
      ret.status 401 {error: "Invalid credentials"}
    auto token = auth.sign({id: user.id})
    ret {token}

  get "/api/items" (req, res):
    auto items = ItemStore.where({ownerId: req.user.id})
    ret {data: items, total: items.length}

  post "/api/items" (req, res):
    if typeof req.body.name != "string" or req.body.name.length < 1 or req.body.name.length > 100:
      ret.status 400 {error: "name must be between 1 and 100 characters"}
    auto item = ItemStore.create({ownerId: req.user.id, name: req.body.name.trim(), done: false})
    if item.error:
      ret.status 400 {errors: item.error}
    ret.status 201 item

  get "/api/items/:id" (req, res):
    auto item = ItemStore.where({id: req.params.id, ownerId: req.user.id})[0]
    if not item:
      ret.status 404 {error: "Item not found"}
    ret item

  put "/api/items/:id" (req, res):
    auto item = ItemStore.where({id: req.params.id, ownerId: req.user.id})[0]
    if not item:
      ret.status 404 {error: "Item not found"}
    mut str name = item.name
    mut bool done = item.done
    if req.body.name != undefined:
      if typeof req.body.name != "string" or req.body.name.length < 1 or req.body.name.length > 100:
        ret.status 400 {error: "name must be between 1 and 100 characters"}
      name = req.body.name.trim()
    if req.body.done != undefined:
      if typeof req.body.done != "boolean":
        ret.status 400 {error: "done must be a boolean"}
      done = req.body.done
    auto updated = ItemStore.update(item.id, {name, done})
    ret updated

  del "/api/items/:id" (req, res):
    auto item = ItemStore.where({id: req.params.id, ownerId: req.user.id})[0]
    if not item:
      ret.status 404 {error: "Item not found"}
    bool deleted = ItemStore.delete(item.id)
    ret {deleted}
`);
  }

  if (!existsSync(resolve(dir, '.env'))) {
    writeFileSync(resolve(dir, '.env'), `JWT_SECRET=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  }

  const gitignorePath = resolve(dir, '.gitignore');
  const ignoredPaths = ['.env', 'data/', 'dist/', 'node_modules/'];
  const existingGitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const missingIgnoredPaths = ignoredPaths.filter(path => !existingGitignore.split(/\r?\n/).includes(path));
  if (missingIgnoredPaths.length > 0) {
    const separator = existingGitignore && !existingGitignore.endsWith('\n') ? '\n' : '';
    writeFileSync(gitignorePath, `${existingGitignore}${separator}${missingIgnoredPaths.join('\n')}\n`);
  }

  if (!existsSync(resolve(dir, 'README.md'))) {
    writeFileSync(resolve(dir, 'README.md'), `# ${name}

A small NAIDE API starter with registration, login, and an items API scoped to the authenticated user.

## Start

\`\`\`sh
npm install
npm run dev
\`\`\`

The initializer creates a random \`JWT_SECRET\` in \`.env\`. Keep that file private; it is excluded by \`.gitignore\`. The development server loads it automatically.

## API

- \`GET /api/health\` — public health check
- \`POST /api/auth/register\` — create an account (password: 12–128 characters)
- \`POST /api/auth/login\` — receive a bearer token
- \`/api/items\` — protected CRUD API; send \`Authorization: Bearer <token>\`

The default CORS allowlist is limited to local development origins. Change it deliberately when connecting a deployed frontend. The generated in-memory/file-backed starter and single-process rate limiter are for local development, not production deployment; use a production database, shared rate limiting, HTTPS, and an operational secret store before exposing it publicly.

## Checks

\`\`\`sh
npm run check
npm test
\`\`\`
`);
  }

  const testDir = resolve(dir, 'test');
  if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  const starterTestPath = resolve(testDir, 'api.test.js');
  if (!existsSync(starterTestPath)) {
    writeFileSync(starterTestPath, `import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

test('starter API separates each authenticated user’s items', async () => {
  const portProbe = createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = portProbe.address();
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, [
    '-r', 'dotenv/config',
    './node_modules/naider/bin/naide.js',
    'app.naide',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });

  try {
    const baseUrl = \`http://127.0.0.1:\${port}\`;
    let health;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(\`Starter server exited early:\\n\${output}\`);
      try {
        health = await fetch(\`\${baseUrl}/api/health\`);
        break;
      } catch {
        await delay(100);
      }
    }
    assert.ok(health, \`Starter server did not become ready:\\n\${output}\`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const unauthenticated = await fetch(\`\${baseUrl}/api/items\`);
    assert.equal(unauthenticated.status, 401);

    const email = \`test-\${Date.now()}@example.com\`;
    const registration = await fetch(\`\${baseUrl}/api/auth/register\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email,
        password: 'correct-horse-battery-staple',
      }),
    });
    assert.equal(registration.status, 201, await registration.text());
    const account = await registration.json();
    assert.ok(account.token);
    assert.equal(account.user.password, undefined);

    const created = await fetch(\`\${baseUrl}/api/items\`, {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${account.token}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Private item' }),
    });
    assert.equal(created.status, 201);
    const privateItem = await created.json();

    const items = await fetch(\`\${baseUrl}/api/items\`, {
      headers: { Authorization: \`Bearer \${account.token}\` },
    });
    assert.equal(items.status, 200);
    assert.equal((await items.json()).data[0].id, privateItem.id);

    const otherRegistration = await fetch(\`\${baseUrl}/api/auth/register\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Other User',
        email: \`other-\${Date.now()}@example.com\`,
        password: 'another-correct-horse-battery',
      }),
    });
    assert.equal(otherRegistration.status, 201);
    const otherAccount = await otherRegistration.json();

    const otherItems = await fetch(\`\${baseUrl}/api/items\`, {
      headers: { Authorization: \`Bearer \${otherAccount.token}\` },
    });
    assert.deepEqual((await otherItems.json()).data, []);

    const hiddenItem = await fetch(\`\${baseUrl}/api/items/\${privateItem.id}\`, {
      headers: { Authorization: \`Bearer \${otherAccount.token}\` },
    });
    assert.equal(hiddenItem.status, 404);
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  }
});
`);
  }

  if (!existsSync(resolve(dir, 'public'))) mkdirSync(resolve(dir, 'public'), { recursive: true });
  if (!existsSync(resolve(dir, 'dist'))) mkdirSync(resolve(dir, 'dist'), { recursive: true });

  console.log(`\n  NAIDE project initialized!

  ${dir === process.cwd() ? '' : `  cd ${basename(dir)}\n`}  npm install
  npm run check
  npm run dev

  A random JWT secret and a local-development API test were created.
`);
  process.exit(0);
}

if (files[0] === 'dev') {
  const { buildWebProject, startWebDevServer } = await import('../src/web-dev.js');
  const projectPath = files[1] && !files[1].startsWith('--') ? files[1] : '.';
  const projectRoot = resolve(projectPath);
  const readOption = (name, fallback) => {
    const index = files.indexOf(name);
    return index === -1 ? fallback : files[index + 1];
  };
  const portValue = Number(readOption('--port', '5173'));
  const host = readOption('--host', '127.0.0.1');
  if (!Number.isInteger(portValue) || portValue < 0 || portValue > 65535) {
    console.error('  Error: --port must be an integer between 0 and 65535.');
    process.exit(1);
  }
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    console.error(`  Error: Web project directory not found: ${projectRoot}`);
    process.exit(1);
  }

  try {
    console.log(`\n  NAIDE Web — preparing ${projectRoot}\n`);
    let webBuild = buildWebProject(projectRoot, { cliPath: fileURLToPath(import.meta.url) });
    const generatedPages = new Set(webBuild.pagePaths);
    const server = await startWebDevServer(projectRoot, {
      host,
      port: portValue,
      ignoredPaths: generatedPages,
      onChange: changed => {
        if (changed.some(path => path.endsWith('.naide'))) {
          console.log('\n  [NAIDE] Source change detected. Rebuilding web project...\n');
          webBuild = buildWebProject(projectRoot, { cliPath: fileURLToPath(import.meta.url) });
          generatedPages.clear();
          for (const pagePath of webBuild.pagePaths) generatedPages.add(pagePath);
        }
      },
    });
    console.log(`\n  Web development server: http://${host}:${server.port}`);
    console.log('  Edit .naide, CSS, or static assets to rebuild or refresh. Press Ctrl+C to stop.\n');
    const close = () => server.close().catch(error => {
      console.error(`[NAIDE] Could not stop web server: ${error.message}`);
      process.exitCode = 1;
    });
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } catch (error) {
    console.error(`  FAIL Web development: ${error.message}`);
    process.exit(1);
  }
}

if (files[0] === 'build') {
  const { compile } = await import('../src/index.js');
  const bundleBrowser = files.includes('--bundle-browser');
  const buildPaths = files.slice(1).filter(argument => argument !== '--bundle-browser');
  const dir = resolve(buildPaths[0] || '.');
  const outDir = buildPaths[1] ? resolve(buildPaths[1]) : null;

  if (bundleBrowser && !outDir) {
    console.error('  Usage: naide build <dir> <outdir> --bundle-browser');
    process.exit(1);
  }

  function walkDir(d) {
    const found = [];
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
        found.push(...walkDir(full));
      } else if (entry.endsWith('.naide')) {
        found.push(full);
      } else if (entry.endsWith('.nx')) {
        retiredFiles.push(full);
      }
    }
    return found;
  }

  const retiredFiles = [];
  const sourceFiles = walkDir(dir);
  for (const file of retiredFiles) reportRetiredNx(relative(dir, file));
  if (sourceFiles.length === 0) {
    console.log('  No .naide files found.');
    process.exit(retiredFiles.length > 0 ? 1 : 0);
  }

  console.log(`\n  NAIDE build — ${sourceFiles.length} file(s)\n`);
  let errors = retiredFiles.length;
  const schemaMap = {};
  const routeMap = {};
  const browserBundleEntries = new Map();

  function pageString(value) {
    if (!value?.parts || value.parts.some(part => part.type !== 'text')) return null;
    return value.parts.map(part => part.value).join('');
  }

  function isPathInside(root, candidate) {
    const pathFromRoot = relative(root, candidate);
    return pathFromRoot === '' || (
      pathFromRoot !== '..'
      && !pathFromRoot.startsWith(`..${sep}`)
      && !isAbsolute(pathFromRoot)
    );
  }

  function collectBrowserBundleEntries(ast) {
    for (const page of ast?.body || []) {
      if (page.type !== 'Page') continue;

      const pageFilename = pageString(page.filename);
      if (!pageFilename) {
        throw new Error('Browser bundle mode requires a literal page filename.');
      }
      const pageDirectory = dirname(pageFilename);
      const importsToKeep = new Set();
      const moduleSources = [];
      const visitElements = elements => {
        for (const element of elements || []) {
          if (element.tag === 'importmap') {
            const specifier = pageString(element.args[0]);
            if (specifier) importsToKeep.add(specifier.endsWith('/') ? `${specifier}*` : specifier);
          } else if (element.tag === 'module') {
            const moduleSource = pageString(element.args[0]);
            if (!moduleSource) throw new Error('Browser bundle mode requires literal module URLs.');
            moduleSources.push(moduleSource);
          }
          visitElements(element.children);
        }
      };
      visitElements(page.elements);

      for (const moduleSource of moduleSources) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(moduleSource)) continue;
        const urlPath = moduleSource.split(/[?#]/, 1)[0];
        const entryPath = resolve(
          dir,
          moduleSource.startsWith('/') ? urlPath.slice(1) : pageDirectory,
          ...(moduleSource.startsWith('/') ? [] : [urlPath]),
        );
        if (!isPathInside(dir, entryPath)) {
          throw new Error(`Browser bundle entry '${moduleSource}' must stay inside the project directory.`);
        }
        const realProjectRoot = realpathSync(dir);
        const realEntryPath = existsSync(entryPath)
          ? realpathSync(entryPath)
          : realpathSync(dirname(entryPath));
        if (!isPathInside(realProjectRoot, realEntryPath)) {
          throw new Error(`Browser bundle entry '${moduleSource}' must not traverse a symbolic link outside the project directory.`);
        }
        if (extname(entryPath) !== '.mjs') {
          throw new Error(`Browser bundle entry '${moduleSource}' must reference a generated .mjs module.`);
        }
        const external = browserBundleEntries.get(entryPath) || new Set();
        for (const specifier of importsToKeep) external.add(specifier);
        browserBundleEntries.set(entryPath, external);
      }
    }
  }

  for (const srcFile of sourceFiles) {
    const rel = relative(dir, srcFile);
    try {
      const source = readFileSync(srcFile, 'utf-8');
      const { js, ast } = compile(source);
      const outName = rel.replace(/\.naide$/, '.mjs');
      const outPath = outDir ? join(outDir, outName) : join(dir, outName);
      const outDirPath = resolve(outPath, '..');
      if (!existsSync(outDirPath)) mkdirSync(outDirPath, { recursive: true });
      writeFileSync(outPath, js);
      console.log(`  ${rel} → ${outDir ? join(relative('.', outDir), outName) : outName}`);

      if (bundleBrowser) {
        try {
          collectBrowserBundleEntries(ast);
        } catch (error) {
          console.error(`  FAIL ${rel}: ${error.message}`);
          errors++;
          continue;
        }
      }

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

  if (bundleBrowser && errors === 0) {
    if (browserBundleEntries.size === 0) {
      console.error('  FAIL Browser bundle mode found no local .mjs modules referenced by page module elements.');
      errors++;
    } else {
      try {
        const { build } = await import('esbuild');
        for (const [entryPath, external] of browserBundleEntries) {
          if (!existsSync(entryPath)) {
            throw new Error(`Browser module not found: ${entryPath}. Ensure its page module URL matches the build output path.`);
          }
          const result = await build({
            entryPoints: [entryPath],
            outfile: entryPath,
            bundle: true,
            format: 'esm',
            platform: 'browser',
            target: 'es2022',
            external: [...external],
            write: false,
          });
          const output = result.outputFiles.find(file => resolve(file.path) === entryPath);
          if (!output) throw new Error(`Bundler did not produce the expected entry point: ${entryPath}`);
          const cssFiles = result.outputFiles.filter(file => extname(file.path) === '.css');
          const cssLoader = cssFiles.map(file => {
            const cssPath = relative(dirname(entryPath), file.path).replace(/\\/g, '/');
            return `if (!document.querySelector('[data-naide-css=' + ${JSON.stringify(JSON.stringify(cssPath))} + ']')) { const __naideCss = document.createElement("link"); __naideCss.rel = "stylesheet"; __naideCss.href = new URL(${JSON.stringify(`./${cssPath}`)}, import.meta.url).href; __naideCss.dataset.naideCss = ${JSON.stringify(cssPath)}; document.head.append(__naideCss); }`;
          }).join('\n');
          for (const file of result.outputFiles) {
            const contents = file === output && cssLoader
              ? Buffer.concat([
                Buffer.from(`if (typeof document !== "undefined") {\n${cssLoader}\n}\n`),
                file.contents,
              ])
              : file.contents;
            writeFileSync(file.path, contents);
          }
          for (const warning of result.warnings) console.warn(`  WARN ${warning.text}`);
          console.log(`  Bundled browser module ${relative(dir, entryPath)}`);
        }
      } catch (error) {
        console.error(`  FAIL Browser bundling: ${error.message}`);
        errors++;
      }
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

// ── Type Check ──
if (files[0] === 'check') {
  const { compile } = await import('../src/index.js');
  const targets = files.slice(1);
  if (targets.length === 0) {
    console.log('  Usage: naide check <file.naide> [files...]');
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  for (const file of targets) {
    if (extname(file) === '.nx') {
      reportRetiredNx(file);
      totalErrors++;
      continue;
    }
    const filePath = resolve(file);
    try {
      const source = readFileSync(filePath, 'utf-8');
      const result = compile(source, { typeCheck: true });
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

if (files[0] === 'native') {
  const sourceFile = files[1];
  if (!sourceFile || sourceFile.startsWith('--')) {
    console.error('  Usage: naide native <file.naide> [--steps <maximum>] [--env <NAME>]... [-- <args...>]');
    process.exit(1);
  }
  const stepIndex = files.indexOf('--steps');
  const maxSteps = stepIndex === -1 ? 1_000_000 : Number(files[stepIndex + 1]);
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    console.error('  Error: --steps must be a positive safe integer.');
    process.exit(1);
  }
  const environmentNames = [];
  for (let index = 2; index < files.length; index++) {
    if (files[index] !== '--env') continue;
    const name = files[index + 1];
    if (!name || name.startsWith('--') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      console.error('  Error: --env requires a valid environment variable name.');
      process.exit(1);
    }
    environmentNames.push(name);
    index++;
  }
  const separatorIndex = files.indexOf('--');
  const runtimeArgs = separatorIndex === -1 ? [] : files.slice(separatorIndex + 1);
  const allowedEnvironment = Object.fromEntries(
    [...new Set(environmentNames)]
      .filter(name => Object.hasOwn(process.env, name))
      .map(name => [name, process.env[name]]),
  );
  try {
    const result = await runNativeFileAsync(resolve(sourceFile), {
      maxSteps,
      runtime: { args: runtimeArgs, env: allowedEnvironment },
    });
    console.log(`\n  Native NAIDE execution completed in ${result.steps} steps.`);
    process.exitCode = result.globals.get('runtime').exitCode;
  } catch (error) {
    console.error(`\n  Native NAIDE error: ${error.message}`);
    process.exit(1);
  }
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
    naide pkg add <manager> <spec> Install through a native package manager
    naide pkg managers            List supported package ecosystems
    naide pkg publish             Publish current package to npm
    naide pkg list                List installed NAIDE packages
`);
    process.exit(0);
  }

  const pkgManifestPath = resolve('naide.pkg.json');

  if (subcmd === 'managers') {
    const { listPackageAdapters } = await import('../src/project-tools.js');
    console.log('\n  Native package ecosystems:\n');
    for (const adapter of listPackageAdapters()) {
      console.log(`    ${adapter.name.padEnd(10)} ${adapter.description}`);
    }
    console.log('\n  Packages run in their native runtimes. Calling one from NAIDE requires an explicit bridge or adapter.\n');
    process.exit(0);
  }

  if (subcmd === 'add') {
    const {
      createPackageInstallPlan,
      recordPackageDependency,
      runPackageInstall,
      spawnNativeTool,
    } = await import('../src/project-tools.js');
    const manager = files[2];
    const spec = files[3];
    if (!manager || !spec) {
      console.error('  Usage: naide pkg add <manager> <package[@version]>');
      process.exit(1);
    }

    let plan;
    try {
      plan = createPackageInstallPlan(manager, spec);
    } catch (error) {
      console.error(`  Error: ${error.message}`);
      process.exit(1);
    }

    console.log(`  Installing ${spec} via ${manager}...`);
    try {
      const code = await runPackageInstall(plan, {
        directory: process.cwd(),
        spawnCommand: (packagePlan, cwd) => packagePlan.manager === 'npm'
          ? spawnNpm(packagePlan.args, { cwd, stdio: 'inherit' })
          : spawnNativeTool(packagePlan, cwd, { stdio: 'inherit' }),
      });
      if (code === 0) {
        try {
          recordPackageDependency(process.cwd(), plan);
        } catch (error) {
          console.error(`  Error: ${spec} was installed, but package metadata could not be saved: ${error.message}`);
          process.exit(1);
        }
        console.log(`\n  Installed ${spec} via ${manager}.`);
        console.log(`  Recorded dependency in ${manager === 'pip' ? 'naide.pkg.json and requirements.txt' : 'naide.pkg.json'}.`);
        if (plan.note) console.log(`  Note: ${plan.note}`);
      }
      process.exit(code);
    } catch (error) {
      console.error(`  Error: could not start ${plan.executable}: ${error.message}`);
      process.exit(1);
    }
  }

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
      languageDependencies: {},
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
    const packageSpec = parseNpmPackageSpec(pkgName);
    if (!packageSpec) {
      console.error('  Error: expected a package name, optional scope, and optional tag or version.');
      process.exit(1);
    }

    console.log(`  Installing ${pkgName}...`);
    let child;
    try {
      child = spawnNpm(['install', '--', pkgName], { stdio: 'inherit' });
    } catch (error) {
      console.error(`  Error: ${error.message}`);
      process.exit(1);
    }
    child.once('error', (error) => {
      console.error(`  Error: failed to start npm: ${error.message}`);
      process.exit(1);
    });
    child.on('close', (code) => {
      if (code === 0) {
        if (existsSync(pkgManifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(pkgManifestPath, 'utf-8'));
            manifest.dependencies ||= {};
            const npmPkg = resolve('node_modules', packageSpec.name, 'package.json');
            if (existsSync(npmPkg)) {
              const ver = JSON.parse(readFileSync(npmPkg, 'utf-8')).version;
              manifest.dependencies[packageSpec.name] = `^${ver}`;
              writeFileSync(pkgManifestPath, JSON.stringify(manifest, null, 2) + '\n');
            }
          } catch (error) {
            console.error(`  Warning: package installed, but naide.pkg.json could not be updated: ${error.message}`);
          }
        }
        console.log(`\n  Installed ${pkgName}`);
      }
      process.exit(code ?? 1);
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
        files: ['*.naide', 'src/', 'naide.pkg.json'],
      }, null, 2) + '\n');
    }

    console.log(`  Publishing ${manifest.name}@${manifest.version}...`);
    let child;
    try {
      child = spawnNpm(['publish', '--access', 'public'], { stdio: 'inherit' });
    } catch (error) {
      console.error(`  Error: ${error.message}`);
      process.exit(1);
    }
    child.once('error', (error) => {
      console.error(`  Error: failed to start npm: ${error.message}`);
      process.exit(1);
    });
    child.on('close', (code) => {
      if (code === 0) console.log(`\n  Published ${manifest.name}@${manifest.version}`);
      process.exit(code ?? 1);
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
    const languageDeps = Object.entries(manifest.languageDependencies || {})
      .flatMap(([manager, packages]) => Object.entries(packages).map(([name, spec]) => [name, spec, manager]));
    if (deps.length === 0 && languageDeps.length === 0) {
      console.log('  No NAIDE packages installed.');
    } else {
      console.log('\n  NAIDE packages:\n');
      for (const [name, ver] of deps) {
        console.log(`    ${name}  ${ver}`);
      }
      for (const [name, spec, manager] of languageDeps) {
        console.log(`    ${name}  ${spec}  (${manager})`);
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
  One readable syntax for people and tools

  Usage:
    naide                        Start interactive REPL
    naide <file.naide>           Run a NAIDE file
      --native                   Execute directly without JavaScript generation
    naide native <file.naide>    Execute core NAIDE directly without JS generation
      --steps <maximum>          Bound native interpreter execution steps
      --env <NAME>               Expose one environment variable to native runtime
      -- <args...>               Pass arguments to the native program
    naide dev [dir]              Build and serve a NAIDE web project
      --port <number>            Development server port (default: 5173)
      --host <address>           Bind address (default: 127.0.0.1)
    naide init <dir> --template web  Create a NAIDE-first web project
    naide ~~ "instruction"       Generate NAIDE code from instruction (no AI)
    naide gen "instruction"      Same as ~~ (alias)
    naide init [dir]             Create a new NAIDE project
    naide mws discord [dir]      Create a Discord bot project for MWS hosting
    naide build [dir] [outdir]   Transpile all files to JavaScript
      --bundle-browser           Bundle browser page modules and npm dependencies
    naide check <files...>       Type-check without running
    naide repl                   Start interactive REPL
    naide lsp                    Start language server (LSP)
    naide vscode                 Install VS Code extension
    naide deploy [dir]           Generate Dockerfile for deployment
    naide doctor [dir]           Diagnose local tools and project setup
    naide verify [dir]           Check project manifests and setup
    naide test [dir]             Run detected native project test suites
    naide fmt <files...>         Format NAIDE files
    naide pkg init               Create naide.pkg.json manifest
    naide pkg install <name>     Install a NAIDE package
    naide pkg add <manager> <spec> Install with a native package manager
    naide pkg managers           List supported package ecosystems
    naide pkg publish            Publish package to npm
    naide pkg list               List NAIDE dependencies
    naide --emit <file>          Output generated JavaScript
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

  Options:
    -e, --emit     Print generated JavaScript
    -o, --output   Write generated JavaScript to file
    -w, --watch    Watch mode: restart on file changes
    -d, --debug    Start with Node.js debugger (--inspect-brk)
    -t, --target   Compile target: node (default), bun, python/py
    --check        Type-check files without running
    --expand       Show ~~ directive expansion (debug)
    --ast          Print AST
    --tokens       Print tokens
    -h, --help     Show this help

  ~~ Keyword Cheat Sheet:
    Intent     server api rest bot cli page test database ai crud auth ws mail graphql game
    Composite  todo blog chat shop fullstack board
    Game       tapping quiz memory snake typing reaction breakout dodge color pong
    App        calculator timer counter pomodoro clock drawing notes
    Platform   discord slack telegram line
    JP Intent  サーバー 認証 ログイン 会員 CRUD 管理 データベース ボット テスト ページ ゲーム
    JP Entity  ユーザー 商品 記事 タスク 注文 コメント イベント 問い合わせ 掲示板 決済
    Fields     "with name email age done" → auto-inferred types
`);
  process.exit(0);
}

const runtimeUrl = new URL('../src/runtime.js', import.meta.url).href;

if (!['dev', 'native'].includes(files[0])) for (const file of files) {
  const filePath = resolve(file);
  let source;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`Error: Cannot read file '${file}'`);
    process.exit(1);
  }

  const ext = extname(file);
  if (ext === '.nx') {
    reportRetiredNx(file);
    process.exitCode = 1;
    continue;
  }

  try {
    if (flags.native) {
      const result = await runNativeFileAsync(filePath);
      console.log(`\n  Native NAIDE execution completed in ${result.steps} steps.`);
      process.exitCode = result.globals.get('runtime').exitCode;
      continue;
    }

    const { compile, compileAsync } = await import('../src/index.js');
    const runtimePath = flags.emit || flags.output ? 'naider/runtime' : runtimeUrl;

    if (flags.watch) {
      const tempFile = resolve(`.naide_tmp_${basename(file, ext)}.mjs`);
      let child = null;

      function start() {
        try {
          source = readFileSync(filePath, 'utf-8');
          const result = compile(source, { runtimePath });
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
      ? await compileAsync(source, { runtimePath, sourceFile: file, typeCheck: flags.check, target: flags.target })
      : compile(source, { runtimePath, sourceFile: file, typeCheck: flags.check });

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
      const bunChild = spawn('bun', ['run', tempFile], { stdio: 'inherit' });
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
