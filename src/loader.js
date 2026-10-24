import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from './index.js';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value) {
  let encoded = '';
  let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    encoded += BASE64[digit];
  } while (vlq > 0);
  return encoded;
}

function inlineSourceMap(url, source, generatedLines) {
  let previousSource = 0;
  let previousOriginalLine = 0;
  const mappings = generatedLines.map(line => {
    const originalLine = Math.max(0, line - 1);
    const segment = [
      encodeVlq(0),
      encodeVlq(-previousSource),
      encodeVlq(originalLine - previousOriginalLine),
      encodeVlq(0),
    ].join('');
    previousSource = 0;
    previousOriginalLine = originalLine;
    return segment;
  }).join(';');

  const map = {
    version: 3,
    file: fileURLToPath(url),
    sources: [fileURLToPath(url)],
    sourcesContent: [source],
    names: [],
    mappings,
  };
  return `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.naide')) return nextLoad(url, context);

  const source = await readFile(new URL(url), 'utf8');
  const result = compile(source, {
    sourceFile: fileURLToPath(new URL(url)),
    preserveNaideImports: true,
  });
  const code = `${result.js}\n${inlineSourceMap(url, source, result.sourceMap)}\n`;
  return { format: 'module', shortCircuit: true, source: code };
}
