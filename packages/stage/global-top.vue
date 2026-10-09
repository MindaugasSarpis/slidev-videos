<script setup>
// Addon global layer, over the slides: the hazy particle borders round cards
// and panels. On with the stage; `stage.halo: false` turns it off, and so
// does a look that goes without it (`look: broadcast`) unless `halo: true`.
import { configs } from '@slidev/client'
import StageHalo from './components/StageHalo.vue'
import { resolveLook } from './stage/palette.js'
import { inPrint } from './stage/stills.js'

const cfg = configs && configs.stage
// Not in print: a canvas per page printed as a full-page transparent PNG on every page
const printing = inPrint(null)
const on = !printing && !!cfg && typeof cfg === 'object' && cfg.auto !== false && (cfg.halo ?? resolveLook(cfg.palette, cfg.look).halo) !== false
</script>

<template>
  <StageHalo v-if="on" />
</template>
