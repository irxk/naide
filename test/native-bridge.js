import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const bridgePath = join(import.meta.dirname, '..', 'native', 'build', 'Release', 'native_bridge.node');
const supported = process.platform === 'win32' && process.arch === 'x64';
const available = supported && existsSync(bridgePath);

test('Windows x64 native bridge executes code and owns its executable memory', {
  skip: available ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const require = createRequire(import.meta.url);
  const bridge = require(bridgePath);
  const add = bridge.compile(Buffer.from([0xf2, 0x0f, 0x58, 0xc1, 0xc3]));

  assert.equal(bridge.invoke(add, 100, 3.25, 8.5).value, 11.75);
  assert.throws(() => bridge.invoke(add, 100, 3.25, '8.5'), /arguments must be numbers/);
  assert.throws(() => bridge.invoke(add, 100, 1, 2, 3, 4, 5), /at most four numbers/);
  assert.throws(() => bridge.invoke(add, -1, 3.25, 8.5), /step limit must be a non-negative safe integer/);
  assert.throws(() => bridge.invoke(add, 1.5, 3.25, 8.5), /step limit must be a non-negative safe integer/);

  bridge.release(add);
  assert.throws(() => bridge.invoke(add, 1, 2), /has been released/);
  assert.throws(() => bridge.release(add), /already been released/);
});

test('Windows x64 native bridge rejects invalid machine-code buffers', {
  skip: available ? false : `native bridge is not built for ${process.platform}-${process.arch}`
}, () => {
  const require = createRequire(import.meta.url);
  const bridge = require(bridgePath);

  const byteCode = bridge.compile(new Uint8Array([0xc3]));
  bridge.release(byteCode);
  assert.throws(() => bridge.compile(new Uint16Array([0xc3])), /byte array/);
  assert.throws(() => bridge.compile(new DataView(new ArrayBuffer(1))), /Buffer or Uint8Array/);
  assert.throws(() => bridge.compile(Buffer.alloc(0)), /between 1 byte and 1 MiB/);
  assert.throws(() => bridge.compile(Buffer.alloc(1024 * 1024 + 1)), /between 1 byte and 1 MiB/);
  assert.throws(() => bridge.compile(Buffer.from([0xc3]), Buffer.from([0xc3])), /one byte-array argument/);
});
