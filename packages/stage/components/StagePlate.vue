<script setup>
import { ref, computed, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { plateUrls } from '../stage/fallback.js'

// The recorded plate (stage/fallback.js): where the world cannot run and the
// deck has its plates (slidev-stage-record --plate: NN-plate.mp4 beside the
// clips, the slide's arrival from the slide before it and a hold), the
// slide's plate plays muted under its text and holds its last frame.
// Stage.vue mounts it over the living still and under the scrim while the
// stage's layer is `plate`.
//
//   slide      the current slide's number
//   total      how many the deck has (no plate is asked for past the end)
//   dir, base, remote, localFirst
//              the chain (plateUrls): the deck's own copy under its base and
//              the release's, and which comes first
//   covered    a clip covers the slide: the plate pauses under it (Stage.vue
//              tracks slidev-videos:cover)
//
// One <video> per slide in a window of three, keyed by the slide's number so
// a step keeps the elements it has: the slide before (a back-step plays at
// once), this one, and the next, which loads under this slide so the advance
// is one cut. Only this slide's is seen, over the one before it. A plate with
// no frame yet is transparent, so the frame before stays until the plate's
// first — which the recorder began on exactly that frame — and at the deck's
// start the living still shows through; no poster, for the same reason. A
// URL that errors is let go for the next in the chain; a slide whose chain is
// exhausted (a clip slide has no plate: the clip is the picture) is given up
// for the session and said so (`exhausted`), and the living still stands
// alone there.
//
// On <html>, for the player's advance-on-end (video-dust/advance.js) and the
// tools: data-stage-plate = loading | playing | paused | held | none (this
// slide's), data-stage-plate-next = n+1 once the next slide's plate can play
// (removed while it cannot, and when there is none). Paused while covered
// and while the tab is hidden; `state` tells Stage.vue the same.

const props = defineProps({
  slide: { type: Number, default: 1 },
  total: { type: Number, default: 0 },
  dir: { type: String, default: 'videos' },
  base: { type: String, default: '/' },
  remote: { type: String, default: '' },
  localFirst: { type: Boolean, default: false },
  covered: { type: Boolean, default: false },
})
const emit = defineEmits(['state', 'exhausted'])

const KEEP_BEHIND = 1          // the slide before stays loaded: a back-step plays at once
const PRELOAD_AHEAD = 1        // the next loads under this slide
const tries = reactive({})     // slide → how far along its chain it is
const dead = reactive({})      // slide → true once no URL of its chain answered
const els = new Map()          // slide → its <video>
let said = ''

const urlsOf = (no) => plateUrls(props.dir, no, { base: props.base, remote: props.remote, localFirst: props.localFirst })
const srcOf = (no) => urlsOf(no)[tries[no] || 0] || ''
// the slides with a <video>: this one and a slide each side, in the deck, not given up
const slots = computed(() => {
  const out = []
  const last = props.total > 0 ? props.total : Infinity
  for (let n = props.slide - KEEP_BEHIND; n <= props.slide + PRELOAD_AHEAD; n++) if (n >= 1 && n <= last && !dead[n] && urlsOf(n).length) out.push(n)
  return out
})
const bind = (no, el) => { if (el) els.set(no, el); else els.delete(no) }

// this slide's plate, as the four states read it
function stateOf() {
  const no = props.slide
  if (dead[no] || !slots.value.includes(no)) return 'none'
  const el = els.get(no)
  if (!el) return 'loading'
  if (el.ended) return 'held'
  if (el.paused) return (props.covered || document.hidden) && el.readyState >= 2 ? 'paused' : 'loading'
  return el.readyState >= 3 ? 'playing' : 'loading'
}

function publish() {
  const html = document.documentElement
  const s = stateOf()
  html.dataset.stagePlate = s
  const next = props.slide + 1
  const el = els.get(next)
  if (el && !dead[next] && el.readyState >= 3) html.dataset.stagePlateNext = String(next)
  else delete html.dataset.stagePlateNext
  if (s !== said) { said = s; emit('state', s) }
}

// This slide's plays unless a clip covers it, the tab is hidden or it has
// ended (play() on an ended element would start it over); the others rest
// where they stand.
function sync() {
  const hidden = document.hidden
  for (const [no, el] of els) {
    if (no === props.slide) {
      if (props.covered || hidden || el.ended) { if (!el.paused) el.pause() }
      else if (el.paused) el.play().catch(() => {})
    } else if (!el.paused) el.pause()
  }
  publish()
}

// a URL that errors: the next in the chain (the src changes, the element loads it); none left: given up
function onError(no) {
  const i = (tries[no] || 0) + 1
  if (i < urlsOf(no).length) { tries[no] = i; return }
  dead[no] = true
  emit('exhausted', no)
  publish()
}

// a new slide: its plate from its arrival (the one before it under it until the first frame is in)
watch(() => props.slide, (n) => {
  publish()    // the next's mark moves at once: a back-step's next is loaded already, the old next is next no more
  nextTick(() => {
    const el = els.get(n)
    if (el && el.readyState > 0) { try { el.currentTime = 0 } catch { /* not seekable yet */ } }
    sync()
  })
})
watch(() => props.covered, () => sync())

onMounted(() => {
  document.addEventListener('visibilitychange', sync)
  nextTick(sync)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', sync)
  for (const el of els.values()) { try { el.pause() } catch { /* gone */ } }
  const html = document.documentElement
  delete html.dataset.stagePlate
  delete html.dataset.stagePlateNext
})
</script>

<template>
  <div class="plate" aria-hidden="true">
    <video v-for="no in slots" :key="no" :ref="(el) => bind(no, el)" :class="{ next: no === slide + 1 }" :src="srcOf(no)" muted playsinline preload="auto" disablepictureinpicture
      @error="onError(no)" @canplay="sync" @playing="sync" @pause="sync" @waiting="sync" @emptied="sync" @ended="sync"></video>
  </div>
</template>

<style scoped>
.plate { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
/* each plate fills the frame as the still does; in the deck's order, so this slide's is over the one before */
.plate video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
/* the next loads unseen */
.plate video.next { visibility: hidden; }
</style>
