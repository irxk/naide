#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createICO(sizes, renderFn) {
  const images = sizes.map(s => createBMPImage(s, renderFn));
  const headerSize = 6 + images.length * 16;
  let offset = headerSize;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...images.map(i => i.data)]);
}

function createBMPImage(size, renderFn) {
  const pixels = new Uint8Array(size * size * 4);
  renderFn(pixels, size);

  const rowSize = size * 4;
  const andRowSize = Math.ceil(size / 32) * 4;
  const bmpInfoSize = 40;
  const pixelDataSize = rowSize * size;
  const andMaskSize = andRowSize * size;
  const totalSize = bmpInfoSize + pixelDataSize + andMaskSize;

  const buf = Buffer.alloc(totalSize);

  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(pixelDataSize + andMaskSize, 20);
  buf.writeInt32LE(0, 24);
  buf.writeInt32LE(0, 28);
  buf.writeUInt32LE(0, 32);
  buf.writeUInt32LE(0, 36);

  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = bmpInfoSize + y * rowSize;
    for (let x = 0; x < size; x++) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 4;
      buf[di + 0] = pixels[si + 2];
      buf[di + 1] = pixels[si + 1];
      buf[di + 2] = pixels[si + 0];
      buf[di + 3] = pixels[si + 3];
    }
  }

  const andOffset = bmpInfoSize + pixelDataSize;
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const alpha = pixels[srcRow + x * 4 + 3];
      if (alpha < 128) {
        const byteIdx = andOffset + y * andRowSize + Math.floor(x / 8);
        buf[byteIdx] |= (0x80 >> (x % 8));
      }
    }
  }

  return { size, data: buf };
}

function setPixel(pixels, size, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  if (a < 255 && pixels[i + 3] > 0) {
    const sa = a / 255;
    const da = 1 - sa;
    pixels[i + 0] = Math.round(r * sa + pixels[i + 0] * da);
    pixels[i + 1] = Math.round(g * sa + pixels[i + 1] * da);
    pixels[i + 2] = Math.round(b * sa + pixels[i + 2] * da);
    pixels[i + 3] = 255;
  } else {
    pixels[i + 0] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }
}

function fillRect(pixels, size, x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      setPixel(pixels, size, x, y, r, g, b, a);
}

function fillRoundRect(pixels, size, x0, y0, w, h, radius, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let inside = true;
      const corners = [
        [x0 + radius, y0 + radius],
        [x0 + w - radius - 1, y0 + radius],
        [x0 + radius, y0 + h - radius - 1],
        [x0 + w - radius - 1, y0 + h - radius - 1],
      ];
      for (const [cx, cy] of corners) {
        const inCornerX = (x < x0 + radius && cx === corners[0][0]) || (x > x0 + w - radius - 1 && cx === corners[1][0]);
        const inCornerY = (y < y0 + radius && cy === corners[0][1]) || (y > y0 + h - radius - 1 && cy === corners[2][1]);
        if (inCornerX && inCornerY) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy > radius * radius) {
            inside = false;
            break;
          }
        }
      }
      if (inside) setPixel(pixels, size, x, y, r, g, b, a);
    }
  }
}

const GLYPH_N = [
  [1,0,0,0,1],
  [1,1,0,0,1],
  [1,0,1,0,1],
  [1,0,0,1,1],
  [1,0,0,0,1],
];

const GLYPH_X = [
  [1,0,0,0,1],
  [0,1,0,1,0],
  [0,0,1,0,0],
  [0,1,0,1,0],
  [1,0,0,0,1],
];

function drawGlyph(pixels, size, glyph, ox, oy, scale, r, g, b) {
  for (let gy = 0; gy < glyph.length; gy++) {
    for (let gx = 0; gx < glyph[gy].length; gx++) {
      if (glyph[gy][gx]) {
        fillRect(pixels, size, ox + gx * scale, oy + gy * scale, scale, scale, r, g, b);
      }
    }
  }
}

function renderNaideIcon(pixels, size) {
  const s = size;
  const r = Math.max(2, Math.round(s * 0.15));
  fillRoundRect(pixels, s, 0, 0, s, s, r, 30, 110, 230);
  fillRoundRect(pixels, s, 1, 1, s - 2, s - 2, r, 40, 130, 255);

  const glyphScale = Math.max(1, Math.round(s / 10));
  const gw = 5 * glyphScale;
  const gh = 5 * glyphScale;
  const ox = Math.round((s - gw) / 2);
  const oy = Math.round((s - gh) / 2);
  drawGlyph(pixels, s, GLYPH_N, ox, oy, glyphScale, 255, 255, 255);
}

function renderNxIcon(pixels, size) {
  const s = size;
  const r = Math.max(2, Math.round(s * 0.15));
  fillRoundRect(pixels, s, 0, 0, s, s, r, 20, 170, 80);
  fillRoundRect(pixels, s, 1, 1, s - 2, s - 2, r, 30, 200, 100);

  const glyphScale = Math.max(1, Math.round(s / 10));
  const gw = 5 * glyphScale;
  const gh = 5 * glyphScale;
  const ox = Math.round((s - gw) / 2);
  const oy = Math.round((s - gh) / 2);
  drawGlyph(pixels, s, GLYPH_X, ox, oy, glyphScale, 255, 255, 255);
}

const naideIco = createICO([16, 32, 48, 64], renderNaideIcon);
const nxIco = createICO([16, 32, 48, 64], renderNxIcon);

const naideOut = resolve(__dirname, '..', 'assets', 'naide.ico');
const nxOut = resolve(__dirname, '..', 'assets', 'nx.ico');

import { mkdirSync } from 'fs';
mkdirSync(resolve(__dirname, '..', 'assets'), { recursive: true });

writeFileSync(naideOut, naideIco);
writeFileSync(nxOut, nxIco);

console.log(`Generated: ${naideOut}`);
console.log(`Generated: ${nxOut}`);
