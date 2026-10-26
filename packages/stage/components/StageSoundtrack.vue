<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { onSlideLeave, useIsSlideActive, useSlideContext, useNav } from '@slidev/client'
import { whenEntered } from '../stage/slide-hooks.js'
import { music } from '../stage/soundtrack.js'
import { warmAudio } from '../stage/sound.js'
import { onSoundLevel, musicKeys, installSoundKeys } from '../stage/sound-level.js'
import { shared } from '../stage/shared.js'
import { slaveRate } from '../stage/recorded.js'

// <StageSoundtrack src="audio/piece.m4a" :level="0.3" start /> on each slide that
// has the music: one piece across them (Innoday's and Užsikrauk karjerai's
// setup/Soundtrack.vue, Oct 2026). Going to a slide without one fades it out.
// Only the audience's window plays it; `+` / `-` scale every level
// (stage/sound-level.js). Fades and accents run on the audio clock
// (stage/soundtrack.js), and a slide's `space.clock: music` keeps the world on it.
//
//   src, level   the piece and its level on this slide (0..1; low under speech)
//   start        on a forward arrival with nothing playing, `src` from its top
//   resync, tail, tailAt
//                (a finale) while `src` is still before `tailAt` s, cross-fade to
//                `tail` from its top; opened here with nothing playing, `tail`.
//                Two files, not a seek: a server without byte ranges cannot seek
//   clipAt       start `src` when the slide's clip reaches this second
//   onClick      { click, file, level, xfade }: on that click, a cross-fade into `file`
//   keys         `+` / `-` are the music's here, even over a clip
//   drop         { at, file, hit, duck, quiet, out?, fade?, xfade?, clock? } (the recorded or
//                live close): at `duck` s the music falls to `out` (default `quiet`) of its
//                level over `fade` ms; `file` (the track from `hit` s before its peak)
//                starts quiet so its peak lands at `at` s, and on the peak the level opens
//                again, set on the peak file's own clock (an accent: it lands on the music
//                whatever the frames do). `xfade` ms: the file comes in by a cross-fade.
//                The seconds are counted on `clock`: music (the audio clock since the slide
//                opened; the default), clip (the slide's clip, its rate nudged ±10 % to stay
//                on the music until the peak), world (the world's time, as the talks had it)
const props = defineProps({
  src: { type: String, required: true },
  tail: { type: String, default: '' },
  tailAt: { type: Number, default: 0 },
  level: { type: Number, default: 0.9 },
  start: { type: Boolean, default: false },
  resync: { type: Boolean, default: false },
  keys: { type: Boolean, default: false },
  drop: { type: Object, default: null },
  clipAt: { type: Number, default: null },
  onClick: { type: Object, default: null },
})
const { $renderContext, $page, $clicks } = useSlideContext()
const nav = useNav()
const page = () => $page?.value ?? $page
// the audience's window only: not the presenter, the overview, a preview or print
const live = () => $renderContext?.value === 'slide' && !nav.isPrintMode?.value && !nav.isPresenter?.value
const G = shared('soundtrack', () => ({ pages: new Map(), prev: null, watching: false }))
if (props.keys) musicKeys(page())
installSoundKeys()

const root = ref(null)
const clipOf = () => root.value?.closest('.slidev-page')?.querySelector('.video-player video') || null
const unlock = () => { const c = warmAudio(); c?.state === 'suspended' && c.resume().catch(() => {}) }

function arrive() {
  unlock()
  const forward = G.prev == null || G.prev < page()
  if (props.start && !music.playing() && forward) return music.begin(props.src, props.level)
  if (props.resync && props.tail) {
    if (!music.playing()) return music.begin(props.tail, props.level)   // opened here: the build onward
    if (music.current === music.track(props.src) && music.current.e.currentTime < props.tailAt) return music.crossfade(props.tail, props.level, 1500)
  }
  if (music.playing()) music.fadeTo(props.level, 1200)
}

let cueRaf = 0
function watchCue() {
  cancelAnimationFrame(cueRaf)
  const me = page()
  const tick = () => {
    if (nav.currentSlideNo?.value !== me) return
    const v = clipOf()
    if (v && (v.ended || v.currentTime >= props.clipAt)) {
      if (!(music.playing() && music.current === music.track(props.src))) { unlock(); music.begin(props.src, props.level) }
      return
    }
    cueRaf = requestAnimationFrame(tick)
  }
  cueRaf = requestAnimationFrame(tick)
}

// the drop: its seconds read each frame on its clock; the peak's opening is an accent
let dropRaf = 0, dropClip = null, cancelOpen = null
function endDrop() {
  cancelAnimationFrame(dropRaf); dropRaf = 0
  cancelOpen?.(); cancelOpen = null
  if (dropClip) { try { dropClip.playbackRate = 1 } catch { /* gone */ } }
  dropClip = null
}
function startDrop() {
  endDrop()
  const d = props.drop, me = page(), mode = d.clock || 'music'
  const ac = warmAudio()
  const a0 = ac ? ac.currentTime : performance.now() / 1000
  const world = () => globalThis.__stage?.state?.()?.elapsed
  const w0 = world()
  const V = () => {
    if (mode === 'clip') { dropClip ||= clipOf(); return dropClip && !dropClip.paused ? dropClip.currentTime : null }
    if (mode === 'world') { const w = world(); return w0 != null && w != null ? w - w0 : null }
    return (ac ? ac.currentTime : performance.now() / 1000) - a0
  }
  const peak = music.track(d.file)
  let phase = 0
  const tick = () => {
    if (nav.currentSlideNo?.value !== me) return endDrop()
    const v = V()
    if (v != null) {
      if (phase === 0 && v >= d.duck && v < d.at) { music.fadeTo(props.level * (d.out ?? d.quiet), d.fade ?? 1000); phase = 1 }
      if (phase <= 1 && v >= d.at - d.hit && v < d.at) {
        music.crossfade(d.file, props.level * d.quiet, d.xfade || 0, { out: d.xfade || 250 })
        cancelOpen = music.accent(d.file, d.hit, { level: props.level })
        phase = 2
      }
      if (phase === 2 && mode === 'clip' && dropClip) {
        // the clip where the music is: ahead, it slows; behind, it hurries
        const m = music.musicClock(d.file)
        // (the clip's second v belongs at the peak file's m plus where it started; never a seek: a nudge, as Innoday's)
        if (m != null) dropClip.playbackRate = m >= d.hit ? 1 : slaveRate(v, m + d.at - d.hit, 0, { seekOver: Infinity }).rate
        if (m != null && m >= d.hit) phase = 3
      } else if (phase === 2) phase = 3
    }
    if (phase < 3) dropRaf = requestAnimationFrame(tick)
    else if (dropClip) { try { dropClip.playbackRate = 1 } catch { /* gone */ } dropClip = null }
  }
  dropRaf = requestAnimationFrame(tick)
}

watch(() => $clicks?.value, (c, was) => {
  const o = props.onClick
  if (!o || !live() || nav.currentSlideNo?.value !== page()) return
  if (c >= o.click && (was ?? 0) < o.click) music.crossfade(o.file, o.level ?? props.level, o.xfade ?? 600)
})
whenEntered(useIsSlideActive(), () => {
  if (!live()) return
  if (props.clipAt != null) { if (music.playing() && music.current !== music.track(props.src)) music.fadeTo(0, 1200); watchCue() }
  else arrive()
  if (props.drop) startDrop()
})
onSlideLeave(() => { endDrop(); cancelAnimationFrame(cueRaf) })
// a drop's or a click's file loads while the slide is mounted ahead of its press
onMounted(() => { if (!live()) return; if (props.drop) music.track(props.drop.file); if (props.onClick) music.track(props.onClick.file) })
onUnmounted(() => { endDrop(); cancelAnimationFrame(cueRaf) })
// a `+` / `-` (here or in the presenter's window): every track at its level times the new one
if (!G.level) G.level = onSoundLevel(() => { for (const t of music.tracks()) if (!t.timer) music.set(t, t.level) })

// the pages with a live <StageSoundtrack>, counted; leaving them fades the music out
let mine = null
onMounted(() => {
  if (!live()) return
  mine = page(); G.pages.set(mine, (G.pages.get(mine) || 0) + 1)
})
onUnmounted(() => {
  if (mine == null) return
  const c = (G.pages.get(mine) || 1) - 1
  if (c > 0) G.pages.set(mine, c); else G.pages.delete(mine)
})
let stop = null
onMounted(() => {
  if (!live() || G.watching) return
  G.watching = true
  // no press yet when a track was asked to play: the next press plays it
  const onPress = () => { const p = music.pending; music.pending = null; p?.() }
  window.addEventListener('keydown', onPress); window.addEventListener('pointerdown', onPress)
  const off = watch(() => nav.currentSlideNo?.value, (n, old) => {
    G.prev = old ?? null
    if (!G.pages.has(n) && music.playing()) { const t = music.current; music.fade(t, 0, 1500, () => t.e.pause()) }
  })
  stop = () => { off(); window.removeEventListener('keydown', onPress); window.removeEventListener('pointerdown', onPress); G.watching = false }
})
onUnmounted(() => stop?.())
</script>

<template><span ref="root" class="stage-soundtrack" aria-hidden="true" /></template>
