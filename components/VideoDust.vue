<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { createDust } from './video-dust/gl.js'
import { registerOverlay } from './video-dust/bus.js'

// The particle layer of the `dust` video transition: one transparent canvas
// over the slide, mounted by the addon's own global-top.vue (Slidev loads
// global layers from every addon root, so a deck adds nothing). It draws only
// while a clip is arriving or leaving and is `display: none` the rest of the
// time; the WebGL context is made on first use, so a deck that never asks for
// `dust` never pays for it.

const canvas = ref(null)
const shown = ref(false)
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

const api = {
  get available() { return !failed },
  enter: (opts) => start('enter', opts),
  leave: (opts) => start('leave', opts),
  cancelAll: () => dust?.cancelAll(),
}

onMounted(() => { unregister = registerOverlay(api) })
onUnmounted(() => {
  unregister?.()
  dust?.dispose()
  dust = null
})
</script>

<template>
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
</style>
