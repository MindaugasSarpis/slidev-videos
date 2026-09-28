<script setup>
// A translucent panel for text or a figure floating over the stage. No drawn
// edge: StageHalo surrounds every `.stage-panel` with hazy particles instead.
// `kicker` is a small uppercase line above the slot.
defineProps({
  kicker: { type: String, default: '' },
  plain: { type: Boolean, default: false },   // the kicker keeps its case (m(J/ψ p), not M(J/Ψ P))
})
</script>

<template>
  <div class="stage-panel">
    <p v-if="kicker" class="stage-kicker" :class="{ plain }" v-html="kicker"></p>
    <slot />
  </div>
</template>

<style scoped>
.stage-panel {
  position: relative;
  padding: 18px 20px 20px;
  border-radius: 12px;
  background: rgba(var(--stage-bg-rgb, 5, 5, 7), 0.62);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--stage-fg, #f2f5f9);
  font-family: 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
.stage-kicker {
  margin: 0 0 8px; font-size: 11px; font-weight: 500;
  color: var(--stage-accent, #7dd3fc); text-transform: uppercase; letter-spacing: 0.14em;
}
.stage-kicker.plain { text-transform: none; letter-spacing: 0.04em; font-size: 12px; }
</style>
