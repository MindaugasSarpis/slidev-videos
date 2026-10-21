// advance-on-end: whether a clip's `ended` goes on to the next slide, decided
// in one place from what the player sees (components/video-dust/advance.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAdvance, advanceGate, NAV_KEYS, NAV_GRACE_MS } from '../components/video-dust/advance.js';

// slide 8's clip ends on slide 8, no click taken, the world running, no press
const ended = {
  armed: true, armedClicks: 0, clicks: 0, advance: true, loop: false, context: 'slide', printing: false,
  active: true, rec: false, page: 8, current: 8, fallback: undefined, plateNext: undefined, lastNavMs: null, nowMs: 10_000,
};
const decide = (over) => shouldAdvance({ ...ended, ...over });

test('a clip ending on its own slide goes on', () => {
  assert.deepEqual(decide({}), { go: true, reason: 'ended' });
});

test('each refusal, the first rule that applies naming it', () => {
  assert.deepEqual(decide({ armed: false }), { go: false, reason: 'disarmed' });
  assert.deepEqual(decide({ advance: false }), { go: false, reason: 'off' });
  assert.deepEqual(decide({ loop: true }), { go: false, reason: 'loop' });
  assert.deepEqual(decide({ context: 'presenter' }), { go: false, reason: 'context' });
  assert.deepEqual(decide({ context: 'overview' }), { go: false, reason: 'context' });
  assert.deepEqual(decide({ printing: true }), { go: false, reason: 'print' });
  assert.deepEqual(decide({ active: false }), { go: false, reason: 'inactive' });
  assert.deepEqual(decide({ rec: true }), { go: false, reason: 'rec' });
  assert.deepEqual(decide({ current: 9 }), { go: false, reason: 'page' });
  assert.deepEqual(decide({ current: 7 }), { go: false, reason: 'page' });
  assert.deepEqual(decide({ clicks: 1 }), { go: false, reason: 'clicks' });
  assert.deepEqual(decide({ armedClicks: 2, clicks: 2 }), { go: true, reason: 'ended' });
  assert.equal(decide({ armed: false, loop: true, rec: true, current: 9 }).reason, 'disarmed');
});

test('without a world the clip goes on only onto the next slide\'s loaded plate', () => {
  assert.deepEqual(decide({ fallback: 'no-webgl2' }), { go: false, reason: 'no-plate' });
  assert.deepEqual(decide({ fallback: 'no-webgl2', plateNext: '9' }), { go: true, reason: 'plate' });   // as html[data-stage-plate-next] reads
  assert.deepEqual(decide({ fallback: 'no-webgl2', plateNext: 9 }), { go: true, reason: 'plate' });
  assert.deepEqual(decide({ fallback: 'no-webgl2', plateNext: '10' }), { go: false, reason: 'no-plate' });
  assert.deepEqual(decide({ fallback: 'no-webgl2', plateNext: '8' }), { go: false, reason: 'no-plate' });
  assert.deepEqual(decide({ fallback: 'context-lost', plateNext: '' }), { go: false, reason: 'no-plate' });
  // with the world up the plate attribute means nothing
  assert.deepEqual(decide({ plateNext: '10' }), { go: true, reason: 'ended' });
  assert.deepEqual(decide({ fallback: '', plateNext: '10' }), { go: true, reason: 'ended' });
  // the earlier rules still come first
  assert.equal(decide({ fallback: 'no-webgl2', plateNext: '9', clicks: 1 }).reason, 'clicks');
});

test('a press in the clip\'s last half second has navigated already', () => {
  assert.equal(NAV_GRACE_MS, 500);
  assert.deepEqual(decide({ lastNavMs: 9_990 }), { go: false, reason: 'pressed' });
  assert.deepEqual(decide({ lastNavMs: 9_501 }), { go: false, reason: 'pressed' });
  assert.deepEqual(decide({ lastNavMs: 9_500 }), { go: true, reason: 'ended' });
  assert.deepEqual(decide({ lastNavMs: 2_000 }), { go: true, reason: 'ended' });
  assert.deepEqual(decide({ lastNavMs: null }), { go: true, reason: 'ended' });        // never pressed
  assert.deepEqual(decide({ lastNavMs: undefined }), { go: true, reason: 'ended' });
  // onto a plate as well
  assert.deepEqual(decide({ lastNavMs: 9_800, fallback: 'no-webgl2', plateNext: '9' }), { go: false, reason: 'pressed' });
});

test('the keys Slidev navigates on, and not the player\'s own', () => {
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', ' ', 'PageUp', 'PageDown', 'Enter', 'Home', 'End']) assert.ok(NAV_KEYS.has(k), k);
  for (const k of ['p', 'P', '+', '=', '-', '_', 'o', 'd', 'g', 'f', 'Escape', 'Shift']) assert.ok(!NAV_KEYS.has(k), k);
});

test('one arming, one advance: a second ended is refused', () => {
  const { armed: _a, armedClicks: _c, ...seen } = ended;   // the gate supplies the arming
  const gate = advanceGate();
  assert.deepEqual(gate.ended(seen), { go: false, reason: 'disarmed' });   // never armed
  gate.arm(0);
  assert.deepEqual(gate.ended(seen), { go: true, reason: 'ended' });
  assert.deepEqual(gate.ended(seen), { go: false, reason: 'disarmed' });
  // armed at a click count, ended at the same
  gate.arm(2);
  assert.deepEqual(gate.ended({ ...seen, clicks: 2 }), { go: true, reason: 'ended' });
  gate.arm(2);
  assert.deepEqual(gate.ended({ ...seen, clicks: 3 }), { go: false, reason: 'clicks' });
  // the route moved away before the end
  gate.arm(0);
  gate.disarm();
  assert.deepEqual(gate.ended(seen), { go: false, reason: 'disarmed' });
  // a refused ended spends the arming too
  gate.arm(0);
  assert.equal(gate.ended({ ...seen, rec: true }).reason, 'rec');
  assert.equal(gate.ended(seen).reason, 'disarmed');
  // arming again is a fresh shot
  gate.arm(0);
  assert.equal(gate.ended(seen).reason, 'ended');
});
