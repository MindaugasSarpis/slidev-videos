<!--
  Explain3D — one of the package's explainers, or a deck's own scene, turned by hand.

    <Explain3D name="line-fit-valley" class="fig-fill mt-sm" />
    <Explain3D :spec="spec" :data="data" />          a deck's own scene
    <Explain3D name="line-fit-valley" still />       the opening view only, no motion

  Vector throughout (SVG): a scene's surfaces, lines and points are projected
  in perspective and drawn far to near. Every explainer has one look, that of
  the course's static figures (engine/palette.js, LOOK): the plot's text in
  the figures' serif face and the text colour, ticks 1 px, the colour key
  edged; the box's edges faint; the buttons in the slides' own type. A deck
  sets --font-figure (and, if it must, --x3d-tick-size, --x3d-name-size). It turns by itself (the scene's
  `view.turn` seconds per turn) until the first drag, never with reduced
  motion; a drag turns and tilts it; the buttons at the left glide to the
  scene's named views and morph between its states; a double-click or
  double-tap goes back to the opening view. No control takes the keyboard
  focus and a drag never moves the slide. In presenter mode the audience
  window follows (BroadcastChannel).

  When frames come slower than about 30 a second it draws every second grid
  line of its surfaces while it moves, and if that is slow too it stops
  turning by itself (a drag still works, and at rest it is drawn in full).
  When it cannot be drawn at all (the scene does not load, or drawing throws)
  the slide shows the explainer's golden picture: the same view, as a file.
  `?x3d-force=fail` in the address rehearses that.
-->
<script>
const scenes = import.meta.glob('../explainers/*/spec.json');
const datas = import.meta.glob('../explainers/*/data.json');
const goldens = import.meta.glob('../explainers/*/golden.svg', { query: '?url', import: 'default' });
const LEFT_W = 150;              // the column of buttons, when a scene has views or states
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useIsSlideActive, useSlideContext } from '@slidev/client'
import { prepareScene, drawFrame } from '../engine/scene.js'
import { createMotion } from '../engine/motion.js'
import { createPainter } from '../engine/paint.js'
import { openSync } from '../engine/sync.js'
import { keyTicks } from '../engine/svg.js'
import { LOOK } from '../engine/palette.js'

const props = defineProps({
  // One of the package's explainers …
  name: { type: String, default: '' },
  // … or a deck's own scene: the spec and its data.
  spec: { type: Object, default: null },
  data: { type: Object, default: null },
  // The opening view, in degrees, and seconds per turn (default: the scene's).
  azim: { type: Number, default: undefined },
  elev: { type: Number, default: undefined },
  turn: { type: Number, default: undefined },
  // The opening view only: no turning, no drag, no buttons.
  still: { type: Boolean, default: false },
  // Two of one explainer on a slide need different ids (presenter ↔ audience).
  syncId: { type: String, default: '' },
})

const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---- the scene ---------------------------------------------------------------------
const scene = shallowRef(null)
const failed = ref('')            // why the live picture is not drawn
const fallback = ref('')          // the golden picture's URL, once it is needed
let motion = null
const tick = ref(0)               // bumped when the motion's buttons should redraw
const frame = shallowRef(null)    // the last frame: edges, axes, labels, key

async function fail(e) {
  failed.value = String(e?.message || e)
  console.error(`[explain3d] ${props.name || 'scene'}: ${failed.value}`)
  const g = goldens[`../explainers/${props.name}/golden.svg`]
  if (g) { try { fallback.value = await g() } catch { /* the message stays */ } }
}
// A rehearsal of the fallback: ?x3d-force=fail in the address (before or after the #).
const forced = typeof location !== 'undefined' && /[?&]x3d-force=fail\b/.test(location.search + location.hash)
async function load() {
  try {
    if (forced) throw new Error('forced to fail (x3d-force=fail)')
    let spec = props.spec
    let data = props.data
    if (!spec) {
      const s = scenes[`../explainers/${props.name}/spec.json`]
      const d = datas[`../explainers/${props.name}/data.json`]
      if (!s || !d) throw new Error(`no explainer "${props.name}"`)
      const [sm, dm] = await Promise.all([s(), d()])
      spec = sm.default ?? sm
      data = dm.default ?? dm
    }
    const sc = prepareScene(spec, data || {})
    motion = createMotion(sc, { reduceMotion: reduceMotion || props.still, azim: props.azim, elev: props.elev, turn: props.turn })
    scene.value = sc
  } catch (e) { fail(e) }
}
load()
const ready = computed(() => !!scene.value && !failed.value)
const hasSide = computed(() => !props.still && !!scene.value && (scene.value.views.length > 0 || scene.value.stateList.length > 1))

// ---- size ---------------------------------------------------------------------------
const root = ref(null)
const svgRef = ref(null)
const itemsG = ref(null)
const W = ref(0)
const H = ref(0)
let ro = null
let painter = null

// ---- drawing and the clock -------------------------------------------------------------
const { $page, $renderContext } = useSlideContext()
const isActive = useIsSlideActive()
const live = computed(() => $renderContext?.value === 'slide' || $renderContext?.value === 'presenter')
const thumb = computed(() => $renderContext?.value === 'overview' || $renderContext?.value === 'previewNext')
// read by the tests (svg.__x3d): how many frames of each kind, and what the watchdog decided
const stats = { full: 0, coarse: 0, gap: 0, slow: false, tooSlow: false, paths: 0 }
let raf = 0
let dragging = null
let slow = false                  // full frames in motion are too slow: every second grid line
let tooSlow = false               // those too: it no longer turns by itself
let lastAt = 0
let gap = 0
let gapN = 0

function draw(coarse) {
  if (!scene.value || !W.value || !H.value || !itemsG.value || failed.value) return
  try {
    painter ||= createPainter(itemsG.value)
    const useCoarse = coarse || thumb.value
    const f = drawFrame(scene.value, { azim: motion.azim, elev: motion.elev, state: motion.state }, { width: W.value, height: H.value }, { live: true, coarse: useCoarse, left: hasSide.value ? LEFT_W : 0 })
    painter.paint(f.items)
    frame.value = f
    if (useCoarse) stats.coarse++; else stats.full++
    stats.paths = f.items.length
  } catch (e) { fail(e) }
}
function loop(now) {
  raf = 0
  if (!motion || failed.value) return
  const allowed = isActive.value && live.value && !document.hidden && !dragging
  const moving = motion.step(now, allowed) || !!dragging
  draw(moving && slow)
  if (moving) {
    // the watchdog: the time between frames in motion, smoothed
    if (lastAt) {
      const g = now - lastAt
      gap = gapN ? 0.8 * gap + 0.2 * g : g
      gapN++
      if (gapN > 8 && gap > 34 && !slow) { slow = true; gapN = 0 }
      else if (gapN > 8 && gap > 80 && slow && !tooSlow) { tooSlow = true; motion.spinning = false; tick.value++ }
      stats.gap = Math.round(gap * 10) / 10
      stats.slow = slow
      stats.tooSlow = tooSlow
    }
    lastAt = now
    kick()
  } else {
    lastAt = 0
    tick.value++
  }
}
function kick() { if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(loop) }
watch([ready, W, H, hasSide], () => nextTick(() => { draw(false); kick() }))
watch([isActive, live], () => kick())

// ---- pointer: drag to turn and tilt, double-click or double-tap to reset -----------------
let lastTap = { t: 0, x: 0, y: 0 }
function onDown(e) {
  if (!ready.value || props.still || (e.pointerType === 'mouse' && e.button !== 0)) return
  e.stopPropagation()             // never a Slidev swipe
  e.preventDefault()
  const now = performance.now()
  if (now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap.t = 0
    motion.toView(null, now)
    changed()
    return
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY }
  const r = root.value.getBoundingClientRect()
  dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, w: r.width, h: r.height, moved: false }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function onMove(e) {
  if (!dragging || e.pointerId !== dragging.id) return
  const dx = e.clientX - dragging.x
  const dy = e.clientY - dragging.y
  if (!dragging.moved && Math.hypot(dx, dy) < 3) return
  dragging.moved = true
  dragging.x = e.clientX
  dragging.y = e.clientY
  motion.drag(dx / dragging.w, dy / dragging.h)
  changed()
}
function onUp(e) {
  if (!dragging || e.pointerId !== dragging.id) return
  dragging = null
  kick()                          // the still frame, in full
}
function press(fn, e) {
  if (!ready.value) return
  fn(performance.now())
  if (e?.detail) e.currentTarget.blur()
  changed()
}
const toView = (id, e) => press((now) => motion.toView(id, now), e)
const toState = (id, e) => press((now) => motion.toState(id, now), e)
const toggleSpin = (e) => press(() => { if (!tooSlow) motion.toggleSpin() }, e)

// ---- presenter ↔ audience ---------------------------------------------------------------
let sync = null
let pending = 0
function changed() {
  tick.value++
  kick()
  if (!sync || pending) return
  pending = requestAnimationFrame(() => { pending = 0; sync?.post() })
}
watch(ready, (r) => {
  if (!r || sync || !live.value || props.still) return
  nextTick(() => {
    sync = openSync({
      key: `Explain3D:${$page.value}:${scene.value.name}:${props.syncId}`,
      get: () => motion.snapshot(),
      set: (s) => { motion.apply(s, performance.now()); tick.value++; kick() },
      hasMoved: () => motion.touched,
    })
  })
}, { immediate: true })

// what the buttons show (recomputed on tick)
const ui = computed(() => {
  tick.value // eslint-disable-line no-unused-expressions
  if (!motion) return { spinning: false, view: null, state: null, canTurn: false }
  return { spinning: motion.spinning, view: motion.view, state: motion.state.b, canTurn: motion.canTurn && !tooSlow }
})
const gid = `x3d-key-${Math.random().toString(36).slice(2)}`

onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    W.value = Math.round(e.contentRect.width)
    H.value = Math.round(e.contentRect.height)
  })
  if (root.value) ro.observe(root.value)
  if (svgRef.value) svgRef.value.__x3d = stats
})
onBeforeUnmount(() => {
  ro?.disconnect()
  if (raf) cancelAnimationFrame(raf)
  if (pending) cancelAnimationFrame(pending)
  sync?.close()
  sync = null
})
</script>

<template>
  <section ref="root" class="x3d" :class="{ 'x3d-still': still, 'x3d-failed': !!failed }" :data-explain3d="name || spec?.name" :data-state="failed ? 'fallback' : ready ? 'live' : 'loading'">
    <img v-if="failed && fallback" class="x3d-fallback" :src="fallback" :alt="scene?.label || name">
    <p v-else-if="failed" class="x3d-msg">{{ failed }}</p>
    <svg
      v-show="!failed"
      ref="svgRef"
      class="x3d-svg"
      :viewBox="`0 0 ${Math.max(W, 1)} ${Math.max(H, 1)}`"
      :width="Math.max(W, 1)"
      :height="Math.max(H, 1)"
      role="img"
      :aria-label="scene?.label || name"
      :data-azim="frame?.azim.toFixed(2)"
      :data-elev="frame?.elev.toFixed(2)"
      :data-shown="frame?.active"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <title v-if="!still">Drag to turn; double-click or double-tap: back to the start</title>
      <defs v-if="frame?.key">
        <linearGradient :id="gid" x1="0" y1="1" x2="0" y2="0">
          <stop v-for="s in frame.key.stops" :key="s.off" :offset="s.off" :stop-color="s.col" />
        </linearGradient>
      </defs>
      <g v-if="frame" class="x3d-edges">
        <line v-for="(e, i) in frame.edges" :key="i" :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" />
      </g>
      <g ref="itemsG" class="x3d-items" />
      <template v-if="frame">
        <g v-for="ax in frame.axes" :key="'a' + ax.k" class="x3d-axis">
          <g v-for="t in ax.ticks" :key="t.text">
            <line :x1="t.x" :y1="t.y" :x2="t.x2" :y2="t.y2" />
            <text :x="t.lx" :y="t.ly" :text-anchor="ax.anchor" dominant-baseline="central">{{ t.text }}</text>
          </g>
          <text class="x3d-name" :x="ax.name.x" :y="ax.name.y" :text-anchor="ax.name.anchor" dominant-baseline="central">{{ ax.name.text }}</text>
        </g>
        <text v-for="(l, i) in frame.labels" :key="'l' + i" class="x3d-label" :x="l.x" :y="l.y" :text-anchor="l.anchor" :fill="l.fill" dominant-baseline="central">{{ l.text }}</text>
        <g v-if="frame.key" class="x3d-key">
          <text class="x3d-name" :x="frame.key.x + frame.key.width / 2" :y="frame.key.top - 18" text-anchor="middle">{{ frame.key.label }}</text>
          <rect class="x3d-keybar" :x="frame.key.x" :y="frame.key.top" :width="frame.key.width" :height="frame.key.bottom - frame.key.top" :fill="`url(#${gid})`" />
          <path class="x3d-keyticks" :d="keyTicks(frame.key)" />
          <text v-for="t in frame.key.ticks" :key="t.text" :x="frame.key.x + frame.key.width + LOOK.tickLen" :y="t.y" dominant-baseline="central">{{ t.text }}</text>
        </g>
      </template>
    </svg>

    <nav v-if="ready && !still" class="x3d-controls">
      <button
        v-if="ui.canTurn"
        type="button"
        class="x3d-play"
        tabindex="-1"
        :aria-label="ui.spinning ? 'Stop turning' : 'Turn'"
        @mousedown.prevent
        @pointerdown.stop
        @click="toggleSpin"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <g v-if="ui.spinning"><rect x="5" y="4" width="3.4" height="12" rx="0.8" /><rect x="11.6" y="4" width="3.4" height="12" rx="0.8" /></g>
          <path v-else d="M6 3.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 6 3.8z" />
        </svg>
      </button>
      <span v-if="scene.stateList.length > 1" class="x3d-seg" role="group" aria-label="What is drawn">
        <button v-for="s in scene.stateList" :key="s.id" type="button" tabindex="-1" :class="{ on: ui.state === s.id }" :data-state-id="s.id" @mousedown.prevent @pointerdown.stop @click="toState(s.id, $event)">{{ s.label }}</button>
      </span>
      <span v-if="scene.views.length" class="x3d-seg" role="group" aria-label="View">
        <button v-for="v in scene.views" :key="v.id" type="button" tabindex="-1" :class="{ on: ui.view === v.id }" :data-view-id="v.id" @mousedown.prevent @pointerdown.stop @click="toView(v.id, $event)">{{ v.label }}</button>
      </span>
    </nav>
  </section>
</template>

<style scoped>
/* A <section> with a <nav>: a theme that lays out the direct <div> children
   of a figure block leaves them alone. In a stretched grid or flex cell it
   takes the cell's height; anywhere else it keeps 22rem. */
.x3d {
  position: relative;
  align-self: stretch;
  min-width: 0;
  min-height: 22rem;
  user-select: none;
  -webkit-user-select: none;
  color: var(--x3d-fg, var(--fg, #f2f5f9));
  font-family: var(--font-sans, 'Space Grotesk', system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
}
.x3d-svg {
  position: absolute;
  inset: 0;
  display: block;
  cursor: grab;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  /* the plot's type: the face of the static figures */
  font-family: var(--x3d-font, var(--font-figure, 'Figure Serif', 'STIX Two Text', 'STIXGeneral', 'Times New Roman', serif));
  font-weight: 400;
  font-variant-numeric: normal;
  letter-spacing: 0;
}
.x3d-svg:active { cursor: grabbing; }
.x3d-still .x3d-svg { cursor: default; }
.x3d-fallback { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.x3d-edges line { stroke: var(--x3d-hair-strong, var(--hair-strong, rgba(139, 151, 166, 0.34))); stroke-width: 1; }
.x3d-items { stroke-linecap: round; stroke-linejoin: round; }
.x3d-axis line, .x3d-keyticks { fill: none; stroke: var(--x3d-fg, var(--fg, #f2f5f9)); stroke-width: 1; }
.x3d-keybar { stroke: var(--x3d-fg, var(--fg, #f2f5f9)); stroke-width: 1; }
.x3d-axis text, .x3d-key text { fill: var(--x3d-fg, var(--fg, #f2f5f9)); font-size: var(--x3d-tick-size, var(--fig-tick-label, 13.75px)); }
.x3d-axis .x3d-name, .x3d-key .x3d-name { font-size: var(--x3d-name-size, var(--fig-axis-label, 15.625px)); }
.x3d-label {
  font-size: var(--x3d-tick-size, var(--fig-tick-label, 13.75px));
  font-weight: 700;
  paint-order: stroke;
  stroke: var(--x3d-bg, var(--bg, #050507));
  stroke-width: 3.5px;
  stroke-linejoin: round;
  pointer-events: none;
}
.x3d-msg { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--x3d-warn, var(--warn, #fbbf24)); font-size: 0.875rem; }

/* The buttons sit in the free column at the left of the box. */
.x3d-controls {
  position: absolute;
  left: 0.2rem;
  top: 0.4rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.8rem;
}
.x3d-play {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--x3d-accent, var(--accent, #7dd3fc)) 55%, transparent);
  border-radius: 50%;
  background: none;
  color: var(--x3d-accent, var(--accent, #7dd3fc));
  cursor: pointer;
  transition: border-color 0.3s, background-color 0.3s;
}
.x3d-play:hover { border-color: var(--x3d-accent, var(--accent, #7dd3fc)); background: color-mix(in srgb, var(--x3d-accent, var(--accent, #7dd3fc)) 12%, transparent); }
.x3d-play:focus { outline: none; }
.x3d-play svg { width: 18px; height: 18px; fill: currentColor; }
.x3d-seg { display: flex; flex-direction: column; border: 1px solid var(--x3d-hair-strong, var(--hair-strong, rgba(139, 151, 166, 0.34))); border-radius: 4px; overflow: hidden; }
.x3d-seg button {
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--x3d-fg-2, var(--fg-2, #c3ccd8));
  background: none;
  border: none;
  padding: 0.4rem 0.7rem;
  text-align: left;
  cursor: pointer;
  transition: color 0.3s, background-color 0.3s;
}
.x3d-seg button + button { border-top: 1px solid var(--x3d-hair-strong, var(--hair-strong, rgba(139, 151, 166, 0.34))); }
.x3d-seg button:focus { outline: none; }
.x3d-seg button:hover { color: var(--x3d-accent, var(--accent, #7dd3fc)); }
.x3d-seg button.on { color: var(--x3d-accent, var(--accent, #7dd3fc)); background: color-mix(in srgb, var(--x3d-accent, var(--accent, #7dd3fc)) 12%, transparent); }

@media (prefers-reduced-motion: reduce) {
  .x3d-play,
  .x3d-seg button { transition: none; }
}
</style>
