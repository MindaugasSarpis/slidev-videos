// The grains a slide lights (stage/budget.js, slidev-stage-check's `grain-budget`),
// the lhcb detector's budget at every tier, and an M-series Mac's tier. From
// Užsikrauk karjerai's finale on an M2 (Oct 2026): ~1.1M additive grains at tier 0,
// where the detector's budget was not applied, and the close went white.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAIN_BUDGET, dustGrains, grainsOf, slideSteps, litGrains, TIER_SIM, FORM_BUDGET } from '../stage/budget.js';
import { TIERS } from '../stage/space.js';
import { BUDGETS } from '../stage/clock.js';
import { readGrains } from '../stage/plugins/lhcb.js';
import { pickTier } from '../stage/diagnose.js';
import { checkStage, parseArgs } from '../bin/check.mjs';

test('the budget tables are the engine’s', () => {
  assert.deepEqual(TIER_SIM, TIERS.map((t) => t.sim));
  assert.deepEqual(FORM_BUDGET, BUDGETS);
  assert.deepEqual(GRAIN_BUDGET, [600000, 320000, 120000, 60000]);
  assert.equal(dustGrains(0), 352 * 352); assert.equal(dustGrains(3), 128 * 128);
});

test('the detector’s budget holds at tier 0', () => {
  assert.equal(readGrains(new Int16Array(446400 * 4).buffer, { tier: 0, budget: 300000 }).length / 4, 223200);
  assert.equal(readGrains(new Int16Array(93000 * 4).buffer, { tier: 0, budget: 300000 }).length / 4, 93000);
});

test('an Apple M-series GPU starts at tier 1, an iPad as before, others as before', () => {
  assert.equal(pickTier({ maxTexture: 16384, gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' }, { screenWidth: 1512, screenHeight: 982 }), 1);
  assert.equal(pickTier({ maxTexture: 16384, gpu: 'Apple GPU' }, { screenWidth: 1512, screenHeight: 982 }), 1);
  assert.equal(pickTier({ maxTexture: 16384, gpu: 'Apple GPU' }, { coarse: true, screenWidth: 820, screenHeight: 1180 }), 1);
  assert.equal(pickTier({ maxTexture: 16384, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)' }, { screenWidth: 1920, screenHeight: 1080 }), 0);
});

test('grainsOf: the shipped data, a deck file by its size, the defaults, thinned per tier', () => {
  const fileBytes = (p) => (p === 'data/big.bin' ? 8 * 900000 : null);
  assert.equal(grainsOf({ type: 'detector', src: 'lhcb-dense' }, { tier: 0 }), 223200);
  assert.equal(grainsOf({ type: 'detector' }, { tier: 0 }), 93000);
  assert.equal(grainsOf({ type: 'detector', src: 'data/big.bin' }, { tier: 0, fileBytes }), 300000);
  assert.equal(grainsOf({ type: 'detector', src: 'lhcb' }, { tier: 2 }), 46500);
  assert.equal(grainsOf({ type: 'emblem' }, { tier: 0 }), 26000);
  assert.equal(grainsOf({ type: 'floor' }, { tier: 0 }), 18000);
  assert.equal(grainsOf({ type: 'galaxy' }, { tier: 0 }), 80000);
  assert.equal(grainsOf({ type: 'mine', grains: 5000 }, { tier: 0 }), 5000);
  assert.equal(grainsOf({ type: 'mine' }, { tier: 0 }), null);   // not counted: nothing says
});

test('steps carry forward from slide to slide, clicks at their last, comments skipped', () => {
  const s = slideSteps([
    '<StageSteps :set="{ det: 1 }" />',
    '',
    '<Grains :set="{ det: 0, emb: 1 }" />',
    '<!-- <StageSteps :set="{ det: 5 }" /> -->',
    `<StageSteps :set="{ det: 1 }" :clicks="{ 1: { det: 2 }, 2: { emb: 0 } }" />`,
  ]);
  assert.deepEqual(s, [{ det: 1 }, { det: 1 }, { det: 0, emb: 1 }, { det: 0, emb: 1 }, { det: 2, emb: 0 }]);
});

test('litGrains: the dust, the unnamed, the named that are stepped on, and those no step drives', () => {
  const objects = [{ type: 'detector', name: 'det', src: 'lhcb-dense' }, { type: 'emblem', name: 'emb' }, { type: 'galaxy', grains: 50000 }, { type: 'floor', name: 'fl', of: 'det' }];
  const off = litGrains({ objects, steps: {}, tier: 0, stepped: new Set(['det', 'emb']) });
  assert.equal(off.total, dustGrains(0) + 50000);
  const on = litGrains({ objects, steps: { det: 1 }, tier: 0, stepped: new Set(['det', 'emb']) });
  assert.equal(on.total, dustGrains(0) + 50000 + 223200 + 18000);
  assert.deepEqual(on.top[0], { name: 'det', grains: 223200 });
});

const DECK = (tier = '') => `---
stage:
  plugins: [lhcb]${tier}
---

<StageSteps :set="{ det: 1 }" />

---

<StageSteps :set="{ det: 1, detp: 1, emb: 1 }" />

---

<StageSteps :set="{ det: 0, detp: 0, emb: 0 }" />
`;
const SPACE = { stations: [{ id: 'hero', pos: [0, 0, 0], look: { dist: 9 }, objects: [
  { type: 'detector', name: 'det', pos: [0, 0, 0], src: 'lhcb-dense' },
  { type: 'detector', name: 'detp', pos: [0, 0, 0], src: 'data/big.bin' },
  { type: 'emblem', name: 'emb', pos: [0, 0, 0] },
] }] };
const fileBytes = (p) => (p === 'data/big.bin' ? 8 * 900000 : null);

test('a slide over budget warns with its heaviest objects; one under does not', () => {
  const r = checkStage({ space: SPACE, deck: DECK(), fileBytes });
  const warn = r.issues.filter((i) => i.code === 'grain-budget');
  assert.deepEqual(warn.map((w) => [w.slide, w.level]), [[2, 'warning']]);
  assert.match(warn[0].msg, /^slide 2: ~673k grains lit at tier 0, over the 600k budget \(detp 300k, det 223k, dust 124k/);
  assert.equal(r.problems.length, 0);
});

test('the tier picks the budget: stage.tier, or --tier', () => {
  const r = checkStage({ space: SPACE, deck: DECK('\n  tier: 1'), fileBytes });
  const w1 = r.issues.filter((i) => i.code === 'grain-budget');
  assert.deepEqual(w1.map((w) => w.slide), [2]);               // a lower tier thins the detectors too
  assert.match(w1[0].msg, /at tier 1, over the 320k budget/);
  const t = checkStage({ space: SPACE, deck: DECK(), fileBytes, tier: 3 });
  assert.match(t.issues.find((i) => i.code === 'grain-budget' && i.slide === 2).msg, /at tier 3, over the 60k budget/);
  assert.equal(parseArgs(['--tier', '2']).tier, 2);
});
