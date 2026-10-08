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
import { BufferGeometry, BufferAttribute, Points, ShaderMaterial, Texture, LinearFilter, SRGBColorSpace, Vector2 } from 'three';

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
varying vec3 vColor;
varying float vRelief;
void main() {
  float d = texture2D(uDepth, aCell).r;              // 1 near … 0 far
  vec3 p = uCenter + uRight * (aCell.x - 0.5) * uSize.x + uUp * (0.5 - aCell.y) * uSize.y
         + uNormal * (d - 0.5) * uDepthScale * uRelief;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // a grain a touch wider than its cell, so the flat photo closes; in relief
  // a little smaller, so the depth reads through the gaps
  gl_PointSize = clamp(uCellW * uScale / max(-mv.z, 0.05) * mix(1.25, 0.9, uRelief), 1.0, 24.0);
  vColor = texture2D(uImg, aCell).rgb;
  vRelief = uRelief;
}`;

const FRAG = /* glsl */`
uniform float uDim, uOpacity;
varying vec3 vColor;
varying float vRelief;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  // round grains in relief, closing to squares as the picture flattens
  float round = smoothstep(0.5, 0.36, length(q));
  float a = mix(1.0, round, smoothstep(0.0, 0.3, vRelief));
  if (a < 0.02) discard;
  // never brighter than the photo: in relief a grain is capped at luminance
  // 0.62, its true colour only as the picture flattens
  float lum = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 capped = vColor * min(1.0, 0.62 / max(lum, 1e-3));
  vec3 col = mix(vColor, capped, smoothstep(0.0, 0.5, vRelief)) * uDim;
  gl_FragColor = vec4(col, a * uOpacity);
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
  const mat = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, depthTest: true,
    uniforms: {
      uImg: { value: texture(image, true) }, uDepth: { value: texture(depth, false) },
      uRight: { value: right }, uUp: { value: [0, 1, 0] }, uNormal: { value: normal }, uCenter: { value: pos },
      uSize: { value: [width, height] }, uRelief: { value: relief },
      uDepthScale: { value: depthScale ?? width * 0.35 },   // a relief, not a sculpture
      uScale: { value: 500 }, uCellW: { value: width / cols }, uDim: { value: 1 }, uOpacity: { value: 1 },
    },
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;   // the box of a shader-placed cloud is not the geometry's
  points.renderOrder = 2;
  const size = new Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(size);
    mat.uniforms.uScale.value = size.y / (2 * Math.tan((camera.fov || 50) * Math.PI / 360));
  };
  return {
    object: points, aspect, width, height, count: n,
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
    dispose() { geo.dispose(); mat.uniforms.uImg.value.dispose(); mat.uniforms.uDepth.value.dispose(); mat.dispose(); },
  };
}
