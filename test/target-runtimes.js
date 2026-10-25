import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileAsync } from '../src/index.js';

const runtimeCases = [
  { target: 'node', command: 'node', extension: '.mjs' },
  { target: 'python', command: 'python', extension: '.py' },
  { target: 'bun', command: 'bun', extension: '.js' },
  {
    target: 'go',
    command: 'go',
    extension: '.go',
    versionArgs: ['version'],
    runArgs: (sourcePath) => ['run', sourcePath],
  },
  {
    target: 'php',
    command: 'php',
    extension: '.php',
    versionArgs: ['--version'],
    runArgs: sourcePath => [sourcePath],
  },
  {
    target: 'ruby',
    command: 'ruby',
    extension: '.rb',
    versionArgs: ['--version'],
    runArgs: sourcePath => [sourcePath],
  },
  {
    target: 'kotlin',
    command: 'kotlinc',
    extension: '.kt',
    versionArgs: ['-version'],
    compileArgs: sourcePath => ['-include-runtime', sourcePath, '-d', sourcePath.replace(/\.kt$/, '.jar')],
    runCommand: 'java',
    runArgs: sourcePath => ['-jar', sourcePath.replace(/\.kt$/, '.jar')],
  },
  {
    target: 'swift',
    command: 'swiftc',
    extension: '.swift',
    versionArgs: ['--version'],
    compileArgs: (sourcePath, executablePath) => [sourcePath, '-o', executablePath],
  },
  {
    target: 'dart',
    command: 'dart',
    extension: '.dart',
    versionArgs: ['--version'],
    compileArgs: (sourcePath, executablePath) => ['compile', 'exe', sourcePath, '-o', executablePath],
  },
  {
    target: 'csharp',
    command: 'dotnet',
    extension: '.cs',
    versionArgs: ['--version'],
    compileArgs: (sourcePath, executablePath) => {
      const projectPath = join(dirname(sourcePath), 'Smoke.csproj');
      const outputDirectory = join(dirname(sourcePath), 'dotnet-output');
      writeFileSync(projectPath, [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <PropertyGroup>',
        '    <OutputType>Exe</OutputType>',
        '    <TargetFramework>net8.0</TargetFramework>',
        '    <ImplicitUsings>enable</ImplicitUsings>',
        '    <Nullable>disable</Nullable>',
        '  </PropertyGroup>',
        '</Project>',
      ].join('\n'));
      return ['build', projectPath, '--nologo', '--output', outputDirectory];
    },
    runCommand: process.platform === 'win32' ? 'dotnet.exe' : 'dotnet',
    runArgs: sourcePath => ['exec', join(dirname(sourcePath), 'dotnet-output', 'Smoke.dll')],
  },
  {
    target: 'typescript',
    command: process.execPath,
    extension: '.ts',
    versionArgs: [join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'typescript', 'bin', 'tsc'), '--version'],
    compileArgs: sourcePath => [
      join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'typescript', 'bin', 'tsc'),
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'CommonJS',
      '--outDir',
      dirname(sourcePath),
      sourcePath,
    ],
    runCommand: 'node',
    runArgs: sourcePath => [sourcePath.replace(/\.ts$/, '.js')],
  },
  {
    target: 'java',
    command: 'javac',
    versionArgs: ['-version'],
    extension: '.java',
    sourceName: 'App.java',
    compileArgs: (sourcePath) => ['-d', dirname(sourcePath), sourcePath],
    runCommand: 'java',
    runArgs: sourcePath => ['-cp', dirname(sourcePath), 'App'],
  },
  {
    target: 'rust',
    command: 'rustc',
    extension: '.rs',
    versionArgs: ['--version'],
    compileArgs: (sourcePath, executablePath) => ['--edition=2021', sourcePath, '-o', executablePath],
  },
  {
    target: 'c',
    command: 'gcc',
    extension: '.c',
    compileArgs: (sourcePath, executablePath) => ['-std=c11', sourcePath, '-o', executablePath],
  },
  {
    target: 'cpp',
    command: 'g++',
    extension: '.cpp',
    compileArgs: (sourcePath, executablePath) => ['-std=c++17', sourcePath, '-o', executablePath],
  },
];

const runtimeSmokeSource = [
  'fn answer() -> int:',
  '  ret 40 + 2',
  'int naideRuntimeSmoke = answer()',
  'if naideRuntimeSmoke == 42:',
  '  log "runtime-ok"',
  'log naideRuntimeSmoke',
].join('\n');

function runtimeAvailable(runtime) {
  const result = spawnSync(runtime.command, runtime.versionArgs || ['--version'], { encoding: 'utf8' });
  if (runtime?.target === 'java') {
    const java = spawnSync(runtime.runCommand, ['-version'], { encoding: 'utf8' });
    return !result.error && result.status === 0 && !java.error && java.status === 0;
  }
  if (runtime?.target === 'rust' && process.platform === 'win32') {
    const linker = spawnSync('where.exe', ['link.exe'], { encoding: 'utf8' });
    return !result.error && result.status === 0 && !linker.error && linker.status === 0;
  }
  return !result.error && result.status === 0;
}

describe('runtime-verified compiler targets', () => {
  const rustCompiler = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
  const rustCompilerAvailable = !rustCompiler.error && rustCompiler.status === 0;

  it('type-checks generated Rust code when rustc is available', {
    skip: !rustCompilerAvailable,
  }, async () => {
    const { code } = await compileAsync(runtimeSmokeSource, { target: 'rust' });
    const directory = mkdtempSync(join(tmpdir(), 'naide-rust-check-'));
    const sourcePath = join(directory, 'smoke.rs');
    const metadataPath = join(directory, 'smoke.rmeta');

    try {
      writeFileSync(sourcePath, code);
      const result = spawnSync('rustc', ['--edition=2021', '--emit=metadata', sourcePath, '-o', metadataPath], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (const runtime of runtimeCases) {
    const available = runtimeAvailable(runtime);
    const requireRuntime = process.env.NAIDE_REQUIRE_RUNTIME_TOOLS === 'true';

    it(`runs generated ${runtime.target} code`, {
      skip: !available && !requireRuntime,
    }, async () => {
      assert.ok(available, `${runtime.command} must be installed in CI`);
      const { code } = await compileAsync(runtimeSmokeSource, { target: runtime.target });
      const directory = mkdtempSync(join(tmpdir(), 'naide-runtime-smoke-'));
      const sourcePath = join(directory, runtime.sourceName || `smoke${runtime.extension}`);
      const executablePath = join(directory, process.platform === 'win32' ? 'smoke.exe' : 'smoke');

      try {
        writeFileSync(sourcePath, code);
        let command = runtime.command;
        let args = runtime.runArgs ? runtime.runArgs(sourcePath) : [sourcePath];

        if (runtime.compileArgs) {
          const build = spawnSync(command, runtime.compileArgs(sourcePath, executablePath), {
            encoding: 'utf8',
            timeout: 60_000,
          });
          assert.ifError(build.error);
          assert.equal(build.status, 0, build.stderr);

          if (runtime.runCommand) {
            command = runtime.runCommand;
          } else if (runtime.target !== 'go') {
            command = executablePath;
            args = [];
          }
        }

        const result = spawnSync(command, args, {
          encoding: 'utf8',
          timeout: 30_000,
        });

        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['runtime-ok', '42']);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
