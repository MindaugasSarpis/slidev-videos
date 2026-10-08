<script setup>
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/700.css'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useNav, configs } from '@slidev/client'
import { createSpace, usePlugin, resolvePalette, resolveLook, liftGround, paletteVars, warmAudio, startHum, stopHum, humProbe, playWhoosh, playRise } from '../index.js'
import StagePanel from './StagePanel.vue'

// The persistent 3D world under a whole deck. The addon mounts it from its
// own global-bottom.vue whenever the headmatter has a `stage:` block:
//
//   addons: [slidev-addon-stage]
//   stage:
//     space: data/space.json     # the stations (under the deck's public/)
//     records: data/records.json # optional: things a stop can name, { states | records: [...], figures: {...} }
//     palette: blue              # a name, or { base, accent, dust, … }
//     look: broadcast            # a named look over any palette (stage/palette.js LOOKS)
//     plugins: [hadron]          # shipped plugins to load
//     hero: hero                 # the station the deck opens and closes on
//     sound: true                # false: silent. Or pick: { hum: true, flight: true, clip: true, level: 1 }
//     humAt: [hero]              # the hum plays while the camera is at these stations
//     videos: true               # stir the dust with slidev-addon-videos' transitions, rest under a covering clip
//     options: { bloom: 0.55, density: 1, nebula: 0.8, … }   # see stage/space.js DEFAULTS
//     auto: true                 # false: the deck mounts <Stage> itself (for the #hud slot)
//
// Each slide steers the camera through its frontmatter:
//
//   space:
//     at: decay            # station id | record / anchor id | named pose | [x, y, z]
//     dist: 7  yaw: -25  pitch: 8  sway: 2.5
//     stops: [a, b, c]     # click k flies to stops[k-1] and shows its record
//     dim: 0.6             # how far the world is dimmed behind the slide, 0..1
//   clicks: 3              # = stops.length
//
// A slide without `space` keeps the previous pose. Without WebGL2 float
// render targets, or under reduced motion, only the static gradient is drawn.
//
// `dim` is the opacity of the scrim between the world and the slide, so body
// copy keeps its contrast over a busy pose. Without the key: 0 while a stop
// is active, 0.15 on cover / section / statement / fact / quote layouts, 0.6
// on content slides.

const CFG = (configs && configs.stage && typeof configs.stage === 'object') ? configs.stage : {}

const props = defineProps({
  space:   { type: String, default: '' },
  records: { type: String, default: '' },
  palette: { type: [String, Object], default: undefined },
  sound:   { type: Boolean, default: undefined },
})

const spaceSrc = computed(() => props.space || CFG.space || 'data/space.json')
const recordsSrc = computed(() => props.records || (CFG.records === false ? '' : CFG.records) || '')
// The engine's options: what the palette brings, a named look over it
// (`look: broadcast`), the deck's own `options` over both. A look may lift
// the ground off near-black (`lift`), which the CSS takes up with the palette.
const LOOK = typeof CFG.look === 'string' ? CFG.look : ''
const OPTIONS = { ...resolveLook(props.palette ?? CFG.palette, LOOK), ...(CFG.options || {}) }
const palette = liftGround(resolvePalette(props.palette ?? CFG.palette), OPTIONS.lift)
const soundOn = computed(() => (props.sound ?? CFG.sound ?? true) !== false)
// which voices: the hum at a station, the whoosh of a flight, the rise of a clip condensing
const VOICES = { hum: true, flight: true, clip: true, level: 1, ...(CFG.sound && typeof CFG.sound === 'object' ? CFG.sound : {}) }
const withVideos = CFG.videos !== false
const LAYOUT_DIM = { cover: 0.15, section: 0.15, statement: 0.15, fact: 0.15, quote: 0.15, ...(CFG.layoutDim || {}) }
const CONTENT_DIM = Number.isFinite(Number(CFG.dim)) ? Number(CFG.dim) : 0.6

const root = ref(null)
const canvas = ref(null)
const nav = useNav()
const data = ref(null)
const staticBg = ref(false)
const ready = ref(false)
const stopId = ref(null)
const arrived = ref(true)   // the HUD waits for the camera to land
let space = null
let humAt = new Set()

function webgl2Ok() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ok = !!gl && (gl.getExtension('EXT_color_buffer_float') !== null
      || gl.getExtension('EXT_color_buffer_half_float') !== null)
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return ok
  } catch { return false }
}

const frontmatter = computed(() => nav.currentSlideRoute.value?.meta?.slide?.frontmatter || {})
const frontmatterSpace = computed(() => frontmatter.value.space || null)
const clicks = computed(() => nav.clicks.value || 0)

function apply(immediate = false) {
  if (!space) return
  const sp = frontmatterSpace.value
  if (!sp) { stopId.value = null; space.setStop(null); updateHum(); return }
  const stops = Array.isArray(sp.stops) ? sp.stops : null
  const k = clicks.value
  if (stops && stops.length && k >= 1) {
    const id = stops[Math.min(k, stops.length) - 1]
    stopId.value = id
    space.setStop(id)
    space.setPose({ ...sp, at: id }, { immediate })
    arrived.value = immediate || space.arrived
  } else {
    stopId.value = null
    space.setStop(null)
    space.setPose(sp, { immediate })
  }
  updateHum()
}

// The hum: on while the pose is at a station that asks for it, after the
// first key press or pointer down (autoplay policy), with the tab visible,
// not under a playing clip, and never in the presenter window, so an audience
// window and a presenter window do not hum twice.
let audioUnlocked = false
let covered = false
function updateHum() {
  if (!soundOn.value) return
  const on = VOICES.hum !== false && audioUnlocked && !!space && !document.hidden && !covered && !nav.isPresenter?.value && humAt.has(space.atStation)
  if (on) startHum()
  else stopHum()
  if (root.value) root.value.dataset.hum = on ? 'on' : 'off'
}

watch([frontmatterSpace, clicks], () => apply(false))
// While a stop is active the slide's own cards fade (the CSS kit keys on
// this), so the record and its figure have the screen.
watch(stopId, (id) => {
  if (id) document.documentElement.dataset.spaceStop = '1'
  else delete document.documentElement.dataset.spaceStop
})

const stopRecord = computed(() => (stopId.value && space) ? space.record(stopId.value) : null)
const stopFigure = computed(() => (stopId.value && data.value?.figures) ? data.value.figures[stopId.value] || null : null)

// The year the current slide is telling its story in (`space.asof`): a record
// whose `status_year` is later shows `status_before`, a `note` whose
// `note_year` is later is held back.
const asof = computed(() => Number(frontmatterSpace.value?.asof) || 9999)
const shown = computed(() => {
  const s = stopRecord.value
  if (!s) return null
  const out = { ...s }
  if (Number(s.status_year) > asof.value) out.status = s.status_before || 'observed'
  if (Number(s.note_year) > asof.value) out.note = ''
  return out
})
// The record's rows in the default HUD: `rows: [[label, value], …]` on the
// record, else the fields named in `stage.hud.fields`, else every plain field.
const HIDDEN = new Set(['id', 'pos', 'label', 'label_html', 'name', 'rows', 'status_year', 'status_before', 'note_year'])
const rows = computed(() => {
  const s = shown.value
  if (!s) return []
  if (Array.isArray(s.rows)) return s.rows.map((r) => [String(r[0]), String(r[1] ?? '')])
  const fields = Array.isArray(CFG.hud?.fields) ? CFG.hud.fields : Object.keys(s).filter((k) => !HIDDEN.has(k))
  return fields
    .filter((k) => s[k] != null && s[k] !== '' && typeof s[k] !== 'object')
    .map((k) => [k.replace(/_/g, ' '), String(s[k])])
})

const dim = computed(() => {
  const fm = frontmatterSpace.value?.dim
  if (fm != null && Number.isFinite(Number(fm))) return Math.min(1, Math.max(0, Number(fm)))
  if (stopId.value) return 0
  return LAYOUT_DIM[frontmatter.value.layout] ?? CONTENT_DIM
})
// The scene fades its labels with the scrim (see setDim).
watch(dim, (d) => space?.setDim(d))

const base = () => (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
// Public assets are written `/figures/…` in space.json; the deck is served
// under a base (`/<repo>/<talk>/` on GitHub Pages), so resolve against it.
const asset = (src) => (typeof src === 'string' && src.startsWith('/') ? base() + src.slice(1) : src)
const getJson = async (path) => {
  const r = await fetch(base() + String(path).replace(/^\//, ''))
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json()
}

async function boot() {
  if (space || staticBg.value || !canvas.value) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || !webgl2Ok()) { staticBg.value = true; assembled(true); return }
  try {
    for (const p of [].concat(CFG.plugins || [])) await usePlugin(p)
    const [spaceDef, records] = await Promise.all([
      getJson(spaceSrc.value),
      recordsSrc.value ? getJson(recordsSrc.value).catch((e) => { console.warn('stage: records not loaded —', e.message); return null }) : null,
    ])
    data.value = records
    if (!canvas.value) return    // unmounted while the data came in
    space = createSpace(canvas.value, root.value, {
      space: spaceDef,
      records: records?.records || records?.states || [],
      palette,
      options: { ...OPTIONS, hero: CFG.hero },
      asset,
      onArrive: () => { arrived.value = true },
      // what builds itself at the hero does so on arrival; the cover's title
      // waits for it (the CSS kit keys on html[data-space-assembled])
      onEvent: (e, detail) => {
        if (e === 'assembling') {
          assembled(false)
          if (root.value) root.value.dataset.assemblies = String(Number(root.value.dataset.assemblies || 0) + 1)   // for the probes
        } else if (e === 'assembled') assembled(true)
        else if (e === 'flight') onFlight(detail)
      },
    })
  } catch (e) {
    console.warn('stage: not started —', e?.message || e)
    space = null
  }
  if (!space) { staticBg.value = true; assembled(true); return }
  humAt = new Set([].concat(CFG.humAt ?? (space.hero != null ? [space.hero] : [])))
  ready.value = true
  if (root.value) root.value.__space = space
  space.setDim(dim.value)
  apply(true)
}

// html[data-space-assembled]: set while no assembly runs (and always without WebGL), so the cover's title shows
function assembled(on) {
  if (on) document.documentElement.dataset.spaceAssembled = '1'
  else delete document.documentElement.dataset.spaceAssembled
}
// A flight is heard as well as seen: never in the presenter window (two
// windows would sound twice), never under a clip, and not for the short hops
// between two poses at one station, which would make every click a whoosh.
const audible = () => soundOn.value && audioUnlocked && !document.hidden && !nav.isPresenter?.value
function onFlight(d) {
  if (root.value) root.value.dataset.flights = String(Number(root.value.dataset.flights || 0) + 1)
  if (!audible() || VOICES.flight === false || covered) return
  if (!d || d.distance < 6) return
  playWhoosh(d.seconds, { level: VOICES.level * Math.min(1.2, 0.5 + d.distance / 60) })
}
// `c` builds again what stands at the station the pose is at
const onKey = (e) => {
  if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  space?.assemble()
}
// the first key press or pointer down unlocks audio (autoplay policy); the hum starts then
const onGesture = () => {
  if (!soundOn.value || audioUnlocked) return
  audioUnlocked = true
  warmAudio()
  updateHum()
}
const rest = () => space?.setPaused(document.hidden || covered)
const onVisibility = () => { rest(); updateHum() }

// slidev-addon-videos announces its transitions on window. A clip arriving
// as particles draws the world's dust toward the screen with it, one leaving
// shoves it back out; and while a clip covers the slide the world rests —
// the renderer stops, so the machine's GPU is the decoder's alone.
let coverTimer = 0
const onVideoTransition = (e) => {
  const d = e.detail || {}
  if (!space || d.mode === 'cut') return
  if (d.phase === 'enter') {
    space.stir('gather', { seconds: (d.duration || 1400) / 1000 })
    if (d.mode === 'dust' && audible() && VOICES.clip !== false) playRise((d.duration || 1400) / 1000, { level: VOICES.level })
  } else if (d.phase === 'leave') {
    space.stir('burst', { strength: 0.8 })
    // the clip's colours stay in the dust it broke into, for a few seconds
    if (d.mode === 'dust' && Array.isArray(d.color)) space.tint(d.color, { seconds: 5, strength: CFG.tint ?? 0.8 })
  }
}
const onVideoCover = (e) => {
  const d = e.detail || {}
  clearTimeout(coverTimer)
  if (d.covered && d.fit !== 'contain') {
    // after the hand-over: the picture is fully up before the world stops under it
    coverTimer = setTimeout(() => { covered = true; rest(); updateHum() }, 600)
  } else {
    covered = false
    rest()
    updateHum()
  }
}

onMounted(() => {
  const html = document.documentElement
  html.dataset.stage = '1'
  if (LOOK) html.dataset.stageLook = LOOK    // the CSS kit keys on html[data-stage-look]
  for (const [k, v] of Object.entries(paletteVars(palette))) html.style.setProperty(k, v)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keydown', onGesture, { once: true })
  window.addEventListener('pointerdown', onGesture, { once: true })
  if (withVideos) {
    window.addEventListener('slidev-videos:transition', onVideoTransition)
    window.addEventListener('slidev-videos:cover', onVideoCover)
  }
  if (root.value) root.value.__hum = humProbe   // for the headless probes
  boot()
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keydown', onGesture)
  window.removeEventListener('pointerdown', onGesture)
  window.removeEventListener('slidev-videos:transition', onVideoTransition)
  window.removeEventListener('slidev-videos:cover', onVideoCover)
  clearTimeout(coverTimer)
  stopHum()
  assembled(true)
  delete document.documentElement.dataset.stage
  delete document.documentElement.dataset.stageLook
  delete document.documentElement.dataset.spaceStop
  space?.dispose()
  space = null
})
</script>

<template>
  <div ref="root" class="stage" :class="{ 'static-bg': staticBg, ready }">
    <canvas ref="canvas" class="field" aria-hidden="true"></canvas>
    <div class="scrim" aria-hidden="true" :style="{ opacity: dim }"></div>
    <div class="grain" aria-hidden="true"></div>
    <Transition name="hud">
      <div v-if="shown && arrived" class="hud" :key="shown.id">
        <slot name="hud" :record="shown" :figure="stopFigure" :rows="rows">
          <StagePanel :kicker="(CFG.hud && CFG.hud.kicker) || 'record'" class="hud-card">
            <div class="hud-name" v-html="shown.label_html || shown.label || shown.name || shown.id"></div>
            <dl class="hud-rows">
              <template v-for="[k, v] in rows" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></template>
            </dl>
          </StagePanel>
          <StagePanel v-if="stopFigure" class="hud-figure" :kicker="stopFigure.caption" plain>
            <img class="space-figure" :src="asset(stopFigure.src)" :alt="stopFigure.alt || stopFigure.caption" />
            <p v-if="stopFigure.see" class="hud-see">{{ stopFigure.see }}</p>
          </StagePanel>
        </slot>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.stage {
  --bg: var(--stage-bg, #050507); --fg: var(--stage-fg, #f2f5f9); --dim: var(--stage-dim, #8b97a6); --accent: var(--stage-accent, #7dd3fc);
  position: absolute; inset: 0; overflow: hidden;
  font-family: 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--fg);
  background:
    radial-gradient(1100px 700px at 78% -8%, rgba(var(--stage-accent-rgb, 125, 211, 252), 0.07), transparent 62%),
    radial-gradient(900px 600px at -12% 108%, rgba(var(--stage-accent-rgb, 125, 211, 252), 0.05), transparent 60%),
    var(--bg);
}
.field { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity 1.2s ease; }
.ready .field { opacity: 1; }
.static-bg .field { display: none; }
/* Scrim between the world and the slide: keeps body copy legible over a busy
   pose. Opacity comes from `dim` (frontmatter `space.dim`, else the layout). */
.scrim {
  position: absolute; inset: 0; pointer-events: none;
  transition: opacity 0.6s ease;
  background: linear-gradient(180deg, rgba(var(--stage-bg-rgb, 5, 5, 7), 0.96) 0%, rgba(var(--stage-bg-rgb, 5, 5, 7), 0.88) 62%, rgba(var(--stage-bg-rgb, 5, 5, 7), 0.45) 100%);
}
.grain {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
/* the paper texture is fine detail an encoder smears; a broadcast frame goes without it */
html[data-stage-look="broadcast"] .grain { display: none; }
/* stop HUD: record left, figure right; sizes in px against the 980-wide canvas,
   scaled and floored like the CSS kit's (--stage-type-scale, --stage-type-min) */
.hud { position: absolute; inset: 0; display: grid; grid-template-columns: 340px 1fr; gap: 24px; padding: 60px max(44px, var(--stage-safe-x, 0px)) 48px; align-items: start; pointer-events: none; }
.hud-card { align-self: end; }
.hud-name { font-size: max(var(--stage-type-min, 0px), 36px * var(--stage-type-scale, 1)); font-weight: 700; letter-spacing: -0.01em; line-height: 1.05; margin: 2px 0 12px; }
.hud-rows { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; font-size: max(var(--stage-type-min, 0px), 15px * var(--stage-type-scale, 1)); line-height: 1.4; }
.hud-rows dt { color: var(--dim); text-transform: uppercase; letter-spacing: 0.12em; font-size: max(var(--stage-type-min, 0px), 12px * var(--stage-type-scale, 1)); padding-top: 3px; }
.hud-rows dd { margin: 0; color: var(--fg); }
.hud-figure { justify-self: end; align-self: start; max-width: 560px; background: rgba(var(--stage-bg-rgb, 5, 5, 7), 0.78); }
/* Figure height budget: the grid row is 551 − 60 − 48 = 443 px; kicker (20)
   + image + `see` (two lines, 50) + panel padding (38) must fit, or the row
   grows past the frame and clips both the `see` line and the record's last row. */
.space-figure { display: block; max-width: 100%; max-height: 320px; border-radius: 6px; background: #fff; opacity: 0.94; }
.hud-see { margin: 10px 0 0; font-size: max(var(--stage-type-min, 0px), 14px * var(--stage-type-scale, 1)); line-height: 1.4; color: var(--fg); max-width: 100%; }
.hud-enter-active, .hud-leave-active { transition: opacity 0.6s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
.hud-enter-from, .hud-leave-to { opacity: 0; transform: translateY(8px); }
</style>
