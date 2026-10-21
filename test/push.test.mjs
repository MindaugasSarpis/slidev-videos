// The overlay's pure parts (components/video-dust/gl.js): exit="push"'s
// scale, the one the dust's shader and the player's live zoom share, and
// when the overlay declines its WebGL2 on the stage's word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pushScale, declinesGL, NO_WEBGL2 } from '../components/video-dust/gl.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the push starts at 1, accelerates, and ends some thirty times nearer', () => {
  assert.equal(pushScale(0), 1);
  assert.ok(pushScale(0.25) < 1.07);                       // eased in: barely moved a quarter in
  assert.ok(pushScale(0.75) - pushScale(0.5) > pushScale(0.5) - pushScale(0.25));
  assert.ok(Math.abs(pushScale(1) - 1 / 0.03) < 1e-9);
  assert.equal(pushScale(-1), 1);
  assert.equal(pushScale(2), pushScale(1));
});

test('the overlay declines its WebGL2 where the stage says there is none, found or forced — and only then', () => {
  assert.equal(NO_WEBGL2, 'no-webgl2');
  assert.equal(declinesGL('no-webgl2'), true);           // html[data-stage-fallback], the probe's finding or ?stage-force=no-webgl2 rehearsing it
  // the other reasons leave WebGL2 to the overlay: a venue with a world that cannot run still pushes live
  for (const r of ['no-float-target', 'plugin', 'data', 'init', 'context-lost', 'reduced-motion', 'shader']) assert.equal(declinesGL(r), false, r);
  for (const none of ['', null, undefined]) assert.equal(declinesGL(none), false, String(none));   // the world runs, or there is no stage
  assert.equal(declinesGL('NO-WEBGL2'), false);
  // VideoDust.vue asks before it makes a context, and says so in `available`
  const src = read('../components/VideoDust.vue');
  assert.match(src, /import \{[^}]*\bdeclinesGL\b[^}]*\} from '\.\/video-dust\/gl\.js'/);
  assert.match(src, /const declined = \(\) => typeof document !== 'undefined' && declinesGL\(document\.documentElement\.dataset\.stageFallback\)/);
  assert.match(src, /function renderer\(\) \{\n\s+if \(declined\(\)\) return null\n/);
  assert.match(src, /get available\(\) \{ return !failed && !declined\(\) \}/);
});
