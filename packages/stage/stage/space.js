import {
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, Mesh, Points, Group,
  PlaneGeometry, BufferGeometry, BufferAttribute, ShaderMaterial, DataTexture,
  WebGLRenderTarget, RGBAFormat, FloatType, HalfFloatType, NearestFilter,
  AdditiveBlending, Vector2, Vector3, Vector4, Color, Matrix3, Matrix4,
  HemisphereLight, DirectionalLight, PointLight, PMREMGenerator, ACESFilmicToneMapping,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SIM_VERT, COPY_FRAG, VEL_FRAG, POS_FRAG, RENDER_VERT, RENDER_FRAG } from './shaders/passes.glsl.js';
import { NOISE } from './shaders/noise.glsl.js';
import { createPhotoPlace } from './photo-place.js';
import { buildStation, helpers } from './builders.js';
import { shell } from './materials.js';
import { resolvePalette, hexToRgb } from './palette.js';

// The stage: one persistent 3D world under a whole deck. A path of built
// scenes (stations) stands in an ambient field of dust; slides steer the
// camera from one pose to the next, so a talk is one continuous flight rather
// than a stack of pages.
//
//   createSpace(canvas, container, { space, records, palette, options, onArrive, onEvent })
//     space    { stations: [{ id, pos, look, gather?, pulse?, objects: [...] }], poses?, hero? }
//     records  [{ id, … }]: things a stop can name; an object with an id anchors one
//   → { setPose, setStop, setDim, setPaused, stir, assemble, record, value, dispose, … }
//
// The field is pulled toward the active station only faintly: the dust reads
// as a uniform, bright ground behind the scenes, not a cloud clumped round them.

const FIELD_BOUNDS = new Vector3(30, 30, 30);   // ambient field wrap box (half extents; a cube so the camera never sits at a face)
const MAX_DT = 1 / 12;   // frame-time clamp: real time down to 12 fps (flights and the assembly keep their pace on a slow GPU)
const D2R = Math.PI / 180;
export const DEFAULTS = {   // the keys of `stage.options` (types.js OPTION_KEYS lists them for the validator)
  fov: 50,
  pose: { dist: 9, yaw: -20, pitch: 6 },
  gather: 0.25,          // the field's pull toward the active station; a station may set its own
  pulseKick: 26,         // a station with `pulse: <s>` shoves the dust outward from its centre that often
  stopOffset: [0.6, -0.35, 0],   // a lit stop lands just left of centre, in the gap between the record and the figure
  maxBufferWidth: 2560,  // drawing-buffer width cap: about half resolution at 4K, so bloom and SMAA hold 60 fps on a laptop GPU
  bloom: 0.55,
  vignette: 0.3,
  grain: 0.035,
  aberration: 0.0004,
  exposure: 1.05,
  dustSize: 1.9,
  dustGain: 2.0,
  density: 1,            // scales the grain count (0.5 … 1.5)
  nebula: 0,             // clouds of the palette's colour far behind the dust, 0 (none) … 1
  streak: 1,             // grains are drawn out along their path while the camera flies, 0 (never) … 2
  reach: 12,             // a pose within this of a station is *at* it: what stands there gathers on arrival
  flight: [1.4, 4.5],    // shortest and longest flight, seconds
  twinkle: 1,            // how far a form's grains swell and fade as they shine, 0 (steady) … 1
  guard: true,           // false: no frame-rate guard (the pixel ratio and the dust stay as they are on a slow machine)
};

// The page gradient, drawn by the renderer itself (post-processing wants a
// solid ground): the two radial glows the container's CSS carries for the
// static fallback, in view fractions.
const BG_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
// With `nebula` > 0 the ground also carries slow clouds of the palette's two
// nebula colours. They are painted on the inside of a sphere round the
// camera (the lookup is the view direction), so they turn as the camera turns
// and stand still as it travels: the far background of a world, not a
// wallpaper on the slide.
const BG_FRAG = /* glsl */ `
uniform vec3 uBg, uGlow, uNebA, uNebB;
uniform float uNebula, uTime, uAspect, uTanHalfFov;
uniform mat3 uCamRot;
varying vec2 vUv;
${NOISE}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + vec3(11.7, 3.1, 7.9); a *= 0.5; }
  return s;
}
void main() {
  float g1 = 1.0 - smoothstep(0.0, 0.62, length((vUv - vec2(0.78, 1.08)) / vec2(0.69, 0.78)));
  float g2 = 1.0 - smoothstep(0.0, 0.60, length((vUv - vec2(-0.12, -0.08)) / vec2(0.56, 0.67)));
  vec3 col = uBg + uGlow * (0.07 * g1 + 0.05 * g2);
  if (uNebula > 0.0) {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 dir = normalize(uCamRot * vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));
    vec3 p = dir * 1.35 + vec3(0.0, 0.0, uTime * 0.006);
    float warp = fbm(p * 1.7 + 4.0);
    float n = fbm(p + 0.55 * warp);
    float cloud = smoothstep(-0.05, 0.75, n);             // broad bodies
    float wisp = smoothstep(0.25, 0.9, fbm(p * 2.6 - warp)); // finer structure inside them
    vec3 neb = mix(uNebA, uNebB, smoothstep(-0.3, 0.5, warp)) * cloud * (0.55 + 0.75 * wisp);
    // thinner toward the ground plane of the world, so the horizon stays calm behind text
    neb *= 0.45 + 0.55 * smoothstep(-0.5, 0.6, dir.y);
    col += neb * 0.16 * uNebula;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
// The finish: a vignette, a touch of chromatic aberration toward the edges,
// film grain.
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.3 }, uGrain: { value: 0.035 }, uCA: { value: 0.0004 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uCA;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 d = vUv - 0.5; float r2 = dot(d, d);
  vec2 off = d * r2 * uCA * 40.0;
  vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
  c *= 1.0 - uVignette * smoothstep(0.15, 0.75, r2 * 2.0);
  c += (hash(floor(gl_FragCoord.xy / 1.5) + fract(uTime * 0.37) * 100.0) - 0.5) * uGrain * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.5, c.g)));
  gl_FragColor = vec4(c, 1.0);
}`,
};

// Quality tiers (stage/diagnose.js pickTier; `stage.tier` pins one). Each step
// down shrinks what the GPU holds: the simulated field, the drawing buffer, the
// photo places' grains and textures. A lost context rebuilds one tier lower.
//   sim: the field's side at most · dpr / maxW: the drawing buffer · grains: a
//   photo place's columns, as a share · placeTex: its textures' longest side
export const TIERS = [
  { sim: 448, dpr: 2, maxW: 2560, grains: 1, placeTex: 2048 },
  { sim: 256, dpr: 1.5, maxW: 1920, grains: 0.8, placeTex: 1536 },
  { sim: 192, dpr: 1.25, maxW: 1280, grains: 0.6, placeTex: 1024 },
  { sim: 128, dpr: 1, maxW: 960, grains: 0.4, placeTex: 640 },
];

function pickTexSize(coarse, density) {
  const cores = navigator.hardwareConcurrency || 4;
  const area = (screen.width || 1280) * (screen.height || 800);
  // this field fills a 60-unit box the camera flies through; dense enough to
  // read as a continuous ground of grains from every pose
  let size = 352;
  if (coarse || area < 1e6 || cores <= 4) size = 192;
  else if (cores <= 8) size = 288;
  return Math.max(96, Math.min(448, Math.round(size * Math.sqrt(Math.max(0.1, density)) / 16) * 16));
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

export function createSpace(canvas, container, { space, records = [], palette, options = {}, asset, onArrive, onEvent } = {}) {
  const opt = { ...DEFAULTS, ...options };
  const pal = resolvePalette(palette);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const tier = Math.max(0, Math.min(TIERS.length - 1, Math.round(num(opt.tier, 0)))), T = TIERS[tier];
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'high-performance' });
  } catch (e) { onEvent?.('fallback', { reason: 'no-webgl2', detail: e?.message || '' }); return null; }
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); onEvent?.('fallback', { reason: 'no-webgl2' }); return null; }
  const type = renderer.extensions.has('EXT_color_buffer_float') ? FloatType
    : renderer.extensions.has('EXT_color_buffer_half_float') ? HalfFloatType : null;
  if (!type) { renderer.dispose(); onEvent?.('fallback', { reason: 'no-float-target' }); return null; }
  // A shader that does not compile leaves its object undrawn, not the page
  // broken; say so (the debug panel counts them), and log it as three would.
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].map((t) => (t || '').trim()).filter(Boolean).join(' | ');
    console.error('stage: shader error —', log);
    onEvent?.('shader-error', { message: log.slice(0, 200) });
  };
  const baseDpr = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2, T.dpr);
  renderer.setPixelRatio(baseDpr);
  renderer.setClearColor(new Color(pal.bg), 1);
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = num(opt.exposure, 1.05);

  const scene = new Scene();
  const camera = new PerspectiveCamera(num(opt.fov, 50), 1, 0.1, 400);

  // ground: the page gradient, first thing drawn
  // The ground and the dust take the palette's numbers as they are written
  // (no sRGB → linear step): the look was tuned with the tone mapper lifting
  // them, and a converted ground comes out a shade too deep.
  const raw = (hex) => new Vector3(...hexToRgb(hex));
  const bgMat = new ShaderMaterial({
    vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      uBg: { value: raw(pal.bg) }, uGlow: { value: raw(pal.accent) },
      uNebA: { value: raw(pal.nebula) }, uNebB: { value: raw(pal.nebulaAlt) },
      uNebula: { value: Math.min(1.5, Math.max(0, num(opt.nebula, 0))) },
      uTime: { value: 0 }, uAspect: { value: 1 }, uTanHalfFov: { value: Math.tan(num(opt.fov, 50) * D2R / 2) },
      uCamRot: { value: new Matrix3() },
    },
  });
  const bgQuad = new Mesh(new PlaneGeometry(2, 2), bgMat);
  bgQuad.renderOrder = -1000; bgQuad.frustumCulled = false; scene.add(bgQuad);
  // light: a cool sky over a dark ground, a key from upper left, and a fill
  // that rides the camera's look target so what a slide looks at is lit
  scene.add(new HemisphereLight(new Color(pal.sky), new Color(pal.ground), 0.9));
  const key = new DirectionalLight(0xffffff, 1.6); key.position.set(-6, 9, 7); scene.add(key);
  const fill = new PointLight(new Color(pal.fill), 40, 0, 2); scene.add(fill);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
  scene.environmentIntensity = 0.45;

  // --- records and stations -------------------------------------------------
  const byId = new Map((records || []).filter((s) => s && s.id != null).map((s) => [String(s.id), { ...s }]));
  const stations = new Map();
  const anchors = new Map();
  // places a page adds (StagePhoto mode="place"): id → { pos: Vector3, look: { dist, yaw, pitch, sway, still }, group, vis }
  const places = new Map();
  // Place groups the deck shows or hides (a slide's `places:`): group → false
  // hides its places, fading over PLACE_FADE s. A place in no group always
  // shows; so does the place the pose stands at.
  const PLACE_FADE = 1;
  let placeGroups = new Map();
  const placeWanted = (id, p) => !p.group || placeGroups.get(p.group) !== false || String(pose.at) === id;
  const showPlace = (p, vis) => { p.vis = vis; p.place.set({ opacity: vis }); p.place.object.visible = vis > 0.001; };
  const dropPlace = (id) => {
    const p = places.get(String(id));
    if (!p) return;
    if (p.place) { scene.remove(p.place.object); p.place.dispose(); }
    places.delete(String(id));
  };
  const forms = new Map();   // an object's `name` → its builder's api (value() for <StageCount for>)
  const ctx = { records: byId, states: byId, palette: pal, anisotropy: renderer.capabilities.getMaxAnisotropy(), asset: asset || ((s) => s), helpers, twinkle: Math.max(0, num(opt.twinkle, 1)) };
  for (const st of space.stations || []) {
    const built = buildStation(st, ctx);
    scene.add(built.group);
    stations.set(st.id, { def: st, pos: new Vector3(...st.pos), built });
    for (const [id, p] of built.anchors) anchors.set(String(id), p);
    for (const [name, api] of built.named) forms.set(name, api);
  }
  for (const [id, s] of byId) if (anchors.has(id)) s.pos = anchors.get(id).clone();
  const firstStation = space.stations?.[0]?.id ?? null;
  // The hero: the station a deck opens and closes on. Its first self-building
  // object is assembled on arrival.
  const heroId = stations.has(space.hero) ? space.hero : (stations.has(opt.hero) ? opt.hero : (stations.has('hero') ? 'hero' : null));
  // Named poses: `wide` is the hero (or the first station); a space adds its own.
  const NAMED = { wide: { station: heroId ?? firstStation }, ...(space.poses || {}), ...(opt.poses || {}) };
  const stopOffset = new Vector3(...(opt.stopOffset || DEFAULTS.stopOffset));

  // --- ambient field (GPGPU) --------------------------------------------------
  const size = Math.min(pickTexSize(coarse, num(opt.density, 1)), T.sim), count = size * size;
  const rt = () => new WebGLRenderTarget(size, size, { type, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, stencilBuffer: false });
  let posA = rt(), posB = rt(), velA = rt(), velB = rt();
  const init = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    init[i * 4] = (Math.random() * 2 - 1) * FIELD_BOUNDS.x;
    init[i * 4 + 1] = (Math.random() * 2 - 1) * FIELD_BOUNDS.y;
    init[i * 4 + 2] = (Math.random() * 2 - 1) * FIELD_BOUNDS.z;
    init[i * 4 + 3] = Math.random();
  }
  const initTex = new DataTexture(init, size, size, RGBAFormat, FloatType); initTex.needsUpdate = true;
  const simScene = new Scene(), simCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2)); simScene.add(quad);
  const copyMat = new ShaderMaterial({ vertexShader: SIM_VERT, fragmentShader: COPY_FRAG, uniforms: { uSrc: { value: initTex } } });
  const far = new Vector3(999, 999, 999);
  const velMat = new ShaderMaterial({
    vertexShader: SIM_VERT, fragmentShader: VEL_FRAG,
    uniforms: {
      uPos: { value: null }, uVel: { value: null }, uDt: { value: 0 }, uTime: { value: 0 },
      uPointer: { value: far.clone() }, uPointerVel: { value: new Vector3() },
      uImpulse: { value: new Vector4(999, 999, 999, 0) }, uBurst: { value: new Vector4(999, 999, 999, 0) },
      uGather: { value: new Vector4(0, 0, 0, 0) },
    },
  });
  const posMat = new ShaderMaterial({
    vertexShader: SIM_VERT, fragmentShader: POS_FRAG,
    uniforms: { uPos: { value: null }, uVel: { value: null }, uDt: { value: 0 }, uBounds: { value: FIELD_BOUNDS } },
  });
  const pass = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(simScene, simCam); renderer.setRenderTarget(null); };
  const refs = new Float32Array(count * 3);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) { const k = j * size + i; refs[k * 3] = (i + 0.5) / size; refs[k * 3 + 1] = (j + 0.5) / size; }
  const fieldGeo = new BufferGeometry(); fieldGeo.setAttribute('position', new BufferAttribute(refs, 3));
  const fieldMat = new ShaderMaterial({
    vertexShader: RENDER_VERT, fragmentShader: RENDER_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: {
      uPos: { value: null }, uVel: { value: null }, uSize: { value: num(opt.dustSize, 1.9) }, uPixelRatio: { value: baseDpr },
      uGain: { value: num(opt.dustGain, 2.0) }, uFocus: { value: 0 }, uLinearOut: { value: 1 },
      uDustLo: { value: raw(pal.dust) }, uDustHi: { value: raw(pal.dustBright) },
      uPrevViewProj: { value: new Matrix4() }, uStreak: { value: 0 }, uViewport: { value: new Vector2(1, 1) },
      uTint: { value: new Vector4(0, 0, 0, 0) },
    },
  });
  const field = new Points(fieldGeo, fieldMat); field.frustumCulled = false;
  scene.add(field);
  pass(copyMat, posA);
  renderer.setRenderTarget(velA); renderer.clear(true, false, false); renderer.setRenderTarget(null);

  // --- stop highlight: a pulsing shell around the lit record -------------------
  const hi = new Group(); scene.add(hi);
  let hiMesh = null;

  // --- camera -------------------------------------------------------------------
  let pose = { at: 'wide' };
  const goalPos = new Vector3(), goalLook = new Vector3();
  const curPos = new Vector3(), curLook = new Vector3();
  // flight: from the pose at departure to the (drifting) goal, eased with a
  // smootherstep in time — zero velocity and acceleration at both ends —
  // over a duration that grows with the distance. onArrive fires once per flight.
  const fromPos = new Vector3(), fromLook = new Vector3();
  let flightT0 = -1, flightDur = 1.6, arrived = true;
  const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
  let firstFrame = true, currentTarget = 'wide', activeStation = firstStation;
  let atStation = null;      // the station the pose stands at, or null out in the open dust
  let flightU = 0;           // 0..1 through the current flight, 0 when parked

  const nearestStation = (t) => {
    let best = firstStation, bd = Infinity;
    for (const [id, s] of stations) { const d = t.distanceTo(s.pos); if (d < bd) { bd = d; best = id; } }
    return best;
  };
  // at → { target, dist, yaw, pitch, station }; `at` is [x,y,z], a station id, a record / anchor id or a named pose
  const resolve = (p) => {
    let at = p.at;
    const out = { target: new Vector3(), station: null, dist: p.dist, yaw: p.yaw, pitch: p.pitch, sway: p.sway, still: p.still };
    let offset = null;
    if (typeof at === 'string' && NAMED[at] && !stations.has(at)) {
      const n = NAMED[at]; out.dist ??= n.dist; out.yaw ??= n.yaw; out.pitch ??= n.pitch; out.sway ??= n.sway; offset = n.offset || null;
      at = n.station ?? n.at ?? firstStation;
    }
    if (Array.isArray(at)) { out.target.set(num(at[0], 0), num(at[1], 0), num(at[2], 0)); out.station = nearestStation(out.target); }
    else if (stations.has(at)) {
      const { def, pos } = stations.get(at); const look = def.look || {};
      out.target.copy(pos); if (offset) out.target.add(new Vector3(...offset)); else if (look.target) out.target.add(new Vector3(...look.target));
      out.dist ??= look.dist; out.yaw ??= look.yaw; out.pitch ??= look.pitch; out.sway ??= look.sway; out.station = at;
    } else if (places.has(String(at))) {
      // a photo's place: its front pose unless the slide says otherwise, held still
      const { pos, look } = places.get(String(at));
      out.target.copy(pos);
      out.dist ??= look.dist; out.yaw ??= look.yaw; out.pitch ??= look.pitch; out.sway ??= look.sway; out.still ??= look.still;
      out.station = nearestStation(out.target);
    } else if (anchors.has(String(at))) {
      out.target.copy(anchors.get(String(at))).add(stopOffset);
      out.station = nearestStation(out.target);
    } else if (firstStation != null) {
      out.target.copy(stations.get(firstStation).pos); out.station = firstStation;
    }
    out.dist ??= opt.pose.dist; out.yaw ??= opt.pose.yaw; out.pitch ??= opt.pose.pitch;
    // at a station, or only in its part of the dust? What stands at a station
    // gathers when a pose arrives *at* it; a pose out in the open leaves it be.
    const near = stations.get(out.station);
    out.at = near && out.target.distanceTo(near.pos) <= num(opt.reach, 12) ? out.station : null;
    return out;
  };
  const applyPose = (p, elapsed) => {
    const r = resolve(p);
    // `still`: no breathing, no wobble (a photo's front pose, where the flat cloud must meet the <img>)
    const idle = r.still ? 0 : 1;
    const dist = r.dist * (1 + idle * 0.02 * Math.sin(elapsed / 31 * Math.PI * 2));
    // idle sway about the pose's yaw: 2.5° by default; a look may ask for more (the hero slowly circles)
    const yaw = (r.yaw + idle * (r.sway ?? 2.5) * Math.sin(elapsed / 46 * Math.PI * 2)) * D2R;
    const pitch = (r.pitch + idle * 1.2 * Math.sin(elapsed / 57 * Math.PI * 2 + 2)) * D2R;
    goalLook.copy(r.target);
    goalPos.set(r.target.x + dist * Math.sin(yaw) * Math.cos(pitch), r.target.y + dist * Math.sin(pitch), r.target.z + dist * Math.cos(yaw) * Math.cos(pitch));
    activeStation = r.station;
    atStation = r.at;
  };

  // --- post-processing: bloom, anti-aliasing, tone mapping, the finish ------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), num(opt.bloom, 0.55), 0.55, 0.8); composer.addPass(bloom);
  composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());                         // tone mapping + sRGB
  const finish = new ShaderPass(FinishShader); composer.addPass(finish);   // vignette and grain in display space, last
  finish.uniforms.uVignette.value = num(opt.vignette, 0.3);
  finish.uniforms.uGrain.value = num(opt.grain, 0.035);
  finish.uniforms.uCA.value = num(opt.aberration, 0.0004);
  canvas.__space = { scene, composer, bloom, finish, field, renderer, get guardStage() { return guardStage; }, holdQuality() { guardStage = 2; }, get elapsed() { return elapsed; }, get dpr() { return renderer.getPixelRatio(); }, get frames() { return frames; }, get options() { return { ...opt }; }, targets: type === FloatType ? 'float' : 'half-float', sim: size, tier };   // a handle for the headless probes and the debug panel (options: as resolved, defaults filled in)

  // what builds itself at each station, on arrival
  const selfBuilders = (id) => stations.get(id)?.built.apis.filter((a) => a.assemble) || [];
  let assembledOnce = false;
  const prevViewProj = new Matrix4(), viewProj = new Matrix4();
  let havePrev = false;
  // the tint the dust has taken: set by tint(), let go over its seconds
  const tint = fieldMat.uniforms.uTint.value;
  let tintT0 = -1, tintDur = 0, tintPeak = 0;

  let viewW = 1, viewH = 1, guardScale = 1;
  const maxW = Math.min(num(opt.maxBufferWidth, 2560), T.maxW);
  const dprFor = (w) => Math.min(baseDpr, maxW / Math.max(w, 1));
  // Bloom blurs over a fixed count of pixels; on a small buffer (a phone, or the
  // guard's lower steps) that is a larger share of the frame and a bright core
  // washes it out white. Its strength follows the buffer's width.
  const bloomBase = num(opt.bloom, 0.55);
  const applyDpr = () => {
    const d = dprFor(viewW) * guardScale;
    renderer.setPixelRatio(d); composer.setPixelRatio(d); fieldMat.uniforms.uPixelRatio.value = d;
    bloom.strength = bloomBase * Math.min(1, Math.max(0.35, (viewW * d) / 1280));
    for (const s of stations.values()) s.built.setPixelRatio(d);
  };
  function resize() {
    const r = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === viewW && h === viewH) return;
    viewW = w; viewH = h;
    renderer.setSize(w, h, false);
    applyDpr();
    composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    bgMat.uniforms.uAspect.value = w / h;
    havePrev = false;   // the projection changed: last frame's places mean nothing now
  }
  resize();

  let lastT = performance.now(), raf = 0, paused = false, elapsed = 0, disposed = false, frames = 0;
  let guardStage = 0, winFrames = 0, winTime = 0;
  const getDelta = () => { const t = performance.now(); const d = (t - lastT) / 1000; lastT = t; return d; };
  const period = FIELD_BOUNDS.clone().multiplyScalar(2);
  const gather = new Vector3();
  const burst = velMat.uniforms.uBurst.value;
  const kick = num(opt.pulseKick, 26);
  let nextPulse = 3;
  let armedFor = null;       // the station whose forms were scattered for the flight now under way
  // a passing pull toward the point the camera looks at (see stir)
  let drawT0 = -1, drawDur = 0, drawStrength = 0;
  const fillOffset = new Vector3(0, 3.5, 2.5);

  // Everything at the station that builds itself does so now. The first to
  // finish gives the dust the station's pulse; `assembled` is announced when
  // the last has finished (the cover's title, and the headless tools' settle,
  // wait on it: announced at the first, a slower form beside a quick one was
  // photographed half built).
  let assembling = 0, assemblyRun = 0;
  function startAssembly(id = atStation) {
    const apis = id != null ? selfBuilders(id) : [];
    if (!apis.length) return false;
    onEvent?.('assembling', { station: id });
    const run = ++assemblyRun;
    let first = true, left = apis.length;
    assembling = left;
    for (const api of apis) {
      let mine = false;
      api.assemble(elapsed, () => {
        if (mine || run !== assemblyRun) return;
        mine = true;
        if (first) {
          first = false;
          const st = stations.get(id);
          if (st) { gather.copy(st.pos).sub(field.position); burst.set(gather.x, gather.y, gather.z, kick * (id === heroId ? 1.6 : 0.9)); nextPulse = elapsed + (st.def.pulse || 6); }
        }
        assembling = --left;
        if (!left) onEvent?.('assembled', { station: id });
      });
    }
    return true;
  }
  // A form still moving: one assembling at the station, or a builder that says
  // so itself (`api.busy`, a value or a function), for a form that moves on its
  // own clock without assemble()
  const formsBusy = () => {
    if (assembling > 0) return true;
    for (const st of stations.values()) for (const a of st.built.apis || []) {
      const b = typeof a.busy === 'function' ? a.busy() : a.busy;
      if (b) return true;
    }
    return false;
  };

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(getDelta(), MAX_DT);
    elapsed += dt; frames++;
    resize();

    applyPose(pose, elapsed);
    if (firstFrame) { curPos.copy(goalPos); curLook.copy(goalLook); firstFrame = false; }
    if (flightT0 >= 0) {
      const u = Math.min((elapsed - flightT0) / flightDur, 1);
      const e = smoother(u);
      flightU = u;
      curPos.lerpVectors(fromPos, goalPos, e); curLook.lerpVectors(fromLook, goalLook, e);
      if (u >= 1) { flightT0 = -1; flightU = 0; arrived = true; onArrive?.(currentTarget); if (armedFor != null && armedFor === atStation) startAssembly(armedFor); armedFor = null; }
    } else {
      const k = 1 - Math.exp(-3.0 * dt);   // parked: follow the idle drift
      curPos.lerp(goalPos, k); curLook.lerp(goalLook, k);
    }
    camera.position.copy(curPos); camera.lookAt(curLook); camera.updateMatrixWorld();
    // streaks: only while flying, swelling and dying with the flight, and only
    // once there is a last frame to measure from
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    fieldMat.uniforms.uPrevViewProj.value.copy(havePrev ? prevViewProj : viewProj);
    fieldMat.uniforms.uStreak.value = flightT0 >= 0 ? num(opt.streak, 1) * Math.sin(Math.PI * flightU) : 0;
    fieldMat.uniforms.uViewport.value.set(viewW * renderer.getPixelRatio(), viewH * renderer.getPixelRatio());
    prevViewProj.copy(viewProj); havePrev = true;
    if (tintT0 >= 0) {
      const u = (elapsed - tintT0) / tintDur;
      if (u >= 1) { tintT0 = -1; tint.w = 0; }
      else tint.w = tintPeak * Math.min(1, u / 0.12) * (1 - u) * (1 - u);   // taken up quickly, let go slowly
    }
    bgMat.uniforms.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    bgMat.uniforms.uTime.value = elapsed;
    fill.position.copy(curLook).add(fillOffset);   // above and a little toward the camera, off the objects' faces
    fieldMat.uniforms.uFocus.value = curPos.distanceTo(curLook);
    finish.uniforms.uTime.value = elapsed;
    if (!assembledOnce && elapsed > 0.6) { assembledOnce = true; if (!startAssembly(atStation)) onEvent?.('assembled', { station: null }); }

    // ambient field: tile the wrap box so dust surrounds the camera anywhere,
    // and pull it gently toward the active station (in the field's own frame)
    field.position.set(
      Math.round(curPos.x / period.x) * period.x,
      Math.round(curPos.y / period.y) * period.y,
      Math.round(curPos.z / period.z) * period.z,
    );
    const st = stations.get(activeStation);
    const g4 = velMat.uniforms.uGather.value;
    if (drawT0 >= 0 && elapsed - drawT0 < drawDur) {
      // stirred: for a moment the dust is drawn to where the camera looks
      const u = (elapsed - drawT0) / drawDur;
      gather.copy(curLook).sub(field.position);
      g4.set(gather.x, gather.y, gather.z, drawStrength * Math.sin(Math.PI * u));
    } else if (st) {
      drawT0 = -1;
      gather.copy(st.pos).sub(field.position);
      g4.set(gather.x, gather.y, gather.z, st.def.gather ?? opt.gather);
      // a pulsing station shoves the dust outward from its centre every `pulse` seconds; the shove decays over ~a second
      if (st.def.pulse && elapsed >= nextPulse) { burst.set(gather.x, gather.y, gather.z, kick); nextPulse = elapsed + st.def.pulse; }
    } else g4.w = 0;
    if (burst.w > 0) burst.w = Math.max(0, burst.w - kick * 1.3 * dt);
    velMat.uniforms.uDt.value = dt; velMat.uniforms.uTime.value = elapsed; posMat.uniforms.uDt.value = dt;
    velMat.uniforms.uPos.value = posA.texture; velMat.uniforms.uVel.value = velA.texture; pass(velMat, velB);
    posMat.uniforms.uPos.value = posA.texture; posMat.uniforms.uVel.value = velB.texture; pass(posMat, posB);
    [posA, posB] = [posB, posA]; [velA, velB] = [velB, velA];
    fieldMat.uniforms.uPos.value = posA.texture; fieldMat.uniforms.uVel.value = velA.texture;

    for (const s of stations.values()) s.built.update(elapsed, curPos);
    for (const [id, p] of places) {
      const want = placeWanted(id, p) ? 1 : 0;
      if (p.vis !== want) showPlace(p, want > p.vis ? Math.min(1, p.vis + dt / PLACE_FADE) : Math.max(0, p.vis - dt / PLACE_FADE));
    }
    if (hiMesh) { const k = 1 + 0.12 * Math.sin(elapsed * 3); hiMesh.scale.set(k, k, k); }
    // frame-rate guard: step the pixel ratio down, then halve the field, if slow —
    // before this frame's render, so the resized canvas is drawn at once (a resize
    // clears it, and a frame of page background showed through)
    if (opt.guard !== false && elapsed > 4 && guardStage < 2) {
      winFrames++; winTime += dt;
      if (winTime >= 2) {
        if (winFrames / winTime < 40) {
          guardScale = guardStage === 0 ? 0.7 : 0.5;
          applyDpr();
          if (guardStage === 1) fieldGeo.setDrawRange(0, Math.floor(count / 2));
          guardStage++;
        }
        winFrames = 0; winTime = 0;
      }
    }
    composer.render(dt);
  }
  frame();

  return {
    palette: pal,
    get currentTarget() { return currentTarget; },
    get arrived() { return arrived; },
    get activeStation() { return activeStation; },
    get hero() { return heroId; },
    get atStation() { return atStation; },
    get flying() { return flightT0 >= 0; },
    get busy() { return formsBusy(); },
    get flightProgress() { return flightT0 >= 0 ? flightU : 1; },   // 0..1 in time through the flight, 1 when parked
    get paused() { return paused; },
    get stationIds() { return [...stations.keys()]; },
    has(at) { return Array.isArray(at) || stations.has(at) || places.has(String(at)) || anchors.has(String(at)) || !!NAMED[at]; },
    get camera() { return camera; },
    // A photograph as a place (StagePhoto mode="place"): its grain cloud in the
    // scene, and a pose target `id` whose look is the photo's front view.
    // image, depth: loaded <img> elements. → the cloud's handle (set, dispose, front).
    // group: a place group the deck can hide (setPlaceGroups); it starts as its group stands.
    addPhotoPlace(id, { image, depth, at, yaw = 0, width = 4, cols, relief = 1, depthScale, screenAspect = 16 / 9, group = null }) {
      dropPlace(id);
      const pos = new Vector3(num(at?.[0], 0), num(at?.[1], 0), num(at?.[2], 0));
      const place = createPhotoPlace({ image, depth, pos: pos.toArray(), yaw, width, cols: Math.round(num(cols, 600) * T.grains), relief, depthScale, maxTexture: T.placeTex });
      scene.add(place.object);
      const entry = { pos, look: { dist: place.front(num(opt.fov, 50), screenAspect).dist, yaw, pitch: 0, sway: 0, still: true }, place, group: group ? String(group) : null, vis: 1 };
      places.set(String(id), entry);
      showPlace(entry, placeWanted(String(id), entry) ? 1 : 0);
      return place;
    },
    removePhotoPlace(id) { dropPlace(id); },
    // Which place groups show: { group: true | false } (a group not named
    // shows). Places fade in or out over a second; `immediate` snaps them.
    setPlaceGroups(groups, { immediate = false } = {}) {
      placeGroups = new Map(Object.entries(groups || {}).map(([g, on]) => [String(g), on !== false]));
      if (immediate) for (const [id, p] of places) showPlace(p, placeWanted(id, p) ? 1 : 0);
    },
    get placeGroups() { return Object.fromEntries(placeGroups); },
    // id → 0..1, how far each place shows (for the probes)
    get placeVisibility() { return Object.fromEntries([...places].map(([id, p]) => [id, p.vis])); },
    // build again what stands at the station the pose is at (the `c` key)
    assemble() { return startAssembly(atStation); },
    record(id) { return byId.get(String(id)) || null; },
    // the number the object named `name` shows now (its builder's api.value()), or null
    value(name) { const v = forms.get(String(name))?.value?.(); return Number.isFinite(v) ? v : null; },
    state(id) { return byId.get(String(id)) || null; },   // Startertalk's name for record()
    // pose: { at: <station id | record id | named pose | [x,y,z]>, dist?, yaw?, pitch?, sway? }
    setPose(p, { immediate = false } = {}) {
      pose = { at: 'wide', ...(p || {}) };
      currentTarget = Array.isArray(pose.at) ? pose.at.join(',') : String(pose.at);
      container.dataset.spaceAt = currentTarget;
      const wasAt = atStation;
      applyPose(pose, elapsed);   // resolve now, so activeStation is current when setPose returns (the hum follows it)
      container.dataset.spaceStation = activeStation ?? '';
      container.dataset.spaceAtStation = atStation ?? '';
      if (immediate || firstFrame) { firstFrame = true; flightT0 = -1; flightU = 0; arrived = true; armedFor = null; return; }
      fromPos.copy(curPos); fromLook.copy(curLook);
      // a flight to a station from elsewhere: scatter what builds itself there now, so it gathers on arrival
      armedFor = null;
      if (atStation != null && atStation !== wasAt) {
        const apis = selfBuilders(atStation);
        for (const api of apis) api.arm();
        if (apis.length) armedFor = atStation;
      }
      const d = fromPos.distanceTo(goalPos) + 0.5 * fromLook.distanceTo(goalLook);
      const [lo, hi2] = opt.flight;
      // a slide's own `flight` (seconds) beats the rule from the distance
      flightDur = num(pose.flight, 0) > 0 ? num(pose.flight, 0) : Math.min(hi2, Math.max(lo, 1.1 + d / 12));
      flightT0 = elapsed; flightU = 0; arrived = false;
      onEvent?.('flight', { seconds: flightDur, distance: d, to: currentTarget });
    },
    setStop(id) {
      if (hiMesh) { hi.remove(hiMesh); hiMesh.geometry.dispose(); hiMesh.material.dispose(); hiMesh = null; }
      const p = id != null ? anchors.get(String(id)) : null;
      if (p) {
        hiMesh = shell(0.6, pal.highlight, 0.32);
        hiMesh.position.copy(p); hi.add(hiMesh);
      }
    },
    // How far the world steps back behind a slide's text (0..1): the DOM scrim
    // darkens the canvas; this fades the station labels with it.
    setDim(d) { const k = Math.min(1, Math.max(0, Number(d) || 0)); for (const s of stations.values()) s.built.setDim(k); },
    // Move the dust. 'gather' draws it for `seconds` toward the point the
    // camera looks at; 'burst' shoves it outward from there. A video arriving
    // as particles gathers the world's dust with it; one leaving bursts it.
    stir(kind = 'burst', { strength = 1, seconds = 1.4 } = {}) {
      if (kind === 'gather') { drawT0 = elapsed; drawDur = Math.max(0.2, seconds); drawStrength = 5 * strength; return; }
      gather.copy(curLook).sub(field.position);
      burst.set(gather.x, gather.y, gather.z, kick * 1.2 * strength);
    },
    // Let the dust take a colour for a while: `rgb` as [r, g, b] in 0..1. A
    // clip that breaks into the dust leaves its colours in it.
    tint(rgb, { seconds = 4.5, strength = 0.8 } = {}) {
      if (!Array.isArray(rgb) || rgb.length < 3) return;
      // a dark frame still has a hue: lift it, so the tint is a colour and not a dimming
      const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-3), lift = Math.min(1 / peak, 6) * 0.85;
      tint.set(rgb[0] * lift, rgb[1] * lift, rgb[2] * lift, 0);
      tintT0 = elapsed; tintDur = Math.max(0.5, seconds); tintPeak = Math.min(1, Math.max(0, strength));
    },
    setPaused(p) {
      if (disposed || p === paused) return;
      paused = p;
      container.dataset.spacePaused = p ? '1' : '0';
      havePrev = false;   // no streak across the gap
      if (p) cancelAnimationFrame(raf); else { getDelta(); frame(); }
    },
    dispose() {
      for (const id of [...places.keys()]) dropPlace(id);
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const t of [posA, posB, velA, velB]) t.dispose();
      initTex.dispose();
      for (const s of stations.values()) s.built.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
      quad.geometry.dispose();
      for (const m of [copyMat, velMat, posMat]) m.dispose();
      scene.environment?.dispose?.();
      composer.dispose?.();
      renderer.dispose(); renderer.forceContextLoss?.();
    },
  };
}
