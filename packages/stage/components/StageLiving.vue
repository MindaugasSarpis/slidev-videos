<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { configs } from '@slidev/client'
import { livingPose, livingGrains, livingColours, GRAIN_BIG } from '../stage/living.js'

// The living still (stage/living.js): where the world cannot run, the
// slide's still breathes. Stage.vue mounts it in the still's place under the
// scrim, and under a plate while that loads. The still is an <img> that
// drifts on a CSS transform alone (composited: it never repaints), and over
// it one 2D canvas draws some hundreds of grains of the palette's dust,
// additive, at 30 fps and no more. Points of light over the still and
// nothing else: it must read as the still breathing, not as an effect.
//
//   src       the still's URL (stage/stills.js); none: the grains alone over the ground
//   seed      the slide's number: the way its drift leans, and the still at
//             rest again when it changes (each slide begins on its own
//             framing); the grains keep drifting across slides
//   covered   a clip covers the slide: nothing moves under it (Stage.vue
//             tracks slidev-videos:cover)
//   motion    `stage.motion`: 'respect' (the default) stops it entirely under
//             prefers-reduced-motion — the still at rest, no canvas; 'floor'
//             lets it breathe there too
//
// Paused with the tab hidden; the clock stops with it, so nothing jumps on
// return. The root carries data-living = running | paused | off and
// data-frames (how many it has drawn) for the tools and the smoke test; a
// still that fails to load is reported as `error`, as Stage.vue's own.

const props = defineProps({
  src: { type: String, default: '' },
  seed: { type: Number, default: 0 },
  covered: { type: Boolean, default: false },
  motion: { type: String, default: 'respect' },
})
const emit = defineEmits(['error'])

const CFG = (configs && configs.stage && typeof configs.stage === 'object') ? configs.stage : {}
const GRAINS = 600
const FPS = 30
const DPR_MAX = 1.5          // a machine without WebGL2 is not one to ask for a 4K canvas
const [LO, HI] = livingColours(CFG.palette)
const rgb = (c) => `rgb(${c.join(', ')})`
const wrap = (v) => v - Math.floor(v)

const root = ref(null)
const img = ref(null)
const canvas = ref(null)
const off = ref(false)       // reduced motion, respected: the still at rest, no canvas

// one field for the whole deck, in two colours: the few large grains bright
const grains = livingGrains(GRAINS, props.seed)
const dim = grains.filter((g) => g.size < GRAIN_BIG)
const bright = grains.filter((g) => g.size >= GRAIN_BIG)
let raf = 0
let breath = 0               // seconds this still has been breathing (not while paused)
let drift = 0                // seconds the grains have drifted: never reset, so the field is one across slides
let lastAt = 0               // performance.now() of the last frame taken
let frames = 0

function frame(now) {
  raf = requestAnimationFrame(frame)
  if (now - lastAt < 1000 / FPS - 2) return     // every other frame at 60 Hz, every fourth at 120
  const paused = props.covered || document.hidden
  const r = root.value
  if (r) r.dataset.living = paused ? 'paused' : 'running'
  // the clock runs only while drawn, and never jumps: a stalled or hidden tab resumes where it stopped
  const dt = paused || !lastAt ? 0 : Math.min((now - lastAt) / 1000, 0.1)
  lastAt = now
  if (paused) return
  breath += dt
  drift += dt
  const pose = livingPose(breath, props.seed)
  if (img.value) img.value.style.transform = `translate(${(pose.dx * 100).toFixed(4)}%, ${(pose.dy * 100).toFixed(4)}%) scale(${pose.scale.toFixed(5)})`
  draw(drift)
  frames++
  if (r) r.dataset.frames = String(frames)
}

function draw(time) {
  const c = canvas.value, r = root.value
  if (!c || !r) return
  const rr = r.getBoundingClientRect()
  if (rr.width < 2) return
  const dpr = Math.min(devicePixelRatio || 1, DPR_MAX)
  const W = Math.round(rr.width * dpr), H = Math.round(rr.height * dpr)
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  const u = (rr.width / 980) * dpr      // slide px → canvas px, as the halo's
  for (const [colour, set] of [[LO, dim], [HI, bright]]) {
    ctx.fillStyle = rgb(colour)
    for (const g of set) {
      // adrift: a slow rise with a sway, wrapped at the frame's edge; its light swells and fades by its own phase
      const x = wrap(g.x + 0.006 * Math.sin(time * 0.13 * g.speed + g.phase))
      const y = wrap(g.y - time * 0.004 * g.speed)
      const tw = 0.55 + 0.45 * Math.sin(time * (0.5 + g.speed) + g.phase)
      ctx.globalAlpha = (0.16 + 0.22 * Math.min(g.size / 1.35, 1)) * tw
      ctx.beginPath()
      ctx.arc(x * W, y * H, Math.max(g.size * u, 0.5), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

// a new slide: its still begins on its own framing
watch(() => props.seed, () => { breath = 0; if (img.value) img.value.style.transform = '' })

onMounted(() => {
  off.value = props.motion !== 'floor' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (root.value) root.value.dataset.living = off.value ? 'off' : 'paused'
  if (off.value) return
  raf = requestAnimationFrame(frame)
})
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <div ref="root" class="living" aria-hidden="true">
    <img v-if="src" ref="img" class="still" :src="src" alt="" decoding="async" @error="emit('error', $event)" />
    <canvas v-if="!off" ref="canvas"></canvas>
  </div>
</template>

<style scoped>
.living { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
/* the still fills the frame as Stage.vue's does; its drift is a transform alone, so it never repaints */
.living .still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; will-change: transform; }
/* a slide's space.ambient fades the grains with the world, as it does the halo */
.living canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: var(--stage-ambient, 1); }
</style>
