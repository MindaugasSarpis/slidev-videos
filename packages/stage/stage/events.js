// An event a builder draws from uniforms that hold world times: when it
// started, when it was let go. OFF (1e9) is "none". A stop fades it out over
// `fade` seconds; once faded, the start, the hide and every time named in
// `also` go back to OFF, so nothing of it lingers into a later slide. (Užsikrauk
// karjerai, Oct 2026: a collision's crossing time kept after its stop left a
// later slide's detector in the collision's state, its calm switched off.)
//
//   const ev = eventLatch(u, { start: 'uShowT', hide: 'uHideT', also: ['uHitT'], fade: 1.3 })
//   ev.start(t)   ev.stop(t)   each frame: ev.tick(t) → whether it still draws
export const OFF = 1e9;

export function eventLatch(u, { start, hide, also = [], fade = 1 }) {
  const set = (k) => u[k].value < OFF / 10;
  return {
    // started at `at` (default now); a start during the fade takes it back
    start(t, at = t) { if (!set(start) || set(hide)) u[start].value = at; u[hide].value = OFF; },
    // let go now; a second stop keeps the first's fade
    stop(t) { if (set(start) && !set(hide)) u[hide].value = t; },
    tick(t) {
      if (set(hide) && t - u[hide].value > fade) for (const k of [start, hide, ...also]) u[k].value = OFF;
      return set(start);
    },
    get on() { return set(start) && !set(hide); },
  };
}
