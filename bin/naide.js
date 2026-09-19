#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { compile } from '../src/index.js';

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
    default: files.push(arg);
  }
}

if (flags.help || files.length === 0) {
  console.log(`
  NAIDE - Node AI Development Environment
  A language designed for AI-speed code generation

  Usage:
    naide <file.naide>           Run a NAIDE file
    naide <file.nx>              Run a NAIDE-X file (auto-detected)
    naide --emit <file.nx>       Output generated JavaScript
    naide --mid <file.nx>        Output intermediate NAIDE v1 (debug)
    naide -x <file.naide>        Force NAIDE-X mode

  Modes:
    .naide  Standard NAIDE (~40% fewer tokens than JS)
    .nx     NAIDE-X extreme (~80% fewer tokens than JS)

  Options:
    -e, --emit     Print generated JavaScript
    -o, --output   Write generated JavaScript to file
    -x             Force NAIDE-X mode
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
