import { Group, Color, Vector3, Vector4, ShaderMaterial, NormalBlending, AdditiveBlending, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture } from 'three';
import { GRAIN_GLSL, grainMaterial, grainPoints, grainGeometry, rgb } from '../grains.js';
import { stepper, stepOf, hasStep, onStep } from '../steps.js';
import { shared } from '../shared.js';
import { whenGateOpen } from '../gate.js';
import { OFF, eventLatch } from '../events.js';

// The LHCb plugin: LHCb's real Run 3 geometry as grains, and what stands with it.
// Lifted from MasterTalk (setup/route.js `detector`, d3dc728) and Innoday
// (setup/detector.js and setup/emblems.js, feat/innoday-cern), Oct 2026.
//
//   stage:
//     plugins: [lhcb]          # or, in setup/main.ts: usePlugin('lhcb')
//
// Object types: detector | emblem | floor | supports. Their steps come from the
// step bus (<StageSteps :set="{ det: 1 }" />, stage/steps.js).
//
// The geometry's grains are data, not code: `src: lhcb` (93 000 grains, 744 KB) or
// `src: lhcb-dense` (446 400, 3.5 MB) are fetched from the geometry-lhcb release at
// build time and served at stage-data/ with their notice (GPL-3.0: LHCb's DD4hep
// description, through HSF Phoenix's glTF, Apache-2.0); see vite.config.js. A deck's
// own file works too: `src: data/my-grains.bin`. The format: little-endian Int16
// [x, y, z, part] per grain, in mm, LHCb's frame (z along the beam, y up).
//
// The event's tracks mark the hits (step 2): setLhcbTracks([[[x, y, z] m, …], …]),
// or install's `tracks`. A gate delays the fetch (a deck that keeps its first slide's
// fly-in free of long tasks): setLhcbGate((start) => unsubscribe).

export const name = 'lhcb';

// the parts in the .bin's 4th field, by index (tools/lhcb/bake_grains.py's PARTS)
export const PARTS = ['velo', 'pipe', 'rich1', 'ut', 'magnet', 'scifi', 'rich2', 'ecal', 'hcal', 'muon'];
// `parts: lhcb`: white and light blue only. Neighbours along the beam set apart, the
// trackers (where the hits come from) brightest, the pipe and the magnet deepest (the
// magnet a frame, not a mass); the muon stations in lhc-collision's muon tone.
export const PART_COLORS = {
  velo: { color: '#e6efff', alpha: 1 },
  pipe: { color: '#5b93ff', alpha: 0.5 },
  rich1: { color: '#7fa9ff', alpha: 0.85 },
  ut: { color: '#cfe2ff', alpha: 1 },
  magnet: { color: '#5b93ff', alpha: 0.3 },
  scifi: { color: '#dce9ff', alpha: 1 },
  rich2: { color: '#7fa9ff', alpha: 0.85 },
  ecal: { color: '#b8d2ff', alpha: 0.9 },
  hcal: { color: '#8fb6ff', alpha: 0.85 },
  muon: { color: '#cfe2ff', alpha: 0.9 },
};
// the data files the plugin knows by name (vite.config.js fetches and serves them)
export const DATA = { lhcb: 'stage-data/lhcb-grains.bin', 'lhcb-dense': 'stage-data/lhcb-grains-dense.bin' };

const config = shared('lhcb', () => ({ tracks: null, gate: null }));
export function setLhcbTracks(tracks) { config.tracks = tracks || null; }
export function setLhcbGate(gate) { config.gate = typeof gate === 'function' ? gate : null; }
const gated = (fn) => whenGateOpen(fn, config.gate);   // its own gate, else the stage's (stage/gate.js)

const at3 = (v) => [v?.[0] || 0, v?.[1] || 0, v?.[2] || 0];
const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += Math.random(); return (s - 2) / 1.2; };
const srcUrl = (ctx, src, fallback) => ctx.asset('/' + String(DATA[src || fallback] || src || DATA[fallback]).replace(/^\//, ''));

// the per-part colour and alpha, by index: `parts` absent → one `color` for all; 'lhcb' →
// PART_COLORS; an object → its parts over `color` (or over PART_COLORS with preset: lhcb)
export function partTable(parts, color = '#5b93ff') {
  const base = parts === 'lhcb' || parts?.preset === 'lhcb' ? PART_COLORS : null;
  const own = parts && typeof parts === 'object' ? parts : {};
  return PARTS.map((p) => ({
    color: own[p]?.color ?? base?.[p]?.color ?? color,
    alpha: Number(own[p]?.alpha ?? base?.[p]?.alpha ?? 1),
  }));
}

// the grains of a .bin: every k-th, to the stage's budget for one form — at every tier (v0.11: tier 0
// took them all, and lhcb-dense's 446 400 helped Užsikrauk karjerai's finale to white on an M2)
export function readGrains(buf, { tier = 0, budget = 300000 } = {}) {
  const all = new Int16Array(buf);
  const k = Math.max(1, Math.ceil(all.length / 4 / (budget || 300000)));
  return k === 1 ? all : all.filter((_, j) => ((j >> 2) % k) === 0);
}

// a grain is a hit when one of the tracks passes within r of it (the tracks binned
// every 5 cm along the beam); never within `min` of the beam, where every track meets
export function markHits(raw, tracks, { r = 0.035, min = 0.1 } = {}) {
  const n = raw.length / 4, hit = new Float32Array(n);
  if (!tracks?.length) return { hit, hits: 0 };
  const bins = new Map();
  for (const t of tracks) for (const p of t) {
    const k = Math.round(p[2] / 0.05); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(p[0], p[1]);
  }
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const x = raw[i * 4] / 1000, y = raw[i * 4 + 1] / 1000, z = raw[i * 4 + 2] / 1000;
    if (Math.hypot(x, y) < min) continue;
    const rr = r + 0.004 * Math.max(z, 0);
    for (let dk = -1; dk <= 1 && !hit[i]; dk++) {
      const b = bins.get(Math.round(z / 0.05) + dk); if (!b) continue;
      for (let j = 0; j < b.length; j += 2) if ((b[j] - x) ** 2 + (b[j + 1] - y) ** 2 < rr * rr) { hit[i] = 1; hits++; break; }
    }
  }
  return { hit, hits };
}

// a few frames drawn hidden ahead of need (an event a deck dispatches): buffers upload
// and programs compile then, not mid-flight
function prewarm(o) {
  let warm = 0;
  const ev = o.prewarm || 'slidev-stage:prewarm', on = () => { warm = 3; };
  if (typeof window !== 'undefined') window.addEventListener(ev, on);
  return { tick: () => (warm > 0 ? warm-- > 0 : false), off: () => { if (typeof window !== 'undefined') window.removeEventListener(ev, on); } };
}

// ---- detector --------------------------------------------------------------------------
//   { type: detector, name, pos, src?: lhcb | lhcb-dense | path, scale?: 0.5, stretch?: 2.4,
//     sweep?: 3.5 (s for the front to cross it), size?: 1, alpha?: 0.16, color?: '#5b93ff', hot?: '#ffffff',
//     parts?: lhcb | { velo: { color, alpha }, …, preset?: lhcb }, out?: [x, y, z] (where the hits
//     leave to, in the object's frame), hitR?: 0.035 (m), hitMin?: 0.1 (m from the beam),
//     hole?: [x, y, z, r] (a soft dimming on screen round that point), near?: { size, from, to },
//     prewarm?: event name }
// World frame, as lhc-collision draws it: W(x, y, z) = [z·S, y·S·T, x·S·T] (LHCb metres; S
// `scale` units a metre along the beam, world +x; T `stretch` across it).
// Steps: 0 hidden; 1 lit behind a front running out from the collision; 2 the hits (the
// grains the tracks pass through) turn `hot` and leave for `out` every 3.4 s, the rest dims.
// Arriving at a later step directly shows it whole at once.
const DET_VERT = GRAIN_GLSL + /* glsl */ `
attribute float aX, aHit, aSeed, aPart;
uniform float uShowT, uHideT, uSweep, uLen, uHitT, uSize, uAlpha;
uniform vec3 uOut, uHot;
uniform vec3 uPartColor[10];
uniform float uPartAlpha[10];
uniform vec4 uHole;
void main() {
  if (uShowT > 1e8) { hide(); return; }
  int pi = int(clamp(aPart, 0.0, 9.0) + 0.5);
  vec3 base = uPartColor[pi];
  float since = uTime - uShowT;
  float front = since / uSweep * uLen;
  float d = front - aX;
  float passed = smoothstep(-0.4, 0.0, d);
  float flash = passed * exp(-max(d, 0.0) * 0.9);
  float fade = uHideT > 1e8 ? 1.0 : 1.0 - smoothstep(0.0, 1.2, uTime - uHideT);
  vec3 p = position, col = mix(base, uHot, 0.6 * flash);
  float a = (uAlpha * passed * (0.55 + 0.45 * hash(aSeed * 9.0)) + 0.5 * flash) * uPartAlpha[pi];
  float size = uSize;
  if (uHitT < 1e8) {
    float h = uTime - uHitT;
    if (aHit > 0.5) {
      // a hit is hot whatever its part
      float lit = smoothstep(0.0, 0.8, h);
      col = mix(col, uHot, lit); a = mix(a, 0.7, lit); size *= 1.0 + 0.3 * lit;
      // each hit leaves after the others ahead of it: the front ones first; then again, every
      // 3.4 s (the next crossing's hits), so the readout stays a flow from the detector
      float hh = h - 2.2 - (1.0 - aX / uLen) * 1.2 - aSeed * 0.8;
      float go = hh < 0.0 ? 0.0 : ease(mod(hh, 3.4) / 2.6);
      vec3 c1 = vec3(max(position.x, uOut.x * 0.7), position.y * 0.6, position.z * 0.6);
      p = mix(mix(position, c1, go), mix(c1, uOut, go), go);
      a *= (1.0 - 0.4 * smoothstep(0.0, 0.3, go)) * (1.0 - smoothstep(0.88, 1.0, go));   // in flight a hit is a fainter grain
    } else {
      a *= mix(1.0, 0.5, smoothstep(0.0, 1.6, h));
    }
  }
  if (uHole.w > 0.0) {
    // a mark in front of the grains along its line of sight: they make way round it (a
    // soft dimming, not a hole), so added light does not wash its colours out
    vec4 hc = projectionMatrix * modelViewMatrix * vec4(uHole.xyz, 1.0), gc = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vec2 dn = (gc.xy / gc.w - hc.xy / hc.w) * vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0);
    a *= mix(0.25, 1.0, smoothstep(uHole.w * 0.2, uHole.w, length(dn)));
  }
  place(p, size, a * fade, col, aSeed);
}`;

function buildDetector(o, ctx) {
  const g = new Group(); g.position.set(...at3(o.pos)); g.name = 'detector:' + (o.name || '');
  const S = o.scale ?? 0.5, T = o.stretch ?? 2.4;
  const W = (x, y, z) => [z * S, y * S * T, x * S * T];   // LHCb metres -> world, as the collision draws it
  const table = partTable(o.parts, o.color || '#5b93ff');
  const mat = grainMaterial(DET_VERT, {
    uShowT: { value: 1e9 }, uHideT: { value: 1e9 }, uSweep: { value: o.sweep ?? 3.5 }, uLen: { value: 19.5 * S },
    uHitT: { value: 1e9 }, uSize: { value: o.size ?? 1 }, uAlpha: { value: o.alpha ?? 0.16 },
    uOut: { value: new Vector3(...(o.out || [14, 0, 0])) },
    uHot: { value: new Color(...rgb(o.hot || '#ffffff')) },
    uPartColor: { value: table.map((t) => new Color(...rgb(t.color))) },
    uPartAlpha: { value: table.map((t) => t.alpha) },
    uHole: { value: new Vector4(...(o.hole || [0, 0, 0, 0])) },
  }, { near: o.near });
  const u = mat.uniforms;
  let alive = true;
  const build = (buf) => {
    if (!alive) return;
    const raw = readGrains(buf, { tier: ctx.tier ?? 0, budget: ctx.budget });
    const n = raw.length / 4;
    const { hit, hits } = markHits(raw, o.tracks || config.tracks, { r: o.hitR ?? 0.035, min: o.hitMin ?? 0.1 });
    const pos = new Float32Array(n * 3), ax = new Float32Array(n), seed = new Float32Array(n), part = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = raw[i * 4] / 1000, y = raw[i * 4 + 1] / 1000, z = raw[i * 4 + 2] / 1000;
      pos.set(W(x, y, z), i * 3); ax[i] = z * S; seed[i] = Math.random(); part[i] = raw[i * 4 + 3];
    }
    g.add(grainPoints(grainGeometry(n, { position: pos, aX: [ax, 1], aHit: [hit, 1], aSeed: [seed, 1], aPart: [part, 1] }), mat));
    g.userData.hits = hits; g.userData.grains = n;
  };
  const offGate = gated(() => {
    fetch(srcUrl(ctx, o.src, 'lhcb')).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(build).catch((e) => console.warn('stage: detector grains failed', o.src || 'lhcb', e));
  });
  const warm = prewarm(o);
  const s = stepper(o.name);
  let now = 0;
  // shown and let go through one latch: once faded, its show, hide and hit times are all OFF
  const ev = eventLatch(u, { start: 'uShowT', hide: 'uHideT', also: ['uHitT'], fade: 1.3 });
  const apply = () => {
    const k = s.step;
    if (k <= 0) { ev.stop(now); ev.tick(now); u.uHitT.value = OFF; return; }
    ev.start(now, k === 1 && s.prev === 0 ? now : now - 100);
    if (k >= 2) { if (u.uHitT.value > 1e8) u.uHitT.value = s.prev === 1 ? now : now - 100; } else u.uHitT.value = OFF;
  };
  return {
    group: g, labels: [], frameScale: u.uPixelRatio,
    api: { busy: () => (u.uShowT.value < 1e8 && now - u.uShowT.value < u.uSweep.value + 1) || (u.uHitT.value < 1e8 && now - u.uHitT.value < 7.5) },
    update(t) {
      now = t; u.uTime.value = t;
      if (s.fresh) { s.fresh = false; apply(); }
      ev.tick(t);
      const warming = warm.tick();
      g.visible = u.uShowT.value < 1e8 || warming;   // hidden, it costs nothing on the other slides
    },
    dispose() { alive = false; offGate(); s.off(); warm.off(); },
  };
}

// ---- emblem ------------------------------------------------------------------------------
//   { type: emblem, name, pos, width?: 4, yaw?: 0, pitch?: 0 (degrees), flag?: lt | src?: image,
//     mode?: alpha (the image's own alpha marks its grains; else dark or coloured marks on a light
//     ground), keep?: 0.25, tint?: { '#rrggbb': '#rrggbb' }, grains?: 26000, size?: 1.2, alpha?: 0.85,
//     wave?: 0 (a flag's flutter, units), scrim?: 0 (a soft dark ground behind it), blend?: add,
//     dur?: 2.6, of?: another name to follow (a person for scale beside the detector), near?, prewarm? }
// An image or a flag as grains, gathering out of the dust on step 1 and fading on 0. Drawn
// over the world's grains (normal blending) unless blend: add, so its colours stay its own.
const FLAGS = {
  // top to bottom; the yellow lifted from #FDB913 so the finish brings it back there
  lt: [['#FFC800', 1.05], ['#006A44', 1], ['#C1272D', 1]],
};
const EMB_VERT = GRAIN_GLSL + /* glsl */ `
attribute vec3 aStart, aColor;
attribute float aSeed, aU;
uniform float uT0, uHide, uDur, uSize, uAlpha, uWave;
void main() {
  if (uT0 > 1e8) { hide(); return; }
  float k = clamp((uTime - uT0) / uDur * 1.35 - aSeed * 0.35, 0.0, 1.0);
  float e = ease(k);
  vec3 p = mix(aStart, position, e);
  vec3 col = aColor;
  if (uWave > 0.0) {
    // the cloth: a travelling wave, pinned at its hoist (aU = 0); the folds catch the light
    p.z += uWave * aU * sin(aU * 7.0 - uTime * 2.2) * e;
    col *= 1.02 + 0.07 * cos(aU * 7.0 - uTime * 2.2) * aU;
  }
  float fade = uHide > 1e8 ? 1.0 : 1.0 - smoothstep(0.0, 1.0, uTime - uHide);
  place(p, uSize * (0.7 + 0.6 * aSeed), uAlpha * smoothstep(0.0, 0.25, k) * fade, col, aSeed);
}`;
const EMB_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.18, 0.5, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(pow(vColor, vec3(2.2)), a);
}`;
const EMB_ADD_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.04, 0.5, d)) * vAlpha;
  gl_FragColor = vec4(pow(vColor, vec3(2.2)) * a, 1.0);
}`;

export function flagGrains(n, w, flag = 'lt') {
  const bands = (FLAGS[flag] || FLAGS.lt).map(([hex, lift]) => new Color(hex).multiplyScalar(lift));
  const h = w * 3 / 5, out = { home: new Float32Array(n * 3), col: new Float32Array(n * 3), u: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const u = Math.random(), v = Math.random(), c = bands[Math.min(bands.length - 1, Math.floor(v * bands.length))];
    out.home.set([(u - 0.5) * w, (0.5 - v) * h, (Math.random() - 0.5) * 0.02 * w], i * 3);
    out.col.set([c.r, c.g, c.b].map((x) => Math.pow(x, 1 / 2.2)), i * 3);   // display values: the shader takes them to linear
    out.u[i] = u;
  }
  return out;
}

// grains where an image has its marks, each its pixel's colour (or a tint for it)
export function imageMarks(px, W, H, n, w, o = {}) {
  const tints = Object.entries(o.tint || {}).map(([a, b]) => [new Color(a), new Color(b)]);
  const keep = o.keep ?? 0.25;
  const cdf = new Float64Array(W * H);
  let acc = 0;
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4] / 255, gg = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255, a = px[i * 4 + 3] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const mark = o.mode === 'alpha' ? a : a * Math.max(1 - (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 0.85, mx > 0 ? (mx - mn) / mx : 0);
    acc += mark > keep ? 1 : 0;
    cdf[i] = acc;
  }
  const h = w * H / W, out = { home: new Float32Array(n * 3), col: new Float32Array(n * 3), u: new Float32Array(n) };
  if (!acc) return out;
  for (let k = 0; k < n; k++) {
    const t = Math.random() * acc;
    let lo = 0, hi = W * H - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < t) lo = mid + 1; else hi = mid; }
    const x = lo % W, y = (lo / W) | 0;
    const u = (x + Math.random()) / W, v = (y + Math.random()) / H;
    out.home.set([(u - 0.5) * w, (0.5 - v) * h, (Math.random() - 0.5) * 0.02 * w], k * 3);
    let col = new Color(px[lo * 4] / 255, px[lo * 4 + 1] / 255, px[lo * 4 + 2] / 255);
    let best = null, bd = 0.12;
    for (const [a, b] of tints) { const d = Math.hypot(col.r - a.r, col.g - a.g, col.b - a.b); if (d < bd) { bd = d; best = b; } }
    if (best) col = best;
    out.col.set([col.r, col.g, col.b], k * 3);
    out.u[k] = u;
  }
  return out;
}
async function imageGrains(url, n, w, o) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = 480, H = Math.round(480 * img.naturalHeight / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  return imageMarks(g.getImageData(0, 0, W, H).data, W, H, n, w, o);
}

function buildEmblem(o, ctx) {
  const g = new Group(); g.position.set(...at3(o.pos)); g.name = 'emblem:' + (o.name || '');
  g.rotation.set((o.pitch || 0) * Math.PI / 180, (o.yaw || 0) * Math.PI / 180, 0, 'YXZ');
  const w = o.width ?? 4, n = Math.round((o.grains ?? 26000) * Math.min(1, (ctx.budget || 300000) / 300000) ** 0.5);
  const add = o.blend === 'add';
  const mat = grainMaterial(EMB_VERT, {
    uT0: { value: 1e9 }, uHide: { value: 1e9 }, uDur: { value: o.dur ?? 2.6 },
    uSize: { value: o.size ?? 1.2 }, uAlpha: { value: o.alpha ?? 0.85 }, uWave: { value: o.wave ?? 0 },
  }, { near: { size: 10, from: 2.5, to: 7, ...(o.near || {}) }, fragmentShader: add ? EMB_ADD_FRAG : EMB_FRAG });
  mat.blending = add ? AdditiveBlending : NormalBlending;
  const u = mat.uniforms;
  let scrim = null;
  if (o.scrim > 0 && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,1,3,1)'); gr.addColorStop(0.6, 'rgba(0,1,3,0.85)'); gr.addColorStop(1, 'rgba(0,1,3,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const h = o.src ? w * 0.75 : w * 3 / 5;
    scrim = new Mesh(new PlaneGeometry(w * 1.7, h * 2.0), new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    scrim.position.z = -0.05; scrim.renderOrder = 19;
    g.add(scrim);
  }
  let alive = true;
  const make = (d) => {
    if (!alive) return;
    const start = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // scattered in the dust around where it will hang, up to a couple of widths out
      start.set([d.home[i * 3] * 2.2 + gauss() * w * 0.8, d.home[i * 3 + 1] * 2.2 + gauss() * w * 0.6, gauss() * w * 0.9], i * 3);
      seed[i] = Math.random();
    }
    const pts = grainPoints(grainGeometry(n, { position: d.home, aStart: [start, 3], aColor: [d.col, 3], aSeed: [seed, 1], aU: [d.u, 1] }), mat);
    pts.renderOrder = 20;   // after the detector's grains: laid over them
    g.add(pts);
  };
  const offGate = gated(() => {
    if (o.flag) make(flagGrains(n, w, o.flag));
    else if (o.src) imageGrains(ctx.asset('/' + String(o.src).replace(/^\//, '')), n, w, o).then(make).catch((e) => console.warn('stage: emblem failed', o.src, e));
  });
  const warm = prewarm(o);
  const key = o.of || o.name;
  let now = 0, step = stepOf(key) ?? 0, fresh = hasStep(key);
  const off = onStep(key, (k) => { step = k; fresh = true; });
  const ev = eventLatch(u, { start: 'uT0', hide: 'uHide', fade: 1.1 });
  const apply = () => { if (step > 0) ev.start(now); else ev.stop(now); };
  return {
    group: g, labels: [], frameScale: u.uPixelRatio,
    api: { busy: () => u.uT0.value < 1e8 && u.uHide.value > 1e8 && now - u.uT0.value < u.uDur.value * 1.4 },
    update(t) {
      now = t; u.uTime.value = t;
      if (fresh) { fresh = false; apply(); }
      ev.tick(t);
      if (scrim) {
        const on = u.uT0.value > 1e8 ? 0 : Math.min(1, (t - u.uT0.value) / u.uDur.value);
        const out = u.uHide.value > 1e8 ? 1 : Math.max(0, 1 - (t - u.uHide.value));
        scrim.material.opacity = o.scrim * on * out;
      }
      const warming = warm.tick();
      g.visible = u.uT0.value < 1e8 || warming;
    },
    dispose() { alive = false; offGate(); off(); warm.off(); },
  };
}

// ---- floor and supports --------------------------------------------------------------------
//   { type: floor, name, of?: det, pos, area?: [32, 28], step?: 2, grains?: 18000, size?: 1.4, color?, alpha?: 0.9 }
//     a cavern floor as a faint grid of grains, for an eye-level view's scale, shown with `of`
//   { type: supports, name, of?: det, pos?, floor: -6.72, parts: [[x0, x1, zHalf, yBottom], …],
//     frame?: legs, grains?: 16000, color?, alpha?: 0.6, size?: 1.2 }
//     the cradles the sub-detectors stand on: legs to the floor and rails (and the full frame)
const LINE_VERT = GRAIN_GLSL + /* glsl */ `
attribute float aSeed, aFall;
uniform float uShowT, uAlpha, uSize;
uniform vec3 uColor;
void main() {
  if (uShowT > 1e8) { hide(); return; }
  float a = uAlpha * smoothstep(0.0, 2.0, uTime - uShowT) * aFall * (0.6 + 0.4 * hash(aSeed * 7.0));
  place(position, uSize, a, uColor, aSeed);
}`;
function shownWith(o, g, pos, seed, fall, defaults) {
  const mat = grainMaterial(LINE_VERT, {
    uShowT: { value: 1e9 }, uAlpha: { value: o.alpha ?? defaults.alpha }, uSize: { value: o.size ?? defaults.size },
    uColor: { value: new Color(...rgb(o.color || defaults.color)) },
  }, { near: { size: 10, from: 2.5, to: 7, ...(o.near || {}) } });
  g.add(grainPoints(grainGeometry(seed.length, { position: pos, aSeed: [seed, 1], aFall: [fall, 1] }), mat));
  const u = mat.uniforms, of = o.of || 'det';
  let now = 0, step = stepOf(of) ?? 0, fresh = true;
  const off = onStep(of, (k) => { step = k; fresh = true; });
  return {
    group: g, labels: [], frameScale: u.uPixelRatio,
    api: { busy: () => u.uShowT.value < 1e8 && now - u.uShowT.value < 2.2 },
    update(t) {
      now = t; u.uTime.value = t;
      if (fresh) { fresh = false; if (step > 0) { if (u.uShowT.value > 1e8) u.uShowT.value = t; } else u.uShowT.value = 1e9; }
      g.visible = u.uShowT.value < 1e8;
    },
    dispose: off,
  };
}
function buildFloor(o) {
  const g = new Group(); g.position.set(...at3(o.pos)); g.name = 'floor:' + (o.name || '');
  const [sx, sz] = o.area || [32, 28], step = o.step ?? 2, n = o.grains ?? 18000;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n), fall = new Float32Array(n);
  const nx = Math.floor(sx / step) + 1, lines = nx + Math.floor(sz / step) + 1;
  for (let i = 0; i < n; i++) {
    let x, z;
    if (i % 5 === 4) { x = (Math.random() - 0.5) * sx; z = (Math.random() - 0.5) * sz; }   // a little dust between the lines
    else {
      const l = Math.floor(Math.random() * lines);
      if (l < nx) { x = -sx / 2 + l * step; z = (Math.random() - 0.5) * sz; }
      else { z = -sz / 2 + (l - nx) * step; x = (Math.random() - 0.5) * sx; }
      x += (Math.random() - 0.5) * 0.04; z += (Math.random() - 0.5) * 0.04;
    }
    pos.set([x, 0, z], i * 3); seed[i] = Math.random();
    const r = Math.max(Math.abs(x) / (sx / 2), Math.abs(z) / (sz / 2));   // faded toward the edges: no border shows
    fall[i] = (1 - Math.min(1, r) ** 3) * (i % 5 === 4 ? 0.35 : 1);
  }
  return shownWith(o, g, pos, seed, fall, { alpha: 0.9, size: 1.4, color: '#7f9fd8' });
}
function buildSupports(o) {
  const g = new Group(); g.position.set(...at3(o.pos)); g.name = 'supports:' + (o.name || '');
  const n = o.grains ?? 16000, fl = o.floor ?? -6.72, segs = [];
  for (const [x0, x1, zh, yb] of o.parts || []) {
    for (const x of [x0, x1]) for (const z of [-zh, zh]) segs.push([[x, fl, z], [x, yb, z]]);   // legs
    for (const z of [-zh, zh]) segs.push([[x0, fl, z], [x1, fl, z]]);   // foot rails
    if (o.frame !== 'legs') {
      for (const z of [-zh, zh]) segs.push([[x0, yb, z], [x1, yb, z]]);
      segs.push([[x0, yb, -zh], [x0, yb, zh]], [[x1, yb, -zh], [x1, yb, zh]]);
    }
  }
  const len = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])), total = len.reduce((s, l) => s + l, 0);
  const pos = new Float32Array(n * 3), seed = new Float32Array(n), fall = new Float32Array(n).fill(1);
  for (let i = 0; i < n && segs.length; i++) {
    let t = Math.random() * total, j = 0;
    while (j < segs.length - 1 && t > len[j]) { t -= len[j]; j++; }
    const [a, b] = segs[j], k = len[j] ? t / len[j] : 0;
    for (let c = 0; c < 3; c++) pos[i * 3 + c] = a[c] + (b[c] - a[c]) * k + (Math.random() - 0.5) * 0.12;
    seed[i] = Math.random();
  }
  return shownWith(o, g, pos, seed, fall, { alpha: 0.6, size: 1.2, color: '#6fa4ff' });
}

// The object types this plugin adds, with the fields each must carry (the validator
// reads this without running any three.js; stage/types.js holds the same table).
export const types = {
  detector: ['pos', 'name'],
  emblem: ['pos', 'name'],
  floor: ['pos', 'name'],
  supports: ['name', 'parts'],
};

// install({ registerBuilder }, { tracks, gate }): usePlugin('lhcb') calls it with the api
export function install({ registerBuilder }, { tracks, gate } = {}) {
  if (tracks) setLhcbTracks(tracks);
  if (gate) setLhcbGate(gate);
  const fns = { detector: buildDetector, emblem: buildEmblem, floor: buildFloor, supports: buildSupports };
  for (const [type, fields] of Object.entries(types)) registerBuilder(type, fns[type], { fields });
}
