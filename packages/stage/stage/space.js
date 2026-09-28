import {
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, Mesh, Points, Group,
  PlaneGeometry, BufferGeometry, BufferAttribute, ShaderMaterial, DataTexture,
  WebGLRenderTarget, RGBAFormat, FloatType, HalfFloatType, NearestFilter,
  AdditiveBlending, Vector2, Vector3, Vector4, Color,
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
//   → { setPose, setStop, setDim, setPaused, stir, assemble, record, dispose, … }
//
// The field is pulled toward the active station only faintly: the dust reads
// as a uniform, bright ground behind the scenes, not a cloud clumped round them.

const FIELD_BOUNDS = new Vector3(30, 30, 30);   // ambient field wrap box (half extents; a cube so the camera never sits at a face)
const MAX_DT = 1 / 12;   // frame-time clamp: real time down to 12 fps (flights and the assembly keep their pace on a slow GPU)
const D2R = Math.PI / 180;
const DEFAULTS = {
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
  flight: [1.4, 4.5],    // shortest and longest flight, seconds
};

// The page gradient, drawn by the renderer itself (post-processing wants a
// solid ground): the two radial glows the container's CSS carries for the
// static fallback, in view fractions.
const BG_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const BG_FRAG = /* glsl */ `
uniform vec3 uBg, uGlow;
varying vec2 vUv;
void main() {
  float g1 = 1.0 - smoothstep(0.0, 0.62, length((vUv - vec2(0.78, 1.08)) / vec2(0.69, 0.78)));
  float g2 = 1.0 - smoothstep(0.0, 0.60, length((vUv - vec2(-0.12, -0.08)) / vec2(0.56, 0.67)));
  gl_FragColor = vec4(uBg + uGlow * (0.07 * g1 + 0.05 * g2), 1.0);
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
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'high-performance' });
  } catch { return null; }
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); return null; }
  const type = renderer.extensions.has('EXT_color_buffer_float') ? FloatType
    : renderer.extensions.has('EXT_color_buffer_half_float') ? HalfFloatType : null;
  if (!type) { renderer.dispose(); return null; }
  const baseDpr = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2);
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
  const bgMat = new ShaderMaterial({ vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false, uniforms: { uBg: { value: raw(pal.bg) }, uGlow: { value: raw(pal.accent) } } });
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
  const ctx = { records: byId, states: byId, palette: pal, anisotropy: renderer.capabilities.getMaxAnisotropy(), asset: asset || ((s) => s), helpers };
  for (const st of space.stations || []) {
    const built = buildStation(st, ctx);
    scene.add(built.group);
    stations.set(st.id, { def: st, pos: new Vector3(...st.pos), built });
    for (const [id, p] of built.anchors) anchors.set(String(id), p);
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
  const size = pickTexSize(coarse, num(opt.density, 1)), count = size * size;
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

  const nearestStation = (t) => {
    let best = firstStation, bd = Infinity;
    for (const [id, s] of stations) { const d = t.distanceTo(s.pos); if (d < bd) { bd = d; best = id; } }
    return best;
  };
  // at → { target, dist, yaw, pitch, station }; `at` is [x,y,z], a station id, a record / anchor id or a named pose
  const resolve = (p) => {
    let at = p.at;
    const out = { target: new Vector3(), station: null, dist: p.dist, yaw: p.yaw, pitch: p.pitch, sway: p.sway };
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
    } else if (anchors.has(String(at))) {
      out.target.copy(anchors.get(String(at))).add(stopOffset);
      out.station = nearestStation(out.target);
    } else if (firstStation != null) {
      out.target.copy(stations.get(firstStation).pos); out.station = firstStation;
    }
    out.dist ??= opt.pose.dist; out.yaw ??= opt.pose.yaw; out.pitch ??= opt.pose.pitch;
    return out;
  };
  const applyPose = (p, elapsed) => {
    const r = resolve(p);
    const dist = r.dist * (1 + 0.02 * Math.sin(elapsed / 31 * Math.PI * 2));
    // idle sway about the pose's yaw: 2.5° by default; a look may ask for more (the hero slowly circles)
    const yaw = (r.yaw + (r.sway ?? 2.5) * Math.sin(elapsed / 46 * Math.PI * 2)) * D2R;
    const pitch = (r.pitch + 1.2 * Math.sin(elapsed / 57 * Math.PI * 2 + 2)) * D2R;
    goalLook.copy(r.target);
    goalPos.set(r.target.x + dist * Math.sin(yaw) * Math.cos(pitch), r.target.y + dist * Math.sin(pitch), r.target.z + dist * Math.cos(yaw) * Math.cos(pitch));
    activeStation = r.station;
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
  canvas.__space = { scene, composer, bloom, finish, field, renderer, get guardStage() { return guardStage; }, holdQuality() { guardStage = 2; }, get elapsed() { return elapsed; }, get dpr() { return renderer.getPixelRatio(); }, get frames() { return frames; } };   // a handle for the headless probes

  // what builds itself at each station, on arrival
  const selfBuilders = (id) => stations.get(id)?.built.apis.filter((a) => a.assemble) || [];
  const heroApi = heroId != null ? (selfBuilders(heroId)[0] || null) : null;
  let assembledOnce = false;

  let viewW = 1, viewH = 1, guardScale = 1;
  const maxW = num(opt.maxBufferWidth, 2560);
  const dprFor = (w) => Math.min(baseDpr, maxW / Math.max(w, 1));
  const applyDpr = () => {
    const d = dprFor(viewW) * guardScale;
    renderer.setPixelRatio(d); composer.setPixelRatio(d); fieldMat.uniforms.uPixelRatio.value = d;
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
  // a passing pull toward the point the camera looks at (see stir)
  let drawT0 = -1, drawDur = 0, drawStrength = 0;
  const fillOffset = new Vector3(0, 3.5, 2.5);

  function startAssembly() {
    if (!heroApi) return;
    onEvent?.('assembling');
    heroApi.assemble(elapsed, () => {
      // the last node lands: the dust takes the station's pulse from the body
      const st = stations.get(heroId);
      if (st) { gather.copy(st.pos).sub(field.position); burst.set(gather.x, gather.y, gather.z, kick * 1.6); nextPulse = elapsed + (st.def.pulse || 6); }
      onEvent?.('assembled');
    });
  }

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
      curPos.lerpVectors(fromPos, goalPos, e); curLook.lerpVectors(fromLook, goalLook, e);
      if (u >= 1) { flightT0 = -1; arrived = true; onArrive?.(currentTarget); if (heroId != null && activeStation === heroId) startAssembly(); }
    } else {
      const k = 1 - Math.exp(-3.0 * dt);   // parked: follow the idle drift
      curPos.lerp(goalPos, k); curLook.lerp(goalLook, k);
    }
    camera.position.copy(curPos); camera.lookAt(curLook); camera.updateMatrixWorld();
    fill.position.copy(curLook).add(fillOffset);   // above and a little toward the camera, off the objects' faces
    fieldMat.uniforms.uFocus.value = curPos.distanceTo(curLook);
    finish.uniforms.uTime.value = elapsed;
    if (!assembledOnce && elapsed > 0.6) { assembledOnce = true; if (heroId != null && activeStation === heroId && heroApi) startAssembly(); else onEvent?.('assembled'); }

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
    if (hiMesh) { const k = 1 + 0.12 * Math.sin(elapsed * 3); hiMesh.scale.set(k, k, k); }
    // frame-rate guard: step the pixel ratio down, then halve the field, if slow —
    // before this frame's render, so the resized canvas is drawn at once (a resize
    // clears it, and a frame of page background showed through)
    if (elapsed > 4 && guardStage < 2) {
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
    get paused() { return paused; },
    get stationIds() { return [...stations.keys()]; },
    has(at) { return Array.isArray(at) || stations.has(at) || anchors.has(String(at)) || !!NAMED[at]; },
    assemble() { startAssembly(); },
    record(id) { return byId.get(String(id)) || null; },
    state(id) { return byId.get(String(id)) || null; },   // Startertalk's name for record()
    // pose: { at: <station id | record id | named pose | [x,y,z]>, dist?, yaw?, pitch?, sway? }
    setPose(p, { immediate = false } = {}) {
      pose = { at: 'wide', ...(p || {}) };
      currentTarget = Array.isArray(pose.at) ? pose.at.join(',') : String(pose.at);
      container.dataset.spaceAt = currentTarget;
      const wasStation = activeStation;
      applyPose(pose, elapsed);   // resolve now, so activeStation is current when setPose returns (the hum follows it)
      container.dataset.spaceStation = activeStation ?? '';
      if (immediate || firstFrame) { firstFrame = true; flightT0 = -1; arrived = true; return; }
      fromPos.copy(curPos); fromLook.copy(curLook);
      // a flight toward the hero: scatter its nodes now, so they fly in on arrival
      if (heroId != null && activeStation === heroId && wasStation !== heroId) heroApi?.arm();
      const d = fromPos.distanceTo(goalPos) + 0.5 * fromLook.distanceTo(goalLook);
      const [lo, hi2] = opt.flight;
      flightDur = Math.min(hi2, Math.max(lo, 1.1 + d / 12));
      flightT0 = elapsed; arrived = false;
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
    setPaused(p) {
      if (disposed || p === paused) return;
      paused = p;
      container.dataset.spacePaused = p ? '1' : '0';
      if (p) cancelAnimationFrame(raf); else { getDelta(); frame(); }
    },
    dispose() {
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
