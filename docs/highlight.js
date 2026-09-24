document.addEventListener('DOMContentLoaded', () => {
  const KEYWORDS = new Set([
    'fn', 'ret', 'if', 'elif', 'else', 'each', 'for', 'while', 'match',
    'try', 'fail', 'ensure', 'server', 'model', 'schema', 'use', 'pub', 'mut',
    'log', 'typeof', 'instanceof', 'not', 'and', 'or', 'break', 'continue',
    'throw', 'new', 'await', 'test', 'assert', 'queue', 'job', 'db', 'env',
    'get', 'post', 'put', 'del', 'patch', 'crud', 'cors', 'auth', 'static',
    'cache', 'ws', 'sse', 'cookie', 'session', 'limit', 'upload', 'group',
    'validate', 'openapi', 'error', 'mid', 'prompt', 'bot', 'slash',
    'page', 'cli', 'mail', 'graphql', 'desktop', 'screen', 'every', 'watch',
    'oauth', 'pay', 'storage', 'pdf', 'i18n', 'push', 'search', 'image',
    'import', 'from', 'export',
    'const', 'let', 'var', 'function', 'async', 'return', 'class', 'extends',
    'try', 'catch', 'finally', 'if', 'else', 'for', 'while', 'switch', 'case',
    'default', 'def', 'True', 'False', 'None', 'pass', 'in', 'global',
  ]);

  const TYPES = new Set([
    'str', 'int', 'num', 'bool', 'list', 'map', 'any', 'json', 'void',
    'auto', 'required', 'optional', 'unique', 'default', 'min', 'max', 'email',
  ]);

  const BUILTINS = new Set([
    'log', 'assert', 'uuid', 'hash', 'verify', 'sign',
    'ai', 'api', 'console', 'print', 'jsonify', 'Flask',
    'createMock', 'createSpy', 'registerPlugin', 'usePlugin',
    'createVectorStore', 'createPrompt', 'createSchema', 'createStore',
  ]);

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      // Comments
      if (text[i] === '#' || (text[i] === '/' && text[i + 1] === '/')) {
        const end = text.indexOf('\n', i);
        const comment = end === -1 ? text.slice(i) : text.slice(i, end);
        tokens.push(`<span class="cmt">${escapeHtml(comment)}</span>`);
        i += comment.length;
        continue;
      }

      // Strings
      if (text[i] === '"' || text[i] === "'") {
        const q = text[i];
        let j = i + 1;
        while (j < text.length && text[j] !== q) {
          if (text[j] === '\\') j++;
          j++;
        }
        j++;
        tokens.push(`<span class="str">${escapeHtml(text.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Numbers
      if (/\d/.test(text[i]) && (i === 0 || /[\s(,=:[\{+\-*/]/.test(text[i - 1]))) {
        let j = i;
        while (j < text.length && /[\d.]/.test(text[j])) j++;
        tokens.push(`<span class="num">${escapeHtml(text.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Words
      if (/[a-zA-Z_]/.test(text[i])) {
        let j = i;
        while (j < text.length && /[\w.]/.test(text[j])) j++;
        const word = text.slice(i, j);
        const base = word.split('.')[0];
        if (TYPES.has(base)) {
          tokens.push(`<span class="type">${escapeHtml(word)}</span>`);
        } else if (KEYWORDS.has(base)) {
          tokens.push(`<span class="kw">${escapeHtml(word)}</span>`);
        } else if (BUILTINS.has(base)) {
          tokens.push(`<span class="bi">${escapeHtml(word)}</span>`);
        } else if (j < text.length && text[j] === '(') {
          tokens.push(`<span class="fn">${escapeHtml(word)}</span>`);
        } else {
          tokens.push(escapeHtml(word));
        }
        i = j;
        continue;
      }

      // Operators
      if (/[=+\-*/<>!&|%^~?:]/.test(text[i])) {
        tokens.push(`<span class="op">${escapeHtml(text[i])}</span>`);
        i++;
        continue;
      }

      tokens.push(escapeHtml(text[i]));
      i++;
    }
    return tokens.join('');
  }

  document.querySelectorAll('pre code').forEach(block => {
    block.innerHTML = highlight(block.textContent);
  });
});
