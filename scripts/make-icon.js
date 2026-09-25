'use strict';
// Writes build/icon.ico from the same four-dot artwork the app draws at runtime.
const fs = require('node:fs');
const path = require('node:path');
const { makeIconPng } = require('../src/icon');

const sizes = [16, 32, 48, 256];
const pngs = sizes.map((s) => makeIconPng(s));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);

let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s; // width (0 means 256)
  e[1] = s >= 256 ? 0 : s; // height
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});

const out = path.join(__dirname, '..', 'build', 'icon.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, ...entries, ...pngs]));
console.log(`wrote ${out} (${sizes.join(', ')} px)`);
