// The frame-time watchdog: is this machine too slow for the world, even after
// the frame guard has lowered the pixel ratio and thinned the dust? From
// Užsikrauk karjerai's finale on an M2 (Oct 2026): the guard did what it could,
// the frames stayed long, and the close went white. When the watchdog says
// `slow`, the stage hands the slide to its plate and builds the world again a
// tier lower (components/Stage.vue).
//
//   const dog = createWatchdog()
//   each frame: dog.feed(frameMs, wallSeconds) → 'ok' | 'slow'   (slow once, until reset)
//   dog.reset(wallSeconds, { grace })          a fresh start (grace: graceS); the guard's new step: { grace: 0 }
//
// Slow: over the last `windowS` of wall time, frames longer than `slowMs` (the
// engine's MAX_DT, 12 fps) fill at least `share` of it; or `hitches` frames longer
// than `hitchMs` fall in it. Nothing counts in the `graceS` after the first frame
// or a reset (shaders compile, data comes in), and a frame longer than `gapMs` is a
// gap (a hidden tab, a world resuming after a clip): the window starts over after it.
export const WATCHDOG = { slowMs: 83, windowS: 2, share: 0.5, hitchMs: 250, hitches: 3, graceS: 4, gapMs: 1000 };

export function createWatchdog(opts = {}) {
  const o = { ...WATCHDOG, ...opts };
  let from = null, frames = [], said = false;
  return {
    feed(ms, now) {
      if (from == null) from = now + o.graceS;
      if (said) return 'ok';
      if (ms > o.gapMs) { frames = []; from = Math.max(from, now); return 'ok'; }
      if (now < from) return 'ok';
      frames.push([now, ms]);
      while (frames.length && frames[0][0] < now - o.windowS) frames.shift();
      let slowMs = 0, hitches = 0;
      for (const [, f] of frames) { if (f > o.slowMs) slowMs += f; if (f > o.hitchMs) hitches++; }
      const covered = now - from >= o.windowS;
      if (hitches >= o.hitches || (covered && slowMs >= o.share * o.windowS * 1000)) { said = true; return 'slow'; }
      return 'ok';
    },
    reset(now, { grace = o.graceS } = {}) { frames = []; said = false; from = now + grace; },
  };
}
