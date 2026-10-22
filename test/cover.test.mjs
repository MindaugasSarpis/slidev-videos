// A `cut` clip covers its slide like a `fade` or `dust` one: once it is shown
// it says so (slidev-videos:cover), and slidev-addon-stage rests its world
// under it. It never did: the cut path (syncPlayback) never reached enter(),
// so the world drew on under a cut clip for its whole length.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cutCovers } from '../components/video-dust/bus.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a cut clip covers its slide once it is on screen and loaded — and only then', () => {
  const on = { mode: 'cut', active: true, live: true, status: 'ready' };
  assert.equal(cutCovers(on), true);
  assert.equal(cutCovers({ ...on, active: false }), false);            // left: the world comes back
  assert.equal(cutCovers({ ...on, live: false }), false);              // the overview's or a print page's copy
  for (const s of ['idle', 'loading', 'error']) assert.equal(cutCovers({ ...on, status: s }), false, s);   // nothing to show yet, or never
  for (const m of ['fade', 'dust']) assert.equal(cutCovers({ ...on, mode: m }), false, m);                 // enter() and exit() say it for these
});

test('the player says it for a cut clip as it does for the others', () => {
  const src = read('../components/VideoPlayer.vue');
  assert.match(src, /import \{[^}]*\bcutCovers\b[^}]*\} from '\.\/video-dust\/bus\.js'/);
  assert.match(src, /const cutCovering = computed\(\(\) => cutCovers\(\{ mode: effTransition\.value, active: isActive\.value, live: isLive\.value, status: status\.value \}\)\)/);
  // the stage keeps the last word: stepping from one cut clip to the next, the
  // slide left gives the world back in the same flush as the new one covers it,
  // in either order (the watchers run in mount order). The cover waits a tick,
  // so it comes last, and is said only if it still holds.
  assert.match(src, /watch\(cutCovering, \(covered\) => \{\n\s+if \(!covered\) return announce\('cover', \{ covered: false, src: props\.src, fit: effFit\.value \}\)\n\s+setTimeout\(\(\) => \{ if \(cutCovering\.value\) announce\('cover', \{ covered: true, src: props\.src, fit: effFit\.value \}\) \}, 0\)\n\}\)/);
  // unmounted while it covered: the world is given back
  assert.match(src, /if \(phase === 'shown' \|\| cutCovering\.value\) announce\('cover', \{ covered: false/);
});
