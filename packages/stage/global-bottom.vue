<script setup>
// Addon global layer, under the slides: the world. Mounted when the deck's
// headmatter has a `stage:` block (and not `auto: false`, which says the deck
// mounts <Stage> from its own global-bottom.vue, for the #hud slot).
import { configs } from '@slidev/client'
import Stage from './components/Stage.vue'

const cfg = configs && configs.stage
const on = !!cfg && typeof cfg === 'object' && cfg.auto !== false
</script>

<template>
  <Stage v-if="on" />
</template>
