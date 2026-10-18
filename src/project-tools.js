import { closeSync, existsSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { compile } from './index.js';

const PACKAGE_ADAPTERS = {
  npm: {
    description: 'Node.js packages from npm',
    validate(spec) {
      const match = spec.match(/^(?<name>@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)(?:@(?<version>latest|[A-Za-z][A-Za-z0-9._-]*|[~^]?v?\d+(?:\.\d+){0,2}(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?))?$/);
      return match ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return { executable: 'npm', args: ['install', '--', spec], dependency: parsed.name };
    },
  },
  pip: {
    description: 'Python packages from PyPI',
    validate(spec) {
      const match = spec.match(/^(?<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:\[(?<extras>[A-Za-z0-9_,.-]+)\])?(?<version>(?:===|==|~=|!=|<=|>=|<|>)[A-Za-z0-9.*!+_-]+(?:,(?:===|==|~=|!=|<=|>=|<|>)[A-Za-z0-9.*!+_-]+)*)?$/);
      return match ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed, directory, options) {
      const localInterpreter = resolve(directory, '.venv', process.platform === 'win32'
        ? 'Scripts/python.exe'
        : 'bin/python');
      const activeInterpreter = process.env.VIRTUAL_ENV
        ? resolve(process.env.VIRTUAL_ENV, process.platform === 'win32'
          ? 'Scripts/python.exe'
          : 'bin/python')
        : null;
      let executable = options.pythonExecutable
        || (activeInterpreter && existsSync(activeInterpreter) ? activeInterpreter : null);
      if (existsSync(localInterpreter)) executable = localInterpreter;
      if (!executable) {
        throw new Error('Python installs require an active virtual environment or a project .venv. Create one with "python -m venv .venv", activate it, then retry.');
      }
      return {
        executable,
        args: ['-m', 'pip', 'install', '--', spec],
        dependency: parsed.name,
        note: 'Installs into the selected virtual environment and records the requirement in requirements.txt.',
      };
    },
  },
  cargo: {
    description: 'Rust crates from crates.io',
    validate(spec) {
      const match = spec.match(/^(?<name>[A-Za-z0-9][A-Za-z0-9_-]*)(?:@(?<version>\*|[A-Za-z0-9.+-]+))?$/);
      return match ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return { executable: 'cargo', args: ['add', spec], dependency: parsed.name };
    },
  },
  go: {
    description: 'Go modules',
    validate(spec) {
      const match = spec.match(/^(?<name>[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~-]+)+(?:\/[A-Za-z0-9._~-]+)*)(?:@(?<version>v[0-9][A-Za-z0-9.+-]*))?$/);
      return match ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return { executable: 'go', args: ['get', spec], dependency: parsed.name };
    },
  },
  dotnet: {
    description: '.NET packages from NuGet',
    validate(spec) {
      const match = spec.match(/^(?<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:@(?<version>[0-9][A-Za-z0-9.+-]*))?$/);
      return match ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return {
        executable: 'dotnet',
        args: ['add', 'package', parsed.name, ...(parsed.version ? ['--version', parsed.version] : [])],
        dependency: parsed.name,
      };
    },
  },
  composer: {
    description: 'PHP packages from Packagist',
    validate(spec) {
      const match = spec.match(/^(?<name>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?::(?<version>[A-Za-z0-9.*^~<>=!| -]+))?$/);
      return match && !spec.includes('--') ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return { executable: 'composer', args: ['require', '--', spec], dependency: parsed.name };
    },
  },
  gem: {
    description: 'Ruby gems from RubyGems via Bundler',
    validate(spec) {
      const match = spec.match(/^(?<name>[A-Za-z0-9][A-Za-z0-9_.-]*)(?:@(?<version>[0-9][A-Za-z0-9.+-]*))?$/);
      return match ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return {
        executable: 'bundle',
        args: ['add', parsed.name, ...(parsed.version ? ['--version', parsed.version] : [])],
        dependency: parsed.name,
        note: 'Uses Bundler to update Gemfile and Gemfile.lock; the project must have a Gemfile.',
      };
    },
  },
  dart: {
    description: 'Dart packages from pub.dev',
    validate(spec) {
      const match = spec.match(/^(?<name>[a-z][a-z0-9_]*)(?::(?<version>(?:\^|>=|>|<=|<)?[0-9][A-Za-z0-9.+-]*))?$/);
      return match ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return { executable: 'dart', args: ['pub', 'add', spec], dependency: parsed.name };
    },
  },
  maven: {
    description: 'Java and Kotlin artifacts from Maven Central',
    validate(spec) {
      const match = spec.match(/^(?<group>[A-Za-z0-9_.-]+):(?<name>[A-Za-z0-9_.-]+)(?::(?<version>[A-Za-z0-9_.+-]+))?$/);
      return match ? { name: `${match.groups.group}:${match.groups.name}`, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return {
        executable: 'mvn',
        args: ['dependency:get', `-Dartifact=${spec}`],
        dependency: parsed.name,
        note: 'Downloaded to the Maven cache; add the artifact to pom.xml to use it in a project.',
      };
    },
  },
  conan: {
    description: 'C and C++ packages from Conan Center',
    validate(spec) {
      const match = spec.match(/^(?<name>[A-Za-z0-9][A-Za-z0-9_.+-]*)(?:\/(?<version>[A-Za-z0-9.*+_-]+))?$/);
      return match ? { name: match.groups.name, version: match.groups.version } : null;
    },
    install(spec, parsed) {
      return {
        executable: 'conan',
        args: ['install', `--requires=${spec}`, '--build=missing'],
        dependency: parsed.name,
        note: 'Conan generates dependency metadata; configure the generated toolchain or build integration before use.',
      };
    },
  },
};

const PACKAGE_FILES = [
  ['package.json', 'Node.js / npm'],
  ['pyproject.toml', 'Python / pip'],
  ['requirements.txt', 'Python / pip'],
  ['Cargo.toml', 'Rust / Cargo'],
  ['go.mod', 'Go modules'],
  ['*.csproj', '.NET / NuGet'],
  ['*.sln', '.NET / NuGet'],
  ['composer.json', 'PHP / Composer'],
  ['Gemfile', 'Ruby / Bundler'],
  ['pubspec.yaml', 'Dart / pub'],
  ['Package.swift', 'Swift Package Manager'],
  ['pom.xml', 'Java / Maven'],
  ['build.gradle', 'Gradle'],
  ['build.gradle.kts', 'Gradle'],
  ['conanfile.py', 'C/C++ / Conan'],
  ['conanfile.txt', 'C/C++ / Conan'],
];

const TOOL_COMMANDS = [
  ['node', ['--version']],
  ['npm', ['--version']],
  [process.platform === 'win32' ? 'py' : 'python3', ['--version']],
  ['cargo', ['--version']],
  ['go', ['version']],
  ['dotnet', ['--version']],
  ['composer', ['--version']],
  ['gem', ['--version']],
  ['bundle', ['--version']],
  ['dart', ['--version']],
  ['mvn', ['--version']],
  ['gradle', ['--version']],
  ['conan', ['--version']],
  ['swift', ['--version']],
];

export function listPackageAdapters() {
  return Object.entries(PACKAGE_ADAPTERS).map(([name, adapter]) => ({
    name,
    description: adapter.description,
  }));
}

export function checkNaideSource(source, sourceFile) {
  try {
    const result = compile(source, { typeCheck: true, sourceFile });
    const diagnostics = [
      ...result.typeErrors.errors.map(diagnostic => ({
        severity: 'error',
        line: diagnostic.line,
        message: diagnostic.message,
      })),
      ...result.typeErrors.warnings.map(diagnostic => ({
        severity: 'warning',
        line: diagnostic.line,
        message: diagnostic.message,
      })),
    ];
    return {
      ok: result.typeErrors.errors.length === 0,
      diagnostics,
    };
  } catch (error) {
    const location = error.message.match(/line (\d+)(?::(\d+))?/);
    return {
      ok: false,
      diagnostics: [{
        severity: 'error',
        ...(location ? {
          line: Number(location[1]),
          ...(location[2] ? { column: Number(location[2]) } : {}),
        } : {}),
        message: error.message.split('\n')[0],
      }],
    };
  }
}

export function recordPackageDependency(directory, plan) {
  const projectDirectory = resolve(directory);
  const path = resolve(projectDirectory, 'naide.pkg.json');
  let manifest;

  if (existsSync(path)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`naide.pkg.json is not valid JSON: ${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('naide.pkg.json must contain a JSON object.');
    }
    manifest = parsed;
  } else {
    const packageJson = readPackageJson(projectDirectory);
    if (packageJson.error) {
      throw new Error(`package.json is not valid JSON: ${packageJson.error}`);
    }
    manifest = {
      name: packageJson.value?.name || 'my-naide-project',
      version: '1.0.0',
      description: '',
      main: 'index.naide',
      keywords: ['naide'],
      exports: {},
      dependencies: {},
      languageDependencies: {},
    };
  }

  if (manifest.dependencies === undefined) manifest.dependencies = {};
  if (!manifest.dependencies || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies)) {
    throw new Error('naide.pkg.json "dependencies" must be an object.');
  }
  let pipRequirementsUpdate = null;
  if (plan.manager === 'pip') {
    const requirementsPath = resolve(projectDirectory, 'requirements.txt');
    const requirements = existsSync(requirementsPath) ? readFileSync(requirementsPath, 'utf8') : '';
    const normalizeName = name => name.toLowerCase().replace(/[-_.]+/g, '-');
    const packageName = plan.dependency.match(/^[A-Za-z0-9][A-Za-z0-9._-]*/)?.[0];
    if (!packageName) throw new Error(`Could not determine the Python package name from "${plan.dependency}".`);
    const lines = requirements.split(/\r?\n/);
    let found = false;
    const updatedLines = lines.map(line => {
      const existingName = line.trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1];
      if (!existingName || normalizeName(existingName) !== normalizeName(packageName)) return line;
      found = true;
      return plan.spec;
    });
    if (!found) updatedLines.push(plan.spec);
    const output = updatedLines.join('\n').replace(/\n*$/, '\n');
    if (output !== requirements) pipRequirementsUpdate = { path: requirementsPath, output };
  }

  if (plan.manager === 'npm') {
    manifest.dependencies[plan.dependency] = plan.spec;
  } else {
    if (manifest.languageDependencies === undefined) manifest.languageDependencies = {};
    if (!manifest.languageDependencies
      || typeof manifest.languageDependencies !== 'object'
      || Array.isArray(manifest.languageDependencies)) {
      throw new Error('naide.pkg.json "languageDependencies" must be an object.');
    }
    manifest.languageDependencies[plan.manager] ||= {};
    if (typeof manifest.languageDependencies[plan.manager] !== 'object'
      || Array.isArray(manifest.languageDependencies[plan.manager])) {
      throw new Error(`naide.pkg.json "languageDependencies.${plan.manager}" must be an object.`);
    }
    manifest.languageDependencies[plan.manager][plan.dependency] = plan.spec;
  }

  const updates = [
    ...(pipRequirementsUpdate ? [pipRequirementsUpdate] : []),
    { path, output: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
  const staged = [];
  const replaced = [];
  try {
    for (const update of updates) {
      const temporaryPath = `${update.path}.naide-${randomUUID()}.tmp`;
      const stagedUpdate = { ...update, temporaryPath };
      staged.push(stagedUpdate);
      const fileDescriptor = openSync(temporaryPath, 'wx');
      try {
        writeFileSync(fileDescriptor, update.output, 'utf8');
      } finally {
        closeSync(fileDescriptor);
      }
    }

    for (const update of staged) {
      const backupPath = `${update.path}.naide-${randomUUID()}.bak`;
      const hadOriginal = existsSync(update.path);
      if (hadOriginal) renameSync(update.path, backupPath);
      replaced.push({ ...update, backupPath, hadOriginal, installed: false });
      renameSync(update.temporaryPath, update.path);
      replaced.at(-1).installed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const update of replaced.reverse()) {
      try {
        if (update.installed && existsSync(update.path)) unlinkSync(update.path);
        if (update.hadOriginal && existsSync(update.backupPath)) renameSync(update.backupPath, update.path);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'Could not fully roll back package metadata updates.');
    }
    throw error;
  } finally {
    for (const update of staged) {
      if (existsSync(update.temporaryPath)) unlinkSync(update.temporaryPath);
    }
  }
  for (const update of replaced) {
    if (update.hadOriginal) {
      try {
        unlinkSync(update.backupPath);
      } catch (error) {
        throw new Error(`Package metadata was updated, but backup cleanup failed for ${update.backupPath}: ${error.message}`);
      }
    }
  }

  return path;
}

export function spawnNativeTool(plan, directory, options = {}) {
  const spawnCommand = options.spawnCommand || spawn;
  const projectDirectory = resolve(directory);
  if (options.platform === 'win32' || (!options.platform && process.platform === 'win32')) {
    if (!plan.executable.toLowerCase().endsWith('.exe')) {
      const args = [plan.executable, ...plan.args];
      if (args.some(argument => /["%\r\n\0]/.test(argument))) {
        throw new Error('Windows script-based package managers do not accept quotes, percent signs, or line breaks in arguments.');
      }
      const commandLine = args.map(argument => `"${argument}"`).join(' ');
      return spawnCommand(process.env.ComSpec || 'cmd.exe', [
        '/d', '/v:off', '/s', '/c', `"${commandLine}"`,
      ], {
        cwd: projectDirectory,
        windowsHide: true,
        windowsVerbatimArguments: true,
        ...(options.stdio ? { stdio: options.stdio } : {}),
      });
    }
  }
  return spawnCommand(plan.executable, plan.args, {
    cwd: projectDirectory,
    windowsHide: true,
    ...(options.stdio ? { stdio: options.stdio } : {}),
  });
}

export function runPackageInstall(plan, options = {}) {
  const directory = resolve(options.directory || process.cwd());
  const spawnCommand = options.spawnCommand
    || ((packagePlan, cwd) => spawnNativeTool(packagePlan, cwd, { stdio: 'inherit' }));

  return new Promise((resolveResult, rejectResult) => {
    let child;
    try {
      child = spawnCommand(plan, directory);
    } catch (error) {
      rejectResult(error);
      return;
    }

    let settled = false;
    child.once('error', error => {
      if (settled) return;
      settled = true;
      rejectResult(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      resolveResult(code ?? 1);
    });
  });
}

export function createPackageInstallPlan(manager, spec, options = {}) {
  const adapter = PACKAGE_ADAPTERS[manager];
  if (!adapter) {
    throw new Error(`Unsupported package manager "${manager}". Supported: ${Object.keys(PACKAGE_ADAPTERS).join(', ')}`);
  }
  if (typeof spec !== 'string' || spec.length === 0 || spec.length > 256) {
    throw new Error('Package spec must be a non-empty string of at most 256 characters.');
  }
  if (spec.trim() !== spec || /[\r\n\0]/.test(spec)) {
    throw new Error('Package spec cannot contain leading/trailing whitespace or line breaks.');
  }
  const parsed = adapter.validate(spec);
  if (!parsed) {
    throw new Error(`Invalid ${manager} package spec "${spec}". Use a registry package name and optional version; URLs and local paths are not supported.`);
  }
  return { ...adapter.install(spec, parsed, options.directory || process.cwd(), options), manager, spec };
}

function fileMatches(directory, pattern) {
  if (!pattern.startsWith('*')) return existsSync(resolve(directory, pattern));
  const suffix = pattern.slice(1);
  try {
    return readdirSync(directory).some(name => name.endsWith(suffix));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

function readPackageJson(directory, manifestName = 'package.json') {
  const path = resolve(directory, manifestName);
  if (!existsSync(path)) return { path, value: null, error: null, present: false };
  try {
    return { path, value: JSON.parse(readFileSync(path, 'utf8')), error: null, present: true };
  } catch (error) {
    return { path, value: null, error: error.message, present: true };
  }
}

function findNaideFiles(directory) {
  const files = [];
  const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);

  function visit(currentDirectory) {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(resolve(currentDirectory, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.naide')) {
        if (currentDirectory === directory && entry.name === 'SPEC.naide') continue;
        const absolutePath = resolve(currentDirectory, entry.name);
        files.push({
          path: relative(directory, absolutePath).split(sep).join('/'),
          absolutePath,
        });
      }
    }
  }

  visit(directory);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function inspectProject(directory = process.cwd()) {
  const projectDirectory = resolve(directory);
  const manifests = PACKAGE_FILES
    .filter(([pattern]) => fileMatches(projectDirectory, pattern))
    .map(([, ecosystem]) => ecosystem);
  const packageJson = readPackageJson(projectDirectory);
  const errors = [];
  const warnings = [];
  const checks = [];

  if (packageJson.error) {
    errors.push(`package.json is not valid JSON: ${packageJson.error}`);
  } else if (packageJson.present && (
    !packageJson.value
    || typeof packageJson.value !== 'object'
    || Array.isArray(packageJson.value)
  )) {
    errors.push('package.json must contain a JSON object.');
  } else if (packageJson.present) {
    checks.push('package.json parses successfully');
    if (packageJson.value.name !== undefined && typeof packageJson.value.name !== 'string') {
      errors.push('package.json "name" must be a string.');
    } else if (!packageJson.value.name) {
      warnings.push('package.json has no project name.');
    }
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = packageJson.value[section];
      if (dependencies !== undefined
        && (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies))) {
        errors.push(`package.json "${section}" must be an object of package names and version strings.`);
      } else if (dependencies) {
        for (const [name, version] of Object.entries(dependencies)) {
          if (typeof version !== 'string' || version.length === 0) {
            errors.push(`package.json "${section}.${name}" must be a non-empty version string.`);
          }
        }
      }
    }
    if (packageJson.value.scripts !== undefined
      && (!packageJson.value.scripts
        || typeof packageJson.value.scripts !== 'object'
        || Array.isArray(packageJson.value.scripts))) {
      errors.push('package.json "scripts" must be an object of command strings.');
    } else if (packageJson.value.scripts) {
      for (const [name, command] of Object.entries(packageJson.value.scripts)) {
        if (typeof command !== 'string' || command.length === 0) {
          errors.push(`package.json "scripts.${name}" must be a non-empty command string.`);
        }
      }
    }
    const dependencies = {
      ...(packageJson.value.dependencies && typeof packageJson.value.dependencies === 'object'
        && !Array.isArray(packageJson.value.dependencies) ? packageJson.value.dependencies : {}),
      ...(packageJson.value.devDependencies && typeof packageJson.value.devDependencies === 'object'
        && !Array.isArray(packageJson.value.devDependencies) ? packageJson.value.devDependencies : {}),
    };
    if (Object.keys(dependencies).length > 0
      && !['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']
        .some(name => existsSync(resolve(projectDirectory, name)))) {
      warnings.push('Dependencies are declared but no npm-compatible lockfile was found.');
    }
    if (packageJson.value.scripts?.test) {
      checks.push('A project test script is configured (run it with npm test).');
    }
  }

  let sourceFiles = [];
  try {
    sourceFiles = findNaideFiles(projectDirectory);
  } catch (error) {
    errors.push(`Cannot inspect project directory: ${error.message}`);
  }
  const naideFiles = sourceFiles.map(file => file.path);
  if (naideFiles.length > 0) {
    checks.push(`${naideFiles.length} .naide source file(s) found.`);
    for (const file of sourceFiles) {
      try {
        const source = readFileSync(file.absolutePath, 'utf8');
        const result = checkNaideSource(source, file.path);
        for (const diagnostic of result.diagnostics) {
          const formatted = `${file.path}${diagnostic.line ? `:${diagnostic.line}` : ''} ${diagnostic.message}`;
          if (diagnostic.severity === 'error') errors.push(formatted);
          else warnings.push(formatted);
        }
        if (result.ok) {
          const hasWarnings = result.diagnostics.some(diagnostic => diagnostic.severity === 'warning');
          checks.push(`${file.path} compiles${hasWarnings ? ' with type-check warnings' : ' and passes type checks'}.`);
        }
      } catch (error) {
        errors.push(`${file.path} could not be compiled: ${error.message.split('\n')[0]}`);
      }
    }
  }
  if (existsSync(resolve(projectDirectory, 'SPEC.naide'))) {
    checks.push('SPEC.naide language reference excluded from source checks.');
  }
  if (manifests.length === 0) warnings.push('No supported package-manager manifest was found in this directory.');
  if (manifests.includes('Python / pip')
    && !process.env.VIRTUAL_ENV
    && !existsSync(resolve(projectDirectory, '.venv'))) {
    warnings.push('Python packages should be installed in a virtual environment (.venv) to avoid modifying the system Python.');
  }

  return {
    directory: projectDirectory,
    manifests: [...new Set(manifests)],
    naideFiles,
    checks,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

export function getProjectTestPlans(directory = process.cwd()) {
  const project = resolve(directory);
  const plans = [];
  const packageJson = readPackageJson(project);
  let entries;
  try {
    entries = readdirSync(project, { withFileTypes: true }).map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return plans;
    throw error;
  }

  if (!packageJson.error && packageJson.value?.scripts?.test) {
    plans.push({ manager: 'npm', executable: 'npm', args: ['test'], label: 'npm test' });
  }
  if (existsSync(resolve(project, 'Cargo.toml'))) {
    plans.push({ manager: 'cargo', executable: 'cargo', args: ['test'], label: 'cargo test' });
  }
  if (existsSync(resolve(project, 'go.mod'))) {
    plans.push({ manager: 'go', executable: 'go', args: ['test', './...'], label: 'go test ./...' });
  }
  if (entries.some(name => name.endsWith('.sln') || name.endsWith('.csproj'))) {
    plans.push({ manager: 'dotnet', executable: 'dotnet', args: ['test'], label: 'dotnet test' });
  }
  if (existsSync(resolve(project, 'pom.xml'))) {
    plans.push({ manager: 'maven', executable: 'mvn', args: ['test'], label: 'mvn test' });
  }
  if (entries.some(name => name === 'build.gradle' || name === 'build.gradle.kts')) {
    plans.push({ manager: 'gradle', executable: 'gradle', args: ['test'], label: 'gradle test' });
  }
  if (existsSync(resolve(project, 'Package.swift'))) {
    plans.push({ manager: 'swift', executable: 'swift', args: ['test'], label: 'swift test' });
  }
  if (existsSync(resolve(project, 'pubspec.yaml')) && entries.includes('test')) {
    plans.push({ manager: 'dart', executable: 'dart', args: ['test'], label: 'dart test' });
  }
  const composerJson = readPackageJson(project, 'composer.json');
  if (!composerJson.error && composerJson.value?.scripts?.test) {
    plans.push({ manager: 'composer', executable: 'composer', args: ['test'], label: 'composer test' });
  }
  if (existsSync(resolve(project, 'Gemfile')) && existsSync(resolve(project, 'Rakefile'))) {
    plans.push({ manager: 'bundle', executable: 'bundle', args: ['exec', 'rake', 'test'], label: 'bundle exec rake test' });
  }
  if (['pyproject.toml', 'pytest.ini', 'tox.ini'].some(name => existsSync(resolve(project, name)))
    && entries.some(name => name === 'test' || name === 'tests')) {
    const localPython = resolve(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = existsSync(localPython)
      ? localPython
      : process.platform === 'win32' ? 'py' : 'python3';
    plans.push({
      manager: 'pip',
      executable: python,
      args: [...(python === 'py' ? ['-m'] : ['-m']), 'pytest'],
      label: 'python -m pytest',
    });
  }
  return plans;
}

function checkToolVersion(executable, args) {
  let command = executable;
  let commandArgs = args;
  if (executable === 'npm' && process.platform === 'win32') {
    const npmCandidates = [
      process.env.npm_execpath,
      resolve(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      resolve(process.execPath, '..', '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].filter(Boolean);
    const npmCli = npmCandidates.find(path => existsSync(path) && /\.(?:c|m)?js$/i.test(path));
    if (npmCli) {
      command = process.execPath;
      commandArgs = [npmCli, ...args];
    }
  }
  return new Promise(resolveResult => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (available, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({
        executable,
        available,
        version: available ? `${stdout}${stderr}`.trim().split(/\r?\n/, 1)[0] : null,
        error,
      });
    };
    const child = spawnNativeTool({ manager: executable === 'npm' ? 'npm' : null, executable: command, args: commandArgs }, process.cwd());
    const timeout = setTimeout(() => {
      child.kill();
      finish(false, 'ETIMEDOUT');
    }, 1500);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => finish(false, error.code || 'ERROR'));
    child.once('close', code => finish(code === 0, code === 0 ? null : `EXIT_${code}`));
  });
}

function spawnProjectTool(plan, directory) {
  if (plan.manager === 'npm' && process.platform === 'win32') {
    const npmCandidates = [
      process.env.npm_execpath,
      resolve(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      resolve(process.execPath, '..', '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].filter(Boolean);
    const npmCli = npmCandidates.find(path => existsSync(path) && /\.(?:c|m)?js$/i.test(path));
    if (npmCli) return spawn(process.execPath, [npmCli, ...plan.args], { cwd: directory, windowsHide: true });
  }
  return spawnNativeTool(plan, directory);
}

export async function runProjectTests(directory = process.cwd(), options = {}) {
  const project = resolve(directory);
  const plans = getProjectTestPlans(project);
  const outcomes = [];

  for (const plan of plans) {
    const result = await new Promise(resolveResult => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timeout = null;
      const append = (current, chunk) => current.length >= 1024 * 1024
        ? current
        : current + chunk.slice(0, 1024 * 1024 - current.length);
      const finish = (code, error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveResult({ ...plan, code, error, stdout, stderr });
      };

      let child;
      try {
        child = spawnProjectTool(plan, project);
      } catch (error) {
        finish(127, error.message);
        return;
      }
      timeout = setTimeout(() => {
        child.kill();
        finish(124, 'Test command timed out after 10 minutes.');
      }, options.timeoutMs || 10 * 60 * 1000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
      child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
      child.once('error', error => finish(127, error.message));
      child.once('close', code => finish(code ?? 1));
    });
    outcomes.push(result);
  }

  return {
    directory: project,
    plans,
    outcomes,
    ok: plans.length > 0 && outcomes.every(outcome => outcome.code === 0),
  };
}

export async function getDoctorReport(directory = process.cwd()) {
  const project = inspectProject(directory);
  const tools = await Promise.all(TOOL_COMMANDS.map(([executable, args]) => checkToolVersion(executable, args)));
  const requirements = new Map([
    ['Node.js / npm', ['node', 'npm']],
    ['Python / pip', [process.platform === 'win32' ? 'py' : 'python3']],
    ['Rust / Cargo', ['cargo']],
    ['Go modules', ['go']],
    ['.NET / NuGet', ['dotnet']],
    ['PHP / Composer', ['composer']],
    ['Ruby / Bundler', ['bundle']],
    ['Dart / pub', ['dart']],
    ['Swift Package Manager', ['swift']],
    ['Java / Maven', ['mvn']],
    ['Gradle', ['gradle']],
    ['C/C++ / Conan', ['conan']],
  ]);
  const requiredTools = [...new Set(project.manifests.flatMap(manifest => requirements.get(manifest) || []))];
  const missingRequiredTools = requiredTools.filter(name => !tools.some(tool => tool.executable === name && tool.available));
  for (const name of missingRequiredTools) project.errors.push(`Required ecosystem tool "${name}" was not found.`);
  project.ok = project.errors.length === 0;

  return {
    node: { version: process.version, supported: Number(process.versions.node.split('.')[0]) >= 18 },
    platform: `${process.platform} ${process.arch}`,
    tools,
    requiredTools,
    project,
  };
}
