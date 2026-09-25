'use strict';

// Tiles n windows into a near-square grid inside a screen work area. Pure and order-stable, so the same account
// always lands in the same cell for a given count.
function computeGrid(n, area, gap = 8) {
  if (n <= 0) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = Math.floor((area.width - gap * (cols + 1)) / cols);
  const cellH = Math.floor((area.height - gap * (rows + 1)) / rows);
  const rects = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // The last row may have fewer items than `cols`; centre that row instead of leaving a gap on the right.
    const itemsInRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const rowOffset = Math.floor(((cols - itemsInRow) * (cellW + gap)) / 2);
    rects.push({
      x: area.x + gap + col * (cellW + gap) + (row === rows - 1 ? rowOffset : 0),
      y: area.y + gap + row * (cellH + gap),
      width: cellW,
      height: cellH,
    });
  }
  return rects;
}

module.exports = { computeGrid };
