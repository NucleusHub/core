<script setup>
import { watch, onUnmounted, ref, nextTick, computed, useSlots } from 'vue'
import AppTabs from './AppTabs.vue'
import { Icon, Spinner } from './icons'
import SearchIcon from '@core/assets/icons/search.svg?component'

const props = defineProps({
  show: { type: Boolean, default: false },

  title: { type: String, default: '' },
  description: { type: String, default: '' },
  header: { type: Boolean, default: false },
  closeable: { type: Boolean, default: true },

  message: { type: String, default: '' },

  footer: { type: Boolean, default: false },
  confirmLabel: { type: String, default: '' },
  cancelLabel: { type: String, default: '' },
  confirmVariant: { type: String, default: '' },
  confirmDisabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  busyLabel: { type: String, default: '' },
  hideCancel: { type: Boolean, default: false },

  searchable: { type: Boolean, default: false },
  search: { type: String, default: '' },
  searchPlaceholder: { type: String, default: 'Search…' },

  tabs: { type: Array, default: () => [] },
  tab: { type: String, default: '' },

  size: { type: String, default: 'sm' },
  panelClass: { type: String, default: '' },
  fixedHeight: { type: [Boolean, String], default: false },
  bodyClass: { type: String, default: 'px-5 pb-5 pt-1' },
  z: { type: String, default: 'z-[200]' },
})
const emit = defineEmits(['confirm', 'cancel', 'update:search', 'update:tab'])

const slots = useSlots()

const hasTabs = computed(() => props.tabs.length > 0)
const internalTab = ref('')
const activeTab = computed(() => props.tab || internalTab.value || props.tabs[0]?.key || '')
function selectTab(key) {
  internalTab.value = key
  emit('update:tab', key)
}

const SIZES = {
  xs: 'max-w-sm',
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}
const widthClass = computed(() => props.panelClass || SIZES[props.size] || SIZES.sm)
const effectiveFixedHeight = computed(() => props.fixedHeight || hasTabs.value)
const heightClass = computed(() =>
  effectiveFixedHeight.value === true ? 'h-[85vh]' : (effectiveFixedHeight.value || ''))

const hasHeader = computed(() => props.header || !!slots.header)
const hasFooter = computed(() => props.footer || !!slots.footer)
const chrome = computed(() => hasHeader.value || props.searchable || hasFooter.value || hasTabs.value)

const confirmText = computed(() => props.confirmLabel || (chrome.value ? 'Save' : 'Delete'))
const cancelText = computed(() => props.cancelLabel || 'Cancel')
const confirmVariantEffective = computed(() => props.confirmVariant || (chrome.value ? 'primary' : 'danger'))
const confirmClass = computed(() =>
  confirmVariantEffective.value === 'danger'
    ? 'text-white bg-red-600 hover:bg-red-500 focus-visible:ring-red-400'
    : 'text-white bg-indigo-600 hover:bg-indigo-500 focus-visible:ring-indigo-400'
)

const confirmBtn = ref(null)
const searchInput = ref(null)

function onKeydown(e) { if (e.key === 'Escape') emit('cancel') }

function lockScroll()   { document.body.style.overflow = 'hidden' }
function unlockScroll() { document.body.style.overflow = '' }

// immediate: a modal mounted already open still needs Escape, scroll lock and autofocus.
watch(() => props.show, (val) => {
  if (val) {
    window.addEventListener('keydown', onKeydown)
    lockScroll()
    internalTab.value = ''
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
    <Transition name="tm">
      <div v-if="show" class="fixed inset-0 flex items-center justify-center p-4" :class="z">
        <div class="absolute inset-0 bg-slate-950/30 backdrop-blur-md" @pointerdown.prevent="$emit('cancel')" />
        <div
          class="tm-panel relative w-full bg-white/60 dark:bg-slate-900/55 backdrop-blur-2xl border border-white/40 dark:border-white/10 rounded-2xl shadow-2xl shadow-slate-950/25 overflow-hidden"
          :class="[widthClass, chrome ? 'flex flex-col max-h-[88vh]' : '', chrome ? heightClass : '']"
        >
          <template v-if="chrome">
            <div v-if="hasHeader" class="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-black/[0.06] dark:border-white/10 shrink-0">
              <slot name="header">
                <div class="min-w-0">
                  <h2 class="text-base font-semibold text-slate-900 dark:text-white truncate">{{ title }}</h2>
                  <p v-if="description" class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{{ description }}</p>
                </div>
              </slot>
              <button
                v-if="closeable"
                class="cursor-pointer -mr-1 -mt-0.5 p-1.5 shrink-0 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"
                aria-label="Close"
                @click="$emit('cancel')"
              >
                <Icon name="close" class="w-4 h-4" :sw="2.5" />
              </button>
            </div>

            <AppTabs
              v-if="hasTabs"
              :tabs="tabs"
              :model-value="activeTab"
              class="px-5 sm:px-6 shrink-0 border-b border-black/[0.06] dark:border-white/10"
              @update:model-value="selectTab"
            />

            <div v-if="searchable" class="px-5 sm:px-6 pt-4 pb-3 shrink-0">
              <div class="relative">
                <SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                <input
                  ref="searchInput"
                  :value="search"
                  type="text"
                  :placeholder="searchPlaceholder"
                  class="w-full bg-black/5 dark:bg-white/8 text-slate-900 dark:text-white rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  @input="$emit('update:search', $event.target.value)"
                />
              </div>
            </div>

            <div class="flex-1 overflow-y-auto min-h-0" :class="bodyClass">
              <slot :active-tab="activeTab" />
            </div>

            <div v-if="hasFooter" class="flex items-center gap-3 px-5 sm:px-6 py-4 border-t border-black/[0.06] dark:border-white/10 shrink-0">
              <slot name="footer">
                <div v-if="$slots['footer-start']" class="mr-auto min-w-0 text-sm">
                  <slot name="footer-start" />
                </div>
                <div class="flex gap-2 ml-auto">
                  <button
                    v-if="!hideCancel"
                    :disabled="busy"
                    class="cursor-pointer px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    @click="$emit('cancel')"
                  >
                    {{ cancelText }}
                  </button>
                  <button
                    ref="confirmBtn"
                    :disabled="confirmDisabled || busy"
                    class="cursor-pointer inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    :class="confirmClass"
                    @click="$emit('confirm')"
                  >
                    <Spinner v-if="busy" class="w-4 h-4 animate-spin" />
                    {{ busy && busyLabel ? busyLabel : confirmText }}
                  </button>
                </div>
              </slot>
            </div>
          </template>

          <slot v-else>
            <div class="p-6 flex flex-col gap-5">
              <div>
                <h2 class="text-base font-semibold text-slate-900 dark:text-white">{{ title }}</h2>
                <p v-if="message" class="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{{ message }}</p>
              </div>
              <div class="flex gap-2 justify-end">
                <button
                  v-if="!hideCancel"
                  :disabled="busy"
                  class="cursor-pointer px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="$emit('cancel')"
                >
                  {{ cancelText }}
                </button>
                <button
                  ref="confirmBtn"
                  :disabled="confirmDisabled || busy"
                  class="cursor-pointer inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="confirmClass"
                  @click="$emit('confirm')"
                >
                  <Spinner v-if="busy" class="w-4 h-4 animate-spin" />
                  {{ busy && busyLabel ? busyLabel : confirmText }}
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
.tm-enter-active, .tm-leave-active { transition: opacity 0.18s ease; }
.tm-enter-from, .tm-leave-to { opacity: 0; }
.tm-enter-active .tm-panel, .tm-leave-active .tm-panel {
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease;
}
.tm-enter-from .tm-panel, .tm-leave-to .tm-panel {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
}
</style>
