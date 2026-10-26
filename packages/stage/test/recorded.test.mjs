// A slide as its recording (stage/recorded.js): `space.recorded: plate | clip`. Over a
// running world the slide's plate plays (or its clip stands), the world rests under it,
// and with `music` the video keeps the music's time. From Innoday's close, recorded and
// slaved to the music, which played whole where Užsikrauk karjerai's live one did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordedOf, layerNow, slaveRate } from '../stage/recorded.js';
import { SPACE_KEYS } from '../stage/types.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const none = new Set();

test('recordedOf reads the three forms and nothing else', () => {
  assert.equal(recordedOf(null), null); assert.equal(recordedOf({}), null); assert.equal(recordedOf({ recorded: 'nope' }), null);
  assert.equal(recordedOf({ recorded: false }), null);
  assert.deepEqual(recordedOf({ recorded: 'plate' }), { kind: 'plate', sync: null });
  assert.deepEqual(recordedOf({ recorded: 'clip' }), { kind: 'clip', sync: null });
  assert.deepEqual(recordedOf({ recorded: { kind: 'clip', music: 'starfire', at: 13.5 } }), { kind: 'clip', sync: { track: 'starfire', at: 13.5 } });
  assert.deepEqual(recordedOf({ recorded: { music: 'starfire' } }), { kind: 'plate', sync: { track: 'starfire', at: 0 } });
  assert.deepEqual(recordedOf({ recorded: { kind: 'plate', at: 3 } }), { kind: 'plate', sync: null });   // no music: nothing to keep time with
});

test('a recorded slide plays its plate over a running world', () => {
  assert.equal(layerNow({ base: 'world', slide: 30, recorded: { kind: 'plate' }, plateMissing: none }), 'plate');
});

test('a recorded slide whose plate is missing runs the world', () => {
  assert.equal(layerNow({ base: 'world', slide: 30, recorded: { kind: 'plate' }, plateMissing: new Set([30]) }), 'world');
});

test('plates off: a recorded slide runs the world', () => {
  assert.equal(layerNow({ base: 'world', slide: 30, recorded: { kind: 'plate' }, plateMissing: none, plates: false }), 'world');
});

test('a recorded clip slide keeps the world layer (the clip covers it)', () => {
  assert.equal(layerNow({ base: 'world', slide: 4, recorded: { kind: 'clip' }, plateMissing: none }), 'world');
});

test('the watchdog’s slide plays its plate too', () => {
  assert.equal(layerNow({ base: 'world', slide: 7, recorded: null, slowSlide: 7, plateMissing: none }), 'plate');
  assert.equal(layerNow({ base: 'world', slide: 8, recorded: null, slowSlide: 7, plateMissing: none }), 'world');
});

test('a fallback layer stands whatever the slide asks; a fallback plate that is missing is the living still', () => {
  assert.equal(layerNow({ base: 'still', slide: 3, recorded: { kind: 'plate' }, plateMissing: none }), 'still');
  assert.equal(layerNow({ base: 'plate', slide: 3, recorded: null, plateMissing: new Set([3]) }), 'living');
  assert.equal(layerNow({ base: 'plate', slide: 3, recorded: null, plateMissing: none }), 'plate');
  assert.equal(layerNow({ base: 'world-floor', slide: 3, recorded: null, plateMissing: none }), 'world-floor');
});

test('slaveRate: behind hurries, ahead slows, far off seeks', () => {
  assert.deepEqual(slaveRate(10, 23.5, 13.5), { rate: 1, seek: null });
  assert.ok(slaveRate(9.9, 23.5, 13.5).rate > 1); assert.ok(slaveRate(10.1, 23.5, 13.5).rate < 1);
  assert.equal(slaveRate(10.5, 23.5, 13.5).rate, 0.9);
  assert.equal(slaveRate(9.5, 23.5, 13.5).rate, 1.1);
  assert.deepEqual(slaveRate(14, 23.5, 13.5), { rate: 1, seek: 10 });
});

test('slaveRate before the recording starts on the music holds it at its top', () => {
  assert.deepEqual(slaveRate(2, 5, 13.5), { rate: 1, seek: 0 });
});

test('recorded is a slide key; Stage.vue wires the layer, rests the world, slaves the video', () => {
  assert.ok(SPACE_KEYS.includes('recorded'));
  const src = read('../components/Stage.vue');
  assert.match(src, /layerNow\(/); assert.match(src, /recordedOf\(/); assert.match(src, /slaveRate\(/);
  // mounted for a fallback's whole run (a missing plate is the living still, the element window kept), and over the world for its slide
  assert.ok(src.includes(`<StagePlate v-if="!printing && (layerBase === 'plate' || layer === 'plate')"`));
  assert.match(src, /recordedRest/);
});

test('StageSoundtrack’s clip drop keeps time through slaveRate', () => {
  assert.match(read('../components/StageSoundtrack.vue'), /slaveRate\(/);
});

test('under the recorder a recorded slide is the world (it films what the plate will be)', () => {
  assert.match(read('../components/Stage.vue'), /const recordedNow = \(\) => \(printing\.value \|\| globalThis\.__stageMaxDt/);
});
