#!/usr/bin/env node

import { readFileSync, writeFileSync, unlinkSync, watch as fsWatch, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, basename, extname, join, relative } from 'path';
import { compile } from '../src/index.js';
import { spawn } from 'child_process';

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
    default: files.push(arg);
  }
}

if (files[0] === 'init') {
  const dir = files[1] ? resolve(files[1]) : process.cwd();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const name = basename(dir === process.cwd() ? dir : dir);

  if (!existsSync(resolve(dir, 'package.json'))) {
    writeFileSync(resolve(dir, 'package.json'), JSON.stringify({
      name, version: '1.0.0', type: 'module',
      scripts: { start: 'naide app.naide', dev: 'naide -w app.naide', build: 'naide --emit app.naide -o dist/app.mjs' },
      dependencies: { naidejs: '^1.3.0' }
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
  for (const srcFile of sourceFiles) {
    const rel = relative(dir, srcFile);
    const mode = srcFile.endsWith('.nx') ? 'x' : 'naide';
    try {
      const source = readFileSync(srcFile, 'utf-8');
      const { js } = compile(source, { mode });
      const outName = rel.replace(/\.(naide|nx)$/, '.mjs');
      const outPath = outDir ? join(outDir, outName) : join(dir, outName);
      const outDirPath = resolve(outPath, '..');
      if (!existsSync(outDirPath)) mkdirSync(outDirPath, { recursive: true });
      writeFileSync(outPath, js);
      console.log(`  ${rel} → ${outDir ? join(relative('.', outDir), outName) : outName}`);
    } catch (e) {
      console.error(`  FAIL ${rel}: ${e.message.split('\n')[0]}`);
      errors++;
    }
  }
  console.log(`\n  Done. ${sourceFiles.length - errors} compiled, ${errors} failed.`);
  process.exit(errors > 0 ? 1 : 0);
}

if (flags.help || files.length === 0) {
  console.log(`
  NAIDE - Node AI Development Environment
  A language designed for AI-speed code generation

  Usage:
    naide <file.naide>           Run a NAIDE file
    naide <file.nx>              Run a NAIDE-X file (auto-detected)
    naide init [dir]             Create a new NAIDE project
    naide build [dir] [outdir]   Transpile all files to JavaScript
    naide --emit <file.nx>       Output generated JavaScript
    naide --mid <file.nx>        Output intermediate NAIDE v1 (debug)
    naide -x <file.naide>        Force NAIDE-X mode
    naide -w <file.naide>        Watch mode (auto-restart on changes)

  Modes:
    .naide  Standard NAIDE (~40% fewer tokens than JS)
    .nx     NAIDE-X extreme (~80% fewer tokens than JS)

  Options:
    -e, --emit     Print generated JavaScript
    -o, --output   Write generated JavaScript to file
    -x             Force NAIDE-X mode
    -w, --watch    Watch mode: restart on file changes
    --mid          Show intermediate NAIDE v1 (X mode only)
    --ast          Print AST
    --tokens       Print tokens
    -h, --help     Show this help
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

    const runtimePath = flags.emit || flags.output ? 'naidejs/runtime' : runtimeUrl;

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

    const result = compile(source, { mode, runtimePath });

    if (flags.tokens) {
      console.log(JSON.stringify(result.tokens, null, 2));
      continue;
    }

    if (flags.ast) {
      console.log(JSON.stringify(result.ast, null, 2));
      continue;
    }

    if (flags.output) {
      writeFileSync(flags.output, result.js, 'utf-8');
      console.log(`Written to ${flags.output}`);
      continue;
    }

    if (flags.emit) {
      console.log(result.js);
      continue;
    }

    // Run mode
    const tempFile = resolve(`.naide_tmp_${basename(file, ext)}.mjs`);
    writeFileSync(tempFile, result.js, 'utf-8');

    try {
      await import('file:///' + tempFile.replace(/\\/g, '/'));
    } finally {
      try {
        const { unlinkSync } = await import('fs');
        unlinkSync(tempFile);
      } catch {}
    }
  } catch (err) {
    console.error(`\n${err.message}`);
    if (process.env.NAIDE_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}
