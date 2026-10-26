// Grains for a builder's own forms: a points material in the engine's linear
// light, the shared GLSL a vertex shader starts from, and the small geometry
// helpers. From MasterTalk's and Innoday's setup/grains.js (Oct 2026).
//
//   const mat = grainMaterial(VERT, { uColor: { value: new Color('#9cc4ff') } }, { near })
//   group.add(grainPoints(grainGeometry(n, { position, aSeed: [seed, 1] }), mat))
//   return { group, frameScale: mat.uniforms.uPixelRatio, … }
//
// GRAIN_GLSL gives a vertex shader place(p, size, alpha, color, seed) (a slow
// twinkle; the size from distance, capped; faded out near the camera), hide(),
// hash(), ease() and turnY().
import { BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending, Color } from 'three';
import { twinkleUniform } from './twinkle.js';

export const GRAIN_GLSL = /* glsl */ `
uniform float uTime, uPixelRatio, uMaxSize, uNear0, uNear1, uTwinkle;
varying vec3 vColor; varying float vAlpha;
void place(vec3 p, float size, float alpha, vec3 color, float seed) {
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // a slow, shallow twinkle (a stream encoder smears fast sparkle); none as uTwinkle goes to 0 (stage/twinkle.js)
  float tw = mix(1.0, 0.86 + 0.14 * sin(uTime * (0.6 + seed * 1.2) + seed * 40.0), uTwinkle);
  // capped, and faded out within a few units of the camera: a flight that passes through a
  // scattered form must not fill the frame with huge additive sprites (a flash, and a fill-rate spike)
  gl_PointSize = min(uPixelRatio * size * tw * (72.0 / max(-mv.z, 0.1)), uMaxSize * uPixelRatio);
  vColor = color;
  vAlpha = alpha * tw * smoothstep(uNear0, uNear1, -mv.z);
}
void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; vColor = vec3(0.0); vAlpha = 0.0; }
float hash(float n) { return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }
float ease(float x) { x = clamp(x, 0.0, 1.0); return x * x * x * (x * (x * 6.0 - 15.0) + 10.0); }
vec3 turnY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
`;
export const GRAIN_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.04, 0.5, d)) * vAlpha;
  gl_FragColor = vec4(pow(vColor * a, vec3(2.2)), 1.0);
}`;

// near: { size: 48 (the largest grain, px at 900 high), from: 1.5, to: 5 (units from the
// camera: faded out at `from`, whole at `to`) }
export const NEAR = { size: 48, from: 1.5, to: 5 };
export function grainMaterial(vertexShader, uniforms = {}, { near = {}, fragmentShader = GRAIN_FRAG } = {}) {
  const n = { ...NEAR, ...(near || {}) };
  return new ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    // uPixelRatio carries the frame scale (the buffer's height / 900; each builder returns it as
    // `frameScale`), so a grain is the same share of the picture at 1600×900 and on a phone
    uniforms: {
      uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTwinkle: twinkleUniform,
      uMaxSize: { value: n.size }, uNear0: { value: n.from }, uNear1: { value: n.to },
      ...uniforms,
    },
  });
}

export function grainPoints(geo, mat) { const p = new Points(geo, mat); p.frustumCulled = false; return p; }
// attrs: { position?: Float32Array, aName: [array, itemSize], … }
export function grainGeometry(n, attrs = {}) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(attrs.position || new Float32Array(n * 3), 3));
  for (const [k, v] of Object.entries(attrs)) if (k !== 'position') geo.setAttribute(k, new BufferAttribute(v[0], v[1]));
  return geo;
}
// '#rrggbb' → [r, g, b] (three's Color: linear)
export const rgb = (hex) => { const c = new Color(hex); return [c.r, c.g, c.b]; };
