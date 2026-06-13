<script setup>
// Renders an app icon from inline SVG markup (served by the registry, which
// reads each app's own icon.svg). The SVG is self-contained and uses
// currentColor, so it supports both line and filled icons (e.g. Pulse's
// diamond) and inherits size/colour from this wrapper. Falls back to a generic
// app glyph when an app ships no icon.
const props = defineProps({
  svg: { type: String, default: '' },
})

const FALLBACK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"/></svg>'
</script>

<template>
  <span class="app-icon" v-html="svg || FALLBACK" />
</template>

<style scoped>
.app-icon { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
.app-icon :deep(svg) { width: 100%; height: 100%; display: block; }
</style>
