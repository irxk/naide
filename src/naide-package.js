import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep, dirname } from 'node:path';

const PACKAGE_DIRECTORIES = ['naide_modules', 'node_modules'];
const PACKAGE_NAME_PATTERN = /^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/;

export function resolveNaidePackage(specifier, referrer) {
  if (typeof specifier !== 'string' || typeof referrer !== 'string') {
    throw new TypeError('NAIDE package resolution requires a package specifier and source path.');
  }
  const segments = specifier.split('/');
  const scoped = specifier.startsWith('@');
  const packageName = scoped ? segments.slice(0, 2).join('/') : segments[0];
  const packageSuffix = segments.slice(scoped ? 2 : 1);
  if (!PACKAGE_NAME_PATTERN.test(packageName)
    || packageName.split('/').some(segment => segment === '.' || segment === '..')
    || packageSuffix.some(segment => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..')) {
    throw new Error(`Native engine received an invalid NAIDE package import path '${specifier}'.`);
  }

  let directory = dirname(referrer);
  let nonSourcePackagePath = null;
  while (true) {
    for (const packageDirectoryName of PACKAGE_DIRECTORIES) {
      const packageDirectory = resolve(directory, packageDirectoryName, ...packageName.split('/'));
      if (!existsSync(packageDirectory)) continue;
      const manifestPath = resolve(packageDirectory, 'naide.pkg.json');
      if (!existsSync(manifestPath)) {
        nonSourcePackagePath ??= manifestPath;
        continue;
      }

      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        throw new Error(`NAIDE package manifest '${manifestPath}' is invalid JSON: ${error.message}`);
      }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new TypeError(`NAIDE package manifest '${manifestPath}' must contain an object.`);
      }
      if (manifest.exports !== undefined
        && (!manifest.exports || typeof manifest.exports !== 'object' || Array.isArray(manifest.exports))) {
        throw new TypeError(`NAIDE package '${packageName}' exports must be an object of subpath-to-file mappings.`);
      }

      const exportKey = packageSuffix.length > 0 ? `./${packageSuffix.join('/')}` : null;
      if (exportKey && !Object.hasOwn(manifest.exports || {}, exportKey)) {
        throw new Error(`NAIDE package '${packageName}' does not export '${exportKey}'.`);
      }
      const entry = exportKey ? manifest.exports[exportKey] : manifest.main ?? 'index.naide';
      if (exportKey && (typeof entry !== 'string' || !entry.startsWith('./'))) {
        throw new TypeError(`NAIDE package '${packageName}' export '${exportKey}' must map to a relative .naide file.`);
      }
      if (typeof entry !== 'string' || entry.length === 0 || isAbsolute(entry)
      ) {
        throw new TypeError(`NAIDE package '${packageName}' entry must be a relative .naide file.`);
      }

      const packageRealPath = realpathSync(packageDirectory);
      const entryPath = resolve(packageDirectory, entry);
      const entryRelativePath = relative(packageDirectory, entryPath);
      if (entryRelativePath === '..' || entryRelativePath.startsWith(`..${sep}`)
        || isAbsolute(entryRelativePath) || extname(entryPath) !== '.naide') {
        throw new Error(`NAIDE package '${packageName}' entry must resolve to a .naide file inside the package.`);
      }
      if (!existsSync(entryPath)) {
        throw new Error(`NAIDE package '${packageName}' entry does not exist: '${entryPath}'.`);
      }
      const entryRealPath = realpathSync(entryPath);
      const realRelativePath = relative(packageRealPath, entryRealPath);
      if (realRelativePath === '..' || realRelativePath.startsWith(`..${sep}`)
        || isAbsolute(realRelativePath) || extname(entryRealPath) !== '.naide') {
        throw new Error(`NAIDE package '${packageName}' entry must resolve to a .naide file inside the package.`);
      }
      return entryRealPath;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  if (nonSourcePackagePath) {
    throw new Error(`Package '${packageName}' is not a NAIDE source package; expected '${nonSourcePackagePath}'.`);
  }
  throw new Error(`Cannot resolve NAIDE package '${packageName}'. Install it and ensure it contains a naide.pkg.json with a .naide main entry.`);
}
