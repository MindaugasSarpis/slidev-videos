// exit="push": the scale the picture grows to about the point, shared by the
// dust's shader and the player's live zoom (components/video-dust/gl.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushScale } from '../components/video-dust/gl.js';

test('the push starts at 1, accelerates, and ends some thirty times nearer', () => {
  assert.equal(pushScale(0), 1);
  assert.ok(pushScale(0.25) < 1.07);                       // eased in: barely moved a quarter in
  assert.ok(pushScale(0.75) - pushScale(0.5) > pushScale(0.5) - pushScale(0.25));
  assert.ok(Math.abs(pushScale(1) - 1 / 0.03) < 1e-9);
  assert.equal(pushScale(-1), 1);
  assert.equal(pushScale(2), pushScale(1));
});
