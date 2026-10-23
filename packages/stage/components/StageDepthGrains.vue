<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { onSlideEnter, onSlideLeave, useSlideContext, useNav } from '@slidev/client'
import { Vector3 } from 'three'
import { sampleFrame, placeInDepth, loadDepth, makeDepthGrains, scaleLaw, poseCamera } from '../stage/depth-grains.js'
import { setSteps } from '../stage/steps.js'
import { whenGateOpen } from '../stage/gate.js'
import { handOverWithout, capShowsWord } from '../stage/fallback.js'

// <StageDepthGrains src="figures/lis_last.jpg" depth="figures/lis_last.depth.png"
//   camera="data/lis.json" :anchor="[x, y, z]" :cues="[…]"><h1>Ačiū</h1></StageDepthGrains>
//
// A clip's last frame hands over to the world. The slide opens on the still (the
// clip's last frame: nothing changes when the clip goes); under it the frame is
// already grains, each where its surface is in depth (stage/depth-grains.js), at
// `anchor` in the world. The still fades into them, and the slide's `path` pulls the
// camera back while the grains shrink to a mark (the camera JSON's `flagUV`, kept at
// `sKeep` units a metre). Along the way, cues fire on the camera's distance from the
// anchor, or once it has stopped, not on a timer (a slow machine's world runs behind
// the wall clock):
//   { dist: 3.2, set: { det: 1 } }                  a step on the step bus (<StageSteps>)
//   { dist: 13, emit: 'collision:start' }           a window event 'slidev-stage:cue', detail { name }
//   { stopped: true, set: { lhcbLogo: 1 }, fadeOut: 1500 }   once the camera stands: the grains fade out
// `reset` (set and emit) runs as the hand-over starts and when the slide is left for
// anywhere but the next one; `end` runs at its end state (also the next page opened
// directly). The slot (the word) shows `wordAfter` s after the camera stopped, by
// `wordBy` s at the latest.
// Without a running world (reduced motion, no WebGL, a lost context, a slow boot) the
// still stays and the word shows over it, unless the slide's recorded plate plays in
// the world's place (slidev-addon-stage 0.7): the plate filmed the grains coming in
// with the still hidden, so the still fades onto it after `hold`, as live, and is gone
// once the plate holds the settled world, where the word shows (handOverWithout,
// stage/fallback.js, on html[data-stage-layer] and [data-stage-plate]); printed, in the overview and the presenter's
// previews it is the still and the word. Nothing loads before the stage gate opens
// (setStageGate, stage/gate.js). From Innoday's <LisTakeover> (Oct 2026), the light
// injection system's hand-over its first use.
const props = defineProps({
  src: { type: String, required: true },
  depth: { type: String, required: true },
  camera: { type: [String, Object], required: true },   // the still's camera: a JSON path, or the object
  anchor: { type: Array, required: true },   // the mark's place in the world
  d0: { type: Number, default: 2.4 },        // the camera's start distance from the anchor, units (the slide's path[0])
  sEnd: { type: Number, default: 2.5 },      // units a metre at the path's farthest key
  sKeep: { type: Number, default: 20 },      // … and the kept polygon's (the mark), so it stays visible
  grains: { type: Number, default: 320000 }, // at tier 0; fewer on a lower tier
  gain: { type: Number, default: 0.92 },
  hold: { type: Number, default: 400 },      // ms of still before the fade
  fade: { type: Number, default: 1400 },     // ms
  cues: { type: Array, default: () => [] },
  reset: { type: Object, default: () => ({}) },
  end: { type: Object, default: () => ({}) },
  hole: { type: Object, default: null },     // { name: 'det', r: 0.1 }: that detector dims round the mark until the fade-out
  prewarm: { type: String, default: 'slidev-stage:prewarm' },   // dispatched as it starts: forms drawn hidden for a few frames
  wordAfter: { type: Number, default: 3.2 },
  wordBy: { type: Number, default: 34 },
  alt: { type: String, default: '' },
})
const { $renderContext, $page, $frontmatter } = useSlideContext()
const nav = useNav()
const base = import.meta.env.BASE_URL
const url = (p) => (p.startsWith('/') || /^https?:/.test(p)) ? p : base + p
const live = computed(() => $renderContext?.value === 'slide')
const page = () => $page?.value ?? $page
const still = ref(true)
const fading = ref(false)
const word = ref(false)
const emit = (name) => { if (name) try { window.dispatchEvent(new CustomEvent('slidev-stage:cue', { detail: { name } })) } catch {} }
const run1 = (c) => { if (c?.set) setSteps(c.set); [].concat(c?.emit || []).forEach(emit) }

let loading = null
const load = () => (loading ||= new Promise((resolve) => whenGateOpen(resolve)).then(async () => {
  try {
    const meta = typeof props.camera === 'string' ? await (await fetch(url(props.camera))).json() : props.camera
    const img = new Image()
    img.src = url(props.src)
    await img.decode()
    const depth = await loadDepth(url(props.depth), meta)
    return { img, depth, meta }
  } catch (e) { console.warn('StageDepthGrains:', e); return null }
}))

function stage() {
  const rootEl = document.querySelector('.stage')
  if (rootEl?.dataset.stageFallback) return null
  const canvas = rootEl?.querySelector('canvas')
  const api = rootEl?.__space, h = canvas?.__space
  const camera = h?.composer?.passes?.[0]?.camera
  if (!api || !h?.scene || !camera) return null
  return { api, h, camera }
}
let run = 0, timers = [], watcher = 0, marks = null
const fellBack = () => !!document.documentElement.dataset.stageFallback
async function waitStage(id) {
  for (let i = 0; i < 80; i++) {
    const s = stage()
    if (s || id !== run || fellBack()) return s
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}
const later = (ms, fn) => timers.push(setTimeout(fn, ms))
const clear = () => { timers.forEach(clearTimeout); timers = []; clearInterval(watcher); watcher = 0; marks?.disconnect(); marks = null }

const A = new Vector3(...props.anchor)
const NAME = 'depth-grains:' + page()
function farthest() {
  const sp = $frontmatter?.value?.space ?? $frontmatter?.space
  let far = 0
  for (const [, k] of sp?.path || []) if (k && Array.isArray(k.at)) far = Math.max(far, poseCamera(k).distanceTo(A))
  return far || 22
}
const holeU = (s) => (props.hole ? s?.h.scene.getObjectByName('detector:' + props.hole.name)?.children[0]?.material.uniforms.uHole : null)

const SHARE = [1, 0.7, 0.4, 0.25]
let made = null
function grains(s, got) {
  const tier = s.h.tier ?? 0
  if (!made || made.tier !== tier) {
    const k = SHARE[Math.min(SHARE.length - 1, tier)]
    // the grains add up to the frame's own colours: each pixel weighed by its brightest
    // channel, each grain its pixel's full hue; near-black gives none
    const sample = sampleFrame(got.img, { n: Math.round(props.grains * k), gamma: 1.2, floor: 0.06, sat: 1.0, weight: 'max', norm: 1 })
    made = { tier, sample, placed: placeInDepth(sample, got.depth, got.meta), size: 0.06 / Math.sqrt(k) }
  }
  const s0 = props.d0 / got.meta.flagDist
  let pts = s.h.scene.getObjectByName(NAME)
  if (pts && pts.userData.tier !== tier) { s.h.scene.remove(pts); pts.geometry.dispose(); pts.material.dispose(); pts = null }
  if (!pts) {
    pts = makeDepthGrains(made.sample, made.placed, { s0, size: made.size, gain: props.gain, name: NAME })
    pts.userData.tier = tier
    s.h.scene.add(pts)
  }
  const law = scaleLaw({ s0, d0: props.d0, sEnd: props.sEnd, dEnd: farthest() })
  pts.userData.scale = (cam, un) => {
    const sc = law(cam.position.distanceTo(A))
    un.uScale.value = sc
    un.uScaleFlag.value = Math.max(sc, props.sKeep)
    un.uRest.value = Math.min(1, Math.max(0, (sc - props.sKeep * 0.5) / (props.sKeep * 1.2)))
  }
  pts.material.uniforms.uAnchor.value.copy(A)
  return pts
}

// Where the world cannot run: the still and the word follow the layer and the slide's
// plate as Stage.vue and StagePlate.vue mark them on <html> (loading → playing → held,
// or the plate given up for the living still), until the slide is left
// A plate that never loads (a hanging URL) shows the word by LOADING_CAP, as v0.9.0
// did after waiting for a world, not at wordBy; a plate playing then is the arrival
// the recorder filmed, and its word waits for its end (capShowsWord).
const LOADING_CAP = 8000
function without(id) {
  const html = document.documentElement
  let played = false, holdTimer = 0
  const follow = () => {
    if (id !== run) return
    played ||= html.dataset.stageLayer === 'plate' && ['playing', 'held'].includes(html.dataset.stagePlate)
    const h = handOverWithout(html.dataset.stageLayer, html.dataset.stagePlate, { played })
    if (h.word) word.value = true
    if (h.still === 'gone') still.value = false
    else if (h.still === 'stay') { still.value = true; fading.value = false; clearTimeout(holdTimer); holdTimer = 0; played = false }
    else if (!holdTimer && !fading.value) { holdTimer = setTimeout(() => { if (id === run) fading.value = true }, props.hold); timers.push(holdTimer) }
  }
  const cap = () => {
    if (id !== run) return
    if (!capShowsWord(html.dataset.stagePlate, played)) return later(500, cap)
    word.value = true
  }
  later(LOADING_CAP, cap)
  marks = new MutationObserver(follow)
  marks.observe(html, { attributes: true, attributeFilter: ['data-stage-layer', 'data-stage-plate'] })
  // a task on: at slide enter <html> may still carry the slide before's plate (`held`
  // at its end) until StagePlate's own watch has published this slide's
  later(0, follow)
}

// the stage falls back after the hand-over began (a context lost for good, a rebuild
// whose boot fails): this slide goes over to the plate or the still at once
const onFallback = () => {
  if (!live.value || nav.currentSlideNo?.value !== page()) return
  const id = ++run
  clear()
  still.value = true; fading.value = false
  without(id)
}

async function takeOver() {
  const id = ++run
  clear()
  still.value = true; fading.value = false; word.value = false
  run1(props.reset)
  const s0 = stage(), hole = holeU(s0)
  if (hole) hole.value.w = props.hole.r ?? 0.1
  try { window.dispatchEvent(new Event(props.prewarm)) } catch {}
  later(props.wordBy * 1000, () => { if (id === run) word.value = true })
  if (fellBack()) return without(id)
  const s = await waitStage(id)
  if (id !== run || !live.value) return
  if (!s && fellBack()) return without(id)
  const got = s ? await load() : null
  if (id !== run || !live.value) return
  if (!s || !got) { word.value = true; return }
  const pts = grains(s, got)
  const u = pts.material.uniforms
  u.uReveal.value = 0; u.uFade.value = 1
  pts.visible = true; pts.userData.gone = false
  later(props.hold, () => {
    if (id !== run) return
    fading.value = true
    const t0 = performance.now()
    const step = (now) => {
      if (id !== run) return
      const k = Math.min(1, (now - t0) / props.fade)
      u.uReveal.value = k
      if (k < 1) requestAnimationFrame(step)
      else still.value = false
    }
    requestAnimationFrame(step)
  })
  const byDist = props.cues.filter((c) => Number.isFinite(c.dist)).map((c) => ({ ...c, done: false }))
  const onStop = props.cues.filter((c) => c.stopped)
  let stopped = -1
  watcher = setInterval(() => {
    if (id !== run) return
    const d = s.camera.position.distanceTo(A)
    for (const c of byDist) if (!c.done && d > c.dist) { c.done = true; run1(c) }
    // stopped: every distance cue has fired and the camera stands
    if (stopped < 0 && byDist.every((c) => c.done) && !s.api.flying) {
      stopped = performance.now()
      onStop.forEach(run1)
      const out = onStop.find((c) => c.fadeOut)?.fadeOut
      if (out) {
        const t0 = performance.now(), h = holeU(s), r0 = h?.value.w ?? 0
        const step = (now) => {
          if (id !== run) return
          const k = Math.min(1, (now - t0) / out)
          u.uFade.value = 1 - k
          if (h) h.value.w = r0 * (1 - k)
          if (k < 1) requestAnimationFrame(step)
          else { pts.visible = false; pts.userData.gone = true }
        }
        requestAnimationFrame(step)
      }
    }
    if (stopped >= 0 && performance.now() - stopped > props.wordAfter * 1000) { word.value = true; clearInterval(watcher); watcher = 0 }
  }, 100)
}

function endState(s, pts) {
  if (pts) { pts.material.uniforms.uFade.value = 0; pts.visible = false; pts.userData.gone = true }
  const h = holeU(s)
  if (h) h.value.w = 0
  run1(props.end)
}
async function showEnd() {
  const id = ++run
  const s = await waitStage(id)
  if (id !== run || !s || nav.currentSlideNo?.value !== page() + 1) return
  endState(s, s.h.scene.getObjectByName(NAME))
}

onSlideEnter(() => { if (live.value) takeOver() })
onSlideLeave(() => {
  if (!live.value) return
  run++; clear()
  const p = stage()?.h.scene.getObjectByName(NAME)
  if (p) p.material.uniforms.uReveal.value = 1
  if (nav.currentSlideNo?.value === page() + 1) endState(stage(), p)
  else run1(props.reset)
})
const onRebuilt = () => {
  if (!live.value) return
  const n = nav.currentSlideNo?.value
  made = null
  if (n === page()) takeOver()
  else if (n === page() + 1) showEnd()
}
onMounted(() => {
  window.addEventListener('slidev-stage:rebuilt', onRebuilt)
  window.addEventListener('slidev-stage:fallback', onFallback)
  if (live.value && nav.currentSlideNo?.value === page()) takeOver()
})
onUnmounted(() => {
  window.removeEventListener('slidev-stage:rebuilt', onRebuilt)
  window.removeEventListener('slidev-stage:fallback', onFallback)
  run++; clear()
})
watch(() => nav.currentSlideNo?.value, (n) => {
  if (!live.value) return
  const p = stage()?.h.scene.getObjectByName(NAME)
  if (p) p.visible = n === page() && !p.userData.gone
  if (n === page() + 1 && (!p || !p.userData.gone)) showEnd()
}, { immediate: true })
</script>

<template>
  <div class="stage-depth-grains">
    <img v-if="still" class="sdg-still" :class="{ fading }" :src="url(src)" :style="{ transitionDuration: fade + 'ms' }" :alt="alt" />
  </div>
  <div class="sdg-word" :class="{ on: word || !live || nav.isPrintMode?.value }"><slot /></div>
</template>

<style>
.stage-depth-grains { position: absolute; inset: 0; pointer-events: none; }
.stage-depth-grains .sdg-still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 1; transition-property: opacity; transition-timing-function: ease-in; }
.stage-depth-grains .sdg-still.fading { opacity: 0; }
html.print .stage-depth-grains .sdg-still { opacity: 1; }
.sdg-word { opacity: 0; transition: opacity 0.8s ease; }
.sdg-word.on, html.print .sdg-word { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .sdg-word { opacity: 1; transition: none; } }
</style>
