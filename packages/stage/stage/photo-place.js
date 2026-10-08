// A photograph as a place in the world: one grain per pixel cell, standing at
// its depth from the photo's depth map (StagePhoto mode="place";
// `slidev-videos depth` writes the maps). Seen from the side it is a relief in
// the world; flattened (relief 0) and seen square-on from its front pose it is
// the photograph, and StagePhoto hands over to the sharp <img> there.
//
//   createPhotoPlace({ image, depth, pos, yaw, width, cols, relief })
//     → { object, aspect, front(fovDeg, screenAspect) → { dist },
//         set({ relief, dim, opacity }), dispose() }
//
// The plane faces the camera of a pose { at: pos, yaw, pitch: 0 } (the stage
// puts that camera at pos + dist·(sin yaw, 0, cos yaw)). Near pixels (white
// in the map) stand toward the viewer; the plane through the map's middle
// depth stays put, so flattening never moves the picture's frame.
import { BufferGeometry, BufferAttribute, Points, Group, ShaderMaterial, Texture, LinearFilter, SRGBColorSpace, Vector2 } from 'three';

const VERT = /* glsl */`
attribute vec2 aCell;      // 0..1 across the photo, y down
attribute float aSeed;
uniform sampler2D uImg;
uniform sampler2D uDepth;
uniform vec3 uRight, uUp, uNormal, uCenter;
uniform vec2 uSize;        // width, height in world units
uniform float uRelief;     // 0 flat … 1 full relief
uniform float uDepthScale; // world units between nearest and farthest at full relief
uniform float uScale;      // drawing-buffer px per world unit at distance 1
uniform float uCellW;      // one cell's width in world units
uniform float uHalo;       // 0: the grain's core (writes depth) · 1: its soft halo (blends over)
varying vec3 vColor;
varying float vRelief;
varying float vFade;
float h(float k) { return fract(sin(aSeed * 91.7 + k * 17.3) * 43758.5453); }
void main() {
  float d = texture2D(uDepth, aCell).r;              // 1 near … 0 far
  // In relief the lattice is broken: each grain off its cell by up to half a
  // cell, a little in depth too; flat, every grain is back on its cell, so the
  // picture closes exactly.
  float jit = smoothstep(0.0, 0.35, uRelief);
  vec2 off = (vec2(h(1.0), h(2.0)) - 0.5) * uCellW * jit;
  float dz = (h(3.0) - 0.5) * uCellW * 1.5 * jit;
  vec3 p = uCenter + uRight * ((aCell.x - 0.5) * uSize.x + off.x) + uUp * ((0.5 - aCell.y) * uSize.y + off.y)
         + uNormal * ((d - 0.5) * uDepthScale * uRelief + dz);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // depth of field about the photo: grains far nearer or farther than the
  // picture's plane grow and fade, so a relief seen close reads as light, not a mesh
  float focus = length(cameraPosition - uCenter);
  float blur = clamp(abs(-mv.z - focus) / (0.5 * focus + 0.01), 0.0, 1.0) * uRelief;
  float sizeVar = mix(1.0, 0.75 + 0.5 * h(4.0), jit);
  float px = uCellW * uScale / max(-mv.z, 0.05) * mix(1.25, 1.05, uRelief) * sizeVar * (1.0 + 1.2 * blur);
  gl_PointSize = clamp(px * mix(1.0, 1.8, uHalo * jit), 1.0, 32.0);
  vColor = texture2D(uImg, aCell).rgb;
  vRelief = uRelief;
  vFade = 1.0 - 0.55 * blur;
}`;

const FRAG = /* glsl */`
uniform float uDim, uOpacity, uHalo, uRelief;
varying vec3 vColor;
varying float vRelief;
varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;      // 0 centre … 1 edge
  float soft = smoothstep(0.0, 0.35, vRelief);      // flat: squares that close the picture
  float a;
  if (uHalo < 0.5) {
    // the core: a round grain with a firm edge, writing depth so nearer grains hide what is behind
    a = mix(1.0, step(r, 0.62), soft);
  } else {
    // the halo: a soft fall-off round the core, blended over, hidden behind nearer cores
    if (soft < 0.01) discard;
    a = soft * 0.5 * (1.0 - smoothstep(0.3, 1.0, r)) * (1.0 - step(r, 0.34));
  }
  if (a < 0.02) discard;
  // never brighter than the photo: in relief a grain is capped at luminance
  // 0.62, its true colour only as the picture flattens
  float lum = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 capped = vColor * min(1.0, 0.62 / max(lum, 1e-3));
  vec3 col = mix(vColor, capped, smoothstep(0.0, 0.5, vRelief)) * uDim;
  gl_FragColor = vec4(col, a * uOpacity * mix(1.0, vFade, soft));
}`;

function texture(img, srgb) {
  const t = new Texture(img);
  t.minFilter = LinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = false;
  t.flipY = false;   // the cells run y down, as the image does
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createPhotoPlace({ image, depth, pos, yaw = 0, width = 4, cols = 600, relief = 1, depthScale }) {
  const aspect = image.naturalWidth / image.naturalHeight;
  const height = width / aspect;
  const rows = Math.max(2, Math.round(cols / aspect));
  const n = cols * rows;
  const cells = new Float32Array(n * 2), seeds = new Float32Array(n), xyz = new Float32Array(n * 3);
  for (let j = 0, k = 0; j < rows; j++) for (let i = 0; i < cols; i++, k++) {
    cells[k * 2] = (i + 0.5) / cols; cells[k * 2 + 1] = (j + 0.5) / rows; seeds[k] = Math.random();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(xyz, 3));   // placed in the shader; three wants one
  geo.setAttribute('aCell', new BufferAttribute(cells, 2));
  geo.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  const y = yaw * Math.PI / 180;
  const normal = [Math.sin(y), 0, Math.cos(y)], right = [Math.cos(y), 0, -Math.sin(y)];
  const uniforms = {
      uImg: { value: texture(image, true) }, uDepth: { value: texture(depth, false) },
      uRight: { value: right }, uUp: { value: [0, 1, 0] }, uNormal: { value: normal }, uCenter: { value: pos },
      uSize: { value: [width, height] }, uRelief: { value: relief },
      uDepthScale: { value: depthScale ?? width * 0.2 },   // a relief, not a sculpture: faces stay faces
      uScale: { value: 500 }, uCellW: { value: width / cols }, uDim: { value: 1 }, uOpacity: { value: 1 },
  };
  // two draws of the same grains: the cores write depth, the halos blend over them
  const pass = (halo) => new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: !halo, depthTest: true,
    uniforms: { ...uniforms, uHalo: { value: halo ? 1 : 0 } },
  });
  const coreMat = pass(false), haloMat = pass(true);
  const mats = [coreMat, haloMat];
  const group = new Group();
  const size = new Vector2();
  for (const [i, m] of mats.entries()) {
    const pts = new Points(geo, m);
    pts.frustumCulled = false;   // the box of a shader-placed cloud is not the geometry's
    pts.renderOrder = 2 + i;     // cores first
    pts.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(size);
      uniforms.uScale.value = size.y / (2 * Math.tan((camera.fov || 50) * Math.PI / 360));
    };
    group.add(pts);
  }
  const mat = { uniforms };
  return {
    object: group, aspect, width, height, count: n,
    // the distance at which the flat photo covers a screen of this aspect, seen square-on
    front(fovDeg = 50, screenAspect = 16 / 9) {
      const t = Math.tan(fovDeg * Math.PI / 360);
      return { dist: Math.min(height / 2 / t, width / 2 / (t * screenAspect)) };
    },
    set({ relief, dim, opacity } = {}) {
      if (relief != null) mat.uniforms.uRelief.value = relief;
      if (dim != null) mat.uniforms.uDim.value = dim;
      if (opacity != null) mat.uniforms.uOpacity.value = opacity;
    },
    get relief() { return mat.uniforms.uRelief.value; },
    dispose() { geo.dispose(); uniforms.uImg.value.dispose(); uniforms.uDepth.value.dispose(); for (const m of mats) m.dispose(); },
  };
}
