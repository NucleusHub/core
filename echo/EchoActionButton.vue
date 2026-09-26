<script setup>
import { computed } from 'vue'
import { useRegistry } from '../useRegistry.js'
import AppIcon from '../AppIcon.vue'

const props = defineProps({
  action: { type: Object, required: true },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['invoke'])

const { apps } = useRegistry()
const appIconSvg = computed(() => apps.value.find(a => a.id === props.action.app)?.iconSvg || '')

const ICONS = {
  paperclip: 'M21.44 11.05 12 20.5a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-5a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z',
}
const iconPath = computed(() => ICONS[props.action.icon] || null)
</script>

<template>
  <button
    type="button"
    class="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-black/5 px-2.5 py-1.5 text-sm text-slate-600 transition-colors hover:bg-black/8 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white"
    :class="{ 'px-2': compact }"
    :title="action.label"
    @click="emit('invoke', action)"
  >
    <AppIcon v-if="appIconSvg" :svg="appIconSvg" class="h-4 w-4" />
    <svg v-else-if="iconPath" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path :d="iconPath"/></svg>
    <span v-else class="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
    <span v-if="!compact">{{ action.label }}</span>
  </button>
</template>
