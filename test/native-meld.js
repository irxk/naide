import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cliPath = join(root, 'bin', 'naide.js');
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

describe('MWS Discord bot starter', () => {
  it('starts bot.naide directly in Node and handles a slash command', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naide-mws-discord-'));
    try {
      const scaffold = spawnSync(process.execPath, [cliPath, 'mws', 'discord', directory], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(scaffold.status, 0, scaffold.stdout + scaffold.stderr);
      const project = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      assert.equal(project.type, 'module');
      assert.equal(project.main, 'index.js');
      assert.equal(project.engines.node, '>=18.19.0');
      assert.equal(project.scripts.start, 'node --enable-source-maps index.js');
      assert.equal(project.dependencies.naider, `^${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`);
      assert.equal(project.dependencies['discord.js'], '^14.27.0');
      assert.match(readFileSync(join(directory, 'bot.naide'), 'utf8'), /process\.env\.BOT_TOKEN/);
      assert.match(readFileSync(join(directory, 'MWS.md'), 'utf8'), /BOT_TOKEN/);
      assert.match(readFileSync(join(directory, 'MWS.md'), 'utf8'), /runs the NAIDE source file itself inside the Node\.js host/);
      assert.match(readFileSync(join(directory, 'index.js'), 'utf8'), /register\('naider\/loader'/);
      assert.match(readFileSync(join(directory, 'index.js'), 'utf8'), /import\('\.\/bot\.naide'\)/);

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
      const run = spawnSync(process.execPath, ['--no-warnings', '--enable-source-maps', 'index.js'], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, BOT_TOKEN: 'test-token' },
      });

      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, /NAIDE bot is online!/);
      assert.match(run.stdout, /REGISTERED:test-token:commands:fixture-app:ping/);
      assert.match(run.stdout, /REPLY:Pong!/);

      const guildRun = spawnSync(process.execPath, ['--no-warnings', '--enable-source-maps', 'index.js'], {
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
