// What the recorder puts into the page before the deck's own scripts run.
// Playwright's fake clock drives requestAnimationFrame, timers and
// performance.now, so the engine, the halo and any counter step exactly
// 1/fps per frame however slowly a frame renders. Three things run on other
// clocks, and are brought into step here:
//
//   Math.random   seeded, so the dust is the same grain for grain in every
//                 run (and in the text-free pass)
//   CSS           animations and transitions run on the document timeline,
//                 which is real time: each one is held and set, every frame,
//                 to the time since it was first seen on the fake clock
//   <video>       play() and pause() are taken over; a playing clip is set to
//                 its time on the fake clock every frame (a seek), so a clip
//                 runs at the recording's pace instead of the wall clock's
//
// window.__rec then offers sync(), state(n) and plate(on) to the recorder.

export function seedRandom(seed) {
  // mulberry32
  let a = (Number(seed) >>> 0) || 1;
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function recorderHooks() {
  const now = () => performance.now();
  // --- media
  const P = HTMLMediaElement.prototype;
  const time = Object.getOwnPropertyDescriptor(P, 'currentTime');
  const pausedReal = Object.getOwnPropertyDescriptor(P, 'paused');
  const pauseReal = P.pause;
  const media = new WeakMap();   // element → { playing, t0, c0 }
  const fire = (el, type) => queueMicrotask(() => el.dispatchEvent(new Event(type)));
  const take = (el) => { let s = media.get(el); if (!s) media.set(el, s = { playing: false, t0: 0, c0: 0 }); return s; };
  P.play = function () {
    const s = take(this);
    if (!s.playing) { s.playing = true; s.t0 = now(); s.c0 = time.get.call(this); fire(this, 'play'); fire(this, 'playing'); }
    return Promise.resolve();
  };
  P.pause = function () {
    const s = media.get(this);
    if (s && s.playing) { s.playing = false; fire(this, 'pause'); }
    return pauseReal.call(this);
  };
  Object.defineProperty(P, 'paused', { configurable: true, get() { const s = media.get(this); return !(s && s.playing); } });
  Object.defineProperty(P, 'currentTime', {
    configurable: true,
    get() { return time.get.call(this); },
    set(v) { const s = media.get(this); if (s && s.playing) { s.c0 = Number(v) || 0; s.t0 = now(); } time.set.call(this, v); },
  });

  // --- CSS
  const born = new WeakMap();
  let cover = null;
  addEventListener('slidev-videos:cover', (e) => { cover = e.detail || null; });

  // The text-free pass: the slide's own layer, the halo and the stop HUD go;
  // `visibility` keeps every box and animation where it is.
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = 'html[data-rec-plate] .slidev-layout, html[data-rec-plate] .halo-layer, html[data-rec-plate] .stage .hud { visibility: hidden !important; }';
    document.head.appendChild(st);
  });

  window.__rec = {
    // Bring CSS and clips to the fake clock's now. → { running, seeking }
    sync() {
      const t = now();
      let running = 0;
      for (const a of document.getAnimations()) {
        let b = born.get(a);
        if (b === undefined) { b = t; born.set(a, b); }
        const end = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : Infinity;
        const at = (t - b) * (a.playbackRate || 1);
        if (Number.isFinite(end) && at >= end) { if (a.playState !== 'finished') { try { a.finish(); } catch {} } }
        else {
          if (a.playState !== 'paused') a.pause();
          a.currentTime = at;
          if (Number.isFinite(end)) running++;
        }
      }
      let seeking = 0;
      for (const v of document.querySelectorAll('video')) {
        let s = media.get(v);
        // a clip the browser started by itself (autoplay) is taken over where it stands
        if ((!s || !s.playing) && !pausedReal.get.call(v)) { pauseReal.call(v); s = take(v); s.playing = true; s.t0 = t; s.c0 = time.get.call(v); }
        if (!s || !s.playing) continue;
        let at = s.c0 + (t - s.t0) / 1000 * (v.playbackRate || 1);
        const d = v.duration;
        if (Number.isFinite(d) && d > 0) {
          if (v.loop) at %= d;
          else if (at >= d) { at = d; s.playing = false; fire(v, 'ended'); }
        }
        if (Math.abs(time.get.call(v) - at) > 0.0005) { time.set.call(v, at); seeking++; v.__recSeek = true; }
      }
      return { running, seeking };
    },
    // Every clip set this frame has its picture.
    seeked() {
      return [...document.querySelectorAll('video')].every((v) => !v.__recSeek || (!v.seeking && v.readyState >= 2 && !(v.__recSeek = false)));
    },
    // Where the deck stands, for the recorder's settle and its report.
    state(n) {
      const st = document.querySelector('.stage');
      const sp = st && st.__space;
      const page = document.querySelector(`.slidev-page[data-slidev-no="${n}"]`);
      const clips = page ? [...page.querySelectorAll('video')].map((v) => {
        const src = v.currentSrc || v.querySelector('source')?.src || v.src || '';
        let sameOrigin = true;
        try { sameOrigin = !src || new URL(src, location.href).origin === location.origin; } catch {}
        const s = media.get(v);
        // a Chromium built without the proprietary codecs cannot decode H.264 (most .mp4 clips)
        const type = /\.webm(\?|$)/i.test(src) ? 'video/webm; codecs="vp9"' : /\.mp4(\?|$)/i.test(src) ? 'video/mp4; codecs="avc1.640028"' : '';
        const decodable = !type || v.canPlayType(type) !== '';
        return { src, sameOrigin, decodable, duration: Number.isFinite(v.duration) ? v.duration : null, loop: v.loop, playing: !!(s && s.playing), t: time.get.call(v) };
      }) : [];
      return {
        slide: Number((/^#\/(\d+)/.exec(location.hash) || [])[1]) || null,
        shown: !!page && getComputedStyle(page).display !== 'none',
        flying: !!(sp && sp.flying),
        // a deck without the world has nothing to wait for but its slides
        assembled: !st || document.documentElement.hasAttribute('data-space-assembled'),
        stage: !!st,
        ready: st ? st.classList.contains('ready') || st.classList.contains('static-bg') : !!document.querySelector('.slidev-layout'),
        at: st ? st.dataset.spaceAt ?? null : null,
        station: st ? st.dataset.spaceStation ?? null : null,
        clicks: st ? Number(st.dataset.clicks || 0) : 0,
        clicksTotal: st ? Number(st.dataset.clicksTotal || 0) : 0,
        look: document.documentElement.dataset.stageLook || null,
        cover: cover && cover.covered ? cover.src || true : null,
        clips,
      };
    },
    plate(on) {
      if (on) document.documentElement.dataset.recPlate = '1';
      else delete document.documentElement.dataset.recPlate;
    },
    // The frame-rate guard would read a slow renderer as a slow machine.
    holdQuality() {
      const c = document.querySelector('.stage canvas');
      if (c && c.__space && c.__space.holdQuality) { c.__space.holdQuality(); return true; }
      return false;
    },
  };
}
