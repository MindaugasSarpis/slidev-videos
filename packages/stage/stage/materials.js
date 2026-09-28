import {
  Mesh, ShaderMaterial, MeshPhysicalMaterial, SphereGeometry, Color, DoubleSide, AdditiveBlending,
} from 'three';

// The stage's ways of drawing a ball. Builders (the shipped ones and a deck's
// own) share them, so every sphere in a world belongs to one family.

// Orbs, not discs. A sphere lit from its rim: a dark translucent centre the
// dust shows through and a bright fresnel edge, so a ball reads as a volume of
// glow rather than a flat coloured circle.
const ORB_VERT = /* glsl */ `
varying vec3 vN, vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const ORB_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity, uCore;
varying vec3 vN, vV;
void main() {
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);   // back faces of a double-sided shell get the same rim, not a full disc
  float nv = max(dot(N, normalize(vV)), 0.0);
  float f = pow(1.0 - nv, 2.4);            // rim
  float c = pow(nv, 3.0);                   // the face toward the viewer, lit from the front
  vec3 col = mix(uColor * (0.7 + 0.45 * c), vec3(1.0), f * 0.6);
  float a = uOpacity * clamp(uCore + (1.0 - uCore) * f, 0.0, 1.0);
  // the frame is tone-mapped and sRGB-encoded at the end of the chain, so emit linear light
  gl_FragColor = vec4(pow(col, vec3(2.2)), pow(a, 2.2));
}`;

export function orb(color, { opacity = 0.95, core = 0.82 } = {}) {
  return new ShaderMaterial({
    vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: opacity }, uCore: { value: core } },
  });
}
export const setOrb = (mat, k, v) => { if (mat.uniforms) mat.uniforms[k].value = v; else mat[k === 'uOpacity' ? 'opacity' : 'color'] = v; };

// Marbles: the lit, glossy version of a ball — a clearcoat over the colour,
// environment reflections, a faint emissive core that bloom lifts. The diffuse
// is kept well under the colour: a near-white marble under the key, fill and
// sky overexposed and bloomed into a blob.
export function marble(color, { glow = 0.2, opacity = 1 } = {}) {
  const c = new Color(color);
  return new MeshPhysicalMaterial({
    color: c.clone().multiplyScalar(0.38), roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.12,
    emissive: c, emissiveIntensity: glow * 0.7, envMapIntensity: 0.5,
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
  });
}

// A bubble, not a disc: the fresnel orb with almost no body, additive, so only
// the rim glows and the inside stays open to the dust and whatever it holds.
export function shell(radius, color = '#7dd3fc', opacity = 0.16) {
  const m = orb(color, { opacity: Math.min(0.7, opacity * 2.2), core: 0.05 });
  m.blending = AdditiveBlending; m.side = DoubleSide;
  return new Mesh(new SphereGeometry(radius, 40, 24), m);
}

// A marble with its thin rim of glow; `ghost` draws the faint orb instead.
export function ball(color, radius = 0.42, { glow = 0.2, ghost = false, rim = true } = {}) {
  const m = new Mesh(new SphereGeometry(radius, 32, 24), ghost ? orb(color, { opacity: 0.55, core: 0.22 }) : marble(color, { glow }));
  if (!ghost && rim) m.add(shell(radius * 1.22, color, 0.14));
  return m;
}
