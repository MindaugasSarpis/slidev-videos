// A slide as its recording. Innoday's close (Oct 2026) was a recorded clip with
// the music slaved to it, and it played whole; Užsikrauk karjerai's close, live
// on a laptop, went white and missed its accent. `space.recorded` lets any slide
// be what the recorder filmed, over a world that could run it:
//
//   space:
//     recorded: plate        # the slide's plate (slidev-stage-record --plate: NN-plate.mp4)
//     recorded: clip         # the slide's own clip is the picture (the world rests under it)
//     recorded: { kind: plate, music: starfire_finale, at: 13.5 }
//                            # …and the video keeps the music's time: its 0 s is the
//                            # playing <StageSoundtrack> track's `at` s (music: a part of its path)
//
// The world rests under it, so the machine's GPU is the decoder's. A slide whose
// plate no URL answers for (never recorded, or plates off) runs the world as live.
// Pure, so node can hold it to account (test/recorded.test.mjs).

const KINDS = ['plate', 'clip'];

// a slide's `space` → { kind, sync: { track, at } | null }, or null when it is live
export function recordedOf(space) {
  const r = space && typeof space === 'object' ? space.recorded : null;
  if (typeof r === 'string') return KINDS.includes(r) ? { kind: r, sync: null } : null;
  if (!r || typeof r !== 'object') return null;
  const kind = KINDS.includes(r.kind) ? r.kind : 'plate';
  const at = Number.isFinite(Number(r.at)) ? Number(r.at) : 0;
  return { kind, sync: typeof r.music === 'string' && r.music ? { track: r.music, at } : null };
}

// What stands under the slide. base: the stage's own layer (stage/fallback.js); over a
// running world (`world`), the slide's plate when the slide is recorded or the watchdog
// handed it over (slowSlide), unless its plate is missing or plates are off. A fallback
// layer stands; a fallback plate that is missing is the living still, as before.
export function layerNow({ base, slide, recorded = null, slowSlide = null, plateMissing = new Set(), plates = true }) {
  const missing = plateMissing.has(slide);
  if (base === 'plate') return missing ? 'living' : 'plate';
  if (base !== 'world') return base;
  const wants = recorded?.kind === 'plate' || (slowSlide != null && slowSlide === slide);
  return wants && plates !== false && !missing ? 'plate' : 'world';
}

// The rate for a video that keeps the music's time: videoT its time, musicT the
// music's, at the music's second at the video's 0 s. Behind, it hurries; ahead, it
// slows, at most ±max; more than seekOver off (a jump, a late start) it is set
// where it belongs, at 0 at the earliest. Innoday's drop: gain 1.5, ±10 %.
export function slaveRate(videoT, musicT, at, { gain = 1.5, max = 0.1, seekOver = 1 } = {}) {
  const want = musicT - at, err = videoT - want;
  if (Math.abs(err) > seekOver) return { rate: 1, seek: Math.max(0, want) };
  return { rate: Math.min(1 + max, Math.max(1 - max, 1 - err * gain)), seek: null };
}
