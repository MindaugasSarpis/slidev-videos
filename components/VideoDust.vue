<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { createDust, pushScale } from './video-dust/gl.js'
import { registerOverlay } from './video-dust/bus.js'

// The particle layer of the `dust` video transition: one transparent canvas
// over the slide, mounted by the addon's own global-top.vue (Slidev loads
// global layers from every addon root, so a deck adds nothing). It draws only
// while a clip is arriving or leaving and is `display: none` the rest of the
// time; the WebGL context is made on first use, so a deck that never asks for
// `dust` never pays for it.

const canvas = ref(null)
const shown = ref(false)
const zoomCanvas = ref(null)
const zooming = ref(false)
let zoomRaf = 0
let dust = null
let failed = false
let unregister = null

function renderer() {
  if (dust || failed || !canvas.value) return dust
  dust = createDust(canvas.value)
  if (!dust) { failed = true; return null }
  dust.onIdle = () => { shown.value = false }
  return dust
}

// The canvas must be laid out before a sheet measures it.
function start(kind, opts) {
  const d = renderer()
  if (!d) return null
  shown.value = true
  canvas.value.style.display = 'block'
  const handle = d[kind](opts)
  if (!handle && !d.active) shown.value = false
  return handle
}

// exit="push": the live clip, zoomed into `via` as the dust's push plane comes
// at the lens (pushScale), on a 2D canvas under the grains. A 2D canvas may
// show a clip from another origin (a release) that WebGL may not read, so the
// travelling shot carries on through the push. It fades as the grains take
// over (u 0.5 → 0.85).
function zoom({ video, rect, uv, via, duration }) {
  const c = zoomCanvas.value
  if (!c || !video) return
  cancelAnimationFrame(zoomRaf)
  zooming.value = true
  c.style.display = 'block'
  const t0 = performance.now()
  const step = (now) => {
    const u = Math.min(1, (now - t0) / duration)
    const box = c.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(box.width * dpr), h = Math.round(box.height * dpr)
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    const g = c.getContext('2d')
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, w, h)
    const vw = video.videoWidth, vh = video.videoHeight
    if (vw && vh && u < 1) {
      const x = (rect.left - box.left) * dpr, y = (rect.top - box.top) * dpr, rw = rect.width * dpr, rh = rect.height * dpr
      const px = x + (via[0] - uv[0]) / uv[2] * rw, py = y + (via[1] - uv[1]) / uv[3] * rh
      const k = pushScale(u)
      g.globalAlpha = 1 - Math.min(1, Math.max(0, (u - 0.5) / 0.35))
      g.setTransform(k, 0, 0, k, px - k * px, py - k * py)
      try { g.drawImage(video, uv[0] * vw, uv[1] * vh, uv[2] * vw, uv[3] * vh, x, y, rw, rh) } catch { /* not ready */ }
    }
    if (u < 1) zoomRaf = requestAnimationFrame(step)
    else { zooming.value = false; c.style.display = 'none' }
  }
  zoomRaf = requestAnimationFrame(step)
}

const api = {
  get available() { return !failed },
  enter: (opts) => start('enter', opts),
  leave: (opts) => start('leave', opts),
  zoom,
  cancelAll: () => { dust?.cancelAll(); cancelAnimationFrame(zoomRaf); zooming.value = false },
}

onMounted(() => { unregister = registerOverlay(api) })
onUnmounted(() => {
  unregister?.()
  dust?.dispose()
  dust = null
  cancelAnimationFrame(zoomRaf)
})
</script>

<template>
  <canvas ref="zoomCanvas" class="video-zoom" aria-hidden="true" :style="{ display: zooming ? 'block' : 'none' }"></canvas>
  <canvas
    ref="canvas"
    class="video-dust"
    aria-hidden="true"
    data-dust="idle"
    :style="{ display: shown ? 'block' : 'none' }"
  ></canvas>
</template>

<style scoped>
.video-dust {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 40;
}
.video-zoom {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 39;
}
</style>
