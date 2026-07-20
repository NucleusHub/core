<script setup>
// Shared icon renderer. Draws one glyph from the registry in icons.js:
//   <Icon name="close" class="w-5 h-5" />          stroke glyph, sized by class
//   <Icon name="star" class="w-4 h-4" />           fill glyph (auto from FILL_ICONS)
//   <Icon name="shield" fill class="w-4 h-4" />    force solid
//   <Icon name="close" :sw="2.5" />                heavier stroke
//
// Colour comes from currentColor, size from the caller's Tailwind classes — same
// contract as the app's other icons. The glyph markup is injected with v-html so
// a registry entry can be a <path>, several <path>s, or arbitrary inner SVG
// (circles, rects, …). See icons.js for the value formats.
import { computed } from 'vue'
import { ICONS, FILL_ICONS } from './icons.js'

const props = defineProps({
  // Registry key from icons.js.
  name: { type: String, required: true },
  // Stroke width for stroke glyphs (matches the codebase's most common value).
  sw: { type: [Number, String], default: 2 },
  // Force fill/stroke mode; defaults to the glyph's entry in FILL_ICONS.
  fill: { type: Boolean, default: undefined },
})

const isFill = computed(() =>
  props.fill !== undefined ? props.fill : FILL_ICONS.has(props.name),
)

const inner = computed(() => {
  const v = ICONS[props.name]
  if (v == null) {
    if (import.meta.env?.DEV) console.warn(`[Icon] unknown icon "${props.name}"`)
    return ''
  }
  if (Array.isArray(v)) return v.map((d) => `<path d="${d}" />`).join('')
  if (v.includes('<')) return v
  return `<path d="${v}" />`
})
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    :fill="isFill ? 'currentColor' : 'none'"
    :stroke="isFill ? 'none' : 'currentColor'"
    :stroke-width="isFill ? undefined : sw"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="inner"
  />
</template>
