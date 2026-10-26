<script setup>
import { watch } from 'vue'
import { useIsSlideActive, useSlideContext } from '@slidev/client'
import { setSteps } from '../stage/steps.js'
import { whenEntered } from '../stage/slide-hooks.js'

// <StageSteps :set="{ det: 1, ltFlag: 0 }" />: when its slide becomes the current
// one, each named form in the world goes to that step (stage/steps.js).
// :clicks="{ 1: { det: 2 } }": from that click on, these steps instead. A slide
// entered at a later click (stepping back into it) starts there too.
// (From the talks' setup/Grains.vue, Oct 2026.)
const props = defineProps({
  set: { type: Object, default: () => ({}) },
  clicks: { type: Object, default: () => ({}) },
})
const { $clicks, $renderContext } = useSlideContext()
const active = useIsSlideActive()
const apply = () => {
  // only the live slide steers the world: the overview grid and the previews render
  // their copies with every click done, which would step a later slide's forms early
  if (!['slide', 'presenter'].includes($renderContext?.value)) return
  const steps = { ...props.set }
  for (const [at, part] of Object.entries(props.clicks)) if ($clicks.value >= Number(at)) Object.assign(steps, part)
  setSteps(steps)
}
whenEntered(active, apply)   // once per entry; a click within the slide is the watch below's
watch($clicks, () => { if (active.value) apply() })
</script>

<template><span class="stage-steps" aria-hidden="true" /></template>
