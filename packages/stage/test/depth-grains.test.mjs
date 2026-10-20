// stage/depth-grains.js: sampling, the depth PNG, placing in depth, the scale law,
// poses. Pure maths, no WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { samplePixels, decodeDepth, placeInDepth, scaleLaw, poseOf, poseCamera } from '../stage/depth-grains.js';
import { whenGateOpen, setStageGate } from '../stage/gate.js';

const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

test('samplePixels: grains only on bright pixels, none from black', () => {
  const w = 4, h = 2, px = new Uint8ClampedArray(w * h * 4);
  px.set([255, 0, 0, 255], (1 * w + 2) * 4);   // one red pixel at (2, 1)
  const s = samplePixels(px, w, h, { n: 200, weight: 'max', norm: 1, floor: 0.06, gamma: 1.2, sat: 1 });
  assert.equal(s.n, 200);
  for (let k = 0; k < s.n; k++) {
    assert.ok(s.uv[k * 2] >= 0.5 && s.uv[k * 2] < 0.75);
    assert.ok(s.uv[k * 2 + 1] >= 0.5);
    assert.deepEqual([...s.col.slice(k * 3, k * 3 + 3)], [1, 0, 0]);
  }
  assert.equal(samplePixels(new Uint8ClampedArray(16), 2, 2, { n: 10 }).n, 0);
});

test('decodeDepth: 0 is no hit; 1 is near; 65534 is far', () => {
  const px = new Uint8ClampedArray([0, 0, 0, 255, 0, 1, 0, 255, 255, 254, 0, 255]);
  const d = decodeDepth(px, { w: 3, h: 1, near: 0.1, far: 0.3 });
  assert.equal(d[0], 0); assert.ok(near(d[1], 0.1)); assert.ok(near(d[2], 0.3));
});

test('placeInDepth: the centre pixel lies on the forward ray at its depth; no-hit grains drop', () => {
  const meta = {
    origin: [1, 2, 3], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], vfov: 60, aspect: 2,
    depth: { w: 2, h: 2, near: 0.1, far: 0.5 }, flagUV: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]],
  };
  const depth = new Float32Array([0.2, 0.2, 0.2, 0]);   // the bottom-right quarter hit nothing
  const s = { n: 2, uv: new Float32Array([0.5, 0.5, 0.9, 0.9]) };
  const p = placeInDepth(s, depth, meta);
  // u = v = 0.5 → straight ahead, lands in pixel (1, 1): depth 0 there, so it is dropped at `far`
  assert.equal(p.keep[0], 0); assert.ok(near(p.pos[2], 3 - 0.5));
  assert.equal(p.flag[0], 1); assert.equal(p.flag[1], 0);
  const s2 = { n: 1, uv: new Float32Array([0.25, 0.25]) };   // top-left: depth 0.2, up and left of centre
  const q = placeInDepth(s2, depth, meta);
  const t = Math.tan(Math.PI / 6);
  assert.equal(q.keep[0], 1);
  assert.ok(near(q.pos[0], 1 + (2 * 0.25 - 1) * t * 2 * 0.2));
  assert.ok(near(q.pos[1], 2 + (1 - 2 * 0.25) * t * 0.2));
  assert.ok(near(q.pos[2], 3 - 0.2));
});

test('scaleLaw: s0 at d0, sEnd at dEnd, monotone and held past the ends', () => {
  const law = scaleLaw({ s0: 25, d0: 2.4, sEnd: 2.5, dEnd: 30 });
  assert.ok(near(law(2.4), 25)); assert.ok(near(law(30), 2.5));
  assert.equal(law(1), 25); assert.equal(law(100), 2.5);
  assert.ok(law(5) > law(10) && law(10) > law(20));
});

test('poseOf and poseCamera are inverses', () => {
  const cam = new Vector3(3, 4, -2), target = new Vector3(1, -1, 5);
  const back = poseCamera(poseOf(cam, target));
  assert.ok(back.distanceTo(cam) < 1e-9);
});

test('the stage gate holds work until it opens; none set runs at once', () => {
  const ran = [];
  whenGateOpen(() => ran.push('now'));
  let open;
  setStageGate((fn) => { open = fn; return () => { open = null; }; });
  const off = whenGateOpen(() => ran.push('later'));
  assert.deepEqual(ran, ['now']);
  open();
  assert.deepEqual(ran, ['now', 'later']);
  off(); setStageGate(null);
});
