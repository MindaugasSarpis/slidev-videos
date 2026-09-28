<script setup>
// Addon global layer: the particle overlay of the `dust` video transition.
// Idle (no canvas on screen, no WebGL context) unless a clip asks for it.
import VideoDust from './components/VideoDust.vue'
</script>

<template>
  <VideoDust />
</template>
