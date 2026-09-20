import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { Generator } from './generator.js';
import { preprocess } from './preprocess.js';
import { TypeChecker } from './typechecker.js';

export function compile(source, { mode = 'naide', runtimePath, sourceFile, typeCheck = false } = {}) {
  let processedSource = source;
  if (mode === 'x') {
    processedSource = preprocess(source);
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

export function transpile(source, opts) {
  return compile(source, opts).js;
}

export { preprocess };
