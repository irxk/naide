import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { Generator } from './generator.js';
import { preprocess } from './preprocess.js';
import { TypeChecker } from './typechecker.js';
import { generate, generateProject, updateProject, expandDirectives } from './gen.js';

async function getGenerator(target, options) {
  switch (target) {
    case 'python':
    case 'py': {
      const { PythonGenerator } = await import('./generator-python.js');
      return new PythonGenerator(options);
    }
    case 'bun': {
      const { BunGenerator } = await import('./generator-bun.js');
      return new BunGenerator(options);
    }
    case 'typescript':
    case 'ts': {
      const { TypeScriptGenerator } = await import('./generator-typescript.js');
      return new TypeScriptGenerator(options);
    }
    case 'c': {
      const { CGenerator } = await import('./generator-c.js');
      return new CGenerator(options);
    }
    case 'cpp':
    case 'c++': {
      const { CppGenerator } = await import('./generator-cpp.js');
      return new CppGenerator(options);
    }
    case 'java': {
      const { JavaGenerator } = await import('./generator-java.js');
      return new JavaGenerator(options);
    }
    case 'php': {
      const { PhpGenerator } = await import('./generator-php.js');
      return new PhpGenerator(options);
    }
    case 'ruby':
    case 'rb': {
      const { RubyGenerator } = await import('./generator-ruby.js');
      return new RubyGenerator(options);
    }
    case 'go': {
      const { GoGenerator } = await import('./generator-go.js');
      return new GoGenerator(options);
    }
    case 'kotlin':
    case 'kt': {
      const { KotlinGenerator } = await import('./generator-kotlin.js');
      return new KotlinGenerator(options);
    }
    case 'swift': {
      const { SwiftGenerator } = await import('./generator-swift.js');
      return new SwiftGenerator(options);
    }
    case 'dart': {
      const { DartGenerator } = await import('./generator-dart.js');
      return new DartGenerator(options);
    }
    case 'csharp':
    case 'cs':
    case 'c#': {
      const { CSharpGenerator } = await import('./generator-csharp.js');
      return new CSharpGenerator(options);
    }
    case 'rust':
    case 'rs': {
      const { RustGenerator } = await import('./generator-rust.js');
      return new RustGenerator(options);
    }
    default:
      return new Generator(options);
  }
}

export function compile(source, { mode = 'naide', runtimePath, sourceFile, typeCheck = false, target = 'node' } = {}) {
  let processedSource = source;
  if (mode === 'x') {
    processedSource = preprocess(source);
  }
  if (processedSource.includes('~~')) {
    processedSource = expandDirectives(processedSource).source;
  }
  try {
    const lexer = new Lexer(processedSource);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    let typeErrors = null;
    if (typeCheck) {
      const checker = new TypeChecker();
      typeErrors = checker.check(ast);
    }

    const generator = new Generator({ runtimePath, sourceFile });
    const js = generator.generate(ast);
    return { js, ast, tokens, sourceMap: generator.sourceMap, naide: mode === 'x' ? processedSource : null, typeErrors };
  } catch (e) {
    const lineMatch = e.message.match(/line (\d+)/);
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1]);
      const lines = processedSource.split('\n');
      const start = Math.max(0, lineNum - 3);
      const end = Math.min(lines.length, lineNum + 2);
      const context = lines.slice(start, end).map((l, i) => {
        const num = start + i + 1;
        const marker = num === lineNum ? ' >> ' : '    ';
        return `${marker}${num} | ${l}`;
      }).join('\n');
      e.message += `\n\n${context}\n`;
    }
    throw e;
  }
}

export async function compileAsync(source, { mode = 'naide', runtimePath, sourceFile, typeCheck = false, target = 'node' } = {}) {
  let processedSource = source;
  if (mode === 'x') {
    processedSource = preprocess(source);
  }
  if (processedSource.includes('~~')) {
    processedSource = expandDirectives(processedSource).source;
  }
  try {
    const lexer = new Lexer(processedSource);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    let typeErrors = null;
    if (typeCheck) {
      const checker = new TypeChecker();
      typeErrors = checker.check(ast);
    }

    const generator = await getGenerator(target, { runtimePath, sourceFile });
    const code = generator.generate(ast);
    return { js: code, code, ast, tokens, sourceMap: generator.sourceMap, naide: mode === 'x' ? processedSource : null, typeErrors, target };
  } catch (e) {
    const lineMatch = e.message.match(/line (\d+)/);
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1]);
      const lines = processedSource.split('\n');
      const start = Math.max(0, lineNum - 3);
      const end = Math.min(lines.length, lineNum + 2);
      const context = lines.slice(start, end).map((l, i) => {
        const num = start + i + 1;
        const marker = num === lineNum ? ' >> ' : '    ';
        return `${marker}${num} | ${l}`;
      }).join('\n');
      e.message += `\n\n${context}\n`;
    }
    throw e;
  }
}

export function transpile(source, opts) {
  return compile(source, opts).js;
}

export { preprocess, generate, generateProject, updateProject };
