// A component's work on its slide's entry, once per entry. Slidev's own
// onSlideEnter is a watchEffect: every reactive value its callback reads (the
// slide's $clicks, a prop, a ref) becomes a dependency, so it ran again on a
// click within the slide (Užsikrauk karjerai, 25 Oct: LHCb rebuilt under the
// map on a press; the music's arrival ran again on every press). This runs
// when the slide becomes the current one, and only then:
//
//   import { useIsSlideActive } from '@slidev/client'
//   whenEntered(useIsSlideActive(), () => { … })   → stop()
//
// Vue alone, so node can hold it to account (test/slide-hooks.test.mjs).
import { watch } from 'vue';

export function whenEntered(active, cb) {
  return watch(active, (on) => { if (on) cb(); }, { immediate: true });
}
