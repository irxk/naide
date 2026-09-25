#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const platform = process.platform;
const naideBin = resolve(__dirname, 'naide.js');

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: 'pipe', ...opts });
    return true;
  } catch {
    return false;
  }
}

function registerWindows() {
  const nodePath = process.execPath;
  const npmGlobal = resolve(dirname(nodePath), 'node_modules', 'naider', 'bin', 'naide.js');
  const binPath = existsSync(npmGlobal) ? npmGlobal : naideBin;

  const nodeEsc = nodePath.replace(/\\/g, '\\\\');
  const binEsc = binPath.replace(/\\/g, '\\\\');
  const cmd = `"${nodePath}" "${binPath}" "%1" %*`;

  const regAdd = (key, value) => run(`reg add "${key}" /ve /d "${value}" /f`);

  regAdd('HKCU\\Software\\Classes\\.naide', 'NAIDEFile');
  regAdd('HKCU\\Software\\Classes\\.nx', 'NAIDEXFile');
  regAdd('HKCU\\Software\\Classes\\NAIDEFile', 'NAIDE Source File');
  regAdd('HKCU\\Software\\Classes\\NAIDEXFile', 'NAIDE-X Source File');
  regAdd('HKCU\\Software\\Classes\\NAIDEFile\\shell\\open\\command', cmd);
  regAdd('HKCU\\Software\\Classes\\NAIDEXFile\\shell\\open\\command', cmd);

  const assetsDir = resolve(__dirname, '..', 'assets');
  const naideIco = resolve(assetsDir, 'naide.ico');
  const nxIco = resolve(assetsDir, 'nx.ico');
  regAdd('HKCU\\Software\\Classes\\NAIDEFile\\DefaultIcon', naideIco);
  regAdd('HKCU\\Software\\Classes\\NAIDEXFile\\DefaultIcon', nxIco);

  console.log('  .naide and .nx file associations registered (Windows)');
}

function registerMacOS() {
  const plistDir = resolve(process.env.HOME, 'Library', 'LaunchAgents');
  if (!existsSync(plistDir)) mkdirSync(plistDir, { recursive: true });

  const handlerApp = resolve(process.env.HOME, '.naide', 'NAIDE.app');
  const contentsDir = join(handlerApp, 'Contents');
  const macosDir = join(contentsDir, 'MacOS');

  mkdirSync(macosDir, { recursive: true });

  writeFileSync(join(contentsDir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>NAIDE</string>
  <key>CFBundleIdentifier</key><string>com.naide.runner</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>naide-run</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeExtensions</key><array><string>naide</string><string>nx</string></array>
      <key>CFBundleTypeName</key><string>NAIDE Source</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
    </dict>
  </array>
</dict>
</plist>`);

  writeFileSync(join(macosDir, 'naide-run'), `#!/bin/bash\nexec node "${naideBin}" "$@"\n`);
  run(`chmod +x "${join(macosDir, 'naide-run')}"`);

  run(`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${handlerApp}"`);

  console.log('  .naide and .nx file associations registered (macOS)');
}

function registerLinux() {
  const mimeDir = resolve(process.env.HOME, '.local', 'share', 'mime', 'packages');
  const appDir = resolve(process.env.HOME, '.local', 'share', 'applications');
  mkdirSync(mimeDir, { recursive: true });
  mkdirSync(appDir, { recursive: true });

  writeFileSync(join(mimeDir, 'naide.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="text/x-naide">
    <comment>NAIDE Source File</comment>
    <glob pattern="*.naide"/>
  </mime-type>
  <mime-type type="text/x-naidex">
    <comment>NAIDE-X Source File</comment>
    <glob pattern="*.nx"/>
  </mime-type>
</mime-info>`);

  writeFileSync(join(appDir, 'naide.desktop'), `[Desktop Entry]
Type=Application
Name=NAIDE
Exec=node "${naideBin}" %f
MimeType=text/x-naide;text/x-naidex;
Terminal=true
Categories=Development;
`);

  run('update-mime-database ~/.local/share/mime');
  run('xdg-mime default naide.desktop text/x-naide');
  run('xdg-mime default naide.desktop text/x-naidex');

  console.log('  .naide and .nx file associations registered (Linux)');
}

console.log('NAIDE: Registering file extensions...');

try {
  if (platform === 'win32') {
    registerWindows();
  } else if (platform === 'darwin') {
    registerMacOS();
  } else {
    registerLinux();
  }
} catch (e) {
  console.log(`  Skipped file association (${e.message}). You can still run: naide <file.naide>`);
}

console.log('NAIDE: Installation complete! Run "naide --help" to get started.');
