#!/usr/bin/env node

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createPNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const buf = Buffer.alloc(4 + type.length + data.length + 4);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4);
    data.copy(buf, 4 + type.length);
    const crc = crc32(buf.slice(4, 4 + type.length + data.length));
    buf.writeUInt32BE(crc, buf.length - 4);
    return buf;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * (1 + width * 4) + 1 + x * 4;
      rawData[di + 0] = pixels[si + 0];
      rawData[di + 1] = pixels[si + 1];
      rawData[di + 2] = pixels[si + 2];
      rawData[di + 3] = pixels[si + 3];
    }
  }
  const compressed = zlib.deflateSync(rawData);

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createICO(sizes, renderFn) {
  const images = sizes.map(s => {
    const pixels = new Uint8Array(s * s * 4);
    renderFn(pixels, s);
    return { size: s, data: createPNG(s, s, pixels) };
  });

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

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function setPixel(pixels, size, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  const sa = a / 255;
  const da = (pixels[i + 3] / 255) * (1 - sa);
  const oa = sa + da;
  if (oa > 0) {
    pixels[i + 0] = Math.round((r * sa + pixels[i + 0] * da) / oa);
    pixels[i + 1] = Math.round((g * sa + pixels[i + 1] * da) / oa);
    pixels[i + 2] = Math.round((b * sa + pixels[i + 2] * da) / oa);
    pixels[i + 3] = Math.round(oa * 255);
  }
}

function fillRect(p, s, x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h && y < s; y++)
    for (let x = x0; x < x0 + w && x < s; x++)
      setPixel(p, s, x, y, r, g, b, a);
}

function fillCircle(p, s, cx, cy, radius, r, g, b, a = 255) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) {
        const edge = Math.max(0, Math.min(1, (radius - Math.sqrt(d2)) * 1.5));
        setPixel(p, s, x, y, r, g, b, Math.round(a * edge));
      }
    }
  }
}

function fillRoundRect(p, s, x0, y0, w, h, rad, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let draw = true;
      if (x < x0 + rad && y < y0 + rad) {
        const dx = x - (x0 + rad), dy = y - (y0 + rad);
        if (dx * dx + dy * dy > rad * rad) draw = false;
      } else if (x >= x0 + w - rad && y < y0 + rad) {
        const dx = x - (x0 + w - rad - 1), dy = y - (y0 + rad);
        if (dx * dx + dy * dy > rad * rad) draw = false;
      } else if (x < x0 + rad && y >= y0 + h - rad) {
        const dx = x - (x0 + rad), dy = y - (y0 + h - rad - 1);
        if (dx * dx + dy * dy > rad * rad) draw = false;
      } else if (x >= x0 + w - rad && y >= y0 + h - rad) {
        const dx = x - (x0 + w - rad - 1), dy = y - (y0 + h - rad - 1);
        if (dx * dx + dy * dy > rad * rad) draw = false;
      }
      if (draw) setPixel(p, s, x, y, r, g, b, a);
    }
  }
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function drawSmooth(p, s, segments, ox, oy, scale, r, g, b) {
  const thick = scale * 0.22;
  const x0 = Math.floor(ox - thick - 1), y0 = Math.floor(oy - thick - 1);
  const x1 = Math.ceil(ox + scale + thick + 1), y1 = Math.ceil(oy + scale + thick + 1);
  for (let y = Math.max(0, y0); y < Math.min(s, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(s, x1); x++) {
      let minD = Infinity;
      for (const seg of segments) {
        const d = distToSegment(x + 0.5, y + 0.5,
          ox + seg[0] * scale, oy + seg[1] * scale,
          ox + seg[2] * scale, oy + seg[3] * scale);
        if (d < minD) minD = d;
      }
      if (minD < thick + 1) {
        const alpha = Math.max(0, Math.min(1, (thick + 0.8 - minD) / 1.2));
        setPixel(p, s, x, y, r, g, b, Math.round(255 * alpha));
      }
    }
  }
}

function drawLetterN(p, s, cx, cy, h, r, g, b) {
  const w = h * 0.7;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const segments = [
    [0, 0, 0, 1],
    [1, 0, 1, 1],
    [0, 0, 1, 1],
  ];
  drawSmooth(p, s, segments, x0, y0, h, r, g, b);
  const extra = h * 0.22;
  drawSmooth(p, s, [[0, 0, 0, 1], [1, 0, 1, 1], [0, 0, 1, 1]], x0, y0, h, r, g, b);
}

function drawLetterX(p, s, cx, cy, h, r, g, b) {
  const segments = [
    [0, 0, 1, 1],
    [1, 0, 0, 1],
  ];
  const x0 = cx - h * 0.35, y0 = cy - h / 2;
  drawSmooth(p, s, segments, x0, y0, h, r, g, b);
}

function renderNaideIcon(pixels, size) {
  const s = size;
  const pad = Math.max(1, Math.round(s * 0.08));
  const rad = Math.max(3, Math.round(s * 0.22));

  fillRoundRect(pixels, s, 0, 0, s, s, rad, 35, 70, 150);
  fillRoundRect(pixels, s, pad, pad, s - pad * 2, s - pad * 2, Math.max(2, rad - 2), 55, 110, 210);

  const letterH = Math.round(s * 0.5);
  drawLetterN(pixels, s, Math.round(s / 2), Math.round(s * 0.46), letterH, 255, 255, 255);
}

function renderNxIcon(pixels, size) {
  const s = size;
  const pad = Math.max(1, Math.round(s * 0.08));
  const rad = Math.max(3, Math.round(s * 0.22));

  fillRoundRect(pixels, s, 0, 0, s, s, rad, 25, 110, 60);
  fillRoundRect(pixels, s, pad, pad, s - pad * 2, s - pad * 2, Math.max(2, rad - 2), 45, 160, 90);

  const letterH = Math.round(s * 0.5);
  drawLetterX(pixels, s, Math.round(s / 2), Math.round(s * 0.46), letterH, 255, 255, 255);
}

mkdirSync(resolve(__dirname, '..', 'assets'), { recursive: true });

const naideIco = createICO([16, 32, 48, 256], renderNaideIcon);
const nxIco = createICO([16, 32, 48, 256], renderNxIcon);

writeFileSync(resolve(__dirname, '..', 'assets', 'naide.ico'), naideIco);
writeFileSync(resolve(__dirname, '..', 'assets', 'nx.ico'), nxIco);

console.log('Icons generated successfully.');
