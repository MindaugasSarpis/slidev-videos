// Calm where a slide asks for it (v0.11, from Užsikrauk karjerai's finale: the point
// cloud blinked from the start). One twinkle uniform for every grain material, set
// by the slide's `steady`; event times that go back to OFF once a stop has faded, so
// an earlier slide's event cannot keep a later slide's grains in its state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { twinkleUniform, twinkleAt } from '../stage/twinkle.js';
import { OFF, eventLatch } from '../stage/events.js';
import { GRAIN_GLSL, grainMaterial } from '../stage/grains.js';
import { SPACE_KEYS } from '../stage/types.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('twinkleAt: the deck’s twinkle, gone as steady comes in', () => {
  assert.equal(twinkleAt(1, 0), 1); assert.equal(twinkleAt(0.35, 0), 0.35);
  assert.equal(twinkleAt(1, 1), 0); assert.equal(twinkleAt(1, 0.5), 0.5);
  assert.equal(twinkleAt(-2, 0), 0); assert.equal(twinkleAt(1, 7), 0);
});

test('every grain material shares the one uniform', () => {
  const a = grainMaterial(GRAIN_GLSL + 'void main(){}'), b = grainMaterial(GRAIN_GLSL + 'void main(){}');
  assert.equal(a.uniforms.uTwinkle, twinkleUniform); assert.equal(b.uniforms.uTwinkle, twinkleUniform);
  assert.match(GRAIN_GLSL, /uniform float [^;]*uTwinkle/);
});

test('no grain shader twinkles outside uTwinkle', () => {
  // every `float tw = … sin(uTime` in the package's shaders is scaled by uTwinkle
  for (const f of ['grains.js', 'forms.js', 'builders.js', 'hero/core.js', 'depth-grains.js'])
    for (const line of read(`../stage/${f}`).split('\n').filter((l) => /float tw\s*=.*sin\(/.test(l)))
      assert.match(line, /uTwinkle/, `${f}: ${line.trim()}`);
});

test('forms and constellations take the shared uniform, not a copy of the option', () => {
  for (const f of ['forms.js', 'builders.js']) {
    const src = read(`../stage/${f}`);
    assert.match(src, /uTwinkle: twinkleUniform/, f);
    assert.doesNotMatch(src, /uTwinkle: \{ value: ctx/, f);
  }
});

test('a latch stopped and faded is all OFF', () => {
  const u = { s: { value: OFF }, h: { value: OFF }, c: { value: OFF } };
  const L = eventLatch(u, { start: 's', hide: 'h', also: ['c'], fade: 1.6 });
  L.start(10); u.c.value = 17; assert.ok(L.on);
  L.stop(20); assert.equal(u.h.value, 20); assert.ok(L.tick(21));
  assert.equal(L.tick(21.7), false);
  for (const k of ['s', 'h', 'c']) assert.equal(u[k].value, OFF, k);
  assert.ok(!L.on);
});

test('a second stop does not move the fade', () => {
  const u = { s: { value: OFF }, h: { value: OFF } };
  const L = eventLatch(u, { start: 's', hide: 'h', fade: 1 });
  L.start(1); L.stop(2); L.stop(2.8);
  assert.equal(u.h.value, 2);
});

test('a stop with nothing started leaves it all OFF', () => {
  const u = { s: { value: OFF }, h: { value: OFF } };
  const L = eventLatch(u, { start: 's', hide: 'h', fade: 1 });
  L.stop(5); assert.equal(u.h.value, OFF); assert.equal(L.tick(5), false);
});

test('a restart during the fade keeps the event and clears the hide', () => {
  const u = { s: { value: OFF }, h: { value: OFF } };
  const L = eventLatch(u, { start: 's', hide: 'h', fade: 1 });
  L.start(1); L.stop(2); L.start(2.5); L.tick(9);
  assert.equal(u.s.value, 2.5); assert.equal(u.h.value, OFF);
});

test('start(t, at) dates the event earlier (a jump shows it whole)', () => {
  const u = { s: { value: OFF }, h: { value: OFF } };
  eventLatch(u, { start: 's', hide: 'h', fade: 1 }).start(50, -50);
  assert.equal(u.s.value, -50);
});

test('the lhcb detector and emblem clear their event times through the latch', () => {
  const src = read('../stage/plugins/lhcb.js');
  assert.match(src, /eventLatch\(u, \{ start: 'uShowT', hide: 'uHideT', also: \['uHitT'\]/);
  assert.match(src, /eventLatch\(u, \{ start: 'uT0', hide: 'uHide'/);
});

test('depth grains twinkle on the world clock', () => {
  assert.match(read('../stage/depth-grains.js'), /worldTime\(\)/);
  assert.doesNotMatch(read('../stage/depth-grains.js'), /uTime\.value = \(performance\.now\(\)/);
});

test('steady is a slide key the engine reads', () => {
  assert.ok(SPACE_KEYS.includes('steady'));
  assert.match(read('../stage/space.js'), /setSteady\(/);
  assert.match(read('../stage/space.js'), /twinkleUniform\.value = twinkleAt\(/);
  assert.match(read('../components/Stage.vue'), /setSteady\(/);
});

test('review #4: steady holds a grain at its mean light (the twinkle’s depth scales, its mean stays)', () => {
  // `mix(1.0, tw0, uTwinkle)` went to 1.0, above tw0's mean: size and alpha both scale by tw, and a
  // steady detector carried ~1.5× its light. The form is `mean + depth * uTwinkle * sin(…)`.
  for (const f of ['grains.js', 'forms.js', 'builders.js', 'hero/core.js', 'depth-grains.js'])
    for (const line of read(`../stage/${f}`).split('\n').filter((l) => /float tw\s*=.*sin\(/.test(l)))
      assert.match(line, /float tw = [\d.]+ \+ [\d.]+ \* uTwinkle \* sin\(/, `${f}: ${line.trim()}`);
});
