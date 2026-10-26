<script setup>
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/700.css'
import { ref, computed, watch, nextTick, onMounted, onUnmounted, inject } from 'vue'
import { useNav, configs } from '@slidev/client'
import { createSpace, usePlugin, resolvePalette, resolveLook, liftGround, paletteVars, warmAudio, startHum, stopHum, humProbe, playWhoosh, playRise, stageOut } from '../index.js'
import StagePanel from './StagePanel.vue'
import StageLiving from './StageLiving.vue'
import StagePlate from './StagePlate.vue'
import { placeGroupsAt } from '../stage/place-groups.js'
import { probeGL, stageDebugOn, debugLines, deviceInfo, pickTier, MAX_TIER, stageOverrides } from '../stage/diagnose.js'
import { stillsDir, stillUrl, inPrint } from '../stage/stills.js'
import { fallbackLayer, platesDir, plateRelease, plateLocalFirst } from '../stage/fallback.js'
import { musicClock } from '../stage/soundtrack.js'
import { recordedOf, layerNow, slaveRate } from '../stage/recorded.js'
import { setSteps, stepsAt, allSteps } from '../stage/steps.js'

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
//     humAt: [hero]              # the hum plays while the camera is at these stations; all (or '*'): on every pose
//     videos: true               # stir the dust with slidev-addon-videos' transitions, rest under a covering clip
//     options: { bloom: 0.55, density: 1, nebula: 0.8, … }   # see stage/space.js DEFAULTS
//     auto: true                 # false: the deck mounts <Stage> itself (for the #hud slot)
//     tier: 2                    # pin the quality tier, 0 (full) … 3 (floor); default: from the device
//     stills: stills             # per-slide stills under public/ for print and the fallback (stage/stills.js); false: none
//     plates: videos             # the recorder's NN-plate.mp4 under public/, played where the world cannot run (stage/fallback.js); false: none
//     platesRelease: o/r@tag     # where the plates are pulled from (a URL, or a GitHub release); default: the videos addon's release
//     motion: respect            # under prefers-reduced-motion: respect (the still alone) or floor (the world, at its floor)
//
// Each slide steers the camera through its frontmatter:
//
//   space:
//     at: decay            # station id | record / anchor id | named pose | [x, y, z]
//     dist: 7  yaw: -25  pitch: 8  sway: 2.5
//     stops: [a, b, c]     # click k flies to stops[k-1] and shows its record
//     dim: 0.6             # how far the world is dimmed behind the slide, 0..1
//     steady: true         # no grain twinkles here (eased in over 0.6 s; stage/twinkle.js)
//     clock: music         # the world keeps the playing <StageSoundtrack>'s pace, not the wall's
//     recorded: plate      # the slide is its recording over the world (plate | clip | { kind, music, at }; stage/recorded.js)
//   clicks: 3              # = stops.length
//
//   steps: { det: 1 }              # the step bus from this slide on, however it is reached
//                                  # (0 before the first slide that names it; stage/steps.js)
//   places: { inventions: true }   # photo places in group "inventions" show from here on
//                                  # (false hides them); before the first slide that names a
//                                  # group, it is the opposite (stage/place-groups.js)
//
// A machine that stays slow after the frame guard (the watchdog, stage/watchdog.js;
// `options.watchdog: false` turns it off) hands the slide to its plate and the world is
// built again a tier lower; at the last tier the plates stand in (fallback `slow`).
// A slide without `space` keeps the previous pose. Without WebGL2 float
// render targets, or when the engine fails, the slide's recorded plate plays
// in the world's place, or its still breathes where there is no plate
// (stage/fallback.js: the layer is on <html> as data-stage-layer); under
// reduced motion the still stands alone. Why it fell back is on the root and
// on <html> as data-stage-fallback, as `slidev-stage:fallback` on window and
// in one console line; `?stage-debug` in the address shows it on screen
// (stage/diagnose.js). `?stage-force=<reason>` rehearses a fallback on a
// device that has no need of it (slidev-stage-shots --force puts it there),
// `stage-plates=off` and `stage-motion=floor|respect` stand in for the deck's
// keys for the session.
// Printed and exported (`slidev export`, /print, the browser exporter) every
// slide mounts its own global layers, so a world each would open a WebGL
// context per page: there, and with `static-ground`, the stage draws no world
// and touches no WebGL at all; print and the fallback show the slide's still
// when the deck has one (public/stills/NN.jpg, from `slidev-stage-shots --stills`).
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
  staticGround: { type: Boolean, default: false },
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
// Where the world cannot run (stage/fallback.js). `stage.motion`: respect (the
// default: under prefers-reduced-motion the still alone) or floor (the world
// all the same, at its floor — the engine's floor is T1 of the live fallback
// plan; until it lands the world runs as it does). `stage.plates`: the folder
// under public/ the recorder's NN-plate.mp4 are served from (default videos,
// false: none); `stage.platesRelease`: where they are pulled from, else the
// videos addon's own release, in the chain the player builds for a clip.
// `?stage-force`, `stage-plates=off`, `stage-motion` (and stage-post, stage-targets, stage-tier) in the address: stage/diagnose.js
const OVERRIDES = typeof location !== 'undefined' ? stageOverrides(location) : {}
const MOTION = OVERRIDES.motion || (CFG.motion === 'floor' ? 'floor' : 'respect')
const PLATES = OVERRIDES.plates === false ? '' : platesDir(CFG.plates)
const PLATE_REMOTE = plateRelease(CFG.platesRelease, configs && configs.videos, import.meta.env)
const PLATE_LOCAL_FIRST = plateLocalFirst(import.meta.env)
const LAYER_OPTS = { motion: MOTION, plates: PLATES || false }

const root = ref(null)
const canvas = ref(null)
const nav = useNav()
// `?print` is the exporter's; the browser exporter and /print opened by hand are routes
const printRoute = () => !!nav.isPrintMode?.value || ['print', 'export'].includes(nav.currentRoute?.value?.name)
const data = ref(null)
const staticBg = ref(false)
const ready = ref(false)
const stopId = ref(null)
const arrived = ref(true)   // the HUD waits for the camera to land
let space = null
let humAt = new Set()
let humEverywhere = false

// ---- stills: print, export and the fallback --------------------------------------
const STILLS = stillsDir(CFG.stills)
const printing = ref(false)
const stillMissing = ref(new Set())
// Each print page carries its own nav (Slidev's PrintSlideClick provides it as
// the slide context); useNav() reads it from Slidev 52.19 on, but 52.14 returns
// the deck's, which stays at 1 on the print route: every page showed slide 1's
// still. Read the page's context first.
const pageCtx = inject('$$slidev-context', null)
const pageNo = computed(() => Number(pageCtx?.nav?.currentSlideNo) || nav.currentSlideNo.value || 1)
const stillSrc = computed(() => stillUrl(STILLS, printing.value ? pageNo.value : nav.currentSlideNo.value, base()))
const stillShown = computed(() => !!stillSrc.value && (printing.value || staticBg.value) && !stillMissing.value.has(stillSrc.value))
const onStillError = () => { stillMissing.value = new Set(stillMissing.value).add(stillSrc.value) }

// ---- what stands in for the world ---------------------------------------------
// The layer under the slide: world | world-floor | plate | living | still, on
// <html> as data-stage-layer for the tools and the tests. The base is the
// stage's own (what it could do); a slide whose plate no URL answered for
// (a clip slide has none) drops to the living still.
const layerBase = ref('world')
const plateMissing = ref(new Set())
const plateState = ref('none')          // StagePlate's: loading | playing | paused | held | none
// A slide may be its recording over a running world (`space.recorded`, stage/recorded.js), and the
// watchdog hands a slow slide to its plate (slowSlide): layerNow says which layer stands.
const slowSlide = ref(null)
// (not under the recorder, which sets __stageMaxDt: it films the world the plate is made of)
const recordedNow = () => (printing.value || globalThis.__stageMaxDt || !frontmatterSpace.value?.recorded ? null : recordedOf(frontmatterSpace.value))
const layer = computed(() => layerNow({ base: layerBase.value, slide: nav.currentSlideNo.value, recorded: recordedNow(), slowSlide: slowSlide.value, plateMissing: plateMissing.value, plates: !!PLATES }))
// over a running world the plate plays from its top (a recorded slide) or from where the slide is (the watchdog's)
const plateFrom = ref(null)
const onPlateExhausted = (no) => { plateMissing.value = new Set(plateMissing.value).add(no) }
const onPlateState = (s) => { plateState.value = s }
// a clip covers the slide (slidev-videos:cover): the world rests, and so do the living still and the plate
const covered = ref(false)
// the living still carries its own still; the plain one is for print and the still alone
const livingOn = computed(() => !printing.value && (layerBase.value === 'plate' || layerBase.value === 'living'))
// … and rests under a plate that is on screen, playing or holding its last frame: nothing of it shows
const livingRest = computed(() => covered.value || plateState.value === 'playing' || plateState.value === 'held')
// … and the world rests under a plate that stands for it on screen (a recorded slide, the watchdog's)
const recordedRest = computed(() => layerBase.value === 'world' && layer.value === 'plate' && (plateState.value === 'playing' || plateState.value === 'held'))

// ---- why it runs as it does ---------------------------------------------------
const debug = typeof location !== 'undefined' && stageDebugOn(location)
const debugText = ref('')
let glInfo = {}
const events = { contextLost: 0, shaderErrors: 0, lastShaderError: '' }
// the quality tier: from the device (pickTier), or `stage.tier`; one lower after each lost context
let tier = null
const canvasKey = ref(0)
const MAX_RESTORES = 2
const status = { status: 'starting', reason: '', detail: '', forced: '' }   // forced: the ?stage-force reason, for the panel
function fallback(reason, detail = '') {
  if (status.status === 'fallback') return
  Object.assign(status, { status: 'fallback', reason, detail: String(detail || '').slice(0, 160) })
  staticBg.value = true
  ready.value = false
  assembled(true)
  // what stands in (never a world layer here: the world did not run)
  const l = fallbackLayer(reason, LAYER_OPTS)
  layerBase.value = l.startsWith('world') ? 'still' : l
  if (root.value) root.value.dataset.stageFallback = reason
  // on <html> for the player (advance-on-end goes on without a world only onto
  // a loaded plate) and the deck's own components, and as an event for whoever listens
  const html = document.documentElement
  html.dataset.stageFallback = reason
  console.warn(`stage: fallback — ${reason}${detail ? ` (${detail})` : ''}`)
  try { window.dispatchEvent(new CustomEvent('slidev-stage:fallback', { detail: { reason, detail, layer: layerBase.value } })) } catch {}
  renderDebug()
}
let fpsAt = 0, fpsFrames = 0, panelFps = null
function renderDebug() {
  if (!debug) return
  const h = canvas.value?.__space, c = canvas.value
  let sp = null
  if (h && status.status === 'running') {
    const now = performance.now()
    if (fpsAt) panelFps = (h.frames - fpsFrames) / ((now - fpsAt) / 1000)
    fpsAt = now; fpsFrames = h.frames
    sp = { tier: h.tier, targets: h.targets, post: h.post, sim: h.sim, dpr: h.dpr, canvas: c ? `${c.width}×${c.height}` : '', guard: h.guardStage,
      fps: panelFps, frames: h.frames, textures: h.renderer?.info?.memory?.textures, programs: h.renderer?.info?.programs?.length }
  }
  debugText.value = debugLines({ ...status, gl: glInfo, space: sp, device: deviceInfo(), events, overrides: OVERRIDES }).join('\n')
}
// iOS drops a WebGL context under memory pressure; the canvas goes blank and
// the slide would sit on black. Stop drawing, show the static stage, and build
// the world again one tier lower on a fresh canvas, at most twice; after that
// the static stage stays.
let restoreTimer = 0
const onContextLost = (e) => {
  // only the live canvas counts: disposing the old one after a restore makes it
  // report a loss of its own, which must not step the tier down again
  e.target?.removeEventListener?.('webglcontextlost', onContextLost)
  if (e.target !== canvas.value || status.status !== 'running') return
  e.preventDefault?.()
  events.contextLost++
  space?.setPaused(true)
  if (tier >= MAX_TIER || events.contextLost > MAX_RESTORES) return fallback('context-lost', `tier ${tier}`)
  Object.assign(status, { status: 'restoring', reason: 'context-lost', detail: `rebuilding at tier ${tier + 1}` })
  staticBg.value = true
  ready.value = false
  layerBase.value = 'still'          // for the moment of the rebuild (not a fallback: the world comes back, or falls back then)
  if (root.value) root.value.dataset.stageFallback = 'context-lost'
  console.warn(`stage: context lost — rebuilding at tier ${tier + 1}`)
  renderDebug()
  const old = e.target
  const go = () => { clearTimeout(restoreTimer); old?.removeEventListener('webglcontextrestored', go); rebuild() }
  old?.addEventListener('webglcontextrestored', go, { once: true })
  restoreTimer = setTimeout(go, 1500)
}
// The watchdog (stage/watchdog.js): the machine stayed slow after the frame guard. The slide goes
// to its plate from where it is (when the deck has plates), and the world is built again a tier
// lower behind it, as after a lost context; at the last tier the plates stand in for the rest of
// the talk (fallback 'slow'). The audience's window only.
function onSlow(d = {}) {
  if (printing.value || nav.isPresenter?.value) return
  if (status.status !== 'running') return
  events.slow = (events.slow || 0) + 1
  console.warn(`stage: slow — ${d.fps ?? '?'} fps at tier ${tier}${tier < MAX_TIER ? `, rebuilding at tier ${tier + 1}` : ''}`)
  try { window.dispatchEvent(new CustomEvent('slidev-stage:slow', { detail: { ...d, tier } })) } catch {}
  if (PLATES) { slowSlide.value = nav.currentSlideNo.value; plateFrom.value = Math.max(0, (space?.realTime ?? 0) - entryReal) }
  if (tier >= MAX_TIER) return fallback('slow', `tier ${tier}`)
  Object.assign(status, { status: 'restoring', reason: 'slow', detail: `rebuilding at tier ${tier + 1}` })
  space?.setPaused(true)
  ready.value = false
  staticBg.value = true                      // the canvas goes; the plate (or the still) stands
  if (!PLATES) layerBase.value = 'still'
  renderDebug()
  clearTimeout(restoreTimer)
  restoreTimer = setTimeout(rebuild, 50)
}
async function rebuild() {
  if (status.status !== 'restoring') return
  try { space?.dispose() } catch { /* the context is gone */ }
  space = null
  tier = Math.min(MAX_TIER, tier + 1)
  canvasKey.value++                  // a fresh canvas, a fresh context
  await nextTick()
  Object.assign(status, { status: 'starting', reason: '', detail: '' })
  staticBg.value = false
  if (root.value) delete root.value.dataset.stageFallback
  const html = document.documentElement
  delete html.dataset.stageFallback    // the plate's marks went with StagePlate: the layer was `still` while restoring
  await boot()
  entryReal = 0   // the new world's clock starts at 0 on the slide it was rebuilt on
  if (space) try { window.dispatchEvent(new CustomEvent('slidev-stage:rebuilt', { detail: { tier } })) } catch {}
}

// The slide's frontmatter. On a print page, the page's own slide: Slidev 52.14's
// print route keeps nav.currentSlideRoute at slide 1, so a deck opening at
// dim: 1 printed every page under a near-opaque scrim (Užsikrauk karjerai's
// PDF, pages 5–15 near black). The page's context knows its slide.
const pageRoute = () => {
  const ctxRoute = pageCtx?.nav?.currentSlideRoute
  const r = ctxRoute?.value ?? ctxRoute
  if (r?.meta?.slide && Number(r.no) === pageNo.value) return r
  return (nav.slides.value || []).find((x) => Number(x?.no) === pageNo.value) || null
}
const frontmatter = computed(() => (printing.value ? pageRoute() : nav.currentSlideRoute.value)?.meta?.slide?.frontmatter || {})
const frontmatterSpace = computed(() => frontmatter.value.space || null)
const clicks = computed(() => nav.clicks.value || 0)
const clicksTotal = computed(() => nav.clicksTotal?.value || 0)   // on the root as data-clicks-total, for the headless tools

// Place groups: worked out from every slide's `places:` up to this one, so
// going back or jumping shows what that slide would have.
const placeDecls = computed(() => (nav.slides.value || []).map((r) => r?.meta?.slide?.frontmatter?.places ?? null))
function applyPlaces(immediate = false) {
  if (!space || !space.setPlaceGroups) return
  const groups = placeGroupsAt(placeDecls.value, nav.currentSlideNo.value || 1)
  space.setPlaceGroups(groups, { immediate })
  if (root.value) root.value.dataset.placeGroups = Object.entries(groups).map(([g, on]) => `${g}:${on ? 'on' : 'off'}`).join(' ')
}
watch(() => nav.currentSlideNo.value, () => applyPlaces(false))
// A slide's `steps:` (stage/steps.js stepsAt): the step bus as the deck stands at this slide,
// however it was reached. Synchronously on the change, so the slide's own <StageSteps> lands after.
const stepDecls = computed(() => (nav.slides.value || []).map((r) => r?.meta?.slide?.frontmatter?.steps ?? null))
watch(() => nav.currentSlideNo.value, (n) => { if (!printRoute()) setSteps(stepsAt(stepDecls.value, n)) }, { immediate: true, flush: 'sync' })

// the engine time of the last pose or step change, for the probes' settle
let changedAt = 0

function apply(immediate = false) {
  if (!space) return
  if (immediate) applyPlaces(true)
  changedAt = space.realTime ?? 0
  const sp = frontmatterSpace.value
  // `clock: music`: the world keeps the playing <StageSoundtrack>'s pace (a long frame cannot leave it behind)
  space.setClockSource(sp && sp.clock === 'music' ? () => musicClock() : null)
  if (!sp) { stopId.value = null; space.setStop(null); space.setRate(1); space.setSteady(false); updateHum(); return }
  const stops = Array.isArray(sp.stops) ? sp.stops : null
  const k = clicks.value
  if (stops && stops.length && k >= 1) {
    const id = stops[Math.min(k, stops.length) - 1]
    stopId.value = id
    space.setStop(id)
    space.setPose({ ...sp, at: id }, { immediate, key: nav.currentSlideNo.value })
    arrived.value = immediate || space.arrived
  } else {
    stopId.value = null
    space.setStop(null)
    space.setPose(sp, { immediate, key: nav.currentSlideNo.value })
  }
  updateHum()
}

// The hum: on while the pose is at a station that asks for it (on every
// pose, out in the open dust too, with `humAt: all`), after the
// first key press or pointer down (autoplay policy), with the tab visible,
// not under a playing clip, and never in the presenter window, so an audience
// window and a presenter window do not hum twice.
let audioUnlocked = false
function updateHum() {
  if (!soundOn.value) return
  const on = VOICES.hum !== false && audioUnlocked && !!space && !document.hidden && !covered.value && !nav.isPresenter?.value && frontmatterSpace.value?.hum !== false && (humEverywhere || humAt.has(space.atStation))
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
  // a print page: no world (one WebGL context per page would run out), its still instead
  if (printing.value) { staticBg.value = true; assembled(true); return }
  // ?stage-force=<reason> (stage/diagnose.js): the fallback that reason brings on a
  // device, rehearsed on this one — before the probe, whatever its GL. reduced-motion
  // goes the media query's way below (world-floor with `motion: floor`); context-lost
  // boots the world and loses its live context at the end of boot(), so the real
  // handler (onContextLost) takes it down the way iOS would
  const forced = OVERRIDES.force || ''
  status.forced = forced
  // reduced motion: the still alone, unless the deck says `motion: floor` — then
  // the world all the same (world-floor; its floor is T1's: for now it runs as it does)
  const reduced = forced === 'reduced-motion' || matchMedia('(prefers-reduced-motion: reduce)').matches
  const worldLayer = reduced ? fallbackLayer('reduced-motion', LAYER_OPTS) : 'world'
  if (worldLayer !== 'world' && worldLayer !== 'world-floor') return fallback('reduced-motion', forced === 'reduced-motion' ? 'forced' : '')
  if (forced && forced !== 'reduced-motion' && forced !== 'context-lost') return fallback(forced, 'forced')
  glInfo = probeGL(document)
  if (glInfo.reason) return fallback(glInfo.reason, glInfo.gpu)
  if (tier == null && OVERRIDES.tier != null) tier = OVERRIDES.tier
  if (tier == null) tier = Number.isFinite(Number(CFG.tier)) && CFG.tier !== null && CFG.tier !== ''
    ? Math.max(0, Math.min(MAX_TIER, Math.round(Number(CFG.tier)))) : pickTier(glInfo, deviceInfo())
  let stage = 'plugin', failed = null
  try {
    for (const p of [].concat(CFG.plugins || [])) await usePlugin(p)
    stage = 'data'
    const [spaceDef, records] = await Promise.all([
      getJson(spaceSrc.value),
      recordsSrc.value ? getJson(recordsSrc.value).catch((e) => { console.warn('stage: records not loaded —', e.message); return null }) : null,
    ])
    stage = 'init'
    data.value = records
    if (!canvas.value) return    // unmounted while the data came in
    space = createSpace(canvas.value, root.value, {
      space: spaceDef,
      records: records?.records || records?.states || [],
      palette,
      options: { ...OPTIONS, hero: CFG.hero, tier, ...(OVERRIDES.post === false ? { post: false } : {}), ...(OVERRIDES.targets ? { targets: OVERRIDES.targets } : {}) },
      asset,
      // a builder's ctx.audio(): the stage's context and output once a gesture has unlocked it
      audio: () => (soundOn.value && audioUnlocked && !nav.isPresenter?.value ? { context: warmAudio(), out: stageOut(VOICES.level) } : null),
      onArrive: (target) => {
        arrived.value = true
        // for whoever waits on the camera (StagePhoto's arrive="camera")
        try { window.dispatchEvent(new CustomEvent('slidev-stage:arrive', { detail: { target } })) } catch {}
      },
      // what builds itself at the hero does so on arrival; the cover's title
      // waits for it (the CSS kit keys on html[data-space-assembled])
      onEvent: (e, detail) => {
        if (e === 'assembling') {
          assembled(false)
          if (root.value) root.value.dataset.assemblies = String(Number(root.value.dataset.assemblies || 0) + 1)   // for the probes
        } else if (e === 'assembled') assembled(true)
        else if (e === 'flight') onFlight(detail)
        else if (e === 'slow') onSlow(detail)
        else if (e === 'fallback') failed = detail
        else if (e === 'shader-error') { events.shaderErrors++; events.lastShaderError = detail?.message || ''; renderDebug() }
      },
    })
  } catch (e) {
    failed = { reason: stage, detail: e?.message || String(e) }
    space = null
  }
  if (!space) return fallback(failed?.reason || stage, failed?.detail || '')
  canvas.value.addEventListener('webglcontextlost', onContextLost)
  status.status = 'running'
  layerBase.value = worldLayer
  if (debug) console.info('stage: running —', debugLines({ ...status, gl: glInfo, device: deviceInfo(), events }).slice(1, 3).join(' · '))
  const humList = [].concat(CFG.humAt ?? (space.hero != null ? [space.hero] : [])).map(String)
  humEverywhere = CFG.humAt === true || humList.some((s) => s === 'all' || s === '*')
  humAt = new Set(humList)
  ready.value = true
  if (root.value) root.value.__space = space
  space.setDim(dim.value)
  apply(true)
  rest()          // a rebuild under a covering clip, or in a hidden tab, rests at once
  // ?stage-force=context-lost: the world up, its live context is lost as past the
  // last restore, so onContextLost runs its final branch (no rebuild: the fallback)
  if (forced === 'context-lost') {
    events.contextLost = MAX_RESTORES
    console.warn('stage: forcing context-lost (?stage-force) — losing the live context')
    try {
      const gl = canvas.value.__space?.renderer?.getContext?.() || canvas.value.getContext('webgl2')
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch (e) { console.warn('stage: the context could not be lost —', e?.message || e) }
  }
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
  if (!audible() || VOICES.flight === false || covered.value) return
  if (!d || d.distance < 6) return
  playWhoosh(d.seconds, { level: Math.min(1.2, 0.5 + d.distance / 60) })
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
  stageOut(VOICES.level)   // every voice goes out through the stage's level
  updateHum()
}
const rest = () => space?.setPaused(document.hidden || covered.value || recordedRest.value)
watch(recordedRest, () => rest())

// A new slide: the watchdog's hand-over was for the slide it came on; a recorded slide's
// plate starts from its top. With `music`, the video keeps the playing track's time
// (slaveRate: ±10 %, set where it belongs when more than a second off), in the audience's window.
let entryReal = 0, slaveRaf = 0
watch(() => nav.currentSlideNo.value, () => {
  slowSlide.value = null
  plateFrom.value = recordedNow()?.kind === 'plate' ? 0 : null
  entryReal = space?.realTime ?? 0
  keepTime()
}, { immediate: true })
const videoOf = (r, no) => (r.kind === 'plate'
  ? root.value?.querySelector(`.plate video[data-slide="${no}"]`)
  : document.querySelector(`.slidev-page-${no} .video-player video`)) || null
function keepTime() {
  cancelAnimationFrame(slaveRaf)
  const r = recordedNow(), me = nav.currentSlideNo.value
  if (!r?.sync || printing.value || nav.isPresenter?.value) return
  let last = null
  const tick = () => {
    if (nav.currentSlideNo.value !== me) { if (last) try { last.playbackRate = 1 } catch { /* gone */ } return }
    const v = videoOf(r, me), m = musicClock(r.sync.track)
    if (v && m != null && !v.paused) {
      const k = slaveRate(v.currentTime, m, r.sync.at)
      if (k.seek != null) { try { v.currentTime = k.seek } catch { /* not seekable yet */ } }
      v.playbackRate = k.rate
      last = v
    }
    slaveRaf = requestAnimationFrame(tick)
  }
  slaveRaf = requestAnimationFrame(tick)
}
const onVisibility = () => { rest(); updateHum() }

// slidev-addon-videos announces its transitions on window. A clip arriving
// as particles draws the world's dust toward the screen with it, one leaving
// shoves it back out; and while a clip covers the slide the world rests —
// the renderer stops, so the machine's GPU is the decoder's alone.
let coverTimer = 0
let debugTimer = 0
const onVideoTransition = (e) => {
  const d = e.detail || {}
  if (!space || d.mode === 'cut') return
  if (d.phase === 'enter') {
    space.stir('gather', { seconds: (d.duration || 1400) / 1000 })
    if (d.mode === 'dust' && audible() && VOICES.clip !== false) playRise((d.duration || 1400) / 1000)
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
    coverTimer = setTimeout(() => { covered.value = true; rest(); updateHum() }, 600)
  } else {
    covered.value = false
    rest()
    updateHum()
  }
}

let still = false
// The probe the headless tools read (slidev-stage-shots, the smoke test): one
// documented object on window. canvas.__space, root.__space and root.__hum
// stay as aliases for the probes written against them.
//
//   __stage.state()          → { slide, total, clicks, clicksTotal, at, station, atStation, stop,
//                                flying, arrived, paused, assembled, static, layer, plate, changedAt,
//                                elapsed, frames, dpr, guard, dust }
//   __stage.settle({ min, max }) → Promise<{ settled, engineSec, ms }>: resolves once the camera
//                                has landed, nothing assembles and `min` engine-seconds have passed
//                                since the last pose or step change (`max` wall-seconds at most)
//   __stage.holdQuality()    the frame-rate guard keeps the full pixel ratio and dust
//   __stage.fps(seconds)     → Promise<{ fps, engineSecPerSec }>, measured on the live page
//   __stage.space / .probe / .hum   the engine's API, its render handles, the hum probe
function probeState() {
  const p = space ? canvas.value?.__space : null   // a handle whose engine failed to start reads nothing
  const g = p?.field?.geometry
  return {
    slide: nav.currentSlideNo.value,
    total: nav.total.value,
    clicks: clicks.value,
    clicksTotal: nav.clicksTotal.value,
    at: space?.currentTarget ?? null,
    station: space?.activeStation ?? null,
    atStation: space?.atStation ?? null,
    stop: stopId.value,
    flying: !!space?.flying,
    arrived: !!space?.arrived,
    paused: !!space?.paused,
    assembled: document.documentElement.dataset.spaceAssembled === '1' && !space?.busy,   // every form done, none still moving
    static: staticBg.value,
    layer: layer.value,                 // what stands under the slide (stage/fallback.js)
    plate: plateState.value,            // the plate's state (StagePlate.vue)
    changedAt,
    elapsed: p?.elapsed ?? 0,
    realTime: space?.realTime ?? 0,     // seconds at rate 1 (what settle counts)
    rate: space?.rate ?? 1,
    cameraRate: space?.cameraRate ?? 1,
    clockLeft: space?.clockLeft ?? 0,   // real seconds until the rates and a timed path hold
    frames: p?.frames ?? 0,
    dpr: p?.dpr ?? null,
    guard: p?.guardStage ?? null,
    dust: g ? Math.min(g.drawRange.count, g.attributes.position.count) : 0,
    steps: allSteps(),                  // the step bus now (stage/steps.js)
  }
}
function settle({ min = 6, max = 30 } = {}) {
  return new Promise((done) => {
    const t0 = performance.now(), e0 = space?.realTime ?? 0
    const check = () => {
      const s = probeState()
      // counted in seconds at rate 1, so a slowed world settles in the same time; a
      // world and camera stood still (rate 0) are as settled as they will get
      const frozen = s.rate === 0 && s.cameraRate === 0 && s.clockLeft <= 0
      const still = !space || s.paused || frozen || (!s.flying && s.assembled && s.clockLeft <= 0 && s.realTime - changedAt >= min)
      const ms = performance.now() - t0
      // on a loaded machine the world runs slow (a frame is at most 1/12 s of it): the
      // wall cap stretches, up to fourfold, to what the measured pace needs, so a slow
      // run is not counted a failure
      const pace = ms > 2000 ? (s.realTime - e0) / (ms / 1000) : 1
      const need = pace > 0 ? ((min + s.clockLeft) / pace) * 1.25 : 0
      const cap = Math.min(max * 4, Math.max(max, need))
      if (still || ms > cap * 1000) done({ settled: still, engineSec: +(s.realTime - e0).toFixed(3), ms: Math.round(ms), ...(cap > max ? { stretched: +cap.toFixed(1) } : {}) })
      else requestAnimationFrame(check)
    }
    check()
  })
}
function fps(seconds = 2) {
  return new Promise((done) => {
    const p = canvas.value?.__space
    if (!p) { done({ fps: 0, engineSecPerSec: 0 }); return }
    const f0 = p.frames, e0 = p.elapsed, t0 = performance.now()
    setTimeout(() => {
      const s = (performance.now() - t0) / 1000
      done({ fps: +((p.frames - f0) / s).toFixed(2), engineSecPerSec: +((p.elapsed - e0) / s).toFixed(3) })
    }, seconds * 1000)
  })
}
const stageProbe = {
  version: 1,
  state: probeState,
  settle,
  fps,
  holdQuality: () => canvas.value?.__space?.holdQuality(),
  get space() { return space },
  get probe() { return canvas.value?.__space ?? null },
  hum: humProbe,
}

onMounted(() => {
  const html = document.documentElement
  window.__stage = stageProbe
  html.dataset.stage = '1'
  // Print mounts one stage per page; the page-wide marks stay while any is up
  html.dataset.stageMounts = String((Number(html.dataset.stageMounts) || 0) + 1)
  if (LOOK) html.dataset.stageLook = LOOK    // the CSS kit keys on html[data-stage-look]
  for (const [k, v] of Object.entries(paletteVars(palette))) html.style.setProperty(k, v)
  // a print page (its container, html.print, ?print, or the print route): no world, its still
  printing.value = inPrint(root.value) || printRoute()
  still = props.staticGround || printing.value
  layerBase.value = still ? 'still' : 'world'
  watch(layer, (l) => { html.dataset.stageLayer = l }, { immediate: true })
  if (still) { staticBg.value = true; assembled(true); return }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keydown', onGesture, { once: true })
  window.addEventListener('pointerdown', onGesture, { once: true })
  if (withVideos) {
    window.addEventListener('slidev-videos:transition', onVideoTransition)
    window.addEventListener('slidev-videos:cover', onVideoCover)
  }
  if (root.value) root.value.__hum = humProbe   // for the headless probes
  if (debug) { renderDebug(); debugTimer = setInterval(renderDebug, 1000) }
  boot()
})
onUnmounted(() => {
  if (still) return   // the printed pages share <html>: what one set, the others still need
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keydown', onGesture)
  window.removeEventListener('pointerdown', onGesture)
  window.removeEventListener('slidev-videos:transition', onVideoTransition)
  window.removeEventListener('slidev-videos:cover', onVideoCover)
  clearTimeout(coverTimer)
  clearInterval(debugTimer)
  clearTimeout(restoreTimer)
  cancelAnimationFrame(slaveRaf)
  canvas.value?.removeEventListener('webglcontextlost', onContextLost)
  const html = document.documentElement
  const left = Math.max(0, (Number(html.dataset.stageMounts) || 1) - 1)
  if (left) html.dataset.stageMounts = String(left)
  else {
    // the last stage gone: the page-wide marks go with it (with one per print
    // page, the first unmount took html[data-stage], and with it the CSS kit
    // and every deck style scoped to it, from every page)
    stopHum()
    assembled(true)
    delete html.dataset.stageMounts
    delete html.dataset.stage
    delete html.dataset.stageLook
    delete html.dataset.spaceStop
    delete html.dataset.stageLayer
  }
  if (window.__stage === stageProbe) delete window.__stage
  stopHum()
  assembled(true)
  delete document.documentElement.dataset.stage
  delete document.documentElement.dataset.spaceStop
  // the fallback's marks are this stage's alone (StagePlate takes its own with it)
  delete html.dataset.stageFallback
  delete html.dataset.stagePlateNext
  space?.dispose()
  space = null
})
</script>

<template>
  <div ref="root" class="stage" :class="{ 'static-bg': staticBg, ready }" :data-clicks="clicks" :data-clicks-total="clicksTotal">
    <canvas ref="canvas" :key="canvasKey" class="field" aria-hidden="true"></canvas>
    <img v-if="stillShown && !livingOn" class="still" :src="stillSrc" alt="" aria-hidden="true" decoding="async" @error="onStillError" />
    <!-- where the world cannot run: the still breathing, and over it the slide's recorded plate (stage/fallback.js); the scrim and the text over both, as over the world -->
    <StageLiving v-if="livingOn" :src="stillShown ? stillSrc : ''" :seed="nav.currentSlideNo.value" :covered="livingRest" :motion="MOTION" @error="onStillError" />
    <StagePlate v-if="!printing && (layerBase === 'plate' || layer === 'plate')" :from="layerBase === 'world' ? plateFrom : null" :slide="nav.currentSlideNo.value" :total="nav.total.value" :dir="PLATES" :base="base()" :remote="PLATE_REMOTE" :local-first="PLATE_LOCAL_FIRST" :covered="covered" @state="onPlateState" @exhausted="onPlateExhausted" />
    <div class="scrim" aria-hidden="true" :style="{ opacity: dim }"></div>
    <!-- not in print: an SVG noise filter prints as a page-sized raster on every page -->
    <div v-if="!printing" class="grain" aria-hidden="true"></div>
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
    <!-- on body: the slide is scaled down on a phone, the panel should not be -->
    <Teleport to="body"><pre v-if="debug" class="stage-debug">{{ debugText }}</pre></Teleport>
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
/* the slide's still, where the world cannot run (print, the fallback); under the scrim like the world */
.still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
/* Scrim between the world and the slide: keeps body copy legible over a busy
   pose. Opacity comes from `dim` (frontmatter `space.dim`, else the layout). */
.scrim {
  position: absolute; inset: 0; pointer-events: none;
  transition: opacity 0.6s ease;
  background: linear-gradient(180deg, rgba(var(--stage-bg-rgb, 5, 5, 7), 0.96) 0%, rgba(var(--stage-bg-rgb, 5, 5, 7), 0.88) 62%, rgba(var(--stage-bg-rgb, 5, 5, 7), 0.45) 100%);
  filter: brightness(var(--stage-ambient, 1));   /* space.ambient 0: its tint goes to black with the ground */
}
.grain {
  position: absolute; inset: 0; pointer-events: none; opacity: calc(0.05 * var(--stage-ambient, 1));
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
/* ?stage-debug: what the stage could and could not do, readable on a phone */
.stage-debug {
  position: fixed; left: 8px; right: 8px; top: 8px; z-index: 1000; margin: 0; padding: 8px 10px;
  max-height: 60vh; overflow: auto; white-space: pre-wrap; word-break: break-word;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #e8f0f8;
  background: rgba(0, 0, 0, 0.78); border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 6px;
  pointer-events: auto; user-select: text; -webkit-user-select: text;
}
.hud-enter-active, .hud-leave-active { transition: opacity 0.6s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
.hud-enter-from, .hud-leave-to { opacity: 0; transform: translateY(8px); }
</style>
