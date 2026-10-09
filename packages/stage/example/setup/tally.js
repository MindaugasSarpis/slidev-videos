import { Group, Points, BufferGeometry, BufferAttribute, ShaderMaterial, AdditiveBlending, Color } from 'three'

// The example deck's own builder, written the way a talk writes one: `tally`,
// a square of `count` grains. arm() lifts them into the dust above the
// square, assemble() lets them fall into place one after another over
// `seconds`, and api.value() says how many have landed, which
// <StageCount for="<name>"> shows while its slide is up.
//
//   { type: tally, name: grains, pos, count?: 400, gap?: 0.34, seconds?: 3.2, color? }

const VERT = /* glsl */ `
attribute vec3 aFrom;
attribute float aAt;
uniform float uU, uTime, uPixelRatio;
varying float vAlpha;
void main() {
  float k = clamp((uU - aAt) / 0.25, 0.0, 1.0);   // this grain's fall: 0 aloft, 1 landed
  k = k * k * (3.0 - 2.0 * k);
  vec4 mv = modelViewMatrix * vec4(mix(aFrom, position, k), 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPixelRatio * (1.3 + 1.1 * k) * (72.0 / max(-mv.z, 0.1));
  vAlpha = mix(0.3, 0.9, k) * (0.8 + 0.2 * sin(uTime * 2.0 + aAt * 40.0));
}`
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float a = (1.0 - smoothstep(0.04, 0.5, length(gl_PointCoord - 0.5))) * vAlpha;
  gl_FragColor = vec4(pow(uColor * a, vec3(2.2)), 1.0);   // linear light; additive with alpha 1
}`

export function buildTally(o, ctx) {
  const n = Math.max(1, Math.round(o.count ?? 400)), side = Math.ceil(Math.sqrt(n)), gap = o.gap ?? 0.34
  const home = new Float32Array(n * 3), from = new Float32Array(n * 3), at = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i % side - (side - 1) / 2) * gap, z = (Math.floor(i / side) - (side - 1) / 2) * gap
    home.set([x, 0, z], i * 3)
    from.set([x + ctx.helpers.gauss() * 3, 5 + Math.random() * 5, z + ctx.helpers.gauss() * 3], i * 3)
    at[i] = (i / n) * 0.75   // grain i sets out three quarters of the way through, at the latest
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(home, 3))
  geo.setAttribute('aFrom', new BufferAttribute(from, 3))
  geo.setAttribute('aAt', new BufferAttribute(at, 1))
  const uniforms = {
    uU: { value: 1 }, uTime: { value: 0 }, uPixelRatio: { value: 1 },
    uColor: { value: new Color(o.color || ctx.palette.accent) },
  }
  const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending })
  const points = new Points(geo, mat)
  points.frustumCulled = false
  const group = new Group()
  group.name = 'tally'
  group.add(points)
  group.position.copy(ctx.helpers.v3(o.pos))

  const seconds = o.seconds ?? 3.2
  let t0 = -1, onDone = null
  const api = {
    arm() { t0 = -1; onDone = null; uniforms.uU.value = 0 },
    assemble(now, done) { t0 = now; onDone = done || null; uniforms.uU.value = 0 },
    get assembling() { return t0 >= 0 },
    // grains landed: the last one lands when uU reaches 1
    value() { return Math.round(n * Math.min(1, Math.max(0, (uniforms.uU.value - 0.25) / 0.75))) },
  }
  return {
    group, api, pixelRatio: uniforms.uPixelRatio,
    update(t) {
      uniforms.uTime.value = t
      if (t0 < 0) return
      const u = Math.min((t - t0) / seconds, 1)
      uniforms.uU.value = u
      if (u >= 1) { t0 = -1; const cb = onDone; onDone = null; cb?.() }
    },
  }
}
