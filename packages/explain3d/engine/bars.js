// Columns on a grid of cells (a histogram of two variables): each cell with a
// count is a box from the base up to its count, coloured by its height. A
// frame draws the top of each column and the sides that face the eye, column
// by column from the farthest: columns never hide the wrong neighbour.
import { ramp } from './palette.js';

const SIDE = [0.62, 0.8];          // the brightness of the sides along y and along x; the top is 1

/**
 * grid: { nx, ny, x: [lo, hi], y: [lo, hi] }: nx × ny cells over those limits;
 * z: ny rows of nx heights; maps: data → box units; zBox: the box's bottom and
 * top; base: where the columns stand (data units); gap: the share of a cell
 * left free between columns.
 * Returns { n, cx, cy, hw, hh, z0, z1, top, sideX, sideY } (box units, colours as CSS).
 */
export function buildBars({ grid, z, maps, zBox, base = 0, gap = 0.12, palette = 'viridis', range }) {
  const { nx, ny } = grid;
  if (z.length !== nx * ny) throw new Error(`explain3d: columns on ${nx} × ${ny} cells need ${nx * ny} heights, got ${z.length}`);
  const pal = ramp(palette, 64);
  const b0 = Math.max(zBox[0], Math.min(zBox[1], maps[2](base)));
  const [r0, r1] = range ? range.map(maps[2]) : zBox;
  const wx = (maps[0](grid.x[1]) - maps[0](grid.x[0])) / nx, wy = (maps[1](grid.y[1]) - maps[1](grid.y[0])) / ny;
  const out = { n: 0, cx: [], cy: [], hw: (Math.abs(wx) * (1 - gap)) / 2, hh: (Math.abs(wy) * (1 - gap)) / 2, z0: b0, z1: [], top: [], sideX: [], sideY: [] };
  const css = (rgb, f) => `rgb(${rgb.map((v) => Math.min(255, Math.round(v * f))).join(',')})`;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = z[j * nx + i];
      if (!(v > base)) continue;
      const z1 = Math.min(zBox[1], maps[2](v));
      const rgb = pal[Math.max(0, Math.min(63, Math.round(((z1 - r0) / (r1 - r0)) * 63)))];
      out.cx.push(maps[0](grid.x[0]) + wx * (i + 0.5));
      out.cy.push(maps[1](grid.y[0]) + wy * (j + 0.5));
      out.z1.push(z1);
      out.top.push(css(rgb, 1)); out.sideX.push(css(rgb, SIDE[1])); out.sideY.push(css(rgb, SIDE[0]));
      out.n++;
    }
  }
  return out;
}

/** The faces of one column that the eye sees, as corner lists (x, y, z, …): sides first, the top last. */
export function columnFaces(b, k, v) {
  const x0 = b.cx[k] - b.hw, x1 = b.cx[k] + b.hw, y0 = b.cy[k] - b.hh, y1 = b.cy[k] + b.hh, z0 = b.z0, z1 = b.z1[k];
  const faces = [];
  if (v[0] > 1e-9) faces.push({ P: [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1], fill: b.sideX[k] });
  else if (v[0] < -1e-9) faces.push({ P: [x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1], fill: b.sideX[k] });
  if (v[1] > 1e-9) faces.push({ P: [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], fill: b.sideY[k] });
  else if (v[1] < -1e-9) faces.push({ P: [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], fill: b.sideY[k] });
  if (v[2] > 1e-9) faces.push({ P: [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], fill: b.top[k] });
  return faces;
}
