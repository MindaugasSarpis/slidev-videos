// A slide entered cold (opened directly, a jump, a back-step) gets its state from the
// deck, not from the slides the presenter happened to pass. MasterTalk's crossing slide
// was black opened directly: its collision ran only from the slide before. Karjera's
// blink was the mirror: state carried in. A slide's `steps:` frontmatter holds from
// that slide on, worked out from the slide list as `places:` is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stepsAt, allSteps, setSteps, _resetSteps } from '../stage/steps.js';
import { slideSteps } from '../stage/budget.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
if (typeof globalThis.window === 'undefined') {
  const et = new EventTarget();
  globalThis.window = { dispatchEvent: (e) => et.dispatchEvent(e), addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a) };
}

test('stepsAt: each key from the slide that names it on, 0 before, whatever came before', () => {
  const decls = [null, { det: 1 }, null, { det: 2, flag: 1 }, { det: 0 }];
  assert.deepEqual(stepsAt(decls, 1), { det: 0, flag: 0 });
  assert.deepEqual(stepsAt(decls, 2), { det: 1, flag: 0 });
  assert.deepEqual(stepsAt(decls, 3), { det: 1, flag: 0 });   // the slide after: cold, it has the step
  assert.deepEqual(stepsAt(decls, 4), { det: 2, flag: 1 });
  assert.deepEqual(stepsAt(decls, 5), { det: 0, flag: 1 });
});

test('stepsAt ignores what is not a map of numbers', () => {
  assert.deepEqual(stepsAt(['det', [1], { a: 'x', b: 2 }], 3), { b: 2 });
});

test('allSteps reads the bus', () => {
  _resetSteps(); setSteps({ det: 1, emb: 0 });
  assert.deepEqual(allSteps(), { det: 1, emb: 0 });
});

test('the check counts frontmatter steps with the tags', () => {
  assert.deepEqual(slideSteps(['', '<StageSteps :set="{ b: 1 }" />', ''], [{ a: 1 }, null, { a: 0 }]), [{ a: 1 }, { a: 1, b: 1 }, { a: 0, b: 1 }]);
});

test('Stage.vue applies the fold on every slide change, before the slide’s own <StageSteps>; the probe shows the steps', () => {
  const src = read('../components/Stage.vue');
  assert.match(src, /setSteps\(stepsAt\(stepDecls\.value, n\)\)/);
  assert.match(src, /flush: 'sync'/);
  assert.match(src, /steps: allSteps\(\)/);
});
