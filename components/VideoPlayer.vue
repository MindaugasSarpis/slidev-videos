<script>
// Module scope (runs once): state shared by every VideoPlayer instance.
import { ref } from 'vue'

// ---- session volume ---------------------------------------------------------
// `+` / `-` set a presenter-chosen level that sticks for every later clip in
// this browser (this module-scope ref is shared by all players, mirrored to
// localStorage), so one adjustment at the venue fixes the whole talk. Until a
// key is pressed each clip uses its `volume` prop / `videos.volume` config.
// Venue lesson: a Mac over HDMI ignores keyboard and room volume controls
// (digital output), so the in-page level is the only handle the presenter has.
const VOLUME_KEY = 'slidev-addon-videos:volume'
const VOLUME_STEP = 0.1
const sessionVolume = ref(readStoredVolume())
function readStoredVolume() {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY))
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
  } catch { return null }
}
function setSessionVolume(v) {
  sessionVolume.value = v
  try { localStorage.setItem(VOLUME_KEY, String(v)) } catch {}
}
</script>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useIsSlideActive, useNav, useSlideContext, configs } from '@slidev/client'
import { getOverlay, announce, warmStrip, stripFrame, liveFrame, fitPicture, meanColor, isLit, firstLitFrame, loadFrameIndex } from './video-dust/bus.js'

// Config resolution (headmatter beats env beats built-ins):
//   videos:                       VITE_VIDEO_REPO
//     repo: owner/repo            VITE_VIDEO_RELEASE
//     release: videos-web         VITE_VIDEO_SHARED_REPO + VITE_VIDEO_SHARED_RELEASE
//     shared: owner/repo@tag | false
//     fit: cover | contain
//     hq: false                   (opt-in: only clips with an encode-hq copy)
//     volume: 1                   (0..1, default level before `+`/`-` are used)
//     transition: cut             (cut | fade | dust — how a clip arrives and leaves)
//     dust: '#7dd3fc'             (the colour of the grains in flight, `dust` only)
//     dustFrom: lit               (lit | start — a clip that opens on black arrives as its first lit frame and plays from there)
//     dustStyle: frame            (frame | flight — grains fill the frame and condense in place, or gather into a card that flies in)
//     advanceOnEnd: false         (true — when a clip ends, the deck goes on to the next slide)
//   per player: exit="push" exit-at="0.44,0.40" (the camera pushes on into that point
//   of the frame and the screen ends in black; exit-ms, exit-hold, exit-lift)
const CFG = (configs && configs.videos) || {}
const ENV = import.meta.env
const REPO    = CFG.repo    || ENV.VITE_VIDEO_REPO    || ''
const RELEASE = CFG.release || ENV.VITE_VIDEO_RELEASE || 'videos'
function parseShared(v) {
  if (v === false || v === '') return null
  if (typeof v === 'string' && v.includes('@')) {
    const [repo, tag] = v.split('@')
    if (repo.includes('/') && tag) return { repo, tag }
    return null
  }
  return undefined // not configured here — try env, then default
}
let SHARED = parseShared(CFG.shared)
if (SHARED === undefined) {
  if (ENV.VITE_VIDEO_SHARED_RELEASE) {
    SHARED = { repo: ENV.VITE_VIDEO_SHARED_REPO || REPO, tag: ENV.VITE_VIDEO_SHARED_RELEASE }
  } else {
    SHARED = { repo: 'MindaugasSarpis/slidev-videos', tag: 'videos-shared' }
  }
}
const dl = (repo, tag) => repo ? `https://github.com/${repo}/releases/download/${tag}` : ''
const REMOTE_BASE        = dl(REPO, RELEASE)
const SHARED_REMOTE_BASE = SHARED ? dl(SHARED.repo, SHARED.tag) : ''
if (!REMOTE_BASE && !SHARED_REMOTE_BASE && typeof console !== 'undefined') {
  console.warn('[slidev-addon-videos] no repo configured (videos.repo headmatter or VITE_VIDEO_REPO) — only local files will play')
}

const props = defineProps({
  src:      { type: String, required: true },
  fallback: { type: String, default: '' },   // explicit URL override for the own-release step
  // Start playing when the slide becomes active. `false` = wait for the
  // presenter to press play (the clip still preloads so its first frame and
  // the controls are visible) — a cold open the presenter cues by hand.
  autoplay: { type: Boolean, default: true },
  loop:     { type: Boolean, default: false },
  muted:    { type: Boolean, default: false },
  controls: { type: Boolean, default: true },
  // Native controls stay hidden and only appear while the pointer is over the
  // bottom control strip, or for a few seconds after a click/tap on the video.
  // `false` = controls always visible (when `controls` is on).
  autoHideControls: { type: Boolean, default: true },
  // Try the venue-quality `videos-hq/` copy first. Opt-in per clip (or via
  // `videos.hq`): only clips with an `encode-hq` copy have one; for any other
  // clip the attempt just 404s and races the fallback chain.
  hq:       { type: Boolean, default: undefined },
  // Playback volume, 0..1. Applied on every activation unless the presenter
  // has set a session level with `+` / `-`. `undefined` = `videos.volume`
  // config, else 1.
  volume:   { type: Number, default: undefined },
  // cover = fill the frame edge-to-edge (default; crops non-16:9 slightly).
  // contain = letterbox instead of cropping (ultra-wide/portrait clips).
  fit:      { type: String, default: '' },
  // How the clip arrives and leaves with its slide:
  //   cut   (default) on when ready, off at once
  //   fade  the picture dissolves in and out, the sound fades with it
  //   dust  the picture condenses out of particles and breaks back into them;
  //         needs the addon's overlay and a frame to colour the grains from
  //         (`slidev-videos frames`, or a same-origin clip) — else it fades
  transition: { type: String, default: '' },
  // Colour of the grains while they fly (`dust`). Default `videos.dust`, else #7dd3fc.
  dust:     { type: String, default: '' },
  // How the grains move (`dust`): frame (default) fills the whole frame and
  // condenses in place; flight gathers a card off in the world that flies in.
  dustStyle: { type: String, default: '' },
  // When the clip ends, go on to the next slide by itself, once. Only the
  // audience's slide does it (never the presenter window, the overview, the
  // next-slide preview or a print), only while the slide is still the one the
  // clip started on with no click taken since, and never for a looping clip.
  // `undefined` = `videos.advanceOnEnd`, else false.
  advanceOnEnd: { type: Boolean, default: undefined },
  // How the clip leaves, beyond `transition`: `push` pushes the camera on into
  // the point `exitAt` of the frame ("0.44,0.40", fractions of the clip's own
  // frame): the clip keeps playing as it rushes at the lens, accelerating, over
  // `exitMs` (default 1200), its grains streaming past; the screen ends in
  // black, held `exitHold` ms (600), then lifted over `exitLift` ms (500) onto
  // the next slide. Needs the dust overlay (else the clip leaves as
  // `transition` says) and a strip or a readable frame for the grains.
  exit:     { type: String, default: '' },
  exitAt:   { type: String, default: '' },
  exitMs:   { type: Number, default: 1200 },
  exitHold: { type: Number, default: 600 },
  exitLift: { type: Number, default: 500 },
})
const effHq     = computed(() => props.hq === undefined ? (CFG.hq ?? false) : props.hq)
const effFit    = computed(() => props.fit || CFG.fit || 'cover')
const clamp01   = (v) => Math.min(1, Math.max(0, v))
const TRANSITIONS = ['cut', 'fade', 'dust']
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const effTransition = computed(() => {
  const t = String(props.transition || CFG.transition || 'cut').toLowerCase()
  if (!TRANSITIONS.includes(t)) return 'cut'
  return t === 'dust' && REDUCED_MOTION ? 'fade' : t
})
const effDust = computed(() => props.dust || CFG.dust || '#7dd3fc')
const effPush = computed(() => String(props.exit || '').toLowerCase() === 'push')
const exitVia = computed(() => {
  const m = String(props.exitAt || '').split(/[\s,]+/).map(Number)
  return m.length === 2 && m.every(Number.isFinite) ? m.map((v) => Math.min(1, Math.max(0, v))) : [0.5, 0.5]
})
const effDustStyle = computed(() => String(props.dustStyle || CFG.dustStyle || 'frame').toLowerCase() === 'flight' ? 'flight' : 'frame')
const effVolume = computed(() => {
  const v = props.volume === undefined ? CFG.volume : props.volume
  return Number.isFinite(v) ? clamp01(v) : 1
})

// Fallback chain. Deploys strip local videos/ (served from the release), so
// PROD probes the remotes first — a guaranteed local 404 only delays playback.
// DEV keeps local copies and probes them first (fast, offline).
// VITE_VIDEOS_LOCAL_FIRST=1 at build time flips a keep-videos (offline
// backup) build to local-first.
const base = computed(() => import.meta.env.BASE_URL || '/')
const hqLocalSrc = computed(() => `${base.value}videos-hq/${props.src}`)
const webLocalSrc = computed(() => `${base.value}videos/${props.src}`)
const webRemoteSrc = computed(() => props.fallback || (REMOTE_BASE ? `${REMOTE_BASE}/${props.src}` : ''))
const sharedRemoteSrc = computed(() => SHARED_REMOTE_BASE ? `${SHARED_REMOTE_BASE}/${props.src}` : '')
const LOCAL_FIRST = import.meta.env.DEV || ENV.VITE_VIDEOS_LOCAL_FIRST === '1'
const fallbackChain = computed(() => {
  const locals = effHq.value ? [hqLocalSrc.value, webLocalSrc.value] : [webLocalSrc.value]
  const remotes = [webRemoteSrc.value, sharedRemoteSrc.value]
  const chain = (LOCAL_FIRST ? [...locals, ...remotes] : [...remotes, ...locals]).filter(Boolean)
  return chain.filter((url, i) => i === 0 || url !== chain[i - 1])
})

const videoRef = ref(null)
const sourceRef = ref(null)
const chainIndex = ref(0)
const currentSrc = computed(() => fallbackChain.value[chainIndex.value] || '')
const status = ref('idle')
const isActive = useIsSlideActive()

const mimeType = computed(() => {
  const ext = props.src.split('.').pop()?.toLowerCase()
  if (ext === 'webm') return 'video/webm'
  return 'video/mp4'
})

// --- Fallback chain advance ---
let switching = false
function onError() {
  if (switching || !attached.value) return
  // A <source> error is only real once resource selection has given up
  // (NETWORK_NO_SOURCE). Chrome also fires stale ones — from the empty src the
  // element mounted with, or from a request it aborted itself to re-issue
  // with a Range header — while a fresh load is already in flight; acting on
  // those skips a working tier and can exhaust the chain.
  const video = videoRef.value
  if (video && video.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE) return
  if (chainIndex.value < fallbackChain.value.length - 1) {
    switching = true
    status.value = 'loading'
    chainIndex.value += 1
    nextTick(() => {
      videoRef.value?.load()
      switching = false
    })
  } else {
    status.value = 'error'
  }
}

// ---- fade / dust ------------------------------------------------------------
// With a transition the picture is held back (`revealed`) until its moment and
// the sound is ramped rather than switched. `run` numbers every arrival and
// departure: each step after an await checks it, so a presenter stepping
// through quickly never has a stale step start a clip on a slide already left.
const FADE_MS = 450          // picture dissolve, and the sheet's hand-over to the <video>
const INSTANT_MS = 200       // the picture going under a leaving sheet (.video-instant)
// `videos.dustMs: [arrive, leave]` sets the two
const DUST_MS = Array.isArray(CFG.dustMs) ? CFG.dustMs.map(Number) : []
const DUST_ENTER_MS = DUST_MS[0] > 0 ? DUST_MS[0] : 1900
const DUST_LEAVE_MS = DUST_MS[1] > 0 ? DUST_MS[1] : 1700
const AUDIO_IN_MS = 600
const AUDIO_OUT_MS = 400
const revealed = ref(effTransition.value === 'cut')
const instant = ref(false)   // hide quickly, without the long dissolve: a sheet of grains is coming up over the picture
let phase = 'idle'           // idle | entering | shown | leaving
let run = 0
let sheet = null             // the arriving sheet, while it is up
let ramp = null              // { raf, to }
let settle = null            // resolves the wait for the clip to be ready

const targetVolume = () => sessionVolume.value ?? effVolume.value
function cancelRamp() {
  if (ramp) { cancelAnimationFrame(ramp.raf); ramp = null }
}
function rampVolume(video, to, ms, then) {
  cancelRamp()
  const from = video.volume, t0 = performance.now()
  const state = { raf: 0, to }
  const step = (now) => {
    const u = Math.min(1, (now - t0) / ms)
    try { video.volume = clamp01(from + (to - from) * u) } catch {}
    if (u < 1) state.raf = requestAnimationFrame(step)
    else { if (ramp === state) ramp = null; then?.() }
  }
  ramp = state
  state.raf = requestAnimationFrame(step)
}
function whenSettled() {
  settle?.()
  if (status.value === 'ready' || status.value === 'error') return Promise.resolve()
  return new Promise((resolve) => { settle = () => { settle = null; resolve() } })
}
watch(status, (s) => { if (s === 'ready' || s === 'error') settle?.() })

// Put a sheet of particles over the picture. The colours come from the frame
// on screen when the page may read it, else from the clip's strip.
let sheetColor = null        // the mean colour of the frame the last sheet was made of
let startAt = 0              // where the clip plays from: 0, or the time of its first lit frame
const FROM_LIT = String(CFG.dustFrom || 'lit').toLowerCase() !== 'start'

// The frame a sheet is made of. Leaving: the one on screen. Arriving: the
// clip's first frame, unless that is black (a clip fading in) — grains cannot
// gather into a black picture, so the sheet is made of the first lit frame
// within the opening seconds and the clip plays from there (`dustFrom:
// start` keeps the opening as it is).
async function sheetFrame(kind, time) {
  const live = liveFrame(videoRef.value)
  if (kind !== 'enter') return live || await stripFrame(props.src, time)
  startAt = 0
  if (live && (!FROM_LIT || isLit(live.image))) return live
  if (FROM_LIT) {
    const lit = await firstLitFrame(props.src)
    if (lit) { startAt = lit.time; return lit }
  }
  return live || await stripFrame(props.src, 0)
}
// resolves when the <video> has finished seeking, or after a second and a half
function seekTo(video, t) {
  return new Promise((resolve) => {
    let done = false
    const end = () => { if (done) return; done = true; video.removeEventListener('seeked', end); clearTimeout(timer); resolve() }
    const timer = setTimeout(end, 1500)
    video.addEventListener('seeked', end)
    try { video.currentTime = t } catch { end() }
  })
}

let lastFit = null           // the last sheet's picture rect (screen px) and visible part of the frame
async function raiseSheet(kind, time, extra = {}) {
  const overlay = getOverlay()
  const wrap = wrapRef.value
  sheetColor = null
  if (!overlay || !wrap) return null
  const frame = await sheetFrame(kind, time)
  if (!frame) return null
  sheetColor = meanColor(frame.image)
  let box = wrap.getBoundingClientRect()
  // A full-bleed player is the slide: use the slide's own box, which holds
  // still while a sliding page transition carries the player across.
  const stage = wrap.closest('#slide-content') || wrap.closest('.slidev-slide-content')
  const sb = stage?.getBoundingClientRect()
  if (sb && sb.width > 2 && (box.width < 2 || (Math.abs(box.width - sb.width) < 2 && Math.abs(box.height - sb.height) < 2))) box = sb
  if (box.width < 2 || box.height < 2) return null
  const { rect, uv } = fitPicture(box, frame.size, effFit.value)
  lastFit = { rect, uv }
  return overlay[kind]({ image: frame.image, rect, uv, dust: effDust.value, style: effDustStyle.value, source: frame.source, duration: kind === 'enter' ? DUST_ENTER_MS : DUST_LEAVE_MS, ...extra })
}

async function enter() {
  const id = ++run
  phase = 'entering'
  startAt = 0
  const mode = effTransition.value
  const video = videoRef.value
  cancelRamp()
  instant.value = true
  revealed.value = false
  if (video) {
    video.pause()
    video.muted = true
    if (video.currentTime > 0.01) { try { video.currentTime = 0 } catch {} }
  }
  announce('transition', { phase: 'enter', mode, src: props.src, duration: mode === 'dust' ? DUST_ENTER_MS : FADE_MS })
  await nextTick()             // the slide is laid out before the sheet measures it
  instant.value = false
  if (id !== run) return
  if (mode === 'dust') {
    const handle = await raiseSheet('enter', 0)
    if (id !== run) { handle?.cancel(); return }
    sheet = handle
    if (handle) {
      await handle.assembled
      if (id !== run) return
    }
  }
  // The sheet holds the first frame for as long as the clip needs to arrive.
  await whenSettled()
  if (id !== run) return
  // the sheet is the clip's first lit frame: the clip takes over from that moment
  if (sheet && startAt > 0 && videoRef.value && status.value === 'ready') {
    await seekTo(videoRef.value, startAt)
    if (id !== run) return
  }
  phase = 'shown'
  const v = videoRef.value
  sheet?.release(status.value === 'error' ? 300 : FADE_MS)
  sheet = null
  revealed.value = true
  if (!v || status.value === 'error') return
  announce('cover', { covered: true, src: props.src, fit: effFit.value })
  if (!props.autoplay) {
    v.muted = props.muted
    v.volume = targetVolume()
    return
  }
  v.volume = 0
  v.muted = true
  v.play().then(() => {
    if (id !== run) return
    if (!props.muted) v.muted = false
    rampVolume(v, targetVolume(), AUDIO_IN_MS)
  }).catch(() => { try { v.volume = targetVolume() } catch {} })
}

async function exit() {
  const id = ++run
  const wasShown = phase === 'shown' && status.value === 'ready'
  phase = 'leaving'
  settle?.()
  sheet?.cancel()
  sheet = null
  const mode = effTransition.value
  const video = videoRef.value
  announce('cover', { covered: false, src: props.src, fit: effFit.value })
  let handle = null
  const push = effPush.value && wasShown && !!video
  if ((mode === 'dust' || push) && wasShown && video) {
    handle = push
      ? await raiseSheet('leave', video.currentTime || 0, { style: 'push', via: exitVia.value, duration: Math.max(200, props.exitMs), hold: Math.max(0, props.exitHold), lift: Math.max(0, props.exitLift) })
      : await raiseSheet('leave', video.currentTime || 0)
    if (id !== run) { handle?.cancel(); return }
    // the live clip rushes in under the grains, playing on
    if (push && handle && lastFit) getOverlay()?.zoom?.({ video, rect: lastFit.rect, uv: lastFit.uv, via: exitVia.value, duration: Math.max(200, props.exitMs) })
  }
  const pushing = push && !!handle
  const leaveMs = pushing ? Math.max(200, props.exitMs) + Math.max(0, props.exitHold) + Math.max(0, props.exitLift) : mode === 'dust' ? DUST_LEAVE_MS : FADE_MS
  // `color`: what the picture was, on the whole, as it broke up — for whoever wants to carry it on
  announce('transition', { phase: 'leave', mode: pushing ? 'push' : mode, src: props.src, duration: leaveMs, color: handle ? sheetColor : null })
  instant.value = !!handle     // the sheet is the picture now; the <video> goes at once
  revealed.value = false
  const rest = () => {
    if (id !== run) return
    phase = 'idle'
    instant.value = false
    const v = videoRef.value
    if (!v) return
    v.pause()
    v.muted = true
    try { v.currentTime = 0 } catch {}
  }
  // The clip plays on, unseen, while its sound fades; then it rests. It rests
  // only once the picture has gone: back at its first frame while it still
  // showed, an ended or muted clip flashed that frame under the sheet.
  // Pushing, it plays on (unseen; the overlay draws it) through the push, its
  // sound going with it, and rests once the push is over.
  if (pushing) {
    if (!video.paused && !video.muted) rampVolume(video, 0, Math.max(200, props.exitMs))
    setTimeout(rest, Math.max(200, props.exitMs) + 50)
  } else if (video && wasShown && !video.paused && !video.muted) rampVolume(video, 0, AUDIO_OUT_MS, rest)
  else setTimeout(rest, handle ? INSTANT_MS : FADE_MS)
}

function syncTransition() {
  if (!videoRef.value) return
  if (isActive.value) {
    if (phase === 'idle' || phase === 'leaving') enter()
  } else if (phase === 'entering' || phase === 'shown') {
    exit()
  }
}

function syncPlayback() {
  if (effTransition.value !== 'cut') return syncTransition()
  const video = videoRef.value
  if (!video) return
  if (isActive.value) {
    if (!attached.value) return          // the attach watcher loads first, then re-runs this
    video.currentTime = 0
    video.volume = sessionVolume.value ?? effVolume.value
    if (!props.autoplay) {
      // Manual start: the presenter's click on the controls is the gesture,
      // so it may play with sound straight away.
      video.muted = props.muted
      return
    }
    video.muted = true
    video.play().then(() => {
      if (!props.muted) video.muted = false
    }).catch(() => {})
  } else {
    video.pause()
    video.muted = true
    video.currentTime = 0
  }
}

watch(isActive, syncPlayback, { immediate: true })

function onLoaded() {
  status.value = 'ready'
  syncPlayback()
}

// ---- auto-hiding controls -------------------------------------------------
// The native control bar sits along the bottom edge. We toggle the `controls`
// attribute itself (not CSS: the bar's DOM differs per browser), so it is
// simply absent until wanted: pointer inside the bottom strip → shown; pointer
// elsewhere or gone → hidden after a short grace; click/tap on the video →
// shown for a few seconds. When shown, the bar handles its own hit-testing —
// there is no overlay element to steal its clicks. Pointer tracking is done
// on `window`, not the player: Slidev's own navigation bar floats over the
// bottom of the slide and would otherwise swallow the hover.
const CONTROL_STRIP_PX = 72      // the native bar is ~50-60px tall
const HIDE_GRACE_MS = 700        // pointer left the strip
const CLICK_SHOW_MS = 3500       // after a click/tap
const wrapRef = ref(null)
const controlsVisible = ref(false)
const showControls = computed(() => props.controls && (!props.autoHideControls || controlsVisible.value))
let hideTimer = null
function scheduleHide(ms) {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { controlsVisible.value = false }, ms)
}
function reveal(ms) {
  clearTimeout(hideTimer)
  controlsVisible.value = true
  if (ms != null) scheduleHide(ms)
}
function onWindowMove(e) {
  if (!props.autoHideControls || !isActive.value || !wrapRef.value) return
  const r = wrapRef.value.getBoundingClientRect()
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  const inStrip = inside && e.clientY >= r.bottom - CONTROL_STRIP_PX
  if (inStrip) reveal()
  else if (controlsVisible.value) scheduleHide(HIDE_GRACE_MS)
}
function onPointerGone() {
  // Pointer left the player (or the window): no further mousemove will come.
  if (props.autoHideControls && controlsVisible.value) scheduleHide(HIDE_GRACE_MS)
}
function onVideoClick(e) {
  if (!props.autoHideControls) return
  const r = e.currentTarget.getBoundingClientRect()
  // A click inside the strip lands on the (now visible) native bar — leave it
  // to the browser. Elsewhere on the picture: reveal for a moment.
  if (e.clientY < r.bottom - CONTROL_STRIP_PX) reveal(CLICK_SHOW_MS)
}
function onVideoTouch() {
  if (props.autoHideControls) reveal(CLICK_SHOW_MS)
}

// ---- keyboard ---------------------------------------------------------------
// `p` toggles play/pause, `+` / `-` step the volume — all on the active
// slide's player and without revealing the control bar (Slidev binds
// space/arrows/o/d/g/f; these keys are free). `=` counts as `+` so the
// unshifted key works too; `_` likewise as `-`.
const BADGE_MS = 1200
const volumeBadge = ref(null)   // 0-100 while the badge is shown
let badgeTimer = null
function flashVolume(v) {
  volumeBadge.value = Math.round(v * 100)
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => { volumeBadge.value = null }, BADGE_MS)
}
function stepVolume(video, dir) {
  // mid-fade the element's volume is on its way somewhere: step from where it is going
  const from = ramp ? ramp.to : video.volume
  cancelRamp()
  const next = clamp01(Math.round((from + dir * VOLUME_STEP) * 10) / 10)
  video.volume = next
  if (dir > 0 && video.muted && !props.muted) video.muted = false
  setSessionVolume(next)
  flashVolume(next)
}
function onKey(e) {
  if (!isActive.value) return
  const key = e.key
  const isPlay = key === 'p' || key === 'P'
  const isUp = key === '+' || key === '='
  const isDown = key === '-' || key === '_'
  if (!isPlay && !isUp && !isDown) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  const video = videoRef.value
  if (!video) return
  e.preventDefault()
  if (isUp) return stepVolume(video, +1)
  if (isDown) return stepVolume(video, -1)
  if (video.paused) {
    video.muted = props.muted
    video.play().catch(() => {})
  } else {
    video.pause()
  }
}

onMounted(() => {
  if (!isLive.value) findPoster()
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousemove', onWindowMove, { passive: true })
  document.documentElement.addEventListener('mouseleave', onPointerGone)
  // <source> error events don't bubble to <video> on iOS Safari.
  sourceRef.value?.addEventListener('error', onError)
  // The immediate watcher above may fire before refs are populated —
  // re-run once refs exist so the initially-active slide actually loads.
  syncPlayback()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousemove', onWindowMove)
  document.documentElement.removeEventListener('mouseleave', onPointerGone)
  clearTimeout(hideTimer)
  clearTimeout(badgeTimer)
  run++
  cancelRamp()
  settle?.()
  sheet?.cancel()
  if (phase === 'shown') announce('cover', { covered: false, src: props.src, fit: effFit.value })
})

// Only the real slide (and the presenter's main view) gets a <video>. The
// overview / next-slide preview render a static placeholder instead: the
// overview mounts every slide at once, so a video-heavy deck would put ~30
// media elements on the machine, and its copy of the CURRENT slide is
// "active" too, so it re-downloaded the clip being watched.
const { $page, $renderContext } = useSlideContext()
// Print and PDF export (`?print`, html.print) are never live either: a print
// page mounts every slide's player at once, and a clip the exporting browser
// cannot decode (H.264 in Playwright's Chromium) printed as a blank box.
const PRINTING = typeof location !== 'undefined' && (/[?&]print\b/.test(location.search) || !!document.documentElement?.classList.contains('print'))
const isLive = computed(() => !PRINTING && ($renderContext.value === 'slide' || $renderContext.value === 'presenter'))

// In print, PDF export and the overview the placeholder shows the clip's
// first lit frame: the poster `slidev-videos frames` writes beside the strip
// (full size), else the strip's first lit tile, else the play icon.
const posterSrc = ref('')
async function findPoster() {
  try {
    const entry = (await loadFrameIndex())?.[props.src]
    if (entry?.poster) { posterSrc.value = `${base.value}video-frames/${entry.poster}`; return }
    const f = await firstLitFrame(props.src) || await stripFrame(props.src, 0)
    if (f?.image?.toDataURL) posterSrc.value = f.image.toDataURL('image/jpeg', 0.9)
  } catch { /* the play icon stays */ }
}

// Attach window. A <video> only carries its <source> while its slide is the
// live one, one of the next PRELOAD_AHEAD slides (look-ahead: attach early
// with preload="auto" so the clip buffers while the current slide is up, in
// dev AND in production — <link rel="preload" as="video"> is rejected by
// Chrome and preloaded nothing, found on the deployed World of Particles
// deck 2026-09-07), or one of the KEEP_BEHIND slides just passed (a back-step
// resumes instantly). Everything else is detached and load()ed empty so the
// browser releases its media pipeline: Chrome caps the number of media
// elements that may be loaded at once (per renderer, ~10 on desktop), and
// beyond it every further load() just sits in NETWORK_LOADING with
// readyState 0 — no error, no event. Keeping every visited clip attached
// froze the World of Particles deck from its 9th clip on, web and offline
// alike (2026-09-09). Placeholder instances (overview) have no <video>.
const PRELOAD_AHEAD = 3
const KEEP_BEHIND = 1
const { currentPage, clicks, next, isPrintMode } = useNav()

// ---- advance on end ---------------------------------------------------------
// Armed each time the slide becomes the current one, with the click count it
// stands at; disarmed by leaving. The clip's `ended` goes on only from the
// arming it belongs to, and only once.
const effAdvance = computed(() => props.advanceOnEnd === undefined ? CFG.advanceOnEnd === true : props.advanceOnEnd)
let armed = null             // { clicks } while armed
watch(isActive, (on) => { armed = on ? { clicks: clicks?.value ?? 0 } : null }, { immediate: true })
function onEnded() {
  const a = armed
  armed = null
  if (!a || !effAdvance.value || props.loop || videoRef.value?.loop) return
  if ($renderContext.value !== 'slide' || isPrintMode?.value || !isActive.value) return
  // slidev-stage-record drives the deck itself and plays clips to their end
  // to stage the next slide's arrival: it moves on, not the clip
  if (typeof window !== 'undefined' && window.__rec) return
  if ($page?.value !== currentPage?.value || (clicks?.value ?? 0) !== a.clicks) return
  announce('advance', { src: props.src, from: $page.value })
  next()
}

const distance = computed(() => {
  const here = $page?.value
  const now = currentPage?.value
  if (!here || !now) return null
  return here - now
})
const isUpcoming = computed(() => distance.value !== null && distance.value > 0 && distance.value <= PRELOAD_AHEAD)
const isJustPassed = computed(() => distance.value !== null && distance.value < 0 && -distance.value <= KEEP_BEHIND)
const attached = computed(() => isLive.value && (isActive.value || isUpcoming.value || isJustPassed.value))

watch(attached, (yes) => {
  if (yes) {
    status.value = 'loading'
    // the strip comes in with the clip, so the grains have their colours on arrival
    if (effTransition.value === 'dust') warmStrip(props.src)
    nextTick(() => { videoRef.value?.load(); syncPlayback() })
  } else {
    status.value = 'idle'
    // <source src=""> is in the DOM after this tick; load() on it aborts the
    // fetch and frees the decoder/buffer for the clips still in the window.
    nextTick(() => videoRef.value?.load())
  }
}, { immediate: true })
</script>

<template>
  <div ref="wrapRef" class="video-player" :class="[`video-${effTransition}`, { 'video-instant': instant }]" :data-video-phase="revealed ? 'shown' : 'held'" @mouseleave="onPointerGone">
    <img v-if="!isLive && posterSrc" class="video-poster" :src="posterSrc" :style="{ objectFit: effFit }" alt="" />
    <div v-else-if="!isLive" class="video-placeholder">
      <svg class="video-placeholder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
      <span class="video-status">{{ src }}</span>
    </div>
    <template v-else>
    <div v-if="(status === 'loading' || status === 'idle') && effTransition === 'cut'" class="video-status">Loading video&hellip;</div>
    <div v-if="status === 'error'" class="video-status video-error">
      Video not available: <code>{{ src }}</code>
    </div>
    <video
      ref="videoRef"
      :loop="loop"
      :controls="showControls"
      muted
      playsinline
      webkit-playsinline
      :preload="attached || !autoplay ? 'auto' : 'none'"
      :style="{ objectFit: effFit }"
      @loadeddata="onLoaded"
      @ended="onEnded"
      @error="onError"
      @click="onVideoClick"
      @touchstart.passive="onVideoTouch"
      :class="{ 'video-ready': status === 'ready' && revealed }"
    >
      <source ref="sourceRef" :src="attached ? currentSrc : ''" :type="mimeType" />
    </video>
    <Transition name="volume-badge">
      <div v-if="volumeBadge !== null" class="volume-badge" aria-live="polite">
        {{ volumeBadge === 0 ? '🔇' : '🔊' }} {{ volumeBadge }}%
      </div>
    </Transition>
    </template>
  </div>
</template>

<style scoped>
.video-player {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: black;
}
.video-player video {
  display: block;
  width: 100%;
  height: 100%;
  /* object-fit set inline from the `fit` prop / videos.fit config:
     cover (default) fills the frame edge-to-edge; contain letterboxes. */
  opacity: 0;
  pointer-events: none;
}
.video-player video.video-ready {
  opacity: 1;
  pointer-events: auto;
}
/* fade / dust: what is under the slide shows until the picture is up, and the
   picture dissolves rather than cuts (450 ms = FADE_MS). */
.video-player.video-fade,
.video-player.video-dust {
  background: transparent;
}
.video-player.video-fade video,
.video-player.video-dust video {
  transition: opacity 0.45s ease;
}
/* under a sheet of grains the picture goes quickly, not at once: the sheet
   comes up over it in the same 0.2 s */
.video-player.video-instant video {
  transition: opacity 0.2s linear;
}
.video-status {
  position: absolute;
  padding: 2rem;
  opacity: 0.6;
  font-size: 0.9rem;
  color: white;
}
.video-error {
  color: #ef4444;
  opacity: 1;
}
.video-poster { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.video-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: white;
}
.video-placeholder .video-status {
  position: static;
  padding: 0;
}
.video-placeholder-icon {
  width: 4rem;
  height: 4rem;
  opacity: 0.6;
}
.volume-badge {
  position: absolute;
  top: 1rem;
  right: 1rem;
  padding: 0.35rem 0.7rem;
  border-radius: 0.4rem;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.volume-badge-enter-active,
.volume-badge-leave-active {
  transition: opacity 0.25s ease;
}
.volume-badge-enter-from,
.volume-badge-leave-to {
  opacity: 0;
}
</style>
