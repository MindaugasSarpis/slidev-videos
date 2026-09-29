import {
  Group, Points, ShaderMaterial, BufferGeometry, BufferAttribute, AdditiveBlending, Color,
} from 'three';

// Forms made of grains. Everything here is drawn as points of light, the
// same stuff as the dust the world is filled with: no surfaces, no edges, no
// labels. A form is born scattered — its grains adrift in a wide volume — and
// gathers into shape when the camera arrives (the engine calls `assemble`),
// so what a slide shows is seen coming together, not found standing there.
//
//   galaxy    a spiral of grains, turning, the inside faster than the rim
//   collider  a ring of circulating grains, two bunches running against
//             each other, and a spray of tracks each time they meet
//
// This module knows nothing of the registry: builders.js registers what it
// exports (and types.js lists their fields for the validator).

const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += Math.random(); return (s - 2) / 1.2; };
const rgb = (hex) => { const c = new Color(hex); return [c.r, c.g, c.b]; };
const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const D2R = Math.PI / 180;

// What every form's vertex shader begins with: the grain's own attributes,
// and `formed()`, how far this grain has come home (0 adrift … 1 in place).
// Grains set out at their own moment, so a form condenses rather than snaps.
const HEAD = /* glsl */ `
attribute vec3 aScatter, aColor;
attribute float aSize, aAlpha, aSeed;
uniform float uTime, uForm, uPixelRatio;
varying vec3 vColor; varying float vAlpha;
float formed() {
  float x = clamp(uForm * 1.55 - aSeed * 0.55, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}
// adrift: a slow wander about the scattered place
vec3 adrift() {
  return aScatter + 0.35 * vec3(sin(uTime * 0.5 + aSeed * 40.0), cos(uTime * 0.4 + aSeed * 23.0), sin(uTime * 0.45 + aSeed * 61.0));
}
void place(vec3 p, float f, float sizeBoost) {
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.72 + 0.28 * sin(uTime * (1.1 + aSeed * 2.3) + aSeed * 40.0);
  gl_PointSize = uPixelRatio * aSize * sizeBoost * tw * (72.0 / max(-mv.z, 0.1));
  vColor = aColor;
  // adrift a grain is one mote among the dust; in place it carries its full light
  vAlpha = aAlpha * tw * mix(0.35, 1.0, f);
}`;
const FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.04, d) * vAlpha;
  gl_FragColor = vec4(pow(vColor * a, vec3(2.2)), 1.0);   // linear light; additive with alpha 1
}`;

// The grain buffers of a form, filled one grain at a time.
function grains(n, extra = {}) {
  const a = {
    position: new Float32Array(n * 3), aScatter: new Float32Array(n * 3), aColor: new Float32Array(n * 3),
    aSize: new Float32Array(n), aAlpha: new Float32Array(n), aSeed: new Float32Array(n),
  };
  const sizes = { position: 3, aScatter: 3, aColor: 3, aSize: 1, aAlpha: 1, aSeed: 1 };
  for (const [k, size] of Object.entries(extra)) { a[k] = new Float32Array(n * size); sizes[k] = size; }
  let i = 0;
  return {
    get count() { return i; },
    // scatter: where the grain drifts before the form gathers, relative to the form's centre
    put({ home = [0, 0, 0], color, size = 1, alpha = 0.6, reach = 9, ...more }) {
      if (i >= n) return;
      a.position.set(home, i * 3);
      const len = Math.hypot(home[0], home[1], home[2]) || 1;
      const out = reach * (0.55 + 0.9 * Math.random());
      // outward from where it belongs, and well off to the side: the cloud is wide, not a shell
      a.aScatter.set([
        home[0] + (home[0] / len) * out * 0.5 + gauss() * out * 0.6,
        home[1] + gauss() * out * 0.55,
        home[2] + (home[2] / len) * out * 0.5 + gauss() * out * 0.6,
      ], i * 3);
      a.aColor.set(color, i * 3);
      a.aSize[i] = size; a.aAlpha[i] = alpha; a.aSeed[i] = Math.random();
      for (const [k, v] of Object.entries(more)) { if (Array.isArray(v)) a[k].set(v, i * sizes[k]); else a[k][i] = v; }
      i++;
    },
    geometry() {
      const geo = new BufferGeometry();
      for (const [k, arr] of Object.entries(a)) geo.setAttribute(k, new BufferAttribute(arr, sizes[k]));
      geo.setDrawRange(0, i);
      return geo;
    },
  };
}

// arm / assemble for a form whose shader reads uForm.
function former(uForm, seconds) {
  const s = { t0: -1, armed: false, onDone: null };
  const api = {
    arm() { s.armed = true; s.t0 = -1; s.onDone = null; uForm.value = 0; },
    assemble(now, onDone) { s.armed = true; s.t0 = now; s.onDone = onDone || null; uForm.value = 0; },
    get assembling() { return s.t0 >= 0; },
    get armed() { return s.armed; },
  };
  return {
    api,
    tick(t) {
      if (s.t0 < 0) return;
      const u = Math.min((t - s.t0) / seconds, 1);
      uForm.value = u;
      if (u >= 1) { s.t0 = -1; s.armed = false; const cb = s.onDone; s.onDone = null; cb?.(); }
    },
  };
}

function material(vertexShader, uniforms) {
  return new ShaderMaterial({
    vertexShader, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uForm: { value: 0 }, uPixelRatio: { value: Math.min(devicePixelRatio || 1, 2) }, ...uniforms },
  });
}

function finish(o, geo, mat, { seconds = 3.2 } = {}) {
  const g = new Group();
  const pts = new Points(geo, mat); pts.frustumCulled = false;
  const tilted = new Group();
  tilted.rotation.set((o.tilt || 0) * D2R, (o.yaw || 0) * D2R, (o.roll || 0) * D2R);
  tilted.add(pts); g.add(tilted);
  g.position.set(o.pos?.[0] || 0, o.pos?.[1] || 0, o.pos?.[2] || 0);
  const born = o.assemble !== false;
  const f = former(mat.uniforms.uForm, typeof o.assemble === 'number' ? o.assemble : seconds);
  if (born) f.api.arm(); else mat.uniforms.uForm.value = 1;
  return {
    group: g, labels: [], api: born ? f.api : undefined, pixelRatio: mat.uniforms.uPixelRatio,
    update(t) { mat.uniforms.uTime.value = t; f.tick(t); },
  };
}

// ---- galaxy ---------------------------------------------------------------------
//   { type: galaxy, pos, radius, arms?: 2, winding?: 4.4, grains?: 80000,
//     tilt?, yaw?, roll?, spin?: 1, core?: '#…', arm?: '#…', rim?: '#…', knots?: '#…' }
// A bulge of warm grains, arms wound as logarithmic spirals and thinning
// outward, a few bright knots along them, a faint disc between. The arms turn
// as a pattern, all of a piece (as a galaxy's do: they are a wave the stars
// pass through). Letting the inside lap the rim, as the stars themselves do,
// sheared the spiral into a bar within a minute on screen.
const GALAXY_VERT = /* glsl */ `
${HEAD}
attribute vec3 aPolar;   // radius, angle at rest, height above the disc
uniform float uSpin, uRadius;
void main() {
  float f = formed();
  float r = aPolar.x;
  // the pattern's turn, and a grain's own slow drift through it (a little faster inside)
  float a = aPolar.y + uTime * uSpin * (0.03 + 0.004 * (aSeed - 0.5) / (0.4 + r / uRadius));
  vec3 home = vec3(r * cos(a), aPolar.z, r * sin(a));
  place(mix(adrift(), home, f), f, 1.0);
}`;

export function buildGalaxy(o, ctx) {
  const R = o.radius || 6;
  const N = Math.max(2000, Math.min(160000, Math.round(o.grains || 80000)));
  const arms = Math.max(1, Math.round(o.arms || 2));
  const winding = o.winding ?? 4.4;
  const core = rgb(o.core || '#ffe6c2');
  const arm = rgb(o.arm || ctx.palette.accent);
  const rim = rgb(o.rim || ctx.palette.nebulaAlt || ctx.palette.dust);
  const knot = rgb(o.knots || '#ff9ab8');
  const white = [1, 1, 1];
  const G = grains(N, { aPolar: 3 });
  for (let i = 0; i < N; i++) {
    const pick = Math.random();
    let r, a, h, color, size, alpha;
    if (pick < 0.11) {
      // the bulge: warm, a little taller than the disc. Kept thin: grains
      // add, and a dense bulge burns to a white disc under the bloom
      r = Math.abs(gauss()) * R * 0.2;
      a = Math.random() * 6.2832;
      h = gauss() * R * 0.07 * Math.exp(-r / (R * 0.25));
      color = mixRgb(core, white, Math.random() * 0.3);
      size = 0.8 + 1.0 * Math.random(); alpha = 0.07 + 0.16 * Math.exp(-r / (R * 0.16));
    } else if (pick < 0.8) {
      // the arms: a log spiral, its grains spread wider the farther out
      r = R * (0.05 + 0.95 * Math.pow(Math.random(), 0.7));
      const k = r / R;
      a = (Math.floor(Math.random() * arms) / arms) * 6.2832 + winding * Math.log(1 + 2.4 * k) + gauss() * (0.3 + 0.34 * k);
      h = gauss() * R * 0.02 * (1 - 0.5 * k);
      const bright = Math.random();
      color = bright > 0.985 ? knot : mixRgb(mixRgb(arm, rim, k * 0.8), white, bright > 0.9 ? 0.7 : 0.2 * Math.random());
      size = (bright > 0.985 ? 1.9 : 0.8) + 1.0 * Math.random();
      alpha = (0.2 + 0.34 * Math.random()) * (1 - 0.5 * k);
    } else {
      // the disc between the arms: faint, everywhere, thinning outward
      r = R * Math.pow(Math.random(), 0.75);
      a = Math.random() * 6.2832;
      h = gauss() * R * 0.022;
      color = mixRgb(rim, arm, Math.random());
      size = 0.7 + 0.9 * Math.random(); alpha = (0.16 + 0.2 * Math.random()) * (1 - 0.6 * r / R);
    }
    G.put({ home: [r * Math.cos(a), h, r * Math.sin(a)], color, size, alpha, reach: R * 1.5, aPolar: [r, a, h] });
  }
  const mat = material(GALAXY_VERT, { uSpin: { value: o.spin ?? 1 }, uRadius: { value: R } });
  return finish(o, G.geometry(), mat, { seconds: 3.6 });
}

// ---- collider -------------------------------------------------------------------
//   { type: collider, pos, radius, lap?: 9, tracks?: 14, grains?: 26000,
//     tilt?, yaw?, roll?, beam?: '#…', bunch?: '#…', spray?: ['#…', …] }
// A ring of grains streaming both ways round. Two bunches, dense and bright,
// run against each other once round every `lap` seconds and meet twice a lap,
// at opposite points of the ring; at each meeting a spray of tracks leaves
// the point, bending as charged tracks do in a field, and fades.
const COLLIDER_VERT = /* glsl */ `
${HEAD}
attribute vec4 aRing;    // angle at rest, radial offset, height, direction (+1 / -1)
attribute vec4 aTrack;   // xyz: direction of flight from the meeting point; w: delay along the track
attribute float aKind;   // 0 stream, 1 bunch, 2 spray from the point at angle 0, 3 spray from the point at angle pi
uniform float uRadius, uLap, uLife;
const float TAU = 6.2831853;
void main() {
  float f = formed();
  float w = TAU / uLap;
  vec3 home; float boost = 1.0; float fade = 1.0;
  if (aKind < 1.5) {
    // the stream drifts round at its own pace; the bunches keep time
    float a = aKind < 0.5 ? aRing.x + aRing.w * uTime * w * (0.5 + 0.5 * aSeed) : aRing.x + aRing.w * uTime * w;
    float r = uRadius + aRing.y;
    home = vec3(r * cos(a), aRing.z, r * sin(a));
    if (aKind > 0.5) {
      // a bunch flares as it nears a meeting point (angle 0 or pi)
      float near = pow(abs(cos(a)), 24.0);
      boost = 1.0 + 1.6 * near;
    }
  } else {
    // bunch A is at angle w t, bunch B at -w t: they meet at 0 when w t = 0 (mod 2 pi) and at pi half a lap later
    float since = mod(uTime + (aKind > 2.5 ? 0.5 * uLap : 0.0), uLap) - aTrack.w;
    float u = since / uLife;
    vec3 ip = vec3(aKind > 2.5 ? -uRadius : uRadius, 0.0, 0.0);
    // each meeting throws its tracks a different way: turn them about the beam line by the meeting's number
    float n = floor((uTime + (aKind > 2.5 ? 0.5 * uLap : 0.0)) / uLap);
    float turn = fract(sin(n * 12.9898 + 4.1) * 43758.5453) * TAU;
    float c = cos(turn), s = sin(turn);
    vec3 d = vec3(aTrack.x * c - aTrack.y * s, aTrack.x * s + aTrack.y * c, aTrack.z);
    float t = max(since, 0.0);
    // out from the point, slowing, and bending about the beam line (z at both points)
    vec3 bend = vec3(-d.y, d.x, 0.0) * (aSeed > 0.5 ? 1.0 : -1.0);
    home = ip + d * (2.6 * t - 0.5 * t * t / uLife) * uRadius * 0.16 + bend * t * t * uRadius * 0.045;
    fade = (since < 0.0 || u > 1.0) ? 0.0 : (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.04, u);
    boost = 1.0 + 1.4 * (1.0 - clamp(u, 0.0, 1.0));
  }
  place(mix(adrift(), home, f), f, boost);
  vAlpha *= fade * (aKind > 1.5 ? f : 1.0);   // no spray from a ring that has not gathered
}`;

export function buildCollider(o, ctx) {
  const R = o.radius || 7;
  const N = Math.max(2000, Math.min(120000, Math.round(o.grains || 26000)));
  const nTracks = Math.max(3, Math.min(40, Math.round(o.tracks || 14)));
  const PER_TRACK = 90, BUNCH = 900;
  const life = o.life ?? 2.6;
  const beam = rgb(o.beam || ctx.palette.dust);
  const bright = rgb(o.bunch || ctx.palette.dustBright);
  const accent = rgb(ctx.palette.accent);
  const spray = (o.spray || [ctx.palette.accent, ctx.palette.dustBright, ctx.palette.nebulaAlt || ctx.palette.accent, '#ffffff']).map(rgb);
  const total = N + 2 * BUNCH + 2 * nTracks * PER_TRACK;
  const G = grains(total, { aRing: 4, aTrack: 4, aKind: 1 });
  const none = [0, 0, 0, 0];
  // the stream: a thin tube, denser at its axis
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.2832, dr = gauss() * R * 0.012, h = gauss() * R * 0.012;
    const dir = Math.random() < 0.5 ? 1 : -1;
    G.put({
      home: [(R + dr) * Math.cos(a), h, (R + dr) * Math.sin(a)], color: mixRgb(beam, accent, Math.random() * 0.6),
      size: 0.7 + 0.8 * Math.random(), alpha: 0.16 + 0.3 * Math.random(), reach: R * 1.1,
      aRing: [a, dr, h, dir], aTrack: none, aKind: 0,
    });
  }
  // the bunches: both start at angle 0, one each way
  for (const dir of [1, -1]) for (let i = 0; i < BUNCH; i++) {
    const a = gauss() * 0.035, dr = gauss() * R * 0.008, h = gauss() * R * 0.008;
    G.put({
      home: [(R + dr) * Math.cos(a), h, (R + dr) * Math.sin(a)], color: mixRgb(bright, [1, 1, 1], Math.random() * 0.5),
      size: 1.2 + 1.4 * Math.random(), alpha: 0.4 + 0.45 * Math.random(), reach: R * 0.8,
      aRing: [a, dr, h, dir], aTrack: none, aKind: 1,
    });
  }
  // the sprays: tracks mostly across the beam line, a grain after a grain along each
  for (const kind of [2, 3]) for (let k = 0; k < nTracks; k++) {
    const phi = Math.random() * 6.2832, along = gauss() * 0.45;
    const d = [Math.cos(phi), Math.sin(phi), along];
    const len = Math.hypot(...d); d[0] /= len; d[1] /= len; d[2] /= len;
    const color = spray[k % spray.length];
    const reachOut = 0.55 + 0.7 * Math.random();
    for (let j = 0; j < PER_TRACK; j++) {
      const lag = (j / PER_TRACK) * 0.5;
      G.put({
        home: [kind === 2 ? R : -R, 0, 0], color: mixRgb(color, [1, 1, 1], 0.5 * (1 - j / PER_TRACK)),
        size: (1.9 - 1.2 * j / PER_TRACK) * (0.8 + 0.4 * Math.random()), alpha: 0.75 * (1 - 0.6 * j / PER_TRACK), reach: R * 0.5,
        aRing: none, aTrack: [d[0] * reachOut, d[1] * reachOut, d[2] * reachOut, lag], aKind: kind,
      });
    }
  }
  const mat = material(COLLIDER_VERT, { uRadius: { value: R }, uLap: { value: Math.max(2, o.lap ?? 9) }, uLife: { value: life } });
  // the ring lies in the xz plane with its meeting points on x; the beam line there runs along z
  return finish(o, G.geometry(), mat, { seconds: 3.4 });
}
