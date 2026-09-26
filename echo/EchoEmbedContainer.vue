<script setup>
import { computed } from 'vue'
import { useRegistry } from '../useRegistry.js'
import AppIcon from '../AppIcon.vue'

const props = defineProps({
  app: { type: String, default: null },
  label: { type: String, default: '' },
  accent: { type: String, default: '#6366f1' },
})

const { apps } = useRegistry()
const appIconSvg = computed(() => apps.value.find(a => a.id === props.app)?.iconSvg || '')
</script>

<template>
  <div
    class="echo-embed overflow-hidden rounded-xl border border-slate-200 bg-white/80 backdrop-blur-md dark:border-white/10 dark:bg-white/5"
    :style="{ '--accent': accent }"
  >
    <header
      v-if="label"
      class="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-slate-500 dark:border-white/10 dark:text-white/55"
    >
      <AppIcon v-if="appIconSvg" :svg="appIconSvg" class="h-3.5 w-3.5" :style="{ color: 'var(--accent)' }" />
      <span v-else class="h-2 w-2 rounded-full" :style="{ background: 'var(--accent)' }" />
      <span>{{ label }}</span>
      <span v-if="$slots.actions" class="ml-auto flex items-center gap-1">
        <slot name="actions" />
      </span>
    </header>
    <div class="p-3">
      <slot />
    </div>
  </div>
</template>
