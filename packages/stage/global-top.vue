<script setup>
// Addon global layer, over the slides: the hazy particle borders round cards
// and panels. On with the stage; `stage.halo: false` turns it off.
import { configs } from '@slidev/client'
import StageHalo from './components/StageHalo.vue'

const cfg = configs && configs.stage
const on = !!cfg && typeof cfg === 'object' && cfg.auto !== false && cfg.halo !== false
</script>

<template>
  <StageHalo v-if="on" />
</template>
