<script setup>
// StagePhoto — a full-bleed photograph that arrives and leaves like a clip:
// it condenses out of grains coloured from the image itself (read when it
// loads; no strip file) and breaks back into them as the slide is left.
//
//   <StagePhoto src="/figures/x.jpg" focus="30% 50%" class="right">
//     <div class="hero-text">…</div>
//     <div class="credit">…</div>
//   </StagePhoto>
//
// The markup is the kit's `.hero` (a div.hero with the <img> and the slot over
// it), so a talk's `.hero` styles (gradients, .hero-text, .credit, .right,
// .low) apply as they are. Only the audience's slide moves: the presenter
// window, the overview, the next-slide preview, print and reduced motion show
// the plain image.
//
// Headmatter defaults: `videos.dust` (grain colour in flight), `videos.dustMs`
// ([arrive, leave]), `videos.dustStyle` (frame | flight).
//
// Room for `depth` (2.5D parallax from a depth map, driven by the stage
// camera): it will take over the picture once the photo has arrived; the dust
// arrival and leaving stay as they are.
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useIsSlideActive, useNav, useSlideContext, configs } from '@slidev/client'
import { getOverlay, announce, meanColor } from './video-dust/bus.js'

const CFG = (configs && configs.videos) || {}

const props = defineProps({
  src:    { type: String, required: true },
  alt:    { type: String, default: '' },
  // object-position of the crop, as in CSS ("30% 50%"); also `--focus`
  focus:  { type: String, default: '50% 50%' },
  // frame (grains fill the frame and condense in place) | flight (a card
  // that flies in) | none (no grains: the plain image). Default videos.dustStyle, else frame.
  dust:   { type: String, default: '' },
  // the grains' colour in flight; default videos.dust
  color:  { type: String, default: '' },
  // arrival duration in ms, or [arrive, leave]; default videos.dustMs
  dustMs: { type: [Number, Array], default: undefined },
  fit:    { type: String, default: 'cover' },
  // The slot (headline, credit) waits for the picture: hidden while the
  // grains gather, in over 300 ms once the sharp image is up, and out in
  // 250 ms before the picture breaks up; so two headlines never show at once.
  // `false` leaves the slot to the deck's own transition.
  holdText: { type: Boolean, default: true },
})
const SLOT_IN_MS = 300
const SLOT_OUT_MS = 250

const STYLES = ['frame', 'flight', 'none']
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const mode = computed(() => {
  const m = String(props.dust || CFG.dustStyle || 'frame').toLowerCase()
  return STYLES.includes(m) ? m : 'frame'
})
const ms = computed(() => {
  const v = props.dustMs ?? CFG.dustMs
  const a = Array.isArray(v) ? v.map(Number) : [Number(v), NaN]
  return { enter: a[0] > 0 ? a[0] : 1900, leave: a[1] > 0 ? a[1] : 1700 }
})
const grainColor = computed(() => props.color || CFG.dust || '#7dd3fc')

const isActive = useIsSlideActive()
const { isPrintMode } = useNav()
const { $renderContext } = useSlideContext()
// grains only on the audience's slide
const moving = computed(() => mode.value !== 'none' && !REDUCED_MOTION && $renderContext.value === 'slide' && !isPrintMode?.value)

const rootRef = ref(null)
const imgRef = ref(null)
const revealed = ref(true)     // the sharp <img> is showing
const slotOn = ref(true)       // the slot is showing
const instant = ref(false)     // hide at once (no hand-over)
const leaving = ref(false)     // going under a leaving sheet
let run = 0
let sheet = null
let shown = false

function focusFractions() {
  const m = String(props.focus).match(/(-?[\d.]+)%\s+(-?[\d.]+)%/)
  return m ? [Number(m[1]) / 100, Number(m[2]) / 100] : [0.5, 0.5]
}
// The box the picture fills (the slide's own, which holds still while a page
// transition moves the slide), and the part of the image that shows in it.
function geometry() {
  const wrap = rootRef.value, img = imgRef.value
  if (!wrap || !img || !img.naturalWidth) return null
  let box = wrap.getBoundingClientRect()
  const stage = wrap.closest('#slide-content') || wrap.closest('.slidev-slide-content')
  const sb = stage?.getBoundingClientRect()
  if (sb && sb.width > 2 && (box.width < 2 || (Math.abs(box.width - sb.width) < 2 && Math.abs(box.height - sb.height) < 2))) box = sb
  if (box.width < 2 || box.height < 2) return null
  const vw = img.naturalWidth, vh = img.naturalHeight
  const rect = { left: box.left, top: box.top, width: box.width, height: box.height }
  if (props.fit === 'contain') {
    const k = Math.min(box.width / vw, box.height / vh)
    const w = vw * k, h = vh * k
    return { rect: { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h }, uv: [0, 0, 1, 1] }
  }
  const k = Math.max(box.width / vw, box.height / vh)
  const fx = box.width / (vw * k), fy = box.height / (vh * k)
  const [px, py] = focusFractions()
  return { rect, uv: [(1 - fx) * px, (1 - fy) * py, fx, fy] }
}
function loaded() {
  const img = imgRef.value
  if (!img) return Promise.resolve(false)
  if (img.complete && img.naturalWidth) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (ok) => { img.removeEventListener('load', onOk); img.removeEventListener('error', onErr); resolve(ok) }
    const onOk = () => done(true), onErr = () => done(false)
    img.addEventListener('load', onOk)
    img.addEventListener('error', onErr)
  })
}

const holding = computed(() => moving.value && props.holdText)

async function enter() {
  const id = ++run
  shown = false
  if (!moving.value) { revealed.value = true; slotOn.value = true; shown = true; return }
  instant.value = true
  revealed.value = false
  if (holding.value) slotOn.value = false
  await nextTick()             // laid out before measuring
  instant.value = false
  const ok = await loaded()
  if (id !== run) return
  const overlay = getOverlay()
  const g = ok && geometry()
  let handle = null
  if (overlay && g) {
    announce('transition', { phase: 'enter', mode: 'dust', src: props.src, duration: ms.value.enter })
    handle = overlay.enter({ image: imgRef.value, rect: g.rect, uv: g.uv, dust: grainColor.value, style: mode.value,
                             duration: ms.value.enter, source: 'image' })
  }
  if (id !== run) { handle?.cancel(); return }
  sheet = handle
  if (handle) {
    await handle.assembled
    if (id !== run) return
  }
  sheet?.release(450)
  sheet = null
  revealed.value = true
  slotOn.value = true          // in with the gradient, over SLOT_IN_MS
  shown = true
}

function leave() {
  const id = ++run
  sheet?.cancel()
  sheet = null
  const wasShown = shown
  shown = false
  if (!moving.value || !wasShown) { revealed.value = true; slotOn.value = !holding.value; return }
  // The words go first: the sheet comes up over the picture at once (the deck
  // may take the slide away any moment) and holds it whole while they fade,
  // then breaks up.
  if (holding.value) slotOn.value = false
  const overlay = getOverlay()
  const g = geometry()
  const handle = overlay && g
    ? overlay.leave({ image: imgRef.value, rect: g.rect, uv: g.uv, dust: grainColor.value, style: mode.value,
                      duration: ms.value.leave, source: 'image', hold: holding.value ? SLOT_OUT_MS : 0 })
    : null
  // the world takes the picture's colour, as it does a clip's
  announce('transition', { phase: 'leave', mode: 'dust', src: props.src, duration: ms.value.leave,
                           color: handle ? meanColor(imgRef.value) : null })
  if (handle) {
    leaving.value = true       // the picture goes under the sheet as it comes up (0.2 s)
    revealed.value = false
    handle.done.then(() => { if (id === run) { leaving.value = false; revealed.value = true; slotOn.value = !holding.value } })
  }
}

watch(isActive, (on) => { on ? enter() : leave() })
// a slide that is not up yet waits with its words hidden, so they cannot show
// before its arrival runs (a preloaded slide, the deck's fade)
onMounted(() => { if (isActive.value) enter(); else if (holding.value) slotOn.value = false })
onUnmounted(() => { run++; sheet?.cancel(); sheet = null })
</script>

<template>
  <div ref="rootRef" class="hero stage-photo" :class="{ 'stage-photo-moving': moving, 'stage-photo-held': !revealed, 'stage-photo-instant': instant, 'stage-photo-leaving': leaving }"
       :style="{ '--focus': focus }" :data-photo-phase="revealed ? 'shown' : 'held'">
    <img ref="imgRef" :src="src" :alt="alt" :class="{ contain: fit === 'contain' }" decoding="async" />
    <div class="stage-photo-slot" :class="{ 'stage-photo-slot-off': !slotOn }"><slot /></div>
  </div>
</template>

<style>
/* Full bleed on its own; a talk's .hero styles add to it. The slot's box is
   the photo's, so `.hero .hero-text` and `.credit` place as before; it sits
   above the hero's gradient (::after). */
.stage-photo > .stage-photo-slot { position: absolute; inset: 0; z-index: 1; pointer-events: none; transition: opacity 300ms ease; }
.stage-photo > .stage-photo-slot > * { pointer-events: auto; }
.stage-photo > .stage-photo-slot.stage-photo-slot-off { opacity: 0; transition: opacity 250ms ease; }
.stage-photo { position: absolute; inset: 0; overflow: hidden; }
.stage-photo > img {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: var(--focus, 50% 50%);
}
.stage-photo > img.contain { object-fit: contain; }
/* With grains, they are the arrival: no CSS entrance on the picture, which
   shows once the sheet is whole (a 450 ms hand-over), or goes at once under
   a leaving sheet. */
html .stage-photo.stage-photo-moving > img { animation: none; transition: opacity 450ms ease; }
html .stage-photo.stage-photo-held > img { opacity: 0; }
/* and, as for a clip, no ground until the picture is up: the world shows
   through while the grains gather */
html .stage-photo.stage-photo-held { background: transparent; }
html .stage-photo.stage-photo-held::after { opacity: 0; }
html .stage-photo.stage-photo-moving::after { transition: opacity 450ms ease; }
html .stage-photo.stage-photo-instant > img { transition: none; }
html .stage-photo.stage-photo-leaving > img { transition: opacity 200ms ease; }
</style>
