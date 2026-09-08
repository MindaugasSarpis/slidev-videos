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

// Config resolution (headmatter beats env beats built-ins):
//   videos:                       VITE_VIDEO_REPO
//     repo: owner/repo            VITE_VIDEO_RELEASE
//     release: videos-web         VITE_VIDEO_SHARED_REPO + VITE_VIDEO_SHARED_RELEASE
//     shared: owner/repo@tag | false
//     fit: cover | contain
//     hq: false                   (opt-in: only clips with an encode-hq copy)
//     volume: 1                   (0..1, default level before `+`/`-` are used)
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
})
const effHq     = computed(() => props.hq === undefined ? (CFG.hq ?? false) : props.hq)
const effFit    = computed(() => props.fit || CFG.fit || 'cover')
const clamp01   = (v) => Math.min(1, Math.max(0, v))
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
const hasBeenActive = ref(false)
const warmed = ref(false)

const mimeType = computed(() => {
  const ext = props.src.split('.').pop()?.toLowerCase()
  if (ext === 'webm') return 'video/webm'
  return 'video/mp4'
})

// --- Fallback chain advance ---
let switching = false
function onError() {
  if (switching || (!hasBeenActive.value && !warmed.value)) return
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

function syncPlayback() {
  const video = videoRef.value
  if (!video) return
  if (isActive.value) {
    if (!hasBeenActive.value) {
      hasBeenActive.value = true
      if (!warmed.value) {
        status.value = 'loading'
        nextTick(() => videoRef.value?.load())
      }
    }
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
  const next = clamp01(Math.round((video.volume + dir * VOLUME_STEP) * 10) / 10)
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
})

// Only the real slide (and the presenter's main view) gets a <video>. The
// overview / next-slide preview render a static placeholder instead: the
// overview mounts every slide at once, so a video-heavy deck would put ~30
// media elements on the machine, and its copy of the CURRENT slide is
// "active" too, so it re-downloaded the clip being watched.
const { $page, $renderContext } = useSlideContext()
const isLive = computed(() => $renderContext.value === 'slide' || $renderContext.value === 'presenter')

// Look-ahead preload for the next PRELOAD_AHEAD slides' videos: attach the
// <source> early and let the element buffer (preload="auto"), in dev AND in
// production. Production used to warm the browser cache with
// <link rel="preload" as="video"> instead — Chrome rejects that `as` value
// ("<link rel=preload> uses an unsupported `as` value") and fetches nothing,
// so deployed decks started every clip cold (found on the deployed World of
// Particles deck, 2026-09-07). Placeholder instances (overview) have no
// <video>, so the warm is a no-op there.
const PRELOAD_AHEAD = 3
const { currentPage } = useNav()

const isUpcoming = computed(() => {
  const here = $page?.value
  const now = currentPage?.value
  if (!here || !now) return false
  const distance = here - now
  return distance > 0 && distance <= PRELOAD_AHEAD
})

watch(isUpcoming, (warm) => {
  if (!warm || warmed.value || hasBeenActive.value || !isLive.value) return
  warmed.value = true
  status.value = 'loading'
  nextTick(() => videoRef.value?.load())
}, { immediate: true })
</script>

<template>
  <div ref="wrapRef" class="video-player" @mouseleave="onPointerGone">
    <div v-if="!isLive" class="video-placeholder">
      <svg class="video-placeholder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
      <span class="video-status">{{ src }}</span>
    </div>
    <template v-else>
    <div v-if="status === 'loading' || status === 'idle'" class="video-status">Loading video&hellip;</div>
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
      :preload="warmed || hasBeenActive || !autoplay ? 'auto' : 'none'"
      :style="{ objectFit: effFit }"
      @loadeddata="onLoaded"
      @error="onError"
      @click="onVideoClick"
      @touchstart.passive="onVideoTouch"
      :class="{ 'video-ready': status === 'ready' }"
    >
      <source ref="sourceRef" :src="hasBeenActive || warmed ? currentSrc : ''" :type="mimeType" />
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
