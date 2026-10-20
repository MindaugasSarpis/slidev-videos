// A still with its depth becomes grains: each where its pixel's surface stood, seen
// from where the still's camera stood, at a place (`anchor`) in the world. The
// picture is whole from that view; once the camera moves, it has depth. A scale law
// shrinks it as the camera pulls back ("powers of ten"), so a close-up can hand over
// to the world around it. From Innoday's setup/lisGrains.js, takeover.js and view.js
// (Oct 2026); <StageDepthGrains> is the hand-over that uses it.
//
// The still's camera (JSON; tools/lis/lis_scene.py --meta writes one):
//   { origin, right, up, forward: [x, y, z] (the camera, in metres from the mark),
//     aim, flagDist (m from the camera to the mark), vfov (degrees), aspect,
//     depth: { w, h, near, far } (the depth PNG: 16 bits, red high, green low, 0 = no hit),
//     flagUV?: [[u, v], …] (a polygon in the frame, v down, whose grains keep their own scale) }
import { Points, BufferGeometry, BufferAttribute, ShaderMaterial, AdditiveBlending, Vector2, Vector3 } from 'three';

// ---- sizes against the frame --------------------------------------------------------------
// Grains sized against the frame's height (900 px, the frames the look was approved
// on), so a grain is the same share of the picture on every screen: in raw pixels a
// phone's ~220 px slide got grains covering 4× more, and dense surfaces ran to white.
export const REF_H = 900;
const v2 = new Vector2();
export function viewScale(renderer) {
  const t = renderer.getRenderTarget();
  return (t ? t.height : renderer.getDrawingBufferSize(v2).y) / REF_H;
}
export const POINT_GLSL = /* glsl */ `
uniform float uView;
float pointSize(float ps, float cap) { return clamp(ps, 1.0, max(cap * uView, 1.0)); }
float coverage(float ps) { return min(1.0, ps * ps); }
`;

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---- sampling: pixels → grains (uv, colour) -----------------------------------------------
// Grains fall where the frame is bright (probability ~ (l - floor)^gamma). `weight: 'max'`
// weighs a pixel by its brightest channel (saturated reds and greens get their share),
// `norm` sets how far a grain carries its pixel's full hue. `px` is RGBA, w×h.
export function samplePixels(px, w, h, { n = 140000, gamma = 1.7, floor = 0.035, sat = 1.35, seed = 1, weight = 'lum', norm = 0.55 } = {}) {
  const cdf = new Float64Array(w * h);
  let acc = 0;
  for (let i = 0; i < w * h; i++) {
    const l = weight === 'max' ? Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) / 255
      : (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    acc += l > floor ? Math.pow(l - floor, gamma) : 0;
    cdf[i] = acc;
  }
  const rnd = mulberry(seed);
  const uv = new Float32Array(n * 2), col = new Float32Array(n * 3), lum = new Float32Array(n);
  if (!acc) return { n: 0, uv: uv.subarray(0, 0), col: col.subarray(0, 0), lum: lum.subarray(0, 0) };
  for (let k = 0; k < n; k++) {
    const t = rnd() * acc;
    let lo = 0, hi = w * h - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < t) lo = mid + 1; else hi = mid; }
    const x = lo % w, y = (lo / w) | 0;
    uv[k * 2] = (x + rnd()) / w;
    uv[k * 2 + 1] = (y + rnd()) / h;
    // the tone mapper greys what adds up: a grain starts a little more saturated than its pixel
    const r0 = px[lo * 4] / 255, g0 = px[lo * 4 + 1] / 255, b0 = px[lo * 4 + 2] / 255;
    const l0 = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
    const r = clamp01(l0 + (r0 - l0) * sat), gg = clamp01(l0 + (g0 - l0) * sat), b = clamp01(l0 + (b0 - l0) * sat);
    const m = Math.max(r, gg, b, 1e-3);
    col[k * 3] = r * (1 - norm) + (r / m) * norm;
    col[k * 3 + 1] = gg * (1 - norm) + (gg / m) * norm;
    col[k * 3 + 2] = b * (1 - norm) + (b / m) * norm;
    lum[k] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  }
  return { n, uv, col, lum };
}
// an image (decoded), drawn to cover w×h as the player shows it, then sampled
export function sampleFrame(img, { w = 960, h = 540, ...o } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return samplePixels(g.getImageData(0, 0, w, h).data, w, h, o);
}

// ---- depth -----------------------------------------------------------------------------------
// the depth PNG's pixels → metres (0 where nothing was hit)
export function decodeDepth(px, { w, h, near, far }) {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const q = px[i * 4] * 256 + px[i * 4 + 1];
    out[i] = q === 0 ? 0 : near + ((q - 1) / 65533) * (far - near);
  }
  return out;
}
export async function loadDepth(url, meta) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const { w, h } = meta.depth;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  return decodeDepth(g.getImageData(0, 0, w, h).data, meta.depth);
}

function inside(q, x, y) {
  let c = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// each sampled grain at its pixel's depth along the still camera's ray: positions in
// metres from the mark; `keep` 0 for a grain off every surface (dropped), `flag` 1 inside
// meta.flagUV, `edge` the picture's border feathered
export function placeInDepth(s, depth, meta) {
  const { w, h } = meta.depth;
  const t = Math.tan((meta.vfov * Math.PI) / 360), a = meta.aspect;
  const [O, R, U, F] = [meta.origin, meta.right, meta.up, meta.forward];
  const pos = new Float32Array(s.n * 3), keep = new Float32Array(s.n), flag = new Float32Array(s.n), edge = new Float32Array(s.n);
  const quad = meta.flagUV || [];
  for (let k = 0; k < s.n; k++) {
    const u = s.uv[k * 2], v = s.uv[k * 2 + 1];
    const i = Math.min(w - 1, (u * w) | 0), j = Math.min(h - 1, (v * h) | 0);
    let z = depth[j * w + i];
    keep[k] = z > 0 ? 1 : 0;
    flag[k] = inside(quad, u, v) ? 1 : 0;
    edge[k] = Math.min(1, Math.min(u, 1 - u, v, 1 - v) / 0.06);
    if (!(z > 0)) z = meta.depth.far;
    const x = (2 * u - 1) * t * a * z, y = (1 - 2 * v) * t * z;
    for (let c = 0; c < 3; c++) pos[k * 3 + c] = O[c] + R[c] * x + U[c] * y + F[c] * z;
  }
  return { pos, keep, flag, edge };
}

// ---- drawing ---------------------------------------------------------------------------------
const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize, aSeed, aKeep, aFlag, aEdge;
uniform float uTime, uReveal, uGain, uScale, uScaleFlag, uS0, uFade, uRest;
uniform vec3 uAnchor;
varying vec3 vColor; varying float vAlpha;
${POINT_GLSL}
void main() {
  // the mark's grains keep a larger scale at the end, so it stays a mark the room can see;
  // the rest of the picture fades as it shrinks
  float sc = aFlag > 0.5 ? uScaleFlag : uScale;
  vec3 p = uAnchor + position * sc;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.85 + 0.15 * sin(uTime * (0.8 + aSeed * 1.9) + aSeed * 40.0);
  float r = clamp(uReveal * 1.35 - aSeed * 0.35, 0.0, 1.0);
  // a grain is a piece of the form: its size goes with the form's scale
  float ps = uView * aSize * (72.0 / max(-mv.z, 0.05)) * (sc / uS0);
  gl_PointSize = pointSize(ps, 6.0);
  vColor = aColor * uGain;
  // under two pixels a sprite's light comes down to its soft disc's share (0.3·ps²), so
  // the shrunken picture does not add up to white at the 1 px floor
  float cov = ps < 1.0 ? 0.3 * ps * ps : mix(0.3, 1.0, clamp(ps - 1.0, 0.0, 1.0));
  vAlpha = aKeep * r * tw * cov * smoothstep(0.05, 0.4, -mv.z) * uFade * aEdge * (aFlag > 0.5 ? 1.0 : uRest);
}`;
const FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.05, 0.5, d)) * vAlpha;
  gl_FragColor = vec4(pow(vColor, vec3(2.2)) * a, 1.0);
}`;

export function makeDepthGrains(s, placed, { size = 0.07, gain = 1.25, s0 = 18, name = 'depth-grains' } = {}) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(placed.pos, 3));
  geo.setAttribute('aColor', new BufferAttribute(s.col, 3));
  geo.setAttribute('aKeep', new BufferAttribute(placed.keep, 1));
  geo.setAttribute('aFlag', new BufferAttribute(placed.flag, 1));
  geo.setAttribute('aEdge', new BufferAttribute(placed.edge, 1));
  const sz = new Float32Array(s.n), sd = new Float32Array(s.n);
  let a = 7;
  const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  for (let k = 0; k < s.n; k++) { sd[k] = rnd(); sz[k] = size * (0.6 + 0.8 * rnd()) * (0.8 + 0.6 * s.lum[k]); }
  geo.setAttribute('aSize', new BufferAttribute(sz, 1));
  geo.setAttribute('aSeed', new BufferAttribute(sd, 1));
  const mat = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uReveal: { value: 0 }, uView: { value: 1 }, uGain: { value: gain },
      uScale: { value: s0 }, uScaleFlag: { value: s0 }, uS0: { value: s0 }, uFade: { value: 1 }, uRest: { value: 1 },
      uAnchor: { value: new Vector3() },
    },
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = name;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  // the twinkle's clock, the frame's size and the form's scale (userData.scale(camera, uniforms)), every frame
  pts.onBeforeRender = (r, _s, cam) => {
    mat.uniforms.uTime.value = (performance.now() - t0) / 1000; mat.uniforms.uView.value = viewScale(r);
    pts.userData.scale?.(cam, mat.uniforms);
  };
  return pts;
}

// ---- the pull-back's scale -------------------------------------------------------------------
// s(d), d the camera's distance from the anchor: s0 at d0, sEnd at dEnd, a power law
// between (the picture recedes faster than the camera does); held past either end
export function scaleLaw({ s0, d0, sEnd, dEnd }) {
  const k = Math.log(sEnd / s0) / Math.log(dEnd / d0);
  return (d) => Math.min(s0, Math.max(sEnd, s0 * Math.pow(Math.max(d, 1e-3) / d0, k)));
}
// a stage pose ({ at, dist, yaw, pitch }) for a camera at `cam` looking at `target`
export function poseOf(cam, target) {
  const d = new Vector3().subVectors(cam, target), dist = d.length();
  return { at: [target.x, target.y, target.z], dist, yaw: Math.atan2(d.x, d.z) * 180 / Math.PI, pitch: Math.asin(d.y / dist) * 180 / Math.PI };
}
// where a pose puts the camera
export function poseCamera(k) {
  const r = Math.PI / 180, y = (k.yaw ?? 0) * r, p = (k.pitch ?? 0) * r, d = k.dist ?? 20;
  return new Vector3(k.at[0] + d * Math.sin(y) * Math.cos(p), k.at[1] + d * Math.sin(p), k.at[2] + d * Math.cos(y) * Math.cos(p));
}
