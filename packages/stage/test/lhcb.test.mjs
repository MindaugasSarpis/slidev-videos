// The step bus (stage/steps.js) and the lhcb plugin's pure parts: part colours,
// the .bin's grains, the hits, the flag. No WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';
import { setStep, setSteps, stepOf, hasStep, onStep, setStepLater, tickSteps, stepWaiting, stepper, _resetSteps } from '../stage/steps.js';
import * as lhcb from '../stage/plugins/lhcb.js';
import { PLUGIN_TYPES } from '../stage/types.js';
import { shippedPlugins } from '../index.js';

// node has no window: give the bus one to dispatch on
if (typeof globalThis.window === 'undefined') {
  const et = new EventTarget();
  globalThis.window = { dispatchEvent: (e) => et.dispatchEvent(e), addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a) };
}

test('the bus: set, read, listen, unsubscribe', () => {
  _resetSteps();
  const seen = [];
  const off = onStep('det', (k) => seen.push(k));
  setStep('det', 1); setStep('det', 1); setSteps({ det: 2, other: 5 });
  assert.deepEqual(seen, [1, 2]);                 // a repeat is not a change
  assert.equal(stepOf('det'), 2); assert.equal(stepOf('other'), 5);
  assert.ok(hasStep('other')); assert.ok(!hasStep('nobody'));
  off(); setStep('det', 0);
  assert.deepEqual(seen, [1, 2]);
});

test('a stepper sees the step a name already has, then each change', () => {
  _resetSteps();
  setStep('em', 1);
  const s = stepper('em');
  assert.equal(s.step, 1); assert.ok(s.fresh);
  s.fresh = false; setStep('em', 0);
  assert.equal(s.step, 0); assert.equal(s.prev, 1); assert.ok(s.fresh);
  s.off();
  const t = stepper('new');
  assert.equal(t.step, 0); assert.ok(!t.fresh);
});

test('setStepLater falls due on the world clock, and can be cancelled', () => {
  _resetSteps();
  tickSteps(10);
  setStepLater('a', 2, 1.5);
  const cancel = setStepLater('b', 1, 1);
  assert.ok(stepWaiting('a'));
  tickSteps(11); assert.equal(stepOf('a'), undefined); assert.equal(stepOf('b'), 1);
  cancel();
  tickSteps(11.6); assert.equal(stepOf('a'), 2); assert.ok(!stepWaiting('a'));
});

test('the plugin is shipped, and its types table matches types.js', async () => {
  assert.ok(shippedPlugins().includes('lhcb'));
  assert.deepEqual(lhcb.types, PLUGIN_TYPES.lhcb);
  const seen = new Map();
  lhcb.install({ registerBuilder: (t, fn, { fields }) => seen.set(t, [typeof fn, fields]) });
  assert.deepEqual([...seen.keys()].sort(), Object.keys(PLUGIN_TYPES.lhcb).sort());
  for (const [t, [kind, fields]] of seen) { assert.equal(kind, 'function', t); assert.deepEqual(fields, PLUGIN_TYPES.lhcb[t]); }
});

test('parts: none is one colour (as v0.8), lhcb is white and light blue, an object overrides', () => {
  const one = lhcb.partTable(undefined, '#5b93ff');
  assert.equal(one.length, 10);
  assert.ok(one.every((p) => p.color === '#5b93ff' && p.alpha === 1));
  const kit = lhcb.partTable('lhcb');
  assert.deepEqual(kit.map((p) => p.color), lhcb.PARTS.map((n) => lhcb.PART_COLORS[n].color));
  // never gold: every colour's blue is its largest channel, and red never leads green
  for (const p of kit) { const c = new Color(p.color); assert.ok(c.b >= c.g && c.g >= c.r, p.color); }
  // the magnet the faintest; the trackers brightest
  const a = Object.fromEntries(lhcb.PARTS.map((n, i) => [n, kit[i].alpha]));
  assert.ok(Object.values(a).every((x) => x >= a.magnet));
  for (const t of ['velo', 'ut', 'scifi']) assert.equal(a[t], Math.max(...Object.values(a)));
  // neighbours along the beam set apart
  for (let i = 1; i < kit.length; i++) assert.ok(kit[i].color !== kit[i - 1].color || kit[i].alpha !== kit[i - 1].alpha, lhcb.PARTS[i]);
  // Innoday's weights, as data: the pipe gone, the VELO dimmed, the walls doubled, over one colour
  const inno = lhcb.partTable({ pipe: { alpha: 0 }, velo: { alpha: 0.25 }, ecal: { alpha: 2 }, hcal: { alpha: 2 }, muon: { alpha: 2 } }, '#5b93ff');
  assert.deepEqual(inno.map((p) => p.alpha), [0.25, 0, 1, 1, 1, 1, 1, 2, 2, 2]);
  assert.ok(inno.every((p) => p.color === '#5b93ff'));
  const over = lhcb.partTable({ preset: 'lhcb', magnet: { alpha: 0 } });
  assert.equal(over[4].alpha, 0); assert.equal(over[0].color, '#e6efff');
});

function bin(grains) {
  const a = new Int16Array(grains.length * 4);
  grains.forEach((g, i) => a.set(g, i * 4));
  return a.buffer;
}

test('readGrains keeps all within the budget and thins to it on any tier', () => {
  const buf = bin(Array.from({ length: 1000 }, (_, i) => [i, 0, 0, i % 10]));
  assert.equal(lhcb.readGrains(buf).length / 4, 1000);
  assert.equal(lhcb.readGrains(buf, { tier: 0, budget: 500 }).length / 4, 500);   // v0.11: tier 0 too
  const thin = lhcb.readGrains(buf, { tier: 2, budget: 300 });
  assert.equal(thin.length / 4, 250);                 // every 4th
  assert.deepEqual([...thin.slice(0, 8)], [0, 0, 0, 0, 4, 0, 0, 4]);   // whole records kept
});

test('markHits: grains a track passes near, never at the beam', () => {
  const raw = new Int16Array(bin([
    [300, 0, 1000, 3],    // on the track (0.3 m, 0, 1 m)
    [500, 0, 1000, 3],    // 20 cm off it
    [50, 0, 1000, 0],     // near the beam: never a hit
    [300, 10, 1020, 3],   // 1 cm off, in the next 5 cm bin
  ]));
  const track = [[0.3, 0, 1.0], [0.3, 0, 1.05], [0.05, 0, 1.0]];
  const { hit, hits } = lhcb.markHits(raw, [track]);
  assert.deepEqual([...hit], [1, 0, 0, 1]);
  assert.equal(hits, 2);
  assert.equal(lhcb.markHits(raw, null).hits, 0);
});

test('flagGrains: the flag in three bands, top to bottom', () => {
  const f = lhcb.flagGrains(3000, 5);
  const h = 3;
  for (let i = 0; i < 3000; i++) {
    const y = f.home[i * 3 + 1];
    assert.ok(Math.abs(y) <= h / 2 + 1e-6);
    const band = Math.min(2, Math.floor((0.5 - y / h) * 3));
    const g = f.col[i * 3 + 1], r = f.col[i * 3];
    if (band === 0) assert.ok(r > 0.8 && g > 0.7);    // yellow
    if (band === 1) assert.ok(r < 0.2 && g > 0.2);    // green
    if (band === 2) assert.ok(r > 0.6 && g < 0.3);    // red
  }
});

test('imageMarks: grains only where the image has marks, in its colours', () => {
  const W = 10, H = 10, px = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < 3; x++) px.set([0, 40, 200, 255], (y * W + x) * 4);   // a blue left strip
  const m = lhcb.imageMarks(px, W, H, 500, 1, {});
  for (let k = 0; k < 500; k++) {
    assert.ok(m.home[k * 3] < -0.5 + 0.3 + 1e-6);
    assert.ok(Math.abs(m.col[k * 3 + 2] - 200 / 255) < 1e-6);
  }
  assert.equal(lhcb.imageMarks(new Uint8ClampedArray(16).fill(255), 2, 2, 5, 1).home.every((v) => v === 0), true);   // a blank image: none
});
