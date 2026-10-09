<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { onSlideEnter, onSlideLeave, useSlideContext, useNav, configs } from '@slidev/client'
import { formatCount, countRun, countAt, countSpan } from '../stage/count.js'
import { shared } from '../stage/shared.js'

// <StageCount name="open" :from="800" :to="55000" />: a number that counts
// when its slide becomes the current one, written the way its language
// writes numbers. It takes every prop of the Count.vue the talks carried, with
// the same defaults, so a talk moves to it by renaming the tag.
//
//   to         where it lands (required). Printed, exported, in the overview,
//              in the presenter's next-slide preview and under reduced motion
//              it shows this at once
//   from       where it starts (0)
//   ms, delay  how long the count runs, and how long it waits after the
//              slide arrives (2900 ms, 1000 ms: the pace at which the grains
//              of a step arrive)
//   name       counts of one name continue each other across slides: entered
//              again, the count starts from what that name last landed on, so
//              an unchanged form shows its number at once and going back
//              counts down over 1.1 s with the scattering grains
//   decimals   digits after the decimal sign (0)
//   group      'auto': the language's rule; true: groups of three from four
//              digits up; false: never (years). `plain` is group false
//   lang       'lt' or 'en'; default `stage.lang`, else the deck's
//              htmlAttrs.lang, else 'en'. Both set groups of three apart with
//              a narrow no-break space; lt groups from five digits up (1844,
//              55 000) and takes a decimal comma, en from four (1 844) with a
//              decimal point
//   for        the `name` of an object in the space whose builder offers
//              api.value(): while the slide is up the count shows that number,
//              so it moves with the form and cannot run ahead of it. Without
//              such an object (or without the world) it keeps its own clock.
const props = defineProps({
  to: { type: Number, required: true },
  from: { type: Number, default: 0 },
  ms: { type: Number, default: 2900 },
  delay: { type: Number, default: 1000 },
  name: { type: String, default: '' },
  decimals: { type: Number, default: 0 },
  group: { type: [Boolean, String], default: 'auto' },
  plain: { type: Boolean, default: false },
  lang: { type: String, default: '' },
  for: { type: String, default: '' },
})

// what each named count last landed on, one map per page however many copies
// of the package it has loaded (live windows only: a printed page, the
// overview or a preview leaves it alone)
const last = shared('counts', () => new Map())

const CFG = (configs && configs.stage && typeof configs.stage === 'object') ? configs.stage : {}
const lang = computed(() => props.lang || CFG.lang || configs?.htmlAttrs?.lang || 'en')
const { $renderContext } = useSlideContext()
const nav = useNav()
// print renders slides in the default render context, 'slide': ask the route as well
const printing = () => !!nav.isPrintMode?.value || ['print', 'export'].includes(nav.currentRoute?.value?.name)
const live = () => ['slide', 'presenter'].includes($renderContext?.value) && !printing()
  && !matchMedia('(prefers-reduced-motion: reduce)').matches

const value = ref(props.to)
// the count under way (none yet: at rest on `to`)
const run = ref(null)
// what the named form shows now, from the world under this window's slides
const engine = () => {
  if (!props.for) return null
  const v = document.querySelector('.stage')?.__space?.value?.(props.for)
  return Number.isFinite(v) ? v : null
}

let raf = 0
onSlideEnter(() => {
  cancelAnimationFrame(raf)
  if (!live()) { value.value = props.to; run.value = null; return }
  const r = countRun({ from: props.from, to: props.to, ms: props.ms, delay: props.delay, last: props.name ? last.get(props.name) : undefined })
  if (props.name) last.set(props.name, props.to)
  run.value = r
  const t0 = performance.now()
  value.value = engine() ?? r.from
  if (!r.ms && !props.for) return
  const tick = (now) => {
    const v = engine()
    if (v != null) { value.value = v; raf = requestAnimationFrame(tick); return }
    value.value = countAt(r, now - t0)
    if (now - t0 < r.delay + r.ms) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})
onSlideLeave(() => cancelAnimationFrame(raf))
onUnmounted(() => cancelAnimationFrame(raf))

const text = computed(() => formatCount(value.value, {
  decimals: props.decimals, lang: lang.value, group: props.group, plain: props.plain,
  span: run.value ? countSpan(run.value, value.value) : Math.abs(props.to),
}))
</script>

<template><span class="stage-count">{{ text }}</span></template>

<style scoped>
/* figures of one width: the number does not shake as it counts */
.stage-count { font-variant-numeric: tabular-nums; }
</style>
