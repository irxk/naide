import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const bridgePath = fileURLToPath(new URL('../native/build/Release/native_bridge.node', import.meta.url));
const supportedPlatform = process.platform === 'win32' && process.arch === 'x64';
const bridgeExists = supportedPlatform && existsSync(bridgePath);

export const nativeMachineCodeAvailable = bridgeExists;

const bridge = bridgeExists ? createRequire(import.meta.url)(bridgePath) : null;

export function compileNativeMachineCode(code) {
  if (!bridge) throw new Error('The Windows x64 native bridge is not available.');
  return bridge.compile(code);
}

export function invokeNativeMachineCode(handle, stepLimit, args) {
  if (!bridge) throw new Error('The Windows x64 native bridge is not available.');
  return bridge.invoke(handle, stepLimit, ...args);
}
