import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWebProject, startWebDevServer } from '../src/web-dev.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cliPath = join(root, 'bin', 'naide.js');
const hostPath = join(root, 'bin', 'naide-host.js');
const loaderUrl = pathToFileURL(join(root, 'src', 'loader.js')).href;

function makeProject() {
  const directory = mkdtempSync(join(tmpdir(), 'naide-native-meld-'));
  mkdirSync(join(directory, 'node_modules', 'fixture-upper'), { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(directory, 'node_modules', 'fixture-upper', 'package.json'), JSON.stringify({
    name: 'fixture-upper',
    type: 'module',
    exports: './index.js',
  }));
  writeFileSync(join(directory, 'node_modules', 'fixture-upper', 'index.js'), 'export default value => value.toUpperCase();\n');
  writeFileSync(join(directory, 'helper.js'), 'export function addSuffix(value) { return `${value}!`; }\n');
  writeFileSync(join(directory, 'greeting.naide'), [
    'use { basename } from "node:path"',
    'use upper from "fixture-upper"',
    'use { addSuffix } from "./helper.js"',
    'pub fn display(str path) -> str:',
    '  ret addSuffix(upper(basename(path)))',
    '',
  ].join('\n'));
  return directory;
}

describe('Native-Meld for Node.js projects', () => {
  it('starts a hosted project from only nidpackage.json and its NAIDE entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-hosted-project-'));
    try {
      mkdirSync(join(directory, 'node_modules', 'fixture-upper'), { recursive: true });
      symlinkSync(root, join(directory, 'node_modules', 'naider'), 'junction');
      writeFileSync(join(directory, 'node_modules', 'fixture-upper', 'package.json'), JSON.stringify({
        name: 'fixture-upper',
        type: 'module',
        exports: './index.js',
      }));
      writeFileSync(join(directory, 'node_modules', 'fixture-upper', 'index.js'), 'export default value => value.toUpperCase();\n');
      writeFileSync(join(directory, 'nidpackage.json'), JSON.stringify({
        main: 'node_modules/naider/bin/naide-host.js',
        naide: { entry: 'discord-bot.naide' },
        dependencies: { naider: '^2.0.7', 'fixture-upper': '^1.0.0' },
      }));
      writeFileSync(join(directory, 'discord-bot.naide'), [
        'use upper from "fixture-upper"',
        'log upper("hosted NAIDE")',
        '',
      ].join('\n'));

      const result = spawnSync(process.execPath, [hostPath], { cwd: directory, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.stdout.trim(), 'HOSTED NAIDE');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects host manifest entry paths that escape the project directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-hosted-path-check-'));
    try {
      writeFileSync(join(directory, 'nidpackage.json'), JSON.stringify({
        naide: { entry: '../outside.naide' },
      }));
      const result = spawnSync(process.execPath, [hostPath], { cwd: directory, encoding: 'utf8' });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must stay inside the project directory/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('runs a .naide entry file directly with the package register hook', () => {
    const directory = makeProject();
    try {
      symlinkSync(root, join(directory, 'node_modules', 'naider'), 'junction');
      writeFileSync(join(directory, 'discord_bot.naide'), 'log "DIRECT_NAIDE_ENTRY"\n');

      const result = spawnSync(process.execPath, [
        '--enable-source-maps',
        '--import',
        'naider/register',
        'discord_bot.naide',
      ], { cwd: directory, encoding: 'utf8' });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'DIRECT_NAIDE_ENTRY');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('lets a Node.js host import NAIDE and lets NAIDE import Node and npm modules', () => {
    const directory = makeProject();
    try {
      writeFileSync(join(directory, 'app.js'), [
        "import { display } from './greeting.naide';",
        "console.log(display('/tmp/naide.txt'));",
        '',
      ].join('\n'));
      const result = spawnSync(process.execPath, [
        '--no-warnings',
        '--loader',
        loaderUrl,
        join(directory, 'app.js'),
      ], { cwd: directory, encoding: 'utf8' });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'NAIDE.TXT!');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('builds runtime-free ESM modules importable from a regular Node.js host', () => {
    const directory = makeProject();
    try {
      writeFileSync(join(directory, 'greeting.naide'), [
        'use { basename } from "node:path"',
        'use upper from "fixture-upper"',
        'pub fn display(str path) -> str:',
        '  ret upper(basename(path))',
        '',
      ].join('\n'));
      const build = spawnSync(process.execPath, [cliPath, 'build', directory, join(directory, 'dist')], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(build.status, 0, build.stdout + build.stderr);

      const builtModule = readFileSync(join(directory, 'dist', 'greeting.mjs'), 'utf8');
      assert.match(builtModule, /export function display/);
      assert.doesNotMatch(builtModule, /from ['"]naider\/runtime['"]/);
      writeFileSync(join(directory, 'app.js'), [
        "import { display } from './dist/greeting.mjs';",
        "console.log(display('/tmp/native-meld.txt'));",
        '',
      ].join('\n'));
      const result = spawnSync(process.execPath, [join(directory, 'app.js')], {
        cwd: directory,
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'NATIVE-MELD.TXT');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('maps Node.js runtime errors back to the original NAIDE file and line', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-native-meld-map-'));
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
      writeFileSync(join(directory, 'broken.naide'), [
        'pub fn explode() -> any:',
        '  throw "meld failure"',
        '',
      ].join('\n'));
      writeFileSync(join(directory, 'app.js'), [
        "import { explode } from './broken.naide';",
        'explode();',
        '',
      ].join('\n'));
      const result = spawnSync(process.execPath, [
        '--enable-source-maps',
        '--no-warnings',
        '--loader',
        loaderUrl,
        join(directory, 'app.js'),
      ], { cwd: directory, encoding: 'utf8' });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /broken\.naide:2:\d+/);
      assert.match(result.stderr, /Error: meld failure/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('hosted Discord bot starter', () => {
  it('provides a two-file host project with a NAIDE source and dependency manifest', () => {
    const example = join(root, 'examples', 'mws-discord');
    const manifest = JSON.parse(readFileSync(join(example, 'nidpackage.json'), 'utf8'));
    const source = readFileSync(join(example, 'discord-bot.naide'), 'utf8');

    assert.equal(manifest.main, 'node_modules/naider/bin/naide-host.js');
    assert.equal(manifest.naide.entry, 'discord-bot.naide');
    assert.equal(manifest.dependencies.naider, '^2.0.7');
    assert.ok(manifest.dependencies['discord.js']);

    const check = spawnSync(process.execPath, [cliPath, 'check', join(example, 'discord-bot.naide')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.match(source, /process\.env\.BOT_TOKEN/);
  });

  describe('NAIDE browser application build', () => {
      it('builds and serves a NAIDE web project without exposing its sources or manifests', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-web-dev-server-'));
        let server;
        try {
          writeFileSync(join(directory, 'app.naide'), [
            'page "index.html":',
            '  title "NAIDE Site"',
            '  style "styles.css"',
            '  main "#app":',
            '    h1 "Built with NAIDE"',
            '    module "build/client.mjs"',
            '',
          ].join('\n'));
          writeFileSync(join(directory, 'client.naide'), [
            'use { listen } from "naide:browser"',
            'fn start(any event):',
            '  log "started"',
            'listen("#app", "click", start)',
            '',
          ].join('\n'));
          writeFileSync(join(directory, 'styles.css'), 'body { color: navy; }\n');
          writeFileSync(join(directory, 'nidpackage.json'), '{"dependencies":{}}\n');
          writeFileSync(join(directory, '.env'), 'SECRET=private\n');

          const build = buildWebProject(directory, { cliPath });
          assert.equal(build.needsBrowserBundle, true);
          assert.ok(existsSync(join(directory, 'index.html')));
          assert.ok(existsSync(join(directory, 'build', 'client.mjs')));

          server = await startWebDevServer(directory, { port: 0, pollMs: 50, debounceMs: 20 });
          const baseUrl = `http://${server.host}:${server.port}`;
          const page = await fetch(baseUrl);
          assert.equal(page.status, 200);
          assert.match(page.headers.get('content-type'), /text\/html/);
          assert.match(await page.text(), /Built with NAIDE/);
          assert.match(await (await fetch(`${baseUrl}/build/client.mjs`)).text(), /function start/);
          assert.match(await (await fetch(`${baseUrl}/styles.css`)).text(), /color: navy/);

          for (const privatePath of ['/app.naide', '/nidpackage.json', '/.env', '/package.json', '/node_modules/', '/naide_modules/']) {
            assert.equal((await fetch(`${baseUrl}${privatePath}`)).status, 404, privatePath);
          }
          assert.equal((await fetch(`${baseUrl}/missing.css`)).status, 404);
        } finally {
          if (server) await server.close();
          rmSync(directory, { recursive: true, force: true });
        }
      });

      it('runs the web development workflow through the naide dev command', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-web-dev-cli-'));
        let output = '';
        let child;
        let eventReader;
        try {
          const initialized = spawnSync(process.execPath, [
            cliPath, 'init', directory, '--template', 'web',
          ], { cwd: root, encoding: 'utf8' });
          assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
          assert.ok(existsSync(join(directory, 'nidpackage.json')));
          assert.equal(existsSync(join(directory, 'package.json')), false);

          child = spawn(process.execPath, [cliPath, 'dev', directory, '--port', '0'], {
            cwd: root,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const url = await new Promise((resolveUrl, rejectUrl) => {
            const timeout = setTimeout(() => rejectUrl(new Error(`Timed out waiting for dev server:\n${output}`)), 10000);
            const onOutput = chunk => {
              output += chunk.toString();
              const match = output.match(/Web development server: (http:\/\/127\.0\.0\.1:\d+)/);
              if (!match) return;
              clearTimeout(timeout);
              resolveUrl(match[1]);
            };
            child.stdout.on('data', onOutput);
            child.stderr.on('data', onOutput);
            child.once('error', error => {
              clearTimeout(timeout);
              rejectUrl(error);
            });
            child.once('exit', code => {
              clearTimeout(timeout);
              rejectUrl(new Error(`Dev server exited with ${code} before becoming ready:\n${output}`));
            });
          });
          const response = await fetch(url);
          assert.equal(response.status, 200);
          assert.match(await response.text(), /今日のタスクを整理しよう/);
          assert.match(await (await fetch(`${url}/build/client.mjs`)).text(), /taskCount\.update/);

          const events = await fetch(`${url}/__naide/events`);
          eventReader = events.body.getReader();
          await eventReader.read();
          let eventBuffer = '';
          const readUntil = async pattern => {
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
              const match = pattern.exec(eventBuffer);
              if (match) {
                const end = match.index + match[0].length;
                const received = eventBuffer.slice(0, end);
                eventBuffer = eventBuffer.slice(end);
                return received;
              }
              const remaining = deadline - Date.now();
              let timeout;
              let result;
              try {
                result = await Promise.race([
                  eventReader.read(),
                  new Promise((_, reject) => {
                    timeout = setTimeout(() => reject(new Error(`Timed out waiting for web dev event ${pattern}: ${eventBuffer}\n${output}`)), remaining);
                  }),
                ]);
              } finally {
                clearTimeout(timeout);
              }
              const { value, done } = result;
              if (done) break;
              eventBuffer += new TextDecoder().decode(value);
            }
            throw new Error(`Timed out waiting for web dev event ${pattern}: ${eventBuffer}\n${output}`);
          };
          const updatedSource = readFileSync(join(directory, 'app.naide'), 'utf8')
            .replace('今日のタスクを整理しよう', 'NAIDEのライブリロード');
          writeFileSync(join(directory, 'app.naide'), updatedSource);
          await readUntil(/data: \{"type":"reload"\}/);
          assert.match(await (await fetch(url)).text(), /NAIDEのライブリロード/);

          writeFileSync(join(directory, 'app.naide'), [
            'page "index.html":',
            '  input:',
            '    attr "onclick" "alert(1)"',
            '',
          ].join('\n'));
          await readUntil(/data: \{"type":"error"/);
          assert.match(await (await fetch(url)).text(), /NAIDEのライブリロード/);
        } finally {
          await eventReader?.cancel();
          if (child && child.exitCode === null) {
            const stopped = new Promise(resolveExit => child.once('exit', resolveExit));
            child.kill('SIGTERM');
            await stopped;
          }
          rmSync(directory, { recursive: true, force: true });
        }
      });

      it('rejects web page outputs that escape the project directory', () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-web-output-path-'));
        try {
          writeFileSync(join(directory, 'app.naide'), 'page "../../outside.html":\n  h1 "No"\n');
          assert.throws(
            () => buildWebProject(directory, { cliPath }),
            /Page output must stay inside the web project/,
          );
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      it('rejects web page outputs that traverse a symbolic link', () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-web-output-link-'));
        const outside = mkdtempSync(join(tmpdir(), 'naide-web-output-target-'));
        try {
          symlinkSync(outside, join(directory, 'linked'), 'junction');
          writeFileSync(join(directory, 'app.naide'), 'page "linked/index.html":\n  h1 "No"\n');
          assert.throws(
            () => buildWebProject(directory, { cliPath }),
            /Page output must not traverse a symbolic link/,
          );
          assert.equal(existsSync(join(outside, 'index.html')), false);
        } finally {
          rmSync(directory, { recursive: true, force: true });
          rmSync(outside, { recursive: true, force: true });
        }
      });

      it('builds a .naide client module and generates HTML that loads it', () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-browser-app-'));
        const buildDirectory = join(directory, 'build');
        try {
          writeFileSync(join(directory, 'app.naide'), [
            'page "index.html":',
            '  lang "ja"',
            '  title "NAIDE Browser App"',
            '  importmap "chart.js" "https://esm.sh/chart.js/auto"',
            '  main "#app":',
            '    button "#start" "Start"',
            '    canvas "#game" "320" "200"',
            '  module "build/game.mjs"',
            '',
          ].join('\n'));
          writeFileSync(join(directory, 'game.naide'), [
            'use { select, canvas2d, listen, animate } from "naide:browser"',
            'any canvas = select("#game")',
            'any context = canvas2d(canvas)',
            'fn draw(num delta, num elapsed):',
            '  context.clearRect(0, 0, canvas.width, canvas.height)',
            'fn start(any event):',
            '  log "started"',
            'listen("#start", "click", start)',
            'animate(draw)',
            '',
          ].join('\n'));

          const build = spawnSync(process.execPath, [cliPath, 'build', directory, buildDirectory], {
            cwd: root,
            encoding: 'utf8',
          });
          assert.equal(build.status, 0, build.stdout + build.stderr);
          assert.ok(existsSync(join(buildDirectory, 'game.mjs')));
          assert.ok(existsSync(join(buildDirectory, 'app.mjs')));

          const generatePage = spawnSync(process.execPath, [join(buildDirectory, 'app.mjs')], {
            cwd: directory,
            encoding: 'utf8',
          });
          assert.equal(generatePage.status, 0, generatePage.stdout + generatePage.stderr);
          const html = readFileSync(join(directory, 'index.html'), 'utf8');
          assert.match(html, /<html lang="ja">/);
          assert.match(html, /<script type="importmap">\{"imports":\{"chart\.js":"https:\/\/esm\.sh\/chart\.js\/auto"\}\}<\/script>/);
          assert.match(html, /<button id="start">Start<\/button>/);
          assert.match(html, /<canvas id="game" width="320" height="200"><\/canvas>/);
          assert.match(html, /<script type="module" src="build\/game\.mjs"><\/script>/);
          assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
          assert.doesNotMatch(readFileSync(join(buildDirectory, 'game.mjs'), 'utf8'), /from ["']naide:browser["']/);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      it('bundles installed browser-compatible npm packages while keeping import-map modules external', () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-browser-bundle-'));
        const buildDirectory = join(directory, 'build');
        const packageDirectory = join(directory, 'node_modules', 'fixture-browser-package');
        mkdirSync(packageDirectory, { recursive: true });
        try {
          writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({
            name: 'fixture-browser-package',
            type: 'module',
            exports: './index.js',
          }));
          writeFileSync(join(packageDirectory, 'style.css'), '.fixture-browser-package { color: red; }\n');
          writeFileSync(
            join(packageDirectory, 'index.js'),
            'import "./style.css";\nexport default value => `LOCAL_BROWSER_PACKAGE:${value}`;\n',
          );
          writeFileSync(join(directory, 'plugin.naide'), 'pub str name = "LOCAL_NAIDE_PLUGIN"\n');
          writeFileSync(join(directory, 'app.naide'), [
            'page "index.html":',
            '  importmap "remote-browser-package" "https://cdn.example/remote.mjs"',
            '  module "build/client.mjs"',
            '',
          ].join('\n'));
          writeFileSync(join(directory, 'client.naide'), [
            'use greet from "fixture-browser-package"',
            'use remoteValue from "remote-browser-package"',
            'any dynamicallyLoaded = await import("fixture-browser-package")',
            'any localPlugin = await import("./plugin.naide")',
            'log greet("works")',
            'log dynamicallyLoaded.default("dynamic")',
            'log localPlugin.name',
            'log remoteValue',
            '',
          ].join('\n'));

          const build = spawnSync(process.execPath, [
            cliPath,
            'build',
            directory,
            buildDirectory,
            '--bundle-browser',
          ], { cwd: root, encoding: 'utf8' });
          assert.equal(build.status, 0, build.stdout + build.stderr);
          assert.match(build.stdout, /Bundled browser module build[\\/]client\.mjs/);

          const bundle = readFileSync(join(buildDirectory, 'client.mjs'), 'utf8');
          assert.match(bundle, /LOCAL_BROWSER_PACKAGE:/);
          assert.match(bundle, /LOCAL_NAIDE_PLUGIN/);
          assert.doesNotMatch(bundle, /from ["']fixture-browser-package["']/);
          assert.doesNotMatch(bundle, /import\(["']fixture-browser-package["']\)/);
          assert.doesNotMatch(bundle, /import\(["']\.\/plugin\.mjs["']\)/);
          assert.match(bundle, /from ["']remote-browser-package["']/);
          assert.match(bundle, /data-naide-css/);
          assert.match(bundle, /new URL\("\.\/client\.css", import\.meta\.url\)/);
          assert.match(readFileSync(join(buildDirectory, 'client.css'), 'utf8'), /\.fixture-browser-package\s*\{\s*color:\s*red;/);
          const syntaxCheck = spawnSync(process.execPath, ['--check', join(buildDirectory, 'client.mjs')], {
            cwd: directory,
            encoding: 'utf8',
          });
          assert.equal(syntaxCheck.status, 0, syntaxCheck.stdout + syntaxCheck.stderr);

          const generatePage = spawnSync(process.execPath, [join(buildDirectory, 'app.mjs')], {
            cwd: directory,
            encoding: 'utf8',
          });
          assert.equal(generatePage.status, 0, generatePage.stdout + generatePage.stderr);
          const html = readFileSync(join(directory, 'index.html'), 'utf8');
          assert.match(html, /type="importmap"/);
          assert.match(html, /type="module" src="build\/client\.mjs"/);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      it('rejects Node-only imports in browser bundle mode', () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-browser-node-api-'));
        const buildDirectory = join(directory, 'build');
        try {
          writeFileSync(join(directory, 'app.naide'), [
            'page "index.html":',
            '  module "build/client.mjs"',
            '',
          ].join('\n'));
          writeFileSync(join(directory, 'client.naide'), [
            'use { readFileSync } from "node:fs"',
            'log readFileSync("data.txt", "utf8")',
            '',
          ].join('\n'));

          const build = spawnSync(process.execPath, [
            cliPath,
            'build',
            directory,
            buildDirectory,
            '--bundle-browser',
          ], { cwd: root, encoding: 'utf8' });
          assert.equal(build.status, 1);
          assert.match(build.stderr, /node:fs/);
          assert.match(build.stderr, /FAIL Browser bundling/);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      it('rejects browser bundle entry paths that escape the project directory', () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-browser-path-escape-'));
        const projectDirectory = join(directory, 'project');
        const buildDirectory = join(projectDirectory, 'build');
        const outsidePath = join(directory, 'outside.mjs');
        try {
          mkdirSync(projectDirectory, { recursive: true });
          writeFileSync(outsidePath, 'export default "unchanged";\n');
          writeFileSync(join(projectDirectory, 'app.naide'), [
            'page "index.html":',
            '  module "../outside.mjs"',
            '',
          ].join('\n'));

          const build = spawnSync(process.execPath, [
            cliPath,
            'build',
            projectDirectory,
            buildDirectory,
            '--bundle-browser',
          ], { cwd: root, encoding: 'utf8' });
          assert.equal(build.status, 1);
          assert.match(build.stderr, /must stay inside the project directory/);
          assert.equal(readFileSync(outsidePath, 'utf8'), 'export default "unchanged";\n');
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      it('rejects browser bundle entries that traverse a symlink outside the project', () => {
        const directory = mkdtempSync(join(tmpdir(), 'naide-browser-symlink-escape-'));
        const projectDirectory = join(directory, 'project');
        const externalDirectory = join(directory, 'external');
        const buildDirectory = join(projectDirectory, 'build');
        const externalEntry = join(externalDirectory, 'client.mjs');
        try {
          mkdirSync(projectDirectory, { recursive: true });
          mkdirSync(externalDirectory, { recursive: true });
          writeFileSync(externalEntry, 'export default "unchanged";\n');
          symlinkSync(externalDirectory, join(projectDirectory, 'linked'), 'junction');
          writeFileSync(join(projectDirectory, 'app.naide'), [
            'page "index.html":',
            '  module "linked/client.mjs"',
            '',
          ].join('\n'));

          const build = spawnSync(process.execPath, [
            cliPath,
            'build',
            projectDirectory,
            buildDirectory,
            '--bundle-browser',
          ], { cwd: root, encoding: 'utf8' });
          assert.equal(build.status, 1);
          assert.match(build.stderr, /must not traverse a symbolic link/);
          assert.equal(readFileSync(externalEntry, 'utf8'), 'export default "unchanged";\n');
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });
    });

  it('starts bot.naide through the host runner and handles a slash command', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-mws-discord-'));
    try {
      const scaffold = spawnSync(process.execPath, [cliPath, 'mws', 'discord', directory], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(scaffold.status, 0, scaffold.stdout + scaffold.stderr);
      const project = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      assert.equal(project.type, 'module');
      assert.equal(project.main, 'node_modules/naider/bin/naide-host.js');
      assert.equal(project.engines.node, '>=18.19.0');
      assert.equal(project.scripts.start, 'node --enable-source-maps node_modules/naider/bin/naide-host.js');
      assert.equal(project.dependencies.naider, `^${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`);
      assert.equal(project.dependencies['discord.js'], '^14.27.0');
      const hostedManifest = JSON.parse(readFileSync(join(directory, 'nidpackage.json'), 'utf8'));
      assert.equal(hostedManifest.main, 'node_modules/naider/bin/naide-host.js');
      assert.equal(hostedManifest.naide.entry, 'bot.naide');
      assert.deepEqual(hostedManifest.dependencies, project.dependencies);
      assert.match(readFileSync(join(directory, 'bot.naide'), 'utf8'), /process\.env\.BOT_TOKEN/);
      assert.match(readFileSync(join(directory, 'MWS.md'), 'utf8'), /BOT_TOKEN/);
      assert.match(readFileSync(join(directory, 'MWS.md'), 'utf8'), /upload `bot\.naide` and `nidpackage\.json`/);
      assert.match(readFileSync(join(directory, 'MWS.md'), 'utf8'), /if MWS does not honor that convention/);
      assert.equal(existsSync(join(directory, 'index.js')), false);

      const discordDirectory = join(directory, 'node_modules', 'discord.js');
      mkdirSync(discordDirectory, { recursive: true });
      symlinkSync(root, join(directory, 'node_modules', 'naider'), 'junction');
      writeFileSync(join(discordDirectory, 'package.json'), JSON.stringify({
        name: 'discord.js',
        type: 'module',
        exports: './index.js',
      }));
      writeFileSync(join(discordDirectory, 'index.js'), `
export const GatewayIntentBits = { Guilds: 1, GuildMessages: 2, MessageContent: 4 };
export const Routes = {
  applicationCommands: id => \`commands:\${id}\`,
  applicationGuildCommands: (app, guild) => \`guild-commands:\${app}:\${guild}\`,
};
export class SlashCommandBuilder {
  setName(name) { this.name = name; return this; }
  setDescription(description) { this.description = description; return this; }
}
export class REST {
  setToken(token) { this.token = token; return this; }
  async put(route, { body }) { console.log(\`REGISTERED:\${this.token}:\${route}:\${body[0].name}\`); }
}
export class Client {
  constructor(options) { this.options = options; this.handlers = new Map(); this.user = { id: 'fixture-app' }; }
  on(event, handler) { this.handlers.set(event, handler); return this; }
  once(event, handler) { this.handlers.set(\`once:\${event}\`, handler); return this; }
  login(token) {
    if (token !== 'test-token') throw new Error('missing bot token');
    queueMicrotask(async () => {
      await this.handlers.get('ready')?.();
      await this.handlers.get('once:ready')?.();
      await this.handlers.get('interactionCreate')?.({
        isChatInputCommand: () => true,
        commandName: 'ping',
        reply: async message => console.log(\`REPLY:\${message}\`),
      });
    });
    return Promise.resolve(token);
  }
}
`);
      const run = spawnSync(process.execPath, ['--no-warnings', '--enable-source-maps', project.main], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, BOT_TOKEN: 'test-token' },
      });

      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, /NAIDE bot is online!/);
      assert.match(run.stdout, /REGISTERED:test-token:commands:fixture-app:ping/);
      assert.match(run.stdout, /REPLY:Pong!/);

      const guildRun = spawnSync(process.execPath, ['--no-warnings', '--enable-source-maps', project.main], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, BOT_TOKEN: 'test-token', DISCORD_GUILD_ID: 'fixture-guild' },
      });
      assert.equal(guildRun.status, 0, guildRun.stdout + guildRun.stderr);
      assert.match(guildRun.stdout, /REGISTERED:test-token:guild-commands:fixture-app:fixture-guild:ping/);

      const collision = spawnSync(process.execPath, [cliPath, 'mws', 'discord', directory], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(collision.status, 1);
      assert.match(collision.stderr, /refusing to overwrite/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
