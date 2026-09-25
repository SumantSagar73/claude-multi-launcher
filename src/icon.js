'use strict';

// Builds the tray/window icon at runtime (four dots, one per account) so the project ships no binary assets.
const zlib = require('node:zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const DOTS = [
  { cx: 0.28, cy: 0.28, rgb: [224, 122, 95] },
  { cx: 0.72, cy: 0.28, rgb: [232, 162, 58] },
  { cx: 0.28, cy: 0.72, rgb: [129, 178, 154] },
  { cx: 0.72, cy: 0.72, rgb: [111, 168, 220] },
];

function makeIconPng(size = 64) {
  const radius = size * 0.2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0 + RGBA
    for (let x = 0; x < size; x++) {
      let best = null;
      for (const d of DOTS) {
        const dist = Math.hypot(x + 0.5 - d.cx * size, y + 0.5 - d.cy * size);
        const cover = Math.min(1, Math.max(0, radius + 0.5 - dist));
        if (cover > 0 && (!best || cover > best.cover)) best = { cover, rgb: d.rgb };
      }
      if (best) {
        const o = 1 + x * 4;
        row[o] = best.rgb[0];
        row[o + 1] = best.rgb[1];
        row[o + 2] = best.rgb[2];
        row[o + 3] = Math.round(best.cover * 255);
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A plain coloured disc for a per-account shortcut icon. Kept separate from makeIconPng (the four-dot app icon)
// since it needs one colour, not the fixed palette.
function makeAccountIconPng(size, hexColor) {
  const rgb = [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16));
  const r = size / 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const cover = Math.min(1, Math.max(0, r - dist));
      if (cover > 0) {
        const o = 1 + x * 4;
        row[o] = rgb[0];
        row[o + 1] = rgb[1];
        row[o + 2] = rgb[2];
        row[o + 3] = Math.round(cover * 255);
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { makeIconPng, makeAccountIconPng };
