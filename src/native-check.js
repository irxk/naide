import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { TypeChecker } from './typechecker.js';
import { expandDirectives } from './gen.js';

export function checkNativeSource(source) {
  const processedSource = source.includes('~~') ? expandDirectives(source).source : source;
  const ast = new Parser(new Lexer(processedSource).tokenize()).parse();
  return new TypeChecker().check(ast);
}
