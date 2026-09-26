<script setup>
import { computed } from 'vue'
import { ICONS, FILL_ICONS } from './icons.js'

const props = defineProps({
  name: { type: String, required: true },
  sw: { type: [Number, String], default: 2 },
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
