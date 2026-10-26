// The frame-time watchdog (stage/watchdog.js): a machine still slow once the frame
// guard has done what it can hands the slide to its plate and the world is built
// again a tier lower. From Užsikrauk karjerai's finale on an M2 (Oct 2026): the
// guard only lowers the pixel ratio, and the close went white under ~1.1M grains.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWatchdog } from '../stage/watchdog.js';
import { PLATE_REASONS, fallbackLayer } from '../stage/fallback.js';
import { FALLBACK_REASONS } from '../stage/diagnose.js';
import { OPTION_KEYS } from '../stage/types.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
// frames of `ms` for `seconds`, from t0 (wall seconds): where it said slow, if it did
function run(w, ms, seconds, t0 = 10) {
  let t = t0, r = 'ok';
  while (t < t0 + seconds) { t += ms / 1000; r = w.feed(ms, t); if (r === 'slow') break; }
  return { r, t };
}

test('60 fps is never slow', () => { assert.equal(run(createWatchdog(), 16.7, 30).r, 'ok'); });

test('30 fps is not slow', () => { assert.equal(run(createWatchdog(), 33.3, 30).r, 'ok'); });

test('10 fps is slow within about two seconds of the grace', () => {
  const { r, t } = run(createWatchdog(), 100, 20, 0);
  assert.equal(r, 'slow'); assert.ok(t > 4 && t < 4 + 2.5, String(t));
});

test('one shader-compile hitch is not slow', () => {
  const w = createWatchdog(); let t = 10;
  for (let i = 0; i < 300; i++) { t += 0.0167; assert.equal(w.feed(16.7, t), 'ok'); }   // past the grace
  t += 0.4; assert.equal(w.feed(400, t), 'ok');
  assert.equal(run(w, 16.7, 10, t).r, 'ok');
});

test('three hitches in two seconds are', () => {
  const w = createWatchdog(); let t = 10, r = 'ok';
  run(w, 16.7, 5, t); t += 5;                          // past the grace
  for (let i = 0; i < 3; i++) { t += 0.3; r = w.feed(300, t); t += 0.2; if (r !== 'slow') r = w.feed(16.7, t); }
  assert.equal(r, 'slow');
});

test('grace after start and after reset', () => {
  const w = createWatchdog();
  assert.equal(run(w, 100, 3.9, 0).r, 'ok');          // the first 4 s: shaders compile, data comes in
  w.reset(10);
  assert.equal(run(w, 100, 3.9, 10).r, 'ok');
});

test('a resume gap is not a slow frame', () => {
  const w = createWatchdog(); let t = 10;
  run(w, 16.7, 1, t); t += 1;
  t += 5; assert.equal(w.feed(5000, t), 'ok');        // a hidden tab, a covered world resuming
  assert.equal(run(w, 16.7, 10, t).r, 'ok');
});

test('slow is said once, until reset', () => {
  const w = createWatchdog();
  assert.equal(run(w, 100, 20, 0).r, 'slow');
  assert.equal(run(w, 100, 10, 30).r, 'ok');
  w.reset(50);
  assert.equal(run(w, 100, 20, 50).r, 'slow');
});

test('slow is a plate reason and a fallback reason', () => {
  assert.ok(PLATE_REASONS.includes('slow')); assert.ok(FALLBACK_REASONS.includes('slow'));
  assert.equal(fallbackLayer('slow', { plates: 'videos' }), 'plate');
  assert.equal(fallbackLayer('slow', { plates: false }), 'living');
});

test('watchdog is an option, on by default', async () => {
  const { DEFAULTS } = await import('../stage/space.js');
  assert.equal(DEFAULTS.watchdog, true); assert.ok(OPTION_KEYS.includes('watchdog'));
});

test('the engine feeds the watchdog the wall frame time and says slow once; never under the recorder', () => {
  const src = read('../stage/space.js');
  assert.match(src, /dog\.feed\(wallDt \* 1000, /);
  assert.match(src, /onEvent\?\.\('slow', /);
  assert.match(src, /if \(dogOn && \(guardStage >= 2 \|\| opt\.guard === false\) && !globalThis\.__stageMaxDt && !saidSlow && dog\.feed\(/);
});

test('Stage.vue hands the slide to its plate and rebuilds a tier lower; never in print or the presenter window', () => {
  const src = read('../components/Stage.vue');
  assert.match(src, /e === 'slow'/);
  assert.match(src, /function onSlow\(/);
  assert.match(src, /slowSlide\.value = nav\.currentSlideNo\.value/);
  assert.match(src, /if \(printing\.value \|\| nav\.isPresenter\?\.value\) return/);
  assert.match(src, /slidev-stage:slow/);
});

test('the headless tools never trip it: holdQuality silences it, an automated browser never feeds it', () => {
  const src = read('../stage/space.js');
  assert.match(src, /holdQuality\(\) \{ guardStage = 2; saidSlow = true; \}/);
  assert.match(src, /const dogOn = opt\.watchdog !== false && !\(typeof navigator !== 'undefined' && navigator\.webdriver\)/);
});

// ---- the review's findings (v0.11 fix pass) ---------------------------------------------------
test('review #1: the watchdog is the watchdog option’s alone — a broadcast look (guard: false) keeps it', () => {
  const src = read('../stage/space.js');
  assert.match(src, /const dogOn = opt\.watchdog !== false && !\(typeof navigator/);
});

test('review #2: it judges only once the guard has done what it can, and the guard’s steps give no new grace', () => {
  const src = read('../stage/space.js');
  assert.match(src, /\(guardStage >= 2 \|\| opt\.guard === false\)/);
  assert.match(src, /dog\.reset\(performance\.now\(\) \/ 1000, \{ grace: 0 \}\)/);
  const w = createWatchdog();
  run(w, 16.7, 6, 0);                                // past the first grace
  w.reset(10, { grace: 0 });
  const { r, t } = run(w, 100, 5, 10);
  assert.equal(r, 'slow'); assert.ok(t < 12.5, String(t));   // the window, no grace
});

test('review #3: a world fallen back for slowness rests, and a fallback keeps it resting', () => {
  const src = read('../components/Stage.vue');
  assert.match(src, /if \(tier >= MAX_TIER\) \{ space\?\.setPaused\(true\); return fallback\('slow'/);
  assert.match(src, /const rest = \(\) => space\?\.setPaused\(document\.hidden \|\| covered\.value \|\| recordedRest\.value \|\| status\.status === 'fallback'\)/);
});
