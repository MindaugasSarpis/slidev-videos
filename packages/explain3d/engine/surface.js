// A surface z(x, y) on a regular grid, as polygons in box units: one quad per
// cell, cut at the bottom and the top of the box, coloured by height and
// shaded by a light fixed in the scene.
import { ramp } from './palette.js';

// The light: from the upper left of the floor, about 40° above it.
const LIGHT = (() => { const v = [-1, 1, 1.25]; const n = Math.hypot(...v); return v.map((x) => x / n); })();

/** Cut a polygon (flat xyz) to z <= top (side 1) or z >= bottom (side -1). */
export function clipZ(poly, zc, side) {
  const n = poly.length / 3;
  let inside = true;
  for (let i = 0; i < n; i++) if (side * (poly[3 * i + 2] - zc) > 1e-12) { inside = false; break; }
  if (inside) return poly;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = 3 * i, b = 3 * ((i + 1) % n);
    const da = side * (poly[a + 2] - zc), db = side * (poly[b + 2] - zc);
    if (da <= 0) out.push(poly[a], poly[a + 1], poly[a + 2]);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push(poly[a] + (poly[b] - poly[a]) * t, poly[a + 1] + (poly[b + 1] - poly[a + 1]) * t, zc);
    }
  }
  return out.length >= 9 ? out : [];
}

/**
 * grid: { nx, ny, x: [lo, hi], y: [lo, hi] } in data units; z: ny rows of nx
 * values (z[j * nx + i]); maps: three functions, data → box units; zBox: the
 * box's [bottom, top] in box units; step 2 takes every second grid line (the
 * mesh drawn while frames are slow). split: { at, below, above } (at in box
 * units, the colours as RGB triples) colours by side of one height instead.
 * Returns { n, P, off, fill, flat }: polygon q owns the vertices off[q] to
 * off[q + 1] of P (x, y, z, …) and the colour fill[q].
 */
export function buildSurface({ grid, z, maps, zBox, step = 1, palette = 'viridis', range, shade = true, colour = null, split = null }) {
  const { nx, ny } = grid;
  if (z.length !== nx * ny) throw new Error(`explain3d: a surface of ${nx} × ${ny} needs ${nx * ny} heights, got ${z.length}`);
  const bx = new Float64Array(nx), by = new Float64Array(ny), bz = new Float64Array(nx * ny);
  for (let i = 0; i < nx; i++) bx[i] = maps[0](grid.x[0] + ((grid.x[1] - grid.x[0]) * i) / (nx - 1));
  for (let j = 0; j < ny; j++) by[j] = maps[1](grid.y[0] + ((grid.y[1] - grid.y[0]) * j) / (ny - 1));
  for (let k = 0; k < nx * ny; k++) bz[k] = maps[2](z[k]);
  // the normal at each grid point, from its neighbours on either side
  const N = new Float64Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const ip = Math.min(nx - 1, i + 1), im = Math.max(0, i - 1), jp = Math.min(ny - 1, j + 1), jm = Math.max(0, j - 1);
      const gx = (bz[j * nx + ip] - bz[j * nx + im]) / (bx[ip] - bx[im]);
      const gy = (bz[jp * nx + i] - bz[jm * nx + i]) / (by[jp] - by[jm]);
      const L = Math.hypot(gx, gy, 1);
      const o = 3 * (j * nx + i);
      N[o] = -gx / L; N[o + 1] = -gy / L; N[o + 2] = 1 / L;
    }
  }
  const pal = colour || split ? null : ramp(palette, 64);
  const [r0, r1] = range ? range.map(maps[2]) : zBox;
  const P = [], off = [0], fill = [];
  for (let j = 0; j + step <= ny - 1; j += step) {
    for (let i = 0; i + step <= nx - 1; i += step) {
      const ks = [j * nx + i, j * nx + i + step, (j + step) * nx + i + step, (j + step) * nx + i];
      const is = [i, i + step, i + step, i], js = [j, j, j + step, j + step];
      let poly = [];
      for (let c = 0; c < 4; c++) poly.push(bx[is[c]], by[js[c]], bz[ks[c]]);
      poly = clipZ(clipZ(poly, zBox[1], 1), zBox[0], -1);
      if (!poly.length) continue;
      let zm = 0;
      for (let c = 2; c < poly.length; c += 3) zm += poly[c];
      zm /= poly.length / 3;
      let lam = 1;
      if (shade) {
        let a = 0, b = 0, c = 0;
        for (const k of ks) { a += N[3 * k]; b += N[3 * k + 1]; c += N[3 * k + 2]; }
        lam = 0.4 + 0.72 * Math.max(0, (a * LIGHT[0] + b * LIGHT[1] + c * LIGHT[2]) / Math.hypot(a, b, c));
      }
      if (split) {
        // two colours, one below a height and one above it: the cell is cut there, so the edge is exact
        const parts = [[clipZ(poly, split.at, 1), split.below], [clipZ(poly, split.at, -1), split.above]];
        for (const [part, rgb] of parts) {
          if (!part.length) continue;
          fill.push(`rgb(${rgb.map((v) => Math.min(255, Math.round(v * lam))).join(',')})`);
          for (const v of part) P.push(v);
          off.push(P.length / 3);
        }
        continue;
      }
      const rgb = colour || pal[Math.max(0, Math.min(63, Math.round(((zm - r0) / (r1 - r0)) * 63)))];
      fill.push(`rgb(${rgb.map((v) => Math.min(255, Math.round(v * lam))).join(',')})`);
      for (const v of poly) P.push(v);
      off.push(P.length / 3);
    }
  }
  return { n: fill.length, P: Float64Array.from(P), off: Int32Array.from(off), fill };
}
