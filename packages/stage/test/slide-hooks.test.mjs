// whenEntered (stage/slide-hooks.js): a component's work on its slide's entry, once
// per entry. Slidev's onSlideEnter is a watchEffect: every reactive value its
// callback reads becomes a dependency, so it ran again on a click within the slide
// (Užsikrauk karjerai, 25 Oct: LHCb rebuilt under the map on a press).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ref, nextTick } from 'vue';
import { whenEntered } from '../stage/slide-hooks.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('runs on entry, not on a reactive read inside the callback', async () => {
  const active = ref(false), clicks = ref(0); let n = 0;
  whenEntered(active, () => { n++; void clicks.value; });
  active.value = true; await nextTick(); assert.equal(n, 1);
  clicks.value = 3; await nextTick(); assert.equal(n, 1);
});

test('immediate when mounted on the current slide', () => {
  let n = 0;
  whenEntered(ref(true), () => { n++; });
  assert.equal(n, 1);
});

test('entered again after leaving', async () => {
  const active = ref(true); let n = 0;
  whenEntered(active, () => { n++; });
  active.value = false; await nextTick();
  active.value = true; await nextTick();
  assert.equal(n, 2);
});

test('stop ends it', async () => {
  const active = ref(false); let n = 0;
  const stop = whenEntered(active, () => { n++; });
  stop(); active.value = true; await nextTick();
  assert.equal(n, 0);
});

test('the three components enter through whenEntered, not Slidev’s onSlideEnter', () => {
  for (const c of ['StageSteps', 'StageCount', 'StageDepthGrains']) {
    const src = read(`../components/${c}.vue`);
    assert.match(src, /whenEntered\((useIsSlideActive\(\)|active)/, c);
    if (!/whenEntered\(useIsSlideActive/.test(src)) assert.match(src, /const active = useIsSlideActive\(\)/, c);
    assert.doesNotMatch(src, /\bonSlideEnter\(/, c);
  }
});
