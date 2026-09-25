<script setup>
import Squares2x2Icon from '@core/assets/icons/squares-2x2.svg?component'
// Renders an app icon from inline SVG markup (served by the registry, which
// reads each app's own icon.svg). The SVG is self-contained and uses
// currentColor, so it supports both line and filled icons (e.g. Pulse's
// diamond) and inherits size/colour from this wrapper. Falls back to a generic
// app glyph when an app ships no icon.
const props = defineProps({
  svg: { type: String, default: '' },
})
</script>

<template>
  <span v-if="svg" class="app-icon" v-html="svg" />
  <span v-else class="app-icon"><Squares2x2Icon /></span>
</template>

<style scoped>
.app-icon { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
.app-icon :deep(svg) { width: 100%; height: 100%; display: block; }
</style>
