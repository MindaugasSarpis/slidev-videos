// A scene, declared as data: three axes, a view, and layers (surface, line,
// points, marker) whose numbers come from a data file. validateSpec says what
// is wrong with a spec; prepareScene resolves it; drawFrame draws one view of
// it as a list of paths, far to near (the painter's algorithm).
import { makeCamera, projectMany, turnBounds, viewBounds, viewport, toScreen, ease } from './camera.js';
import { axisMap, boxFrame, fmt } from './axes.js';
import { buildSurface } from './surface.js';
import { buildBars, columnFaces } from './bars.js';
import { color, hexRGB, ramp, TOKENS, PALETTES } from './palette.js';

export const SPEC_VERSION = 1;
export const LAYER_TYPES = ['surface', 'bars', 'line', 'points', 'marker'];
const DEFAULT_VIEW = { azim: -55, elev: 25, dist: 5, turn: 40, elevRange: [5, 85] };
const KEY_W = 92;                 // room for a colour key at the right
const PAD = { l: 44, r: 22, t: 22, b: 54 };
const SEAM = 0.45;                // px each corner of an opaque polygon is pushed outwards: no seam shows
const r1 = (v) => Math.round(v * 10) / 10;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isRef = (v) => typeof v === 'string' && v.startsWith('data:');
function resolve(v, data) { return isRef(v) ? data?.[v.slice(5)] : v; }

/** Everything wrong with a spec and its data, as sentences; [] when it is sound. */
export function validateSpec(spec, data = {}) {
  const bad = [];
  const say = (m) => bad.push(m);
  if (!spec || typeof spec !== 'object') return ['the spec is not an object'];
  if (spec.explain3d !== SPEC_VERSION) say(`explain3d: ${JSON.stringify(spec.explain3d)}, this engine reads version ${SPEC_VERSION}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(spec.name || '')) say(`name: ${JSON.stringify(spec.name)} is not kebab-case`);
  if (typeof spec.label !== 'string' || !spec.label) say('label: the sentence a screen reader gets is missing');
  if (!Array.isArray(spec.axes) || spec.axes.length !== 3) say('axes: three are needed (x, y, height)');
  else spec.axes.forEach((a, k) => {
    if (!isNum(a?.lo) || !isNum(a?.hi) || !(a.lo < a.hi)) say(`axes[${k}]: lo < hi is needed`);
    if (!isNum(a?.len) || !(a.len > 0)) say(`axes[${k}]: len > 0 is needed`);
    for (const t of a?.ticks || []) if (!isNum(t) || t < a.lo || t > a.hi) say(`axes[${k}]: tick ${t} is outside ${a.lo} to ${a.hi}`);
  });
  const v = spec.view || {};
  for (const k of ['azim', 'elev', 'dist', 'turn']) if (k in v && !isNum(v[k])) say(`view.${k} is not a number`);
  if ('dist' in v && isNum(v.dist) && v.dist < 2.5) say('view.dist: below 2.5 the eye is inside the box');
  const ids = (list, what) => {
    const seen = new Set();
    for (const s of list || []) {
      if (!s?.id || !s?.label) say(`${what}: each needs an id and a label`);
      if (seen.has(s?.id)) say(`${what}: "${s.id}" twice`);
      seen.add(s?.id);
    }
    return seen;
  };
  const states = ids(spec.states, 'states');
  ids(spec.views, 'views');
  for (const w of spec.views || []) if (!isNum(w.azim) || !isNum(w.elev)) say(`views: "${w.id}" needs azim and elev`);
  if (!Array.isArray(spec.layers) || !spec.layers.length) say('layers: at least one is needed');
  const column = (L, i, key, n) => {
    const raw = L[key];
    if (isNum(raw)) return n;
    const arr = resolve(raw, data);
    if (!Array.isArray(arr)) { say(`layers[${i}].${key}: ${isRef(raw) ? `no "${raw.slice(5)}" in the data` : 'a number, a list or "data:name" is needed'}`); return n; }
    if (arr.some((x) => !isNum(x))) say(`layers[${i}].${key}: not all numbers`);
    if (n != null && arr.length !== n) say(`layers[${i}].${key}: ${arr.length} values, the other columns have ${n}`);
    return arr.length;
  };
  (spec.layers || []).forEach((L, i) => {
    if (!LAYER_TYPES.includes(L?.type)) { say(`layers[${i}].type: ${JSON.stringify(L?.type)} (known: ${LAYER_TYPES.join(', ')})`); return; }
    for (const s of L.in || []) if (!states.has(s)) say(`layers[${i}].in: no state "${s}"`);
    if (L.color != null && typeof L.color !== 'string') say(`layers[${i}].color is not a string`);
    if (L.type === 'surface') {
      const g = L.grid;
      if (!g || !Number.isInteger(g.nx) || !Number.isInteger(g.ny) || g.nx < 2 || g.ny < 2) { say(`layers[${i}].grid: nx and ny, at least 2 each`); return; }
      if (L.palette != null && !Array.isArray(L.palette) && !PALETTES[L.palette]) say(`layers[${i}].palette: no "${L.palette}"`);
      if (L.split != null && (!isNum(L.split.at) || typeof L.split.below !== 'string' || typeof L.split.above !== 'string')) say(`layers[${i}].split: { at, below, above } is needed`);
      const zs = L.z && typeof L.z === 'object' && !Array.isArray(L.z) ? L.z : { '': L.z };
      for (const [s, ref] of Object.entries(zs)) {
        if (s && !states.has(s)) say(`layers[${i}].z: no state "${s}"`);
        const arr = resolve(ref, data);
        if (!Array.isArray(arr)) say(`layers[${i}].z${s ? `.${s}` : ''}: no heights`);
        else if (arr.length !== g.nx * g.ny) say(`layers[${i}].z${s ? `.${s}` : ''}: ${arr.length} heights for a grid of ${g.nx} × ${g.ny}`);
        else if (arr.some((x) => !isNum(x))) say(`layers[${i}].z${s ? `.${s}` : ''}: not all numbers`);
      }
      if (L.z && typeof L.z === 'object' && !Array.isArray(L.z)) for (const s of states) if (!(s in L.z)) say(`layers[${i}].z: no heights for state "${s}"`);
    } else if (L.type === 'bars') {
      const g = L.grid;
      if (!g || !Number.isInteger(g.nx) || !Number.isInteger(g.ny) || g.nx < 1 || g.ny < 1) { say(`layers[${i}].grid: nx and ny cells, at least 1 each`); return; }
      if (L.palette != null && !Array.isArray(L.palette) && !PALETTES[L.palette]) say(`layers[${i}].palette: no "${L.palette}"`);
      const arr = resolve(L.z, data);
      if (!Array.isArray(arr)) say(`layers[${i}].z: no heights`);
      else if (arr.length !== g.nx * g.ny) say(`layers[${i}].z: ${arr.length} heights for ${g.nx} × ${g.ny} cells`);
      else if (arr.some((x) => !isNum(x))) say(`layers[${i}].z: not all numbers`);
    } else if (L.type === 'line' || L.type === 'points') {
      let n = null;
      for (const key of ['x', 'y', 'z']) n = column(L, i, key, n);
      if (n == null) say(`layers[${i}]: at least one of x, y, z must be a list`);
      if (L.type === 'points' && L.group != null) {
        const g = resolve(L.group, data);
        if (!Array.isArray(g) || g.length !== n) say(`layers[${i}].group: one whole number per point is needed`);
        else if (!Array.isArray(L.colors) || g.some((x) => !Number.isInteger(x) || x < 0 || x >= L.colors.length)) say(`layers[${i}].colors: a colour for every group is needed`);
      }
    } else if (L.type === 'marker') {
      if (!Array.isArray(L.at) || L.at.length !== 3 || L.at.some((x) => !isNum(x))) say(`layers[${i}].at: [x, y, z] is needed`);
    }
  });
  if (spec.key && !(spec.layers || []).some((L) => (L?.type === 'surface' && !L.color && !L.split) || L?.type === 'bars')) say('key: there is no surface coloured by height');
  return bad;
}

/** A spec and its data, resolved: throws with every problem when it is not sound. */
export function prepareScene(spec, data = {}) {
  const bad = validateSpec(spec, data);
  if (bad.length) throw new Error(`explain3d: ${spec?.name || 'scene'}: ${bad.join('; ')}`);
  const axes = spec.axes;
  const maps = axes.map(axisMap);
  const lens = axes.map((a) => a.len);
  const view = { ...DEFAULT_VIEW, ...(spec.view || {}) };
  const states = (spec.states || []).map((s) => s.id);
  const col = (L, key, n) => {
    const arr = resolve(L[key], data);
    const m = maps['xyz'.indexOf(key)];
    return Float64Array.from({ length: n }, (_, i) => m(isNum(arr) ? arr : arr[i]));
  };
  const layers = spec.layers.map((L) => {
    const base = { type: L.type, in: L.in || null, opacity: L.opacity ?? 1, lift: L.lift ?? (L.type === 'surface' || L.type === 'bars' ? 0 : 0.05) };
    if (L.type === 'surface') {
      const grid = { nx: L.grid.nx, ny: L.grid.ny, x: L.grid.x || [axes[0].lo, axes[0].hi], y: L.grid.y || [axes[1].lo, axes[1].hi] };
      const perState = L.z && typeof L.z === 'object' && !Array.isArray(L.z);
      const z = perState ? Object.fromEntries(Object.entries(L.z).map(([s, ref]) => [s, resolve(ref, data)])) : resolve(L.z, data);
      const rgbOf = (c) => hexRGB(TOKENS[c] && TOKENS[c].startsWith('#') ? TOKENS[c] : c);
      const flat = L.color ? rgbOf(L.color) : null;
      const split = L.split ? { at: maps[2](L.split.at), below: rgbOf(L.split.below), above: rgbOf(L.split.above) } : null;
      return { ...base, grid, z, perState, palette: L.palette || 'viridis', range: L.range || null, shade: L.shade !== false, flat, split, cache: new Map() };
    }
    if (L.type === 'bars') {
      const grid = { nx: L.grid.nx, ny: L.grid.ny, x: L.grid.x || [axes[0].lo, axes[0].hi], y: L.grid.y || [axes[1].lo, axes[1].hi] };
      const bars = buildBars({ grid, z: resolve(L.z, data), maps, zBox: [-lens[2] / 2, lens[2] / 2], base: L.base ?? axes[2].lo, gap: L.gap ?? 0.12, palette: L.palette || 'viridis', range: L.range || null });
      return { ...base, bars, palette: L.palette || 'viridis', range: L.range || null, face: { X: new Float64Array(4), Y: new Float64Array(4), D: new Float64Array(4) } };
    }
    if (L.type === 'marker') {
      return { ...base, at: L.at.map((v, k) => maps[k](v)), label: L.label || '', color: L.color || 'fg', radius: L.radius ?? 4.5, dx: L.dx ?? 10, dy: L.dy ?? -11, anchor: L.anchor || 'start' };
    }
    const n = ['x', 'y', 'z'].map((k) => resolve(L[k], data)).find(Array.isArray).length;
    const cols = ['x', 'y', 'z'].map((k) => col(L, k, n));
    const P = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) { P[3 * i] = cols[0][i]; P[3 * i + 1] = cols[1][i]; P[3 * i + 2] = cols[2][i]; }
    const buf = { X: new Float64Array(n), Y: new Float64Array(n), D: new Float64Array(n) };
    if (L.type === 'line') return { ...base, n, P, buf, color: L.color || 'fg', width: L.width ?? 2, dash: L.dash || null, closed: !!L.closed };
    return { ...base, n, P, buf, radius: L.radius ?? 2.1, group: L.group ? resolve(L.group, data) : null, colors: L.colors || [L.color || 'accent'], bands: L.bands ?? 6 };
  });
  const key = spec.key ? { label: spec.key.label || axes[2].label || '', ticks: spec.key.ticks || axes[2].ticks || [], decimals: spec.key.decimals ?? axes[2].decimals ?? 0 } : null;
  return { spec, name: spec.name, label: spec.label, axes, maps, lens, view, states, views: spec.views || [], stateList: spec.states || [], layers, key, bounds: new Map() };
}

function surfaceOf(scene, L, state, coarse) {
  const zBox = [-scene.lens[2] / 2, scene.lens[2] / 2];
  const build = (z) => buildSurface({ grid: L.grid, z, maps: scene.maps, zBox, step: coarse ? 2 : 1, palette: L.palette, range: L.range, shade: L.shade, colour: L.flat, split: L.split });
  if (!L.perState) {
    const k = coarse ? 'c' : 'f';
    if (!L.cache.has(k)) L.cache.set(k, build(L.z));
    return L.cache.get(k);
  }
  const u = state.u <= 0 ? 0 : state.u >= 1 ? 1 : ease(state.u);
  if (u === 0 || u === 1 || state.a === state.b) {
    const id = u === 1 ? state.b : state.a;
    const k = `${id}|${coarse ? 'c' : 'f'}`;
    if (!L.cache.has(k)) L.cache.set(k, build(L.z[id]));
    return L.cache.get(k);
  }
  const za = L.z[state.a], zb = L.z[state.b];
  const z = new Float64Array(za.length);
  for (let i = 0; i < z.length; i++) z[i] = za[i] + (zb[i] - za[i]) * u;
  return build(z);
}

const circle = (x, y, r) => {
  const rr = r.toFixed(2), dd = (2 * r).toFixed(2);
  return `M${r1(x - r)} ${r1(y)}a${rr} ${rr} 0 1 0 ${dd} 0a${rr} ${rr} 0 1 0 -${dd} 0`;
};

/**
 * One view of a scene. view: { azim, elev, state: { a, b, u } } (state: from
 * a to b, u from 0 to 1; left out, the first state). size: { width, height }.
 * opts: { coarse, live, left } (live: colours as CSS variables of the deck;
 * left: pixels kept free at the left, for buttons).
 * Returns { edges, items, axes, labels, key, plot }: items are the paths of
 * every layer, far to near.
 */
export function drawFrame(scene, view = {}, size, opts = {}) {
  const live = !!opts.live;
  const azim = view.azim ?? scene.view.azim;
  const elev = view.elev ?? scene.view.elev;
  const s0 = scene.states[0] ?? null;
  const state = view.state ? { a: view.state.a ?? s0, b: view.state.b ?? view.state.a ?? s0, u: view.state.u ?? 0 } : { a: s0, b: s0, u: 0 };
  const active = state.u < 0.5 ? state.a : state.b;
  const cam = makeCamera(azim, elev, scene.view.dist);
  const left = PAD.l + (opts.left || 0);
  const plot = { x: left, y: PAD.t, w: Math.max(40, size.width - left - PAD.r - (scene.key ? KEY_W : 0)), h: Math.max(40, size.height - PAD.t - PAD.b) };
  // the scale: the box over a whole turn at this tilt; seen from above, the box as it lies
  const bk = elev.toFixed(1);
  if (!scene.bounds.has(bk)) { if (scene.bounds.size > 400) scene.bounds.clear(); scene.bounds.set(bk, turnBounds(scene.lens, elev, scene.view.dist)); }
  let b = scene.bounds.get(bk);
  if (elev > 60) {
    const flat = viewBounds(scene.lens, azim, elev, scene.view.dist);
    const w = ease((elev - 60) / 30);
    b = b.map((v, k) => v + (flat[k] - v) * w);
  }
  const vp = viewport(b, plot);
  const frame = boxFrame(scene.axes, cam, vp, { width: plot.x + plot.w + PAD.r, height: size.height });
  const items = [];
  const labels = [];
  for (const L of scene.layers) {
    if (L.in && !L.in.includes(active)) continue;
    if (L.type === 'surface') {
      const m = surfaceOf(scene, L, state, !!opts.coarse);
      const nv = m.P.length / 3;
      if (!m.X || m.X.length !== nv) { m.X = new Float64Array(nv); m.Y = new Float64Array(nv); m.D = new Float64Array(nv); }
      projectMany(cam, vp, m.P, nv, m.X, m.Y, m.D);
      const push = L.opacity >= 1 ? SEAM : 0;
      for (let q = 0; q < m.n; q++) {
        const a = m.off[q], e = m.off[q + 1], c = e - a;
        let mx = 0, my = 0, md = 0;
        for (let v = a; v < e; v++) { mx += m.X[v]; my += m.Y[v]; md += m.D[v]; }
        mx /= c; my /= c; md /= c;
        let d = '';
        for (let v = a; v < e; v++) {
          const dx = m.X[v] - mx, dy = m.Y[v] - my;
          const len = Math.hypot(dx, dy) || 1;
          d += `${v === a ? 'M' : 'L'}${r1(m.X[v] + (dx / len) * push)} ${r1(m.Y[v] + (dy / len) * push)}`;
        }
        items.push({ key: md + L.lift, d: `${d}Z`, fill: m.fill[q], op: L.opacity });
      }
    } else if (L.type === 'bars') {
      const b = L.bars;
      const { X, Y, D } = L.face;
      for (let k = 0; k < b.n; k++) {
        // a column's place in the order: how near its foot is, so a tall far column never covers a short near one
        const key = b.cx[k] * cam.v[0] + b.cy[k] * cam.v[1] + b.z0 * cam.v[2] + L.lift;
        const faces = columnFaces(b, k, cam.v);
        for (let f = 0; f < faces.length; f++) {
          projectMany(cam, vp, faces[f].P, 4, X, Y, D);
          let d = '';
          for (let v = 0; v < 4; v++) d += `${v ? 'L' : 'M'}${r1(X[v])} ${r1(Y[v])}`;
          items.push({ key: key + f * 1e-7, d: `${d}Z`, fill: faces[f].fill, stroke: faces[f].fill, sw: 0.5, op: L.opacity });
        }
      }
    } else if (L.type === 'line') {
      const { X, Y, D } = L.buf;
      projectMany(cam, vp, L.P, L.n, X, Y, D);
      const stroke = color(L.color, live);
      const last = L.closed ? L.n : L.n - 1;
      for (let i = 0; i < last; i++) {
        const j = (i + 1) % L.n;
        items.push({ key: (D[i] + D[j]) / 2 + L.lift, d: `M${r1(X[i])} ${r1(Y[i])}L${r1(X[j])} ${r1(Y[j])}`, stroke, sw: L.width, op: L.opacity, dash: L.dash });
      }
    } else if (L.type === 'points') {
      const { X, Y, D } = L.buf;
      projectMany(cam, vp, L.P, L.n, X, Y, D);
      const half = 0.5 * Math.hypot(...scene.lens);
      const nb = L.bands, ng = L.colors.length;
      const buf = Array.from({ length: nb * ng }, () => []);
      for (let i = 0; i < L.n; i++) {
        const band = Math.max(0, Math.min(nb - 1, Math.floor(((D[i] + half) / (2 * half)) * nb)));
        const r = (L.radius * cam.dist) / (cam.dist - D[i]);
        buf[band * ng + (L.group ? L.group[i] : 0)].push(circle(X[i], Y[i], r));
      }
      for (let band = 0; band < nb; band++) {
        for (let g = 0; g < ng; g++) {
          const ds = buf[band * ng + g];
          if (ds.length) items.push({ key: -half + ((band + 0.5) / nb) * 2 * half + L.lift, d: ds.join(''), fill: color(L.colors[g], live), op: L.opacity * (0.42 + (0.53 * (band + 0.5)) / nb) });
        }
      }
    } else if (L.type === 'marker') {
      const p = toScreen(cam, vp, L.at[0], L.at[1], L.at[2]);
      const c = color(L.color, live);
      items.push({ key: p.d + L.lift + 0.02, d: circle(p.x, p.y, L.radius * p.k), fill: c, stroke: color('bg', live), sw: 1.5, op: L.opacity });
      if (L.label) labels.push({ x: r1(p.x + L.dx), y: r1(p.y + L.dy), text: L.label, anchor: L.anchor, fill: c });
    }
  }
  items.sort((p, q) => p.key - q.key);
  let key = null;
  if (scene.key) {
    const L = scene.layers.find((l) => (l.type === 'surface' && !l.flat && !l.split) || l.type === 'bars');
    const [lo, hi] = L.range || [scene.axes[2].lo, scene.axes[2].hi];
    const top = PAD.t + 30, bottom = size.height - PAD.b;
    const pal = ramp(L.palette, 12);
    key = {
      x: size.width - KEY_W + 16, top, bottom, label: scene.key.label,
      stops: pal.map((rgb, k) => ({ off: r1((k / 11) * 100) / 100, col: `rgb(${rgb.map(Math.round).join(',')})` })),
      ticks: scene.key.ticks.filter((t) => t >= lo && t <= hi).map((t) => ({ text: fmt(t, scene.key.decimals), y: r1(bottom - ((t - lo) / (hi - lo)) * (bottom - top)) })),
      width: 10,
    };
  }
  for (const e of frame.edges) { e.x1 = r1(e.x1); e.y1 = r1(e.y1); e.x2 = r1(e.x2); e.y2 = r1(e.y2); }
  for (const ax of frame.axes) {
    for (const t of ax.ticks) for (const k of ['x', 'y', 'x2', 'y2', 'lx', 'ly']) t[k] = r1(t[k]);
    ax.name.x = r1(ax.name.x); ax.name.y = r1(ax.name.y);
  }
  return { edges: frame.edges, items, axes: frame.axes, labels, key, plot, azim, elev, active };
}
