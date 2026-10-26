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
//
// A track's `level` is the level it is headed for, as written; what sounds now is read off
// its gain (a fade cut short starts from there, not from the last target). An accent is
// armed once its track sounds (`playing`), set at the context time of its music second, and
// moved when a seek or a restart moves that time; the track's level becomes the accent's
// when it lands. A fade drops a pending accent (the slide asked for something else); the
// presenter's `+` / `-` (relevel) keeps it, and a fade under way goes on to the new level.
export function createMusic({ context, out = () => null, audio, level = () => 1, url = (s) => s }) {
  const tracks = new Map();
  const m = { current: null, pending: null };
  const ctxOf = () => { const c = context?.(); return c && c.state !== 'closed' ? c : null; };
  const amp = (v) => v * level();
  const nowOf = (c) => (c ? c.currentTime : Date.now() / 1000);
  // the level sounding now, as written
  const levelNow = (t) => {
    const k = level(), c = ctxOf();
    if (!(k > 0)) return t.level;
    return t.gain && c ? t.gain.gain.value / k : t.e.volume / k;
  };

  // ---- accents ----
  const dropAccent = (t) => {
    const a = t.accent;
    if (!a) return;
    clearTimeout(a.land);
    const c = ctxOf();
    if (t.gain && c && a.when > c.currentTime) { try { t.gain.gain.cancelScheduledValues(a.when); } catch { /* gone */ } }
    t.accent = null;
  };
  // set (or move) the pending accent's event at its music second on the track's present anchor
  const aim = (t) => {
    const a = t.accent;
    if (!a || m.musicClock(t.src) == null) return;
    clearTimeout(a.land);
    const c = ctxOf();
    if (t.gain && c && c.state === 'running') {
      const g = t.gain.gain, n = c.currentTime, when = Math.max(n, t.anchor + a.at);
      if (a.when > n && a.when !== when) { try { g.cancelScheduledValues(a.when); } catch { /* gone */ } }
      a.when = when;
      try { g.setValueAtTime(amp(a.lvl), Math.max(when, t.fadeEnd > when ? t.fadeEnd : when)); } catch { /* inside a curve on an older engine */ }
      a.land = later(() => { if (t.accent === a) { t.level = a.lvl; t.accent = null; } }, (when - n) * 1000);
    } else {
      const left = a.at - m.musicClock(t.src);
      a.land = later(() => { if (t.accent === a) { t.accent = null; m.set(t, a.lvl); } }, left * 1000);
    }
  };
  // the arms waiting for a track to sound, and the accents to move when its time moves
  const sounding = (t) => { t.started = true; t.anchor = null; for (const f of [...t.waits]) f(); aim(t); };

  m.track = (src) => {
    let t = tracks.get(src);
    if (!t) {
      const e = audio(url(src)); e.preload = 'auto'; e.load?.();
      t = { src, e, gain: null, level: 1, anchor: null, started: false, timer: 0, then: null, fadeEnd: 0, accent: null, waits: new Set() };
      e.addEventListener?.('playing', () => sounding(t));
      e.addEventListener?.('seeked', () => { t.anchor = null; aim(t); });
      e.addEventListener?.('pause', () => { t.started = false; });
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

  // at once (a pending accent stays: it is re-set after the cancel)
  m.set = (t, v) => {
    clearTimeout(t.timer); t.timer = 0; t.then = null; t.fadeEnd = 0;
    t.level = v;
    const c = ctxOf();
    if (t.gain && c) {
      const g = t.gain.gain;
      g.cancelScheduledValues(c.currentTime); g.setValueAtTime(amp(v), c.currentTime);
      if (t.accent && t.accent.when > c.currentTime) { try { g.setValueAtTime(amp(t.accent.lvl), t.accent.when); } catch { /* gone */ } }
    } else t.e.volume = Math.max(0, Math.min(1, amp(v)));
  };
  // to `to` over ms, equal power, from what sounds now; then() once there. keep: the pending accent stays
  m.fade = (t, to, ms, then, { keep = false } = {}) => {
    const c = ctxOf(), from = levelNow(t);
    clearTimeout(t.timer); t.timer = 0; t.then = then || null;
    if (!keep) dropAccent(t);
    t.level = to;
    if (t.gain && c && ms > 0) {
      const g = t.gain.gain, n = c.currentTime;
      g.cancelScheduledValues(n);
      try { g.setValueCurveAtTime(equalPower(amp(from), amp(to)), n, ms / 1000); } catch { try { g.setValueAtTime(amp(to), n); } catch { /* an engine that keeps an active curve */ } }
      t.fadeEnd = n + ms / 1000;
      // an accent kept: after the curve (an event inside one throws)
      if (t.accent) { try { g.setValueAtTime(amp(t.accent.lvl), Math.max(t.accent.when, t.fadeEnd)); } catch { /* gone */ } }
    } else if (ms > 0) {
      // no Web Audio: the element's volume, stepped (iOS ignores it; there the context exists)
      const t0 = Date.now();
      t.fadeEnd = t0 / 1000 + ms / 1000;
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / ms), x = k * Math.PI / 2;
        t.e.volume = Math.max(0, Math.min(1, amp(to >= from ? from + (to - from) * Math.sin(x) : to + (from - to) * Math.cos(x))));
        if (k < 1 && t.level === to) frame(step);
      };
      frame(step);
    } else { m.set(t, to); t.then = then || null; }
    if (then) t.timer = later(() => { t.timer = 0; t.then = null; then(); }, ms);
  };
  // the presenter's `+` / `-`: every track at its level times the new multiplier; a fade under
  // way goes on to it over what is left, an accent ahead is re-set at the new level
  m.relevel = () => {
    const n = nowOf(ctxOf());
    for (const t of tracks.values()) {
      if (t.fadeEnd > n) m.fade(t, t.level, (t.fadeEnd - n) * 1000, t.then, { keep: true });
      else m.set(t, t.level);
    }
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
  const restart = (t, from) => { t.e.currentTime = from; t.anchor = null; t.started = false; };
  m.begin = (src, lvl, { fade = 2000, out = 1500 } = {}) => {
    const t = m.track(src), old = m.current;
    if (old && old !== t) retire(old, out);
    m.current = t; restart(t, 0);
    m.set(t, 0); m.play(t); m.fade(t, lvl, fade);
    return t;
  };
  // out: ms for the old track to go (default: the same as the new one's coming in)
  m.crossfade = (src, lvl, ms = 600, { from = 0, out = ms } = {}) => {
    const t = m.track(src), old = m.current;
    m.current = t; restart(t, from);
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
  // (the element's own until its first sample has sounded: no anchor from a silent start)
  m.musicClock = (src) => {
    const t = find(src);
    if (!m.playing(t)) return null;
    const c = ctxOf();
    if (!c || c.state !== 'running' || !t.started) return t.e.currentTime;
    if (t.anchor == null || needsReanchor(c.currentTime - t.anchor, t.e.currentTime)) t.anchor = anchorOf(c.currentTime, t.e.currentTime);
    return c.currentTime - t.anchor;
  };
  // at `at` s of src: its level set on the context's clock, and/or call() — once src sounds
  m.accent = (src, at, { level: lvl, call } = {}) => {
    let done = false, timer = 0, mine = null;
    const fire = () => { if (!done) { done = true; call?.(); } };
    const arm = () => {
      if (done) return;
      const t = tracks.get(src) || find(src);
      if (t) t.waits.delete(arm);
      if (!t || !t.started || m.musicClock(src) == null) {
        if (t) t.waits.add(arm);
        timer = later(arm, 40);
        return;
      }
      clearTimeout(timer);
      if (lvl != null) { dropAccent(t); mine = t.accent = { at, lvl, when: 0, land: 0 }; aim(t); }
      if (!call) return;
      const now = m.musicClock(src);
      if (now >= at) return fire();
      // a timer to just before, then frames on the music's own clock
      const close = () => { const n = m.musicClock(src); if (n == null || n >= at) fire(); else timer = frame(close); };
      timer = later(close, (at - now) * 1000 - 30);
    };
    arm();
    return () => {
      done = true; clearTimeout(timer);
      const t = tracks.get(src) || find(src);
      if (t) { t.waits.delete(arm); if (mine && t.accent === mine) dropAccent(t); }
    };
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
