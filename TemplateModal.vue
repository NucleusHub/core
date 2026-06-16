<script setup>
import { watch, onUnmounted, ref, nextTick, computed } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: 'Are you sure?' },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Delete' },
  // Width preset for the glass panel; override for richer modals (e.g. max-w-md).
  panelClass: { type: String, default: 'max-w-sm' },
  // ── Opt-in chrome ──────────────────────────────────────────────────────────
  // When `header` or `searchable` is set, the modal renders a bordered title bar
  // (with a close button) and/or a search box, plus a scrollable body wrapping
  // the default slot. Modals that pass neither behave exactly as before.
  header: { type: Boolean, default: false },
  searchable: { type: Boolean, default: false },
  search: { type: String, default: '' },          // v-model:search
  searchPlaceholder: { type: String, default: 'Search…' },
  // Padding for the scroll body in chrome mode (tree pickers want it tighter).
  bodyClass: { type: String, default: 'px-5 pb-5 pt-1' },
})
const emit = defineEmits(['confirm', 'cancel', 'update:search'])

const chrome = computed(() => props.header || props.searchable)

const confirmBtn = ref(null)
const searchInput = ref(null)

function onKeydown(e) { if (e.key === 'Escape') emit('cancel') }

function lockScroll()   { document.body.style.overflow = 'hidden' }
function unlockScroll() { document.body.style.overflow = '' }

// `immediate` so a modal mounted while already open (e.g. an on-demand picker
// rendered with :show=true from the start) still wires up Escape-to-close, the
// scroll lock and autofocus — not only when `show` transitions false→true.
watch(() => props.show, (val) => {
  if (val) {
    window.addEventListener('keydown', onKeydown)
    lockScroll()
    nextTick(() => (props.searchable ? searchInput.value?.focus() : confirmBtn.value?.focus()))
  } else {
    window.removeEventListener('keydown', onKeydown)
    unlockScroll()
  }
}, { immediate: true })
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
        <div
          class="relative bg-white/25 dark:bg-white/8 border border-white/50 dark:border-white/10 rounded-2xl shadow-2xl w-full overflow-hidden"
          :class="[panelClass, chrome ? 'flex flex-col max-h-[85vh]' : '']"
        >
          <!-- Chrome mode: built-in header / search / scrollable body -->
          <template v-if="chrome">
            <div v-if="header" class="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/30 dark:border-white/8 shrink-0">
              <h2 class="text-sm font-semibold text-slate-900 dark:text-white">{{ title }}</h2>
              <button
                class="cursor-pointer p-1.5 -mr-1 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                aria-label="Close"
                @click="$emit('cancel')"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div v-if="searchable" class="px-5 pt-4 pb-3 shrink-0">
              <div class="relative">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input
                  ref="searchInput"
                  :value="search"
                  type="text"
                  :placeholder="searchPlaceholder"
                  class="w-full bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  @input="$emit('update:search', $event.target.value)"
                />
              </div>
            </div>

            <div class="flex-1 overflow-y-auto min-h-0" :class="bodyClass">
              <slot />
            </div>
          </template>

          <!-- Plain mode: custom content via the default slot; falls back to a confirm dialog. -->
          <slot v-else>
            <div class="p-6 flex flex-col gap-5">
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
          </slot>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
