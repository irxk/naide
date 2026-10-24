import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';

const projectDirectory = process.cwd();
const manifestPath = resolve(projectDirectory, 'nidpackage.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entry = manifest.naide?.entry;

if (typeof entry !== 'string' || entry.length === 0 || isAbsolute(entry)) {
  throw new Error('nidpackage.json must define a relative "naide.entry" path to a .naide file.');
}

const entryPath = resolve(projectDirectory, entry);
const entryRelativePath = relative(projectDirectory, entryPath);
if (entryRelativePath === '..' || entryRelativePath.startsWith(`..${sep}`) || isAbsolute(entryRelativePath)) {
  throw new Error('nidpackage.json "naide.entry" must stay inside the project directory.');
}
if (!entryPath.endsWith('.naide')) {
  throw new Error('nidpackage.json "naide.entry" must point to a .naide file.');
}

register(new URL('./loader.js', import.meta.url), import.meta.url);
await import(pathToFileURL(entryPath).href);
