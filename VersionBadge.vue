<script setup>
// Renders a module/platform version as `v0.9.0-beta.2` plus an optional,
// auto-derived release-channel pill (Alpha / Beta / RC). Stable releases show
// no pill by default — they're the expected case, so the bare version reads
// cleanest. Shared across admin + pulse (both build with Tailwind, class-based
// dark mode) via `@core/VersionBadge.vue`.
import { computed } from 'vue'
import { formatVersion, channelOf, channelLabel } from './version.js'

const props = defineProps({
  version: { type: String, default: '' },
  // Show a pill for stable too (off by default to avoid clutter).
  showStable: { type: Boolean, default: false },
})

const label = computed(() => formatVersion(props.version))
const channel = computed(() => channelOf(props.version))
const channelText = computed(() => channelLabel(props.version))
const showPill = computed(() =>
  !!channel.value && (channel.value !== 'stable' || props.showStable),
)

// Per-channel tint. Kept as whole class strings so Tailwind's JIT sees them.
const PILL = {
  stable: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  rc:     'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  beta:   'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  alpha:  'bg-orange-500/15 text-orange-600 dark:text-orange-400',
}
const pillClass = computed(() => PILL[channel.value] || PILL.stable)
</script>

<template>
  <span v-if="label" class="inline-flex items-center gap-1.5 align-middle">
    <span class="font-mono text-[11px] font-medium text-slate-500 dark:text-white/50 tabular-nums">{{ label }}</span>
    <span
      v-if="showPill"
      class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none"
      :class="pillClass"
    >{{ channelText }}</span>
  </span>
</template>
