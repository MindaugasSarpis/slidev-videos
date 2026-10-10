// The stage's clocks (stage/clock.js): rate ramps and the timed camera path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rampKeys, rampAt, rampLeft, pathAt, readPath, BUDGETS, MAX_RATE } from '../stage/clock.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('a number eases from the rate in force over `over` seconds, then holds', () => {
  const k = rampKeys(0.08, 1, 1.5);
  assert.deepEqual(k, [[0, 1], [1.5, 0.08]]);
  near(rampAt(k, 0), 1);
  near(rampAt(k, 0.75), (1 + 0.08) / 2);
  near(rampAt(k, 9), 0.08);
  near(rampLeft(k, 0.5), 1);
  near(rampLeft(k, 2), 0);
  assert.deepEqual(rampKeys(3, 1, 0), [[0, 3]]);           // no ease: at once
});

test('keyframes: from the rate in force to a later first key, eased between, the last holds; clamped', () => {
  const k = rampKeys([[1.5, 0.05], [5, 3], [4, 0.05]], 0.5);
  assert.deepEqual(k, [[0, 0.5], [1.5, 0.05], [4, 0.05], [5, 3]]);
  near(rampAt(k, 3), 0.05);
  assert.ok(rampAt(k, 4.5) > 0.05 && rampAt(k, 4.5) < 3);
  near(rampAt(k, 60), 3);
  assert.deepEqual(rampKeys([[0, -2], [1, 99]], 1), [[0, 0], [1, MAX_RATE]]);
  assert.deepEqual(rampKeys([[0, 1], ['x', 2]], 1), [[0, 1]]);
  assert.deepEqual(rampKeys(undefined, 0.2, 0), [[0, 1]]);  // no rate: back to 1
});

test('the camera path passes through its keys, eases in and out, and holds at the last', () => {
  const keys = [
    { t: 0, pos: [0, 0, 10], look: [0, 0, 0] },
    { t: 2, pos: [10, 0, 0], look: [0, 1, 0] },
    { t: 5, pos: [0, 0, -10], look: [0, 0, 0] },
  ];
  assert.deepEqual(pathAt(keys, -1).pos, [0, 0, 10]);
  for (const [i, k] of keys.entries()) {
    const p = pathAt(keys, k.t);
    k.pos.forEach((v, j) => near(p.pos[j], v, 1e-6));
    assert.equal(p.done, i === keys.length - 1);
  }
  const a = pathAt(keys, 0.01), b = pathAt(keys, 1);
  assert.ok(Math.hypot(...a.pos.map((v, j) => v - keys[0].pos[j])) < 0.05);     // eased in: barely moved
  assert.ok(b.pos[0] > 1 && b.pos[0] < 10 && b.pos.every(Number.isFinite));
  assert.equal(pathAt(keys, 99).done, true);
  assert.equal(pathAt([], 1), null);
});

test('a slide path reads as sorted keys; budgets per tier', () => {
  assert.deepEqual(readPath([[2.4, { at: 'b' }], [0, { at: 'a' }], ['x', {}], [3]]), [[0, { at: 'a' }], [2.4, { at: 'b' }]]);
  assert.equal(readPath('no'), null);
  assert.equal(readPath([]), null);
  assert.deepEqual(BUDGETS, [300000, 160000, 60000, 30000]);
});
