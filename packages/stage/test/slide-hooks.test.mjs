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

// Tokyo (12 Nov): after a step back and forward again onto a slide with `start`, the music did not
// start; the next slide started it. The slide's entry ran before the watcher that keeps the previous
// slide, so it read the slide it had just come back from (its own number) and took the arrival for
// a step back. The previous slide has to be known before any slide's entry runs.
import { computed } from 'vue';
import { trackPrev } from '../stage/slide-hooks.js';

test('Tokyo (b): back and forward again onto a slide is a forward arrival', async () => {
  const cur = ref(1);
  const seen = [];
  // slide 2's soundtrack enters first (its setup ran before the first one's onMounted made the watcher)
  whenEntered(computed(() => cur.value === 2), () => seen.push({ prev: h.prev, forward: h.prev == null || h.prev < 2 }));
  const h = trackPrev(cur);
  cur.value = 2; await nextTick();       // 1 → 2
  cur.value = 1; await nextTick();       // back
  cur.value = 2; await nextTick();       // forward again
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((s) => s.prev), [1, 1]);
  assert.ok(seen.every((s) => s.forward));
});

test('StageSoundtrack reads the previous slide from trackPrev', () => {
  const src = read('../components/StageSoundtrack.vue');
  assert.match(src, /trackPrev\(/);
  assert.doesNotMatch(src, /G\.prev = old/);
});
