<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'

// Shared right-click menu for the whole Nucleus ecosystem. Items are plain
// objects so any app can drive it without knowing about this component:
//   { label, icon, action, danger, divider, href, download }
// - divider: renders a separator instead of a row
// - href (+ optional download): renders an <a> (e.g. a download link)
// - otherwise: a <button> that runs action() then closes
// The menu flips to stay on-screen near the click point.
const props = defineProps({
  show: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  items: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const menuEl = ref(null)
const style = ref({})

watch(() => props.show, async (val) => {
  if (!val) return
  await nextTick()
  if (!menuEl.value) return
  const { innerWidth: vw, innerHeight: vh } = window
  const { offsetWidth: w, offsetHeight: h } = menuEl.value
  style.value = {
    left: props.x + w > vw ? `${props.x - w}px` : `${props.x}px`,
    top: props.y + h > vh ? `${props.y - h}px` : `${props.y}px`,
  }
})

function onKey(e) { if (e.key === 'Escape') emit('close') }

watch(() => props.show, (val) => {
  if (val) document.addEventListener('keydown', onKey)
  else document.removeEventListener('keydown', onKey)
})

onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx">
      <div v-if="show" class="fixed inset-0 z-[120]" @mousedown.self="$emit('close')" @contextmenu.prevent="$emit('close')">
        <div
          ref="menuEl"
          class="absolute min-w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl shadow-black/15 overflow-hidden py-1"
          :style="style"
          @mousedown.stop
        >
          <template v-for="(item, i) in items" :key="i">
            <hr v-if="item.divider" class="my-1 border-slate-100 dark:border-white/8" />
            <a
              v-else-if="item.href"
              :href="item.href"
              :download="item.download"
              class="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer"
              :class="item.danger
                ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/8'"
              @click="$emit('close')"
            >
              <svg v-if="item.icon" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
              </svg>
              {{ item.label }}
            </a>
            <button
              v-else
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer"
              :class="item.danger
                ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/8'"
              @click="item.action?.(); $emit('close')"
            >
              <svg v-if="item.icon" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
              </svg>
              {{ item.label }}
            </button>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-enter-active { transition: opacity 0.1s ease, transform 0.1s ease; }
.ctx-leave-active { transition: opacity 0.08s ease; }
.ctx-enter-from { opacity: 0; transform: scale(0.95); }
.ctx-leave-to { opacity: 0; }
</style>
