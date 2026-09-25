'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeGrid } = require('../src/layout');

const AREA = { x: 0, y: 0, width: 1920, height: 1080 };

test('computeGrid returns one rect per window, all inside the work area', () => {
  for (const n of [1, 2, 3, 4, 5, 7]) {
    const rects = computeGrid(n, AREA);
    assert.equal(rects.length, n);
    for (const r of rects) {
      assert.ok(r.x >= AREA.x && r.y >= AREA.y, `rect starts inside the area for n=${n}`);
      assert.ok(r.x + r.width <= AREA.x + AREA.width + 1, `rect fits horizontally for n=${n}`);
      assert.ok(r.y + r.height <= AREA.y + AREA.height + 1, `rect fits vertically for n=${n}`);
      assert.ok(r.width > 0 && r.height > 0);
    }
  }
});

test('rects for the same count do not overlap', () => {
  const rects = computeGrid(4, AREA);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      assert.equal(overlap, false, `rects ${i} and ${j} overlap`);
    }
  }
});

test('zero windows is an empty layout', () => {
  assert.deepEqual(computeGrid(0, AREA), []);
});
