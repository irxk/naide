import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { Generator } from './generator.js';
import { preprocess } from './preprocess.js';

export function compile(source, { mode = 'naide', runtimePath } = {}) {
  if (mode === 'x') {
    source = preprocess(source);
  }
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const generator = new Generator({ runtimePath });
  const js = generator.generate(ast);
  return { js, ast, tokens, naide: mode === 'x' ? source : null };
}

export function transpile(source, opts) {
  return compile(source, opts).js;
}

export { preprocess };
