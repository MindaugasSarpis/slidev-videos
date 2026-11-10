// The camera of matplotlib's view_init(elev, azim), with a mild perspective.
// World: the scene's box, centred on the origin, z up, each axis as long as
// its `len`. Screen: x right, y up, in box units until a viewport scales it.
const DEG = Math.PI / 180;

/** Eye direction v, screen right r, screen up u, for a view in degrees. */
export function makeCamera(azim, elev, dist = 5) {
  const a = azim * DEG;
  const e = elev * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
  return { v: [ce * ca, ce * sa, se], r: [-sa, ca, 0], u: [-se * ca, -se * sa, ce], dist };
}

/** One point: screen x, y (y up), depth d towards the eye, perspective factor k. */
export function project(cam, x, y, z) {
  const { v, r, u, dist } = cam;
  const d = x * v[0] + y * v[1] + z * v[2];
  const k = dist / (dist - d);
  return { x: k * (x * r[0] + y * r[1] + z * r[2]), y: k * (x * u[0] + y * u[1] + z * u[2]), d, k };
}

/** n points of P (x, y, z, x, y, z, …) into X, Y, D; a viewport puts them in pixels. */
export function projectMany(cam, vp, P, n, X, Y, D) {
  const { v, r, u, dist } = cam;
  const { S, cx, cy } = vp;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    const x = P[o], y = P[o + 1], z = P[o + 2];
    const d = x * v[0] + y * v[1] + z * v[2];
    const k = (S * dist) / (dist - d);
    X[i] = cx + k * (x * r[0] + y * r[1] + z * r[2]);
    Y[i] = cy - k * (x * u[0] + y * u[1] + z * u[2]);
    D[i] = d;
  }
}

/** The eight corners of a box with sides lens = [lx, ly, lz]. */
export function boxCorners(lens) {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([(sx * lens[0]) / 2, (sy * lens[1]) / 2, (sz * lens[2]) / 2]);
  return out;
}

/** Screen bounds [x0, x1, y0, y1] of the box seen from one view. */
export function viewBounds(lens, azim, elev, dist) {
  const cam = makeCamera(azim, elev, dist);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of boxCorners(lens)) {
    const p = project(cam, c[0], c[1], c[2]);
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return [x0, x1, y0, y1];
}

/** The union of the bounds over a whole turn at one tilt: the scale does not
 *  breathe while the scene turns. */
export function turnBounds(lens, elev, dist) {
  const b = [Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < 24; k++) {
    const c = viewBounds(lens, k * 15, elev, dist);
    b[0] = Math.min(b[0], c[0]);
    b[1] = Math.max(b[1], c[1]);
    b[2] = Math.min(b[2], c[2]);
    b[3] = Math.max(b[3], c[3]);
  }
  return b;
}

/** Scale and centre that put screen bounds b inside rect {x, y, w, h} (pixels, y down). */
export function viewport(b, rect, fill = 1) {
  const S = Math.max(1, fill * Math.min(rect.w / (b[1] - b[0]), rect.h / (b[3] - b[2])));
  return { S, cx: rect.x + rect.w / 2 - (S * (b[0] + b[1])) / 2, cy: rect.y + rect.h / 2 + (S * (b[2] + b[3])) / 2 };
}

/** A projected point in pixels. */
export function toScreen(cam, vp, x, y, z) {
  const p = project(cam, x, y, z);
  return { x: vp.cx + vp.S * p.x, y: vp.cy - vp.S * p.y, d: p.d, k: p.k };
}

/** An azimuth in (-180, 180]. */
export const wrapAzim = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
/** From azimuth a0 to a1 the short way round: the a1 to glide to. */
export const nearAzim = (a0, a1) => a0 + wrapAzim(a1 - a0);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
