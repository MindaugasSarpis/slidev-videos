import {
  Group, Mesh, Points, MeshBasicMaterial, MeshStandardMaterial, ShaderMaterial, PlaneGeometry, TorusGeometry, SphereGeometry, BufferGeometry, BufferAttribute,
  Line, LineSegments, LineBasicMaterial, LineDashedMaterial, TextureLoader, CanvasTexture, LinearFilter, Vector3, DoubleSide, AdditiveBlending, Color, CylinderGeometry, Quaternion, SRGBColorSpace,
} from 'three';
import { makeLabel, makeText } from './labels.js';
import { marble, shell, ball } from './materials.js';
import { buildGalaxy, buildCollider } from './forms.js';
import { shared } from './shared.js';

// What a station is made of. A station (space.json) lists `objects`, each
// with a `type`; the type names a *builder* registered here. A builder is
//
//   (object, ctx) => { group, labels?, anchors?, update?(t, camPos), api?, pixelRatio?, dispose? }
//
//   group       a three.js Object3D, placed by the builder at object.pos
//   labels      sprites that fade with the scrim (setDim)
//   anchors     Map<id, Vector3> relative to the object: places a pose or a stop can name
//   update      called every frame with the world clock and the camera position
//   api         { arm(), assemble(now, onDone), value?() }: a thing that builds itself on
//               arrival; value() is the number it shows now, which <StageCount for="name">
//               reads when the object has a `name`; busy (a value or a function), true
//               while a form moves on its own clock without assemble(): the headless
//               tools wait for it as they wait for an assembly
//   pixelRatio  a { value } uniform the engine keeps at the drawing buffer's ratio
//   dispose     called when the world is torn down, before the engine disposes every
//               geometry and material under group: for what else the builder holds
//
//   ctx         { palette, records: Map, anisotropy, asset(src), helpers, twinkle }
//
// The builders below are the general ones. A deck adds its own with
// registerBuilder (from its setup/main.ts), or takes a shipped plugin
// (`stage.plugins: [hadron]`).

// one registry per page, shared by every copy of the package (shared.js)
const registry = shared('registry', () => new Map());
const required = shared('required', () => new Map());

// fields: the keys an object of this type must carry (used by the validator)
// { fields, enterable }: `enterable: true` for a form a camera may stand inside
// (a floor, enveloping strands), which slidev-stage-check then does not warn about
const enterable = new Set();
export function registerBuilder(type, fn, { fields = ['pos'], enterable: inside = false } = {}) {
  if (typeof fn !== 'function') throw new TypeError(`stage: builder for "${type}" is not a function`);
  registry.set(type, fn);
  required.set(type, fields);
  if (inside) enterable.add(type); else enterable.delete(type);
}
export const builderEnterable = (type) => enterable.has(type);
export const hasBuilder = (type) => registry.has(type);
export const builderTypes = () => [...registry.keys()];
export const builderFields = (type) => required.get(type) || ['pos'];

const loader = new TextureLoader();
export const v3 = (a) => new Vector3(a?.[0] || 0, a?.[1] || 0, a?.[2] || 0);
export const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += Math.random(); return (s - 2) / 1.2; };

function endLabel(text, pts, color) {
  const l = makeLabel(text, { worldH: 0.46, color, letterSpacing: 0.02, upper: false });
  const end = pts[pts.length - 1];
  l.position.set(end.x + 0.55, end.y + 0.3, end.z);
  return l;
}
function placedLabel(text, at, pts, color) {
  // a track that ends on a vertex: an end label would sit on the node, so the
  // data gives the position ('mid' = above the middle of the track, or [x, y, z])
  const l = makeLabel(text, { worldH: 0.46, color, letterSpacing: 0.02, upper: false });
  if (Array.isArray(at)) l.position.set(at[0], at[1], at[2]);
  else { const a = pts[0], b = pts[pts.length - 1]; l.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.42, (a.z + b.z) / 2); }
  return l;
}

// ---- page: an image as a lit sheet ---------------------------------------------
registerBuilder('page', (o, ctx) => {
  const g = new Group();
  // lit paper: the key and fill lights fall across the sheet. Its albedo is
  // kept low (a white page under these lights overexposed, and bloom then
  // fogged the whole slide): the sheet reads as paper in a dim room.
  const mat = new MeshStandardMaterial({ color: '#1a1d22', roughness: 0.92, metalness: 0, transparent: true, opacity: 0.98, side: DoubleSide });
  loader.load(ctx.asset(o.src), (tex) => {
    // `paper: '#f4f1ea'`: the image is composed onto a sheet of that colour, of the plane's own
    // aspect, with a margin, so a transparent scan does not print dark ink on dark space
    if (o.paper) {
      const img = tex.image, W = Math.round(img.width * 1.08), H = Math.round(W * o.height / o.width);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g2 = c.getContext('2d'); g2.fillStyle = o.paper; g2.fillRect(0, 0, W, H);
      const pad = img.width * 0.04, k = Math.min((W - 2 * pad) / img.width, (H - 2 * pad) / img.height);
      g2.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
      tex.dispose(); tex = new CanvasTexture(c);
      tex.minFilter = LinearFilter; tex.generateMipmaps = false;   // a scan is seen near 1:1: mipmaps only blur its text
    }
    tex.colorSpace = SRGBColorSpace; tex.anisotropy = ctx.anisotropy || 1;
    mat.map = tex; mat.color.set(o.tone || ctx.palette.paper); mat.needsUpdate = true;   // `tone`: the albedo tint
  }, undefined, () => console.warn('stage: page texture failed', o.src));
  const m = new Mesh(new PlaneGeometry(o.width, o.height), mat);
  m.rotation.y = (o.yaw || 0) * Math.PI / 180;
  g.add(m);
  // a faint lit halo behind the sheet so it reads as a lit object in the dark (`halo: false` drops it)
  if (o.halo !== false) {
    const halo = new Mesh(new PlaneGeometry(o.width * 1.25, o.height * 1.18), new MeshBasicMaterial({ color: ctx.palette.accent, transparent: true, opacity: 0.04, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    halo.position.z = -0.05; halo.rotation.y = m.rotation.y; g.add(halo);
  }
  g.position.copy(v3(o.pos));
  return { group: g, labels: [] };
}, { fields: ['src', 'pos', 'width', 'height'] });

// ---- text: lines of type in the world ----------------------------------------------
registerBuilder('text', (o, ctx) => {
  const s = makeText(o.text, { height: o.height, color: o.color || ctx.palette.fg, weight: o.weight });
  s.position.copy(v3(o.pos));
  return { group: s, labels: [s] };
}, { fields: ['text', 'pos', 'height'] });

// ---- label: one tracked line --------------------------------------------------------
registerBuilder('label', (o, ctx) => {
  const s = makeLabel(o.text, { worldH: o.height || 0.5, color: o.color || ctx.palette.dim, letterSpacing: o.tracking ?? 0.1, upper: o.upper !== false });
  s.position.copy(v3(o.pos));
  return { group: s, labels: [s] };
}, { fields: ['text', 'pos'] });

// ---- ring: a slowly turning torus ------------------------------------------------------
registerBuilder('ring', (o, ctx) => {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: o.color || ctx.palette.accent, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false });
  const ring = new Mesh(new TorusGeometry(o.radius, o.radius * (o.thickness || 0.07), 12, 64), mat);
  if (o.tilt) ring.rotation.x = o.tilt * Math.PI / 180;
  g.add(ring); g.position.copy(v3(o.pos));
  const fadeNear = o.fadeNear || 0;
  const world = new Vector3();
  const anchors = o.id ? new Map([[o.id, new Vector3(0, 0, 0)]]) : undefined;   // a ring can stand for a record
  return { group: g, labels: [], anchors, update(t, camPos) {
    ring.rotation.y = t * (o.spin ?? 0.2);
    if (fadeNear) { const d = camPos.distanceTo(g.getWorldPosition(world)); mat.opacity = 0.15 + 0.7 * Math.min(1, Math.max(0, (d - fadeNear) / fadeNear)); }
  } };
}, { fields: ['pos', 'radius'] });

// ---- tracks: lines and lit tubes, with a pulse running down them ---------------------------
registerBuilder('tracks', (o, ctx) => {
  const g = new Group(); const labels = []; const pulses = [];
  for (const t of o.tracks) {
    const pts = t.points.map(v3);
    const geo = new BufferGeometry().setFromPoints(pts);
    const ink = t.color || ctx.palette.fg;
    const col = new Color(ink);
    const mat = t.dashed
      ? new LineDashedMaterial({ color: col, transparent: true, opacity: t.fade ?? 0.9, dashSize: 0.22, gapSize: 0.16, depthWrite: false })
      : new LineBasicMaterial({ color: col, transparent: true, opacity: t.fade ?? 0.9, depthWrite: false });
    const line = new Line(geo, mat); if (t.dashed) line.computeLineDistances();
    g.add(line);
    // a soft glow: a second pass with additive blending
    g.add(new Line(geo.clone(), new LineBasicMaterial({ color: col, transparent: true, opacity: 0.12 * (t.fade ?? 1), blending: AdditiveBlending, depthWrite: false })));
    if (!t.dashed) {
      // solid tracks as lit tubes with an emissive core: WebGL lines are one pixel wide whatever the screen
      const tubeMat = new MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.15, roughness: 0.5, metalness: 0.1, transparent: (t.fade ?? 1) < 1, opacity: t.fade ?? 1 });
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k], b = pts[k + 1], dir = b.clone().sub(a), len = dir.length();
        const tube = new Mesh(new CylinderGeometry(0.036 * (t.width || 2), 0.036 * (t.width || 2), len, 12, 1, true), tubeMat);
        tube.position.copy(a).addScaledVector(dir, 0.5);
        tube.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
        g.add(tube);
      }
    }
    if (t.label) { const l = t.labelAt ? placedLabel(t.label, t.labelAt, pts, ink) : endLabel(t.label, pts, ink); g.add(l); labels.push(l); }
    if (o.pulse && !t.dashed) {
      const dot = new Mesh(new SphereGeometry(0.09, 10, 8), new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
      g.add(dot); pulses.push({ a: pts[0], b: pts[pts.length - 1], dot });
    }
  }
  for (const n of o.nodes || []) { const m = new Mesh(new SphereGeometry(n.size, 28, 20), marble(n.color || ctx.palette.accent, { glow: 0.45 })); m.position.copy(v3(n.pos)); g.add(m); }
  g.position.copy(v3(o.pos));
  return { group: g, labels, update(t) {
    // one pulse runs down every solid track in 3 s, staggered by track index
    pulses.forEach((p, i) => { const u = (t * 0.33 + i * 0.13) % 1; p.dot.position.lerpVectors(p.a, p.b, u); p.dot.material.opacity = 0.9 * Math.sin(Math.PI * u); });
  } };
}, { fields: ['pos', 'tracks'] });

// ---- orbs: marked places, each a marble with an optional label --------------------------------
// items: [{ id?, pos, color?, size?, label?, faint? }] — `faint` draws the
// same ball at a third of the light (something not established). An item with
// an `id` is an anchor: a pose (`at: <id>`) or a stop can fly to it.
registerBuilder('orbs', (o, ctx) => {
  const g = new Group(); const labels = []; const anchors = new Map();
  (o.items || []).forEach((it, i) => {
    const color = it.color || o.color || ctx.palette.accent;
    const r = it.size || o.size || 0.26;
    const m = new Mesh(new SphereGeometry(r, 32, 24), it.faint ? marble(color, { glow: 0.08, opacity: 0.5 }) : marble(color, { glow: 0.45 }));
    const p = v3(it.pos); m.position.copy(p); g.add(m);
    if (!it.faint) { const halo = shell(r * 1.55, color, 0.12); halo.position.copy(p); g.add(halo); }
    if (it.id) anchors.set(it.id, p.clone());
    const text = it.label ?? (it.id && ctx.records.get(it.id)?.label);
    if (text && o.labels !== false) {
      const l = makeLabel(text, { worldH: o.labelHeight || 0.3, color: ctx.palette.ink, letterSpacing: 0.02, upper: false });
      l.position.set(p.x, p.y + r + 0.5 + (i % 2) * 0.32, p.z); g.add(l); labels.push(l);
    }
  });
  g.position.copy(v3(o.pos));
  return { group: g, labels, anchors };
}, { fields: ['pos', 'items'] });

// ---- grid: a floor of lines fading into the distance ---------------------------------------------
registerBuilder('grid', (o) => {
  const pts = []; const cols = []; const depth = o.depth ?? 8;
  for (let x = o.from; x <= o.to; x += o.step) { pts.push(x, 0, -depth, x, 0, depth); const a = 1 - (x - o.from) / (o.to - o.from); cols.push(a, a, a, a, a, a); }
  for (let z = -depth; z <= depth; z += o.step) { pts.push(o.from, 0, z, o.to, 0, z); cols.push(1, 1, 1, 0.05, 0.05, 0.05); }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
  const mat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: o.opacity ?? 0.2, blending: AdditiveBlending, depthWrite: false });
  if (o.color) mat.color.set(o.color);
  const m = new LineSegments(geo, mat);
  m.position.copy(v3(o.pos));
  return { group: m, labels: [] };
}, { fields: ['pos', 'from', 'to', 'step'] });

// ---- bar: a scale bar with its caption -------------------------------------------------------------
registerBuilder('bar', (o, ctx) => {
  const g = new Group();
  const geo = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(o.length, 0, 0), new Vector3(0, -0.15, 0), new Vector3(0, 0.15, 0), new Vector3(o.length, -0.15, 0), new Vector3(o.length, 0.15, 0)]);
  g.add(new LineSegments(geo, new LineBasicMaterial({ color: ctx.palette.fg, transparent: true, opacity: 0.9 })));
  const l = makeLabel(o.label, { worldH: 0.34, color: ctx.palette.fg, letterSpacing: 0.04 }); l.position.set(o.length / 2, 0.45, 0); g.add(l);
  g.position.copy(v3(o.pos));
  return { group: g, labels: [l] };
}, { fields: ['pos', 'length', 'label'] });

// ---- constellation: a body of grains that builds itself on arrival ---------------------------------------
// Nodes as fuzzy clouds of grains round a bright core, each on its own tilted
// orbit; strings of flowing grains join them in a ring; a thin haze marks the
// bound volume. No solid surface anywhere. It is born scattered: `arm()` puts
// the nodes 7–11 units out in the dust and hides strings, boundary and label;
// `assemble()` flies them in over three seconds with trails. The engine arms
// it when a flight toward its station starts and assembles it on arrival, so
// the whole body is never seen before its fly-in. (Startertalk's pentaquark.)
//
//   { type: constellation, pos, radius, nodeRadius?, label?,
//     nodes: [{ pos, color?, core? }, …], strings?: ring | none, haze?: '#…',
//     coreSize?: 15, coreAlpha?: 0.9 }
const GRAIN_VERT = /* glsl */ `
attribute float aSize, aAlpha, aSeed, aKind; attribute vec3 aColor;
uniform float uPixelRatio, uTime, uReveal, uTrail, uTwinkle;   // aKind 0: node grain, 1: string/haze (fades in with the assembly), 2: trail (only while assembling)
varying vec3 vColor; varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.7 + 0.3 * uTwinkle * sin(uTime * (1.2 + aSeed * 2.4) + aSeed * 40.0);
  gl_PointSize = uPixelRatio * aSize * tw * (72.0 / max(-mv.z, 0.1));
  float k = aKind < 0.5 ? 1.0 : (aKind < 1.5 ? uReveal : uTrail);
  vColor = aColor; vAlpha = aAlpha * tw * k;
}`;
const GRAIN_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.04, 0.5, d)) * vAlpha;
  gl_FragColor = vec4(pow(vColor * a, vec3(2.2)), 1.0);   // linear light; additive with alpha 1
}`;
const lighten = (hex, k) => `#${new Color(hex).lerp(new Color('#ffffff'), k).getHexString()}`;

export function buildConstellation(o, ctx) {
  const g = new Group();
  const Q = o.nodes || [], nQ = Q.length;
  const R = o.radius || 3, rQ = o.nodeRadius || 0.7;
  const haze0 = o.haze || ctx.palette.accent;
  const withStrings = o.strings !== 'none' && nQ > 1;
  const NQ = 360, NS = 2600, NT = 170, NC = 1, NTR = 44;   // grains per node, boundary, per string, cores, trail per node
  const nStr = withStrings ? nQ : 0;                        // ring of strings
  const total = nQ * (NQ + NC + NTR) + NS + nStr * NT;
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  const size = new Float32Array(total), alpha = new Float32Array(total), seed = new Float32Array(total), kind = new Float32Array(total);
  let k = 0;
  const put = (c, sz, al, kd = 0) => { col.set(c, k * 3); size[k] = sz; alpha[k] = al; seed[k] = Math.random(); kind[k] = kd; return k++; };
  const rgb = (hex) => { const c = new Color(hex); return [c.r, c.g, c.b]; };
  const inks = Q.map((q) => { const grain = q.color || ctx.palette.accent; return { grain, core: q.core || lighten(grain, 0.8) }; });
  // node clouds: gaussian offsets, each grain with its own slow spin about the core
  const clouds = Q.map((q, i) => {
    const grain = rgb(inks[i].grain), core = rgb(inks[i].core);
    const items = [];
    for (let j = 0; j < NQ; j++) {
      const off = new Vector3(gauss(), gauss(), gauss()).multiplyScalar(rQ * 0.55);
      const far = off.length() / rQ;
      items.push({ idx: put(grain, 1.0 + 1.0 * Math.random(), 0.3 + 0.55 * Math.exp(-far * 1.6)), off, w: 0.25 + 0.5 * Math.random(), ph: Math.random() * 6.28 });
    }
    const coreIdx = put(core, o.coreSize ?? 15, o.coreAlpha ?? 0.9);
    return { items, coreIdx };
  });
  // trails: a short tail of grains behind each node while it flies in
  const trails = Q.map((q, i) => {
    const grain = rgb(inks[i].grain);
    const idx = [];
    for (let j = 0; j < NTR; j++) idx.push(put(grain, 1.9 - 1.3 * j / NTR, 0.5 * (1 - j / NTR), 2));
    return { idx, buf: [] };
  });
  // the boundary: a tight band of grains at the bound radius R — dense enough
  // to read as a surface from a distance, still grains up close — plus, below,
  // a faint rim bubble that catches the edge
  const haze = [];
  for (let i = 0; i < NS; i++) {
    const d = new Vector3(gauss(), gauss(), gauss()).normalize();
    const r = R * (0.97 + 0.06 * Math.random());
    haze.push({ idx: put(rgb(haze0), 0.7 + 0.8 * Math.random(), 0.2 + 0.3 * Math.random(), 1), d, r, ph: Math.random() * 6.28 });
  }
  const boundary = shell(R, haze0, 0.12); g.add(boundary);
  const boundaryBase = boundary.material.uniforms.uOpacity.value;
  // strings: grains flowing from node a to node b along a gently bowed path
  const ring = [];
  for (let s = 0; s < nStr; s++) {
    const a = s, b = (s + 1) % nQ, items = [];
    const n = new Vector3(gauss(), gauss(), gauss()).normalize();
    for (let i = 0; i < NT; i++) items.push({ idx: put(rgb(haze0), 0.8 + 0.8 * Math.random(), 0.25 + 0.4 * Math.random(), 1), u: Math.random(), w: (Math.random() - 0.5) * 0.28, ph: Math.random() * 6.28 });
    ring.push({ a, b, n, items });
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new BufferAttribute(col, 3));
  geo.setAttribute('aSize', new BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
  geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
  geo.setAttribute('aKind', new BufferAttribute(kind, 1));
  const mat = new ShaderMaterial({
    vertexShader: GRAIN_VERT, fragmentShader: GRAIN_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(devicePixelRatio || 1, 2) }, uReveal: { value: 1 }, uTrail: { value: 0 }, uTwinkle: { value: ctx.twinkle ?? 1 } },
  });
  const pts = new Points(geo, mat); pts.frustumCulled = false; g.add(pts);
  // node centres on tilted orbits through their home positions
  const home = Q.map((q) => v3(q.pos));
  const orbits = home.map((h, i) => {
    const n = new Vector3(Math.sin(i * 2.1), 0.8 + 0.6 * Math.cos(i * 1.3), Math.sin(i * 0.7)).normalize();
    const u = h.clone().sub(n.clone().multiplyScalar(h.dot(n))).normalize();
    const w = new Vector3().crossVectors(n, u);
    return { r: h.length(), u, w, speed: (0.18 + 0.1 * (i % 3)) * (o.speed ?? 1), phase: i * 1.7 };
  });
  const centres = home.map((h) => h.clone());
  const tmp = new Vector3(), tmp2 = new Vector3();
  const up = new Vector3(0, 1, 0);
  const labels = []; let labelSprite = null;
  if (o.label) { const l = makeLabel(o.label, { worldH: 0.5, color: ctx.palette.dim, letterSpacing: 0.1, upper: o.upper === true }); l.position.set(0, R + 1.0, 0); g.add(l); labels.push(l); labelSprite = l; }   // above the body, clear of centred text
  g.position.copy(v3(o.pos));
  const set = (idx, p) => { pos[idx * 3] = p.x; pos[idx * 3 + 1] = p.y; pos[idx * 3 + 2] = p.z; };
  const ASM_DUR = o.assemble ?? 3.0;
  const asm = { t0: -1, armed: false, starts: null, ctrls: null, onDone: null, trailFade: -1 };
  const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
  const ss = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
  const api = {
    arm() {
      if (asm.armed && asm.t0 < 0) return;   // already waiting, scattered
      asm.armed = true; asm.t0 = -1; asm.onDone = null; asm.trailFade = -1;
      asm.starts = home.map(() => new Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(7 + 4 * Math.random()));   // in view from the hero pose: the nodes hover in the dust, then converge
      asm.ctrls = asm.starts.map((st, i) => st.clone().add(home[i]).multiplyScalar(0.5).add(new Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(3 + 3 * Math.random())));
      for (const tr of trails) tr.buf.length = 0;
      mat.uniforms.uReveal.value = 0; mat.uniforms.uTrail.value = 0;
    },
    assemble(now, onDone) {
      if (!asm.armed || asm.t0 >= 0) { asm.armed = false; api.arm(); }
      asm.t0 = now; asm.onDone = onDone || null; asm.trailFade = -1;
      mat.uniforms.uTrail.value = 1;
    },
    get assembling() { return asm.t0 >= 0; },
    get armed() { return asm.armed; },
  };
  if (o.assemble !== false) api.arm();
  return { group: g, labels, api: o.assemble === false ? undefined : api, pixelRatio: mat.uniforms.uPixelRatio, update(t) {
    mat.uniforms.uTime.value = t;
    centres.forEach((c, i) => { const q = orbits[i], a = q.phase + t * q.speed; c.copy(q.u).multiplyScalar(q.r * Math.cos(a)).addScaledVector(q.w, q.r * Math.sin(a)); });
    if (asm.t0 >= 0) {
      const u = Math.min((t - asm.t0) / ASM_DUR, 1), e = smoother(u), w0 = (1 - e) * (1 - e), w1 = 2 * (1 - e) * e, w2 = e * e;
      centres.forEach((c, i) => { const S = asm.starts[i], C = asm.ctrls[i]; c.set(S.x * w0 + C.x * w1 + c.x * w2, S.y * w0 + C.y * w1 + c.y * w2, S.z * w0 + C.z * w1 + c.z * w2); });
      mat.uniforms.uReveal.value = ss(0.35, 1, u);
      if (u >= 1) { asm.t0 = -1; asm.armed = false; asm.trailFade = t; const cb = asm.onDone; asm.onDone = null; cb?.(); }
    } else if (asm.armed) {
      // waiting, scattered: each node hovers about its start in the dust
      centres.forEach((c, i) => c.copy(asm.starts[i]).add(tmp.set(Math.sin(t * 0.7 + i), Math.cos(t * 0.5 + 2 * i), Math.sin(t * 0.6 + 3 * i)).multiplyScalar(0.25)));
      mat.uniforms.uReveal.value = 0;
    } else if (asm.trailFade >= 0) {
      const f = 1 - (t - asm.trailFade) / 0.9;
      mat.uniforms.uTrail.value = Math.max(0, f);
      if (f <= 0) asm.trailFade = -1;
    }
    // the boundary and the label appear with the strings
    const reveal = mat.uniforms.uReveal.value;
    boundary.material.uniforms.uOpacity.value = boundaryBase * reveal;
    if (labelSprite) labelSprite.material.opacity = (labelSprite.userData.dimOp ?? 0.9) * reveal;
    if (mat.uniforms.uTrail.value > 0) trails.forEach((tr, i) => {
      tr.buf.unshift(centres[i].clone()); if (tr.buf.length > NTR) tr.buf.length = NTR;
      tr.idx.forEach((idx, j) => set(idx, tr.buf[Math.min(j, tr.buf.length - 1)]));
    });
    clouds.forEach((cl, i) => {
      const c = centres[i];
      for (const it of cl.items) {
        // the grain circles its core: rotate the offset about y at its own rate, breathe radially
        const a = t * it.w + it.ph, ca = Math.cos(a), sa = Math.sin(a);
        const br = 1 + 0.12 * Math.sin(t * 1.3 + it.ph);
        tmp.set((it.off.x * ca - it.off.z * sa) * br, it.off.y * br, (it.off.x * sa + it.off.z * ca) * br).add(c);
        set(it.idx, tmp);
      }
      set(cl.coreIdx, c);
    });
    for (const h of haze) { tmp.copy(h.d).multiplyScalar(h.r * (1 + 0.04 * Math.sin(t * 0.6 + h.ph))); tmp.applyAxisAngle(up, t * 0.05); set(h.idx, tmp); }
    for (const s of ring) {
      const A = centres[s.a], B = centres[s.b];
      for (const it of s.items) {
        const u = (it.u + t * 0.16) % 1;
        tmp.lerpVectors(A, B, u);
        // bow the string outward from the centre and let the grain wander across it
        tmp2.copy(tmp).normalize().multiplyScalar(0.35 * Math.sin(Math.PI * u));
        tmp.add(tmp2).addScaledVector(s.n, it.w * Math.sin(Math.PI * u) * (1 + 0.5 * Math.sin(t * 2.2 + it.ph)));
        set(it.idx, tmp);
      }
    }
    geo.attributes.position.needsUpdate = true;
  } };
}
registerBuilder('constellation', buildConstellation, { fields: ['pos', 'radius', 'nodes'] });

// ---- forms of grains (forms.js): they gather on arrival, as the constellation does -----------------
registerBuilder('galaxy', buildGalaxy, { fields: ['pos', 'radius'] });
registerBuilder('collider', buildCollider, { fields: ['pos', 'radius'] });

// ---- a station -----------------------------------------------------------------------------------------
export function buildStation(station, ctx) {
  const group = new Group(); group.position.copy(v3(station.pos));
  const anchors = new Map([[station.id, v3(station.pos)]]);
  const labels = []; const updaters = []; const apis = []; const prs = []; const disposers = [];
  const named = new Map();   // name → api, for what reads a form's value (StageCount)
  for (const o of station.objects || []) {
    const b = registry.get(o.type);
    if (!b) { console.warn(`stage: no builder for object type "${o.type}" (station ${station.id}); registered: ${builderTypes().join(', ')}`); continue; }
    let r;
    try { r = b(o, ctx); } catch (e) { console.warn(`stage: builder "${o.type}" failed in station ${station.id}:`, e); continue; }
    if (!r || !r.group) continue;
    group.add(r.group); labels.push(...(r.labels || []));
    if (r.update) updaters.push(r.update);
    if (r.api) apis.push(r.api);
    if (r.api && o.name != null) named.set(String(o.name), r.api);
    if (r.pixelRatio) prs.push(r.pixelRatio);
    if (typeof r.dispose === 'function') disposers.push([o.type, r.dispose]);
    if (r.anchors) for (const [id, p] of r.anchors) anchors.set(id, p.clone().add(v3(o.pos)).add(v3(station.pos)));
  }
  return {
    group, anchors, apis, named,
    update(t, camPos) { for (const u of updaters) u(t, camPos); },
    setPixelRatio(d) { for (const u of prs) u.value = d; },
    setDim(k) { const op = 0.9 * Math.max(0, 1 - k / 0.85); for (const l of labels) { l.material.opacity = op; l.userData.dimOp = op; } },
    dispose() {
      for (const [type, d] of disposers) { try { d(); } catch (e) { console.warn(`stage: builder "${type}" failed to dispose in station ${station.id}:`, e); } }
      group.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
    },
  };
}

// What a builder may want beyond three.js itself.
export const helpers = { v3, gauss, makeLabel, makeText, marble, shell, ball };
