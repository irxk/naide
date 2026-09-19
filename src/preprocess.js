const TYPE_MAP = { s: 'str', i: 'int', n: 'num', b: 'bool', l: 'list', m: 'map', a: 'any', j: 'json', v: 'void' };
const TYPE_CHARS = new Set(Object.keys(TYPE_MAP));

function expandType(ch) { return TYPE_MAP[ch] || ch; }

function expandParams(paramStr) {
  if (!paramStr) return '';
  return paramStr.split(',').map(p => {
    p = p.trim();
    if (!p) return p;
    const m = p.match(/^(\.\.\.)?([ sinblmaj]):(.+)$/);
    if (m) return `${m[1] || ''}${expandType(m[2])} ${m[3]}`;
    const m2 = p.match(/^(\.\.\.)?([ sinblmaj])(\w+)$/);
    if (m2) return `${m2[1] || ''}${expandType(m2[2])} ${m2[3]}`;
    return p;
  }).join(', ');
}

function transformFunc(rest, isAsync, isPublic) {
  const pub = isPublic ? 'pub ' : '';
  const fn = isAsync ? 'fn.async' : 'fn';
  const nameM = rest.match(/^(\w+)/);
  if (!nameM) return `${pub}${fn} ${rest}:`;
  const name = nameM[1];
  let rem = rest.slice(name.length);

  let params = '';
  if (rem.startsWith('(')) {
    let depth = 1, i = 1;
    while (i < rem.length && depth > 0) {
      if (rem[i] === '(') depth++;
      if (rem[i] === ')') depth--;
      i++;
    }
    params = expandParams(rem.slice(1, i - 1));
    rem = rem.slice(i).trim();
  }

  let retType = '';
  if (rem.length > 0 && TYPE_CHARS.has(rem[0]) && (rem.length === 1 || !rem[1].match(/\w/))) {
    retType = ` -> ${expandType(rem[0])}`;
  }

  return `${pub}${fn} ${name}(${params})${retType}:`;
}

function transformRoute(method, rest) {
  const m = rest.match(/^("[^"]*")\s*(\([^)]*\))?\s*(.*)$/);
  if (!m) return `${method} ${rest}:`;
  const path = m[1];
  const routeParams = m[2] ? ` ${m[2]}` : '';
  const inline = m[3] ? m[3].trim() : '';

  if (inline) {
    const body = transformContent(inline);
    return `${method} ${path}${routeParams}:\n  ${body}`;
  }
  return `${method} ${path}${routeParams}:`;
}

function transformAwait(text) {
  // ~~ → await.all
  text = text.replace(/~~/g, 'await.all ');
  // ~ before identifier or ( → await (but not ~f, ~TYPE: which are handled at line level)
  text = text.replace(/~(\w)/g, (_, ch) => `await ${ch}`);
  text = text.replace(/~\(/g, 'await (');
  return text;
}

function transformContent(line) {
  // Log shorthands
  line = line.replace(/\blog\.e\b/g, 'log.error');
  line = line.replace(/\blog\.w\b/g, 'log.warn');
  // log"msg" → log "msg"
  line = line.replace(/\blog"/g, 'log "');
  line = line.replace(/\blog\.error"/g, 'log.error "');
  line = line.replace(/\blog\.warn"/g, 'log.warn "');
  // Await transforms
  line = transformAwait(line);
  return line;
}

export function preprocess(source) {
  const lines = source.split('\n');
  const result = [];

  for (let raw of lines) {
    const indentM = raw.match(/^(\s*)/);
    const indent = indentM ? indentM[1] : '';
    let line = raw.slice(indent.length);

    // Empty line
    if (!line.trim()) { result.push(''); continue; }

    // Comment: -- → #
    if (line.startsWith('--')) { result.push(indent + '#' + line.slice(2)); continue; }

    // Keep # comments as-is
    if (line.startsWith('#') && !line.startsWith('#=')) { result.push(raw); continue; }

    const first = line[0];
    const second = line[1] || '';
    let out = '';

    // > return
    if (first === '>' && second !== '=' && second !== '>') {
      const rest = line.slice(1).trim();
      if (rest.startsWith('.s ') || rest.startsWith('.s(')) {
        out = 'ret.status ' + transformContent(rest.slice(3));
      } else {
        out = rest ? 'ret ' + transformContent(rest) : 'ret';
      }
    }
    // ? if
    else if (first === '?' && second !== '.' && second !== '?') {
      out = 'if ' + transformContent(line.slice(1).trim()) + ':';
    }
    // | elif (but not |>)
    else if (first === '|' && second !== '>') {
      out = 'elif ' + transformContent(line.slice(1).trim()) + ':';
    }
    // : else (alone on line)
    else if (line.trim() === ':') {
      out = 'else:';
    }
    // @ loop
    else if (first === '@') {
      const rest = line.slice(1);
      const loopM = rest.match(/^(\w+(?:,\w+)?)<(.+)$/);
      if (loopM) {
        const vars = loopM[1];
        const col = transformContent(loopM[2]);
        if (col.includes('..')) {
          const [start, end] = col.split('..');
          out = `for ${vars} in ${start}..${end}:`;
        } else if (vars.includes(',')) {
          const [k, v] = vars.split(',');
          out = `each ${k}, ${v} in ${col}:`;
        } else {
          out = `each ${vars} in ${col}:`;
        }
      } else {
        out = transformContent(line);
      }
    }
    // * while
    else if (first === '*') {
      out = 'while ' + transformContent(line.slice(1).trim()) + ':';
    }
    // !! catch (before ! try check)
    else if (first === '!' && second === '!') {
      const rest = line.slice(2).trim();
      out = rest ? `fail ${rest}:` : 'fail:';
    }
    // ! try (alone)
    else if (line.trim() === '!') {
      out = 'try:';
    }
    // $ server
    else if (first === '$') {
      const rest = line.slice(1);
      const srvM = rest.match(/^(\w+):(.+)$/);
      if (srvM) {
        out = `server ${srvM[1]} port ${transformContent(srvM[2].trim())}:`;
      } else {
        out = `server ${rest.trim()}:`;
      }
    }
    // HTTP routes: G P U D
    else if (first === 'G' && second === '"') { out = transformRoute('get', line.slice(1)); }
    else if (first === 'P' && second === '"') { out = transformRoute('post', line.slice(1)); }
    else if (first === 'U' && second === '"') { out = transformRoute('put', line.slice(1)); }
    else if (first === 'D' && second === '"') { out = transformRoute('del', line.slice(1)); }
    // ^ model
    else if (first === '^') {
      const rest = line.slice(1).trim();
      const extM = rest.match(/^(\w+)<(\w+)$/);
      if (extM) {
        out = `model ${extM[1]} extends ${extM[2]}:`;
      } else {
        out = `model ${rest}:`;
      }
    }
    // < import
    else if (first === '<') {
      const rest = line.slice(1);
      if (rest.startsWith('{')) {
        const impM = rest.match(/^\{([^}]+)\}"(.+)"$/);
        if (impM) {
          out = `use {${impM[1]}} from "${impM[2]}"`;
        } else {
          out = transformContent(line);
        }
      } else {
        const fromM = rest.match(/^(\w+)"(.+)"$/);
        if (fromM) {
          out = `use ${fromM[1]} from "${fromM[2]}"`;
        } else {
          out = `use ${rest.trim()}`;
        }
      }
    }
    // % match
    else if (first === '%') {
      out = 'match ' + transformContent(line.slice(1).trim()) + ':';
    }
    // + export prefix
    else if (first === '+') {
      const inner = line.slice(1);
      if (inner.startsWith('~f ')) {
        out = transformFunc(inner.slice(3), true, true);
      } else if (inner.startsWith('f ')) {
        out = transformFunc(inner.slice(2), false, true);
      } else {
        const tvM = inner.match(/^([sinblmaj]):(\w+)=(.+)$/);
        if (tvM) {
          out = `pub ${expandType(tvM[1])} ${tvM[2]} = ${transformContent(tvM[3])}`;
        } else {
          out = 'pub ' + transformContent(inner);
        }
      }
    }
    // ~f async function
    else if (first === '~' && second === 'f' && line[2] === ' ') {
      out = transformFunc(line.slice(3), true, false);
    }
    // ~TYPE:name=value → mutable
    else if (first === '~' && TYPE_CHARS.has(second) && line[2] === ':') {
      const rest = line.slice(1);
      const tvM = rest.match(/^([sinblmaj]):(\w+)=(.+)$/);
      if (tvM) {
        out = `mut ${expandType(tvM[1])} ${tvM[2]} = ${transformContent(tvM[3])}`;
      } else {
        // Mutable field without assignment: ~s:name
        const fieldM = rest.match(/^([sinblmaj]):(\w+)$/);
        if (fieldM) {
          out = `mut ${expandType(fieldM[1])} ${fieldM[2]}`;
        } else {
          out = transformContent(line);
        }
      }
    }
    // f function
    else if (first === 'f' && second === ' ') {
      out = transformFunc(line.slice(2), false, false);
    }
    // TYPE:name=value → typed variable
    else if (TYPE_CHARS.has(first) && second === ':') {
      const rest = line;
      const tvM = rest.match(/^([sinblmaj]):(\w+)=(.+)$/);
      if (tvM) {
        out = `${expandType(tvM[1])} ${tvM[2]} = ${transformContent(tvM[3])}`;
      } else {
        // Could be a type field in model: s:name (no assignment)
        const fieldM = rest.match(/^([sinblmaj]):(\w+)$/);
        if (fieldM) {
          out = `${expandType(fieldM[1])} ${fieldM[2]}`;
        } else {
          // type:name=... with complex value
          const fieldDefM = rest.match(/^([sinblmaj]):(\w+)=(.+)$/);
          if (fieldDefM) {
            out = `${expandType(fieldDefM[1])} ${fieldDefM[2]} = ${transformContent(fieldDefM[3])}`;
          } else {
            out = transformContent(line);
          }
        }
      }
    }
    // Default: apply inline transforms
    else {
      out = transformContent(line);
    }

    // Handle multi-line output from route transform
    if (out.includes('\n')) {
      const subLines = out.split('\n');
      for (const sl of subLines) {
        result.push(indent + sl);
      }
    } else {
      result.push(indent + out);
    }
  }

  return result.join('\n');
}
