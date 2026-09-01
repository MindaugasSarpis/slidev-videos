<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useIsSlideActive, useNav, useSlideContext, configs } from '@slidev/client'

// Config resolution (headmatter beats env beats built-ins):
//   videos:                       VITE_VIDEO_REPO
//     repo: owner/repo            VITE_VIDEO_RELEASE
//     release: videos-web         VITE_VIDEO_SHARED_REPO + VITE_VIDEO_SHARED_RELEASE
//     shared: owner/repo@tag | false
//     fit: cover | contain
//     hq: false
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
  loop:     { type: Boolean, default: false },
  muted:    { type: Boolean, default: false },
  controls: { type: Boolean, default: true },
  // Prefer the local visually-lossless venue master (public/videos-hq/<src>)
  // when present. Falls through to the web tier automatically when absent.
  hq:       { type: Boolean, default: undefined },
  // Per-clip playback attenuation (0..1) — the live escape hatch for a clip
  // that plays hot despite loudness-normalized encodes.
  volume:   { type: Number, default: 1 },
  // cover = fill the frame edge-to-edge (default; crops non-16:9 slightly).
  // contain = letterbox instead of cropping (ultra-wide/portrait clips).
  fit:      { type: String, default: '' },
})
const effHq  = computed(() => props.hq === undefined ? (CFG.hq ?? true) : props.hq)
const effFit = computed(() => props.fit || CFG.fit || 'cover')

// Fallback chain. Deploys strip local videos/ (served from the release), so
// PROD probes the remotes first — a guaranteed local 404 only delays playback.
// DEV keeps local copies and probes them first (fast, offline).
const base = computed(() => import.meta.env.BASE_URL || '/')
const hqLocalSrc = computed(() => `${base.value}videos-hq/${props.src}`)
const webLocalSrc = computed(() => `${base.value}videos/${props.src}`)
const webRemoteSrc = computed(() => props.fallback || (REMOTE_BASE ? `${REMOTE_BASE}/${props.src}` : ''))
const sharedRemoteSrc = computed(() => SHARED_REMOTE_BASE ? `${SHARED_REMOTE_BASE}/${props.src}` : '')
const fallbackChain = computed(() => {
  const locals = effHq.value ? [hqLocalSrc.value, webLocalSrc.value] : [webLocalSrc.value]
  const remotes = [webRemoteSrc.value, sharedRemoteSrc.value]
  const chain = (import.meta.env.PROD ? [...remotes, ...locals] : [...locals, ...remotes])
    .filter(Boolean)
  return chain.filter((url, i) => i === 0 || url !== chain[i - 1])
})

const videoRef = ref(null)
const sourceRef = ref(null)
const currentSrc = ref(fallbackChain.value[0] || '')
const status = ref('idle')
const isActive = useIsSlideActive()
const hasBeenActive = ref(false)
const warmed = ref(false)

const mimeType = computed(() => {
  const ext = props.src.split('.').pop()?.toLowerCase()
  if (ext === 'webm') return 'video/webm'
  return 'video/mp4'
})

// --- Custom controls state ---
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const isMuted = ref(true)
const progressPercent = computed(() => duration.value ? (currentTime.value / duration.value) * 100 : 0)
const controlsVisible = ref(false)

function formatTime(s) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function onTimeUpdate() {
  const v = videoRef.value
  if (!v) return
  currentTime.value = v.currentTime
  duration.value = v.duration || 0
  playing.value = !v.paused
  isMuted.value = v.muted
}

function togglePlay() {
  const v = videoRef.value
  if (!v) return
  if (v.paused) v.play().catch(() => {})
  else v.pause()
  playing.value = !v.paused
}

function toggleMute() {
  const v = videoRef.value
  if (!v) return
  v.muted = !v.muted
  isMuted.value = v.muted
}

function seek(e) {
  const v = videoRef.value
  if (!v || !duration.value) return
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  v.currentTime = ratio * duration.value
}

function showControls() { controlsVisible.value = true }
function hideControls() { controlsVisible.value = false }

// --- Fallback chain advance ---
let switching = false
function onError() {
  if (switching || (!hasBeenActive.value && !warmed.value)) return
  const chain = fallbackChain.value
  const idx = chain.indexOf(currentSrc.value)
  if (idx === -1 || idx === chain.length - 1) {
    status.value = 'error'
    return
  }
  switching = true
  status.value = 'loading'
  currentSrc.value = chain[idx + 1]
  nextTick(() => {
    videoRef.value?.load()
    switching = false
  })
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
    video.volume = Math.min(1, Math.max(0, props.volume))
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
  duration.value = videoRef.value?.duration || 0
  syncPlayback()
}

onMounted(() => {
  // <source> error events don't bubble to <video> on iOS Safari.
  sourceRef.value?.addEventListener('error', onError)
  syncPlayback()
})

// Look-ahead preload for upcoming slides' videos:
//  - PROD: warm the browser cache via <link rel="preload" as="video"> against
//    the most reliable remote (shared release when configured — the own
//    release may 404 for inherited clips).
//  - DEV: attach the <source> early and let the element buffer.
const PRELOAD_AHEAD = 3
const { currentPage } = useNav()
const { $page } = useSlideContext()

const isUpcoming = computed(() => {
  const here = $page?.value
  const now = currentPage?.value
  if (!here || !now) return false
  const distance = here - now
  return distance > 0 && distance <= PRELOAD_AHEAD
})

const shouldPreload = computed(() => import.meta.env.PROD && isUpcoming.value)

watch(() => import.meta.env.DEV && isUpcoming.value, (warm) => {
  if (!warm || warmed.value || hasBeenActive.value) return
  warmed.value = true
  status.value = 'loading'
  nextTick(() => videoRef.value?.load())
}, { immediate: true })

let preloadLink = null
function addPreload() {
  if (preloadLink || typeof document === 'undefined') return
  const url = sharedRemoteSrc.value || webRemoteSrc.value
  if (!url) return
  preloadLink = document.createElement('link')
  preloadLink.rel = 'preload'
  preloadLink.as = 'video'
  preloadLink.href = url
  preloadLink.type = mimeType.value
  document.head.appendChild(preloadLink)
}
function removePreload() {
  if (!preloadLink) return
  preloadLink.remove()
  preloadLink = null
}

watch(shouldPreload, (yes) => yes ? addPreload() : removePreload(), { immediate: true })
onUnmounted(removePreload)
</script>

<template>
  <div class="video-player" @mouseenter="controls && showControls()" @mouseleave="controls && hideControls()" @click="controls && togglePlay()">
    <div v-if="status === 'loading' || status === 'idle'" class="video-status">Loading video&hellip;</div>
    <div v-if="status === 'error'" class="video-status video-error">
      Video not available: <code>{{ src }}</code>
    </div>
    <video
      ref="videoRef"
      :loop="loop"
      muted
      playsinline
      webkit-playsinline
      :preload="warmed || hasBeenActive ? 'auto' : 'none'"
      :style="{ objectFit: effFit }"
      @loadeddata="onLoaded"
      @error="onError"
      @timeupdate="onTimeUpdate"
      @play="playing = true"
      @pause="playing = false"
      :class="{ 'video-ready': status === 'ready' }"
    >
      <source ref="sourceRef" :src="hasBeenActive || warmed ? currentSrc : ''" :type="mimeType" />
    </video>
    <div v-if="controls && status === 'ready'" class="custom-controls" :class="{ visible: controlsVisible }" @click.stop>
      <button class="ctrl-btn" @click="togglePlay">{{ playing ? '⏸' : '▶' }}</button>
      <span class="ctrl-time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
      <div class="ctrl-progress" @click="seek">
        <div class="ctrl-progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <button class="ctrl-btn" @click="toggleMute">{{ isMuted ? '🔇' : '🔊' }}</button>
    </div>
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
  cursor: pointer;
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
.custom-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  opacity: 0;
  transition: opacity 0.3s;
  cursor: default;
}
.custom-controls.visible { opacity: 1; }
.ctrl-btn {
  background: none;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
}
.ctrl-btn:hover { opacity: 0.8; }
.ctrl-time {
  color: rgba(255,255,255,0.8);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 120px;
}
.ctrl-progress {
  flex: 1;
  height: 8px;
  background: rgba(255,255,255,0.25);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
}
.ctrl-progress-fill {
  height: 100%;
  background: white;
  border-radius: 4px;
  transition: width 0.1s linear;
}
</style>
