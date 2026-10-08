<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { onSlideEnter, onSlideLeave, useSlideContext, useNav, configs } from '@slidev/client'
import { formatCount } from '../stage/count.js'

// <StageCount :to="55000" />: a number that counts when its slide becomes the
// current one, written the way its language writes numbers.
//
//   to         where it lands (required). Printed, exported, in the overview,
//              in the presenter's next-slide preview and under reduced motion
//              it shows this at once
//   from       where it starts (0)
//   ms, delay  how long the count runs, and how long it waits after the
//              slide arrives (2600 ms, 350 ms)
//   decimals   digits after the decimal sign (0)
//   lang       'lt' or 'en'; default `stage.lang`, else the deck's
//              htmlAttrs.lang, else 'en'. lt: groups of three set apart by a
//              narrow no-break space from five digits up (1844, 55 000) and a
//              decimal comma; en: 1,844 and a decimal point
//   plain      never grouped: for years
//   for        the `name` of an object in the space whose builder offers
//              api.value(): while the slide is up the count shows that number,
//              so it moves with the form and cannot run ahead of it. Without
//              such an object (or without the world) it keeps its own clock.
const props = defineProps({
  to: { type: Number, required: true },
  from: { type: Number, default: 0 },
  ms: { type: Number, default: 2600 },
  delay: { type: Number, default: 350 },
  decimals: { type: Number, default: 0 },
  lang: { type: String, default: '' },
  plain: { type: Boolean, default: false },
  for: { type: String, default: '' },
})

const CFG = (configs && configs.stage && typeof configs.stage === 'object') ? configs.stage : {}
const lang = computed(() => props.lang || CFG.lang || configs?.htmlAttrs?.lang || 'en')
const { $renderContext } = useSlideContext()
const nav = useNav()
// print renders slides in the default render context, 'slide': ask the route as well
const printing = () => !!nav.isPrintMode?.value || ['print', 'export'].includes(nav.currentRoute?.value?.name)
const live = () => ['slide', 'presenter'].includes($renderContext?.value) && !printing()
  && !matchMedia('(prefers-reduced-motion: reduce)').matches

const value = ref(props.to)
// what the named form shows now, from the world under this window's slides
const engine = () => {
  if (!props.for) return null
  const v = document.querySelector('.stage')?.__space?.value?.(props.for)
  return Number.isFinite(v) ? v : null
}

let raf = 0
onSlideEnter(() => {
  cancelAnimationFrame(raf)
  if (!live()) { value.value = props.to; return }
  const t0 = performance.now() + props.delay
  value.value = engine() ?? props.from
  const tick = (now) => {
    const v = engine()
    if (v != null) { value.value = v; raf = requestAnimationFrame(tick); return }
    const u = Math.min(Math.max((now - t0) / props.ms, 0), 1)
    value.value = props.from + (props.to - props.from) * (1 - Math.pow(1 - u, 3))
    if (u < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})
onSlideLeave(() => cancelAnimationFrame(raf))
onUnmounted(() => cancelAnimationFrame(raf))

const text = computed(() => formatCount(value.value, {
  decimals: props.decimals, lang: lang.value, plain: props.plain, span: Math.max(Math.abs(props.from), Math.abs(props.to)),
}))
</script>

<template><span class="stage-count">{{ text }}</span></template>

<style scoped>
/* figures of one width: the number does not shake as it counts */
.stage-count { font-variant-numeric: tabular-nums; }
</style>
