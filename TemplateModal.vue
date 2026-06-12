<script setup>
import { watch, onUnmounted, ref, nextTick } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: 'Are you sure?' },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Delete' },
})
const emit = defineEmits(['confirm', 'cancel'])

const confirmBtn = ref(null)

function onKeydown(e) { if (e.key === 'Escape') emit('cancel') }

function lockScroll()   { document.body.style.overflow = 'hidden' }
function unlockScroll() { document.body.style.overflow = '' }

watch(() => props.show, (val) => {
  if (val) {
    window.addEventListener('keydown', onKeydown)
    lockScroll()
    nextTick(() => confirmBtn.value?.focus())
  } else {
    window.removeEventListener('keydown', onKeydown)
    unlockScroll()
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  unlockScroll()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/20 backdrop-blur-xl" @pointerdown.prevent="$emit('cancel')" />
        <div class="relative bg-white/25 dark:bg-white/8 border border-white/50 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5">
          <div>
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">{{ title }}</h2>
            <p v-if="message" class="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{{ message }}</p>
          </div>
          <div class="flex gap-3 justify-end">
            <button
              @click="$emit('cancel')"
              class="cursor-pointer px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              ref="confirmBtn"
              @click="$emit('confirm')"
              class="cursor-pointer px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 rounded-lg transition-colors"
            >
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
