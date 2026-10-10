// The stage's clocks: how fast the world runs (`rate`), how fast the camera
// does (`cameraRate`), and a camera path timed in seconds. Pure functions; the
// engine (space.js) keeps the state.
//
// A rate is a number, eased to over `over` seconds from the rate in force, or
// keyframes [[t, rate], …]: t in seconds from when the ramp was set, eased
// between keys (smoothstep), from the rate in force to the first key when that
// key is later than 0; the last value holds. Rates are clamped to 0..MAX_RATE;
// 0 stands the world still.

export const MAX_RATE = 8;

const clampRate = (r) => Math.min(MAX_RATE, Math.max(0, Number.isFinite(Number(r)) ? Number(r) : 1));
const smooth = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

// spec → [[t, rate], …], sorted, starting from `from` at 0 unless a key does
export function rampKeys(spec, from = 1, over = 1) {
  if (Array.isArray(spec)) {
    const keys = spec
      .filter((k) => Array.isArray(k) && k.length >= 2 && Number.isFinite(Number(k[0])))
      .map((k) => [Math.max(0, Number(k[0])), clampRate(k[1])])
      .sort((a, b) => a[0] - b[0]);
    if (!keys.length) return [[0, clampRate(from)]];
    if (keys[0][0] > 0) keys.unshift([0, clampRate(from)]);
    return keys;
  }
  const to = clampRate(spec ?? 1);
  const d = Math.max(0, Number(over) || 0);
  return d > 0 ? [[0, clampRate(from)], [d, to]] : [[0, to]];
}

// the rate `t` seconds into a ramp
export function rampAt(keys, t) {
  if (!keys.length) return 1;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, r1] = keys[i];
    if (t < t1) {
      const [t0, r0] = keys[i - 1];
      return r0 + (r1 - r0) * smooth((t - t0) / Math.max(1e-6, t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

// seconds until the ramp stops changing (0 once it holds)
export const rampLeft = (keys, t) => Math.max(0, (keys.length ? keys[keys.length - 1][0] : 0) - t);

// ---- the camera path -----------------------------------------------------------
// keys: [{ t, pos: [x,y,z], look: [x,y,z] }, …], sorted by t. Between keys a
// centripetal Catmull-Rom spline (no loops or overshoot at uneven spacing),
// with time eased across the whole path so it starts and lands gently. Before
// the first key: the first key; after the last: the last.

function catmull(p0, p1, p2, p3, u) {
  // centripetal: knot intervals by the square root of the distance
  const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => a.map((v, i) => (tb === ta ? v : ((tb - t) / (tb - ta)) * v + ((t - ta) / (tb - ta)) * b[i]));
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

export function pathAt(keys, t) {
  if (!keys.length) return null;
  const last = keys[keys.length - 1];
  if (keys.length === 1 || t <= keys[0].t) return { pos: keys[0].pos.slice(), look: keys[0].look.slice(), done: keys.length === 1 && t >= keys[0].t };
  if (t >= last.t) return { pos: last.pos.slice(), look: last.look.slice(), done: true };
  let i = 1;
  while (i < keys.length - 1 && t >= keys[i].t) i++;
  const k1 = keys[i - 1], k2 = keys[i];
  const k0 = keys[i - 2] || k1, k3 = keys[i + 1] || k2;
  // ease in at the first segment's start and out at the last segment's end
  let u = (t - k1.t) / Math.max(1e-6, k2.t - k1.t);
  const first = i === 1, end = i === keys.length - 1;
  if (first && end) u = smooth(u);
  else if (first) u = u * u * (2 - u);            // eased in, leaves at speed
  else if (end) u = 1 - (1 - u) * (1 - u) * (1 + u); // arrives at speed, eased out
  const ext = (a, b) => a.map((v, j) => 2 * v - b[j]);   // a phantom point beyond an end
  const p0 = k0 === k1 ? ext(k1.pos, k2.pos) : k0.pos, p3 = k3 === k2 ? ext(k2.pos, k1.pos) : k3.pos;
  const l0 = k0 === k1 ? ext(k1.look, k2.look) : k0.look, l3 = k3 === k2 ? ext(k2.look, k1.look) : k3.look;
  return { pos: catmull(p0, k1.pos, k2.pos, p3, u), look: catmull(l0, k1.look, k2.look, l3, u), done: false };
}

// a slide's `path` as written → [[t, pose], …] sorted, or null
export function readPath(path) {
  if (!Array.isArray(path)) return null;
  const keys = path
    .filter((k) => Array.isArray(k) && k.length >= 2 && Number.isFinite(Number(k[0])) && k[1] && typeof k[1] === 'object')
    .map((k) => [Math.max(0, Number(k[0])), k[1]])
    .sort((a, b) => a[0] - b[0]);
  return keys.length ? keys : null;
}

// the grains a builder may draw at a tier (ctx.budget)
export const BUDGETS = [300000, 160000, 60000, 30000];
