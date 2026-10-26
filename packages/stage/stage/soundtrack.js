// The deck's music: one player per page (<StageSoundtrack> on each slide that
// wants it), its tracks through the stage's Web Audio output, its clock read off
// the AudioContext. From Innoday's and Užsikrauk karjerai's setup/Soundtrack.vue
// (Oct 2026), with one change the finale taught: whatever has to land on the
// music is scheduled on the audio clock, never stepped on animation frames or
// timed off the world (whose clock fell behind on a long frame, and the
// accent missed).
//
//   music.track(src)                     → { e, gain, level }: loaded, not played
//   music.begin(src, level, { fade })    from its top, faded in; the old track out
//   music.crossfade(src, level, ms, { out }) from its top, an equal-power cross-fade (the old out over `out` ms)
//   music.fadeTo(level, ms)              the current track
//   music.set(track, level)              at once
//   musicClock(src?)                     → seconds into the playing track (the current
//                                          one, or the playing track whose path holds src),
//                                          null when none plays
//   music.accent(src, at, { level, call }) → cancel(): at `at` seconds of src, its level
//                                          set (on the context's clock) and/or call() run
//
// A level is as written; what sounds is it times the presenter's `+` / `-`
// (stage/sound-level.js). Without Web Audio (or before a gesture made the
// context) the element's own volume and time stand in.
import { shared } from './shared.js';
import { warmAudio, stageOut } from './sound.js';
import { soundLevel } from './sound-level.js';

const FADE_POINTS = 32;
// s the context-time clock may stray from the element's before it is taken again: more than the
// element's own update step (up to 250 ms in some browsers), less than any seek worth the name
export const REANCHOR = 0.3;

// an equal-power ramp, n points from → to: up along a sine, down along a cosine, so a
// track coming in and one going out over the same time keep the loudness between them
// (the talks' ramp took both along the sine, and a cross-fade dipped)
export function equalPower(from, to, n = FADE_POINTS) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = (i / (n - 1)) * Math.PI / 2;
    c[i] = to >= from ? from + (to - from) * Math.sin(k) : to + (from - to) * Math.cos(k);
  }
  c[n - 1] = to;
  return c;
}
// the context time at which the track was at its 0 s
export const anchorOf = (ctxNow, mediaT) => ctxNow - mediaT;
export const needsReanchor = (clockT, mediaT, tol = REANCHOR) => Math.abs(clockT - mediaT) > tol;

const later = (fn, ms) => setTimeout(fn, Math.max(0, ms));
const frame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

// context(): the AudioContext or null; out(): the node tracks connect to (null: the
// context's destination); audio(url): a new media element; level(): the presenter's
// multiplier; url(src): where src is served
export function createMusic({ context, out = () => null, audio, level = () => 1, url = (s) => s }) {
  const tracks = new Map();
  const m = { current: null, pending: null };
  const ctxOf = () => { const c = context?.(); return c && c.state !== 'closed' ? c : null; };

  m.track = (src) => {
    let t = tracks.get(src);
    if (!t) {
      const e = audio(url(src)); e.preload = 'auto'; e.load?.();
      t = { src, e, gain: null, level: 1, anchor: null, timer: 0 };
      e.addEventListener?.('seeked', () => { t.anchor = null; });
      e.addEventListener?.('playing', () => { t.anchor = null; });
      tracks.set(src, t);
    }
    const c = ctxOf();
    if (!t.gain && c) {
      try {
        const g = c.createGain(); c.createMediaElementSource(t.e).connect(g); g.connect(out() || c.destination);
        t.gain = g; t.e.volume = 1;
      } catch { /* a second source for one element, or no audio device: the element's volume */ }
    }
    return t;
  };
  m.tracks = () => [...tracks.values()];
  m.playing = (t = m.current) => !!t && !t.e.paused && !t.e.ended;

  const amp = (v) => v * level();
  m.set = (t, v) => {
    clearTimeout(t.timer); t.timer = 0;
    t.level = v;
    const c = ctxOf();
    if (t.gain && c) { const g = t.gain.gain; g.cancelScheduledValues(c.currentTime); g.setValueAtTime(amp(v), c.currentTime); }
    else t.e.volume = Math.max(0, Math.min(1, amp(v)));
  };
  // to `to` over ms, equal power; then() once there
  m.fade = (t, to, ms, then) => {
    clearTimeout(t.timer); t.timer = 0;
    const c = ctxOf(), from = t.level;
    t.level = to;
    if (t.gain && c && ms > 0) {
      const g = t.gain.gain, now = c.currentTime;
      g.cancelScheduledValues(now);
      try { g.setValueCurveAtTime(equalPower(amp(from), amp(to)), now, ms / 1000); } catch { g.setValueAtTime(amp(to), now); }
    } else if (ms > 0) {
      // no Web Audio: the element's volume, stepped (iOS ignores it; there the context exists)
      const t0 = Date.now();
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        const x = k * Math.PI / 2;
        t.e.volume = Math.max(0, Math.min(1, amp(to >= from ? from + (to - from) * Math.sin(x) : to + (from - to) * Math.cos(x))));
        if (k < 1 && t.level === to) frame(step);
      };
      frame(step);
    } else m.set(t, to);
    if (then) t.timer = later(() => { t.timer = 0; then(); }, ms);
  };
  m.play = (t) => {
    const p = t.e.play();
    p?.catch?.((err) => {
      // no press yet in this window: again on the next one
      console.warn('StageSoundtrack:', err?.message);
      m.pending = () => t.e.play()?.catch?.(() => {});
    });
  };
  const retire = (old, ms) => { if (old) m.fade(old, 0, ms, () => old.e.pause()); };
  m.begin = (src, lvl, { fade = 2000, out = 1500 } = {}) => {
    const t = m.track(src), old = m.current;
    if (old && old !== t) retire(old, out);
    m.current = t; t.e.currentTime = 0; t.anchor = null;
    m.set(t, 0); m.play(t); m.fade(t, lvl, fade);
    return t;
  };
  // out: ms for the old track to go (default: the same as the new one's coming in)
  m.crossfade = (src, lvl, ms = 600, { from = 0, out = ms } = {}) => {
    const t = m.track(src), old = m.current;
    m.current = t; t.e.currentTime = from; t.anchor = null;
    m.set(t, 0); m.play(t); m.fade(t, lvl, ms);
    if (old && old !== t) retire(old, out);
    return t;
  };
  m.fadeTo = (lvl, ms = 1200, then) => { if (m.current) m.fade(m.current, lvl, ms, then); };

  const find = (src) => {
    if (src == null) return m.current;
    return tracks.get(src) || [...tracks.values()].find((t) => t.src.includes(src) && m.playing(t)) || null;
  };
  // the playing track's time, on the context's clock between the element's coarse updates
  m.musicClock = (src) => {
    const t = find(src);
    if (!m.playing(t)) return null;
    const c = ctxOf();
    if (!c || c.state !== 'running') return t.e.currentTime;
    if (t.anchor == null || needsReanchor(c.currentTime - t.anchor, t.e.currentTime)) t.anchor = anchorOf(c.currentTime, t.e.currentTime);
    return c.currentTime - t.anchor;
  };
  // at `at` s of src: its level set on the context's clock, and/or call() — once src plays
  m.accent = (src, at, { level: lvl, call } = {}) => {
    let done = false, timer = 0;
    const fire = () => { if (!done) { done = true; call?.(); } };
    const arm = () => {
      const t = tracks.get(src) || find(src), now = m.musicClock(src);
      if (done) return;
      if (now == null || !t) { timer = later(arm, 40); return; }
      if (lvl != null) {
        const c = ctxOf();
        if (t.gain && c && c.state === 'running') {
          const when = t.anchor + at, g = t.gain.gain;
          g.cancelScheduledValues(Math.max(c.currentTime, when));
          g.setValueAtTime(amp(lvl), Math.max(c.currentTime, when));
          t.level = lvl;
        } else timer = later(() => m.set(t, lvl), (at - now) * 1000);
      }
      if (!call) { done = true; return; }
      if (now >= at) return fire();
      // a timer to just before, then frames on the music's own clock
      const close = () => { const n = m.musicClock(src); if (n == null || n >= at) fire(); else timer = frame(close); };
      timer = later(close, (at - now) * 1000 - 30);
    };
    arm();
    return () => { done = true; clearTimeout(timer); };
  };
  return m;
}

// The page's player: the stage's context and output, the presenter's level.
const page = shared('music', () => ({ m: null }));
export const music = new Proxy({}, {
  get(_, k) {
    page.m ||= createMusic({
      context: () => warmAudio(), out: () => stageOut(),
      audio: (u) => new Audio(u), level: soundLevel,
      url: (p) => (p.startsWith('/') || /^https?:/.test(p) ? p : (import.meta.env?.BASE_URL || '/') + p),
    });
    const v = page.m[k];
    return typeof v === 'function' ? v.bind(page.m) : v;
  },
  set(_, k, v) { music.current; page.m[k] = v; return true; },
});
export const musicClock = (src) => (page.m ? page.m.musicClock(src) : null);
