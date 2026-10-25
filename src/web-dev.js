import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from './index.js';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function walkNaideFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['build', 'dist', 'node_modules'].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkNaideFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.naide')) files.push(path);
  }
  return files;
}

function hasLocalBrowserModule(ast) {
  const visit = elements => elements.some(element => {
    const module = element.tag === 'module' ? element.args[0] : null;
    const url = module?.parts?.map(part => part.value).join('');
    return Boolean(url && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url) && url.endsWith('.mjs'))
      || visit(element.children || []);
  });
  return ast.body.some(node => node.type === 'Page' && visit(node.elements));
}

function literalPageFilename(page) {
  if (!page.filename?.parts || page.filename.parts.some(part => part.type !== 'text')) {
    throw new Error('Web pages require a literal page filename.');
  }
  return page.filename.parts.map(part => part.value).join('');
}

function rejectSymlinkPath(root, target) {
  let current = root;
  for (const segment of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`Page output must not traverse a symbolic link: ${target}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')}`);
}

function writePages(root, buildDirectory, pageFiles) {
  for (const sourceFile of pageFiles) {
    const outputName = relative(root, sourceFile).replace(/\.naide$/, '.mjs');
    const outputFile = resolve(buildDirectory, outputName);
    runCommand(process.execPath, [outputFile], root);
  }
}

export function buildWebProject(root, {
  cliPath = fileURLToPath(new URL('../bin/naide.js', import.meta.url)),
  buildDirectory = join(root, 'build'),
} = {}) {
  const projectRoot = resolve(root);
  const outputDirectory = resolve(buildDirectory);
  const sources = walkNaideFiles(projectRoot);
  if (sources.length === 0) throw new Error('No .naide source files found in the project.');

  const pageFiles = [];
  const pagePaths = [];
  let needsBrowserBundle = false;
  for (const sourceFile of sources) {
    const source = readFileSync(sourceFile, 'utf8');
    const ast = compile(source).ast;
    const pages = ast.body.filter(node => node.type === 'Page');
    if (pages.length > 0) {
      pageFiles.push(sourceFile);
      for (const page of pages) {
        const pagePath = resolve(projectRoot, literalPageFilename(page));
        if (pagePath !== projectRoot && !pagePath.startsWith(`${projectRoot}${sep}`)) {
          throw new Error(`Page output must stay inside the web project: ${literalPageFilename(page)}`);
        }
        rejectSymlinkPath(projectRoot, pagePath);
        pagePaths.push(pagePath);
        mkdirSync(dirname(pagePath), { recursive: true });
      }
      if (hasLocalBrowserModule(ast)) needsBrowserBundle = true;
    }
  }

  const buildArgs = [cliPath, 'build', projectRoot, outputDirectory];
  if (needsBrowserBundle) buildArgs.push('--bundle-browser');
  runCommand(process.execPath, buildArgs, projectRoot);
  writePages(projectRoot, outputDirectory, pageFiles);

  if (!existsSync(join(projectRoot, 'index.html'))) {
    throw new Error('The web project must generate an index.html page.');
  }
  return { pageFiles, pagePaths, buildDirectory: outputDirectory, needsBrowserBundle };
}

function snapshotFiles(root, ignoredPaths) {
  const snapshot = new Map();
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['build', 'dist', 'node_modules'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && !ignoredPaths.has(path)) {
        const info = statSync(path);
        snapshot.set(path, `${info.size}:${info.mtimeMs}`);
      }
    }
  };
  visit(root);
  return snapshot;
}

function changedFiles(previous, current) {
  const changed = [];
  for (const [path, value] of current) {
    if (previous.get(path) !== value) changed.push(path);
  }
  for (const path of previous.keys()) {
    if (!current.has(path)) changed.push(path);
  }
  return changed;
}

function liveReloadScript() {
  return `<script>(()=>{const events=new EventSource("/__naide/events");events.onmessage=({data})=>{let event;try{event=JSON.parse(data)}catch{return}if(event.type==="reload")location.reload();if(event.type==="error"){let panel=document.getElementById("__naide-error");if(!panel){panel=document.createElement("pre");panel.id="__naide-error";panel.style.cssText="position:fixed;inset:12px 12px auto;z-index:2147483647;max-height:45vh;overflow:auto;padding:16px;background:#401d25;color:#fff;border:1px solid #e35d6a;border-radius:8px;white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace";document.body.append(panel)}panel.textContent="NAIDE build failed\\n"+event.message}if(event.type==="reload")document.getElementById("__naide-error")?.remove()}})()</script>`;
}

export function startWebDevServer(root, {
  host = '127.0.0.1',
  port = 5173,
  pollMs = 500,
  debounceMs = 180,
  ignoredPaths = new Set(),
  onChange = null,
} = {}) {
  const requestedRoot = resolve(root);
  const projectRoot = realpathSync(resolve(root));
  const normalizedIgnoredPaths = [...ignoredPaths].map(path =>
    resolve(projectRoot, relative(requestedRoot, resolve(path))));
  ignoredPaths.clear();
  for (const path of normalizedIgnoredPaths) ignoredPaths.add(path);
  const ignored = ignoredPaths;
  const clients = new Set();
  const sendEvent = event => {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(message);
  };

  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    const segments = pathname.split('/').filter(Boolean);
    const blockedNames = new Set([
      '.env', '.npmrc', '.gitignore', 'package.json', 'package-lock.json', 'nidpackage.json',
    ]);
    if (segments.some(segment => segment.startsWith('.') || blockedNames.has(segment.toLowerCase())
      || segment.toLowerCase().endsWith('.naide') || segment.toLowerCase().endsWith('.nx')
      || segment.toLowerCase() === 'node_modules')) {
      response.writeHead(404).end('Not found');
      return;
    }
    if (pathname === '/__naide/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }

    let filePath = resolve(projectRoot, `.${pathname}`);
    if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      if (!existsSync(filePath)) {
        response.writeHead(404).end('Not found');
        return;
      }
      const actualPath = realpathSync(filePath);
      if (actualPath !== projectRoot && !actualPath.startsWith(`${projectRoot}${sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      filePath = statSync(actualPath).isDirectory() ? join(actualPath, 'index.html') : actualPath;
      if (!existsSync(filePath)) {
        response.writeHead(404).end('Not found');
        return;
      }
      const contentType = MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
      response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      if (extname(filePath).toLowerCase() === '.html') {
        let html = readFileSync(filePath, 'utf8');
        const injection = liveReloadScript();
        html = html.includes('</body>') ? html.replace('</body>', `${injection}</body>`) : `${html}${injection}`;
        response.end(html);
        return;
      }
      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(500).end('Internal server error');
    }
  });

  let snapshot = snapshotFiles(projectRoot, ignored);
  let timer = null;
  let building = false;
  let pending = false;
  const scan = () => {
    const next = snapshotFiles(projectRoot, ignored);
    const changed = changedFiles(snapshot, next);
    if (changed.length === 0) return;
    if (building) {
      pending = true;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      snapshot = snapshotFiles(projectRoot, ignored);
      building = true;
      try {
        await onChange?.(changed);
        sendEvent({ type: 'reload' });
      } catch (error) {
        sendEvent({ type: 'error', message: error.message });
        console.error(`[NAIDE] Web rebuild failed: ${error.message}`);
      } finally {
        building = false;
        if (pending) {
          pending = false;
          scan();
        }
      }
    }, debounceMs);
  };
  const poll = setInterval(scan, pollMs);
  poll.unref();

  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      resolveServer({
        host,
        port: typeof address === 'object' && address ? address.port : port,
        close: () => new Promise((resolveClose, rejectClose) => {
          clearInterval(poll);
          if (timer) clearTimeout(timer);
          for (const client of clients) client.end();
          clients.clear();
          server.close(error => error ? rejectClose(error) : resolveClose());
        }),
      });
    });
  });
}
