<script setup>
import { watch, onUnmounted, ref, nextTick, computed, useSlots } from 'vue'

// ─────────────────────────────────────────────────────────────────────────────
// The one modal to rule them all.
//
// Every dialog in Nucleus is built from the same three regions — a header
// (title + optional description + close), a scrollable body, and a footer
// (Cancel + a primary/danger action) — sitting inside one glass panel with a
// blurred backdrop, Escape-to-close, scroll-lock and autofocus. Rather than
// re-implement that scaffold in every app, they all render through here and
// just switch regions on via props/slots:
//
//   • Confirm dialog   → <TemplateModal :show title message confirm-label
//                          confirm-variant="danger" @confirm @cancel />
//   • Header + footer  → :header title  + :footer confirm-label  + #default body
//   • Search picker     → :searchable v-model:search  + #default list
//   • Fully custom      → #header / #footer slots, or just #default in plain mode
//
// Width comes from `size` (sm→xl, comfortably wide on desktop); `panelClass`
// still overrides it for the rare bespoke case. Everything is additive, so the
// older `header`/`searchable`/confirm-dialog call sites keep working untouched.
// ─────────────────────────────────────────────────────────────────────────────

const props = defineProps({
  show: { type: Boolean, default: false },

  // ── Header ──────────────────────────────────────────────────────────────
  title: { type: String, default: '' },
  description: { type: String, default: '' },   // subtitle under the title
  header: { type: Boolean, default: false },     // render the built-in header bar
  closeable: { type: Boolean, default: true },   // show the header close (×)

  // ── Confirm-dialog body (plain mode, no #default slot) ──────────────────
  message: { type: String, default: '' },

  // ── Footer ──────────────────────────────────────────────────────────────
  footer: { type: Boolean, default: false },     // render the built-in footer bar
  confirmLabel: { type: String, default: '' },   // '' → 'Save' (footer) / 'Delete' (dialog)
  cancelLabel: { type: String, default: '' },    // '' → 'Cancel'
  confirmVariant: { type: String, default: '' }, // 'primary' | 'danger'
  confirmDisabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },        // in-flight: disables + spinner
  busyLabel: { type: String, default: '' },
  hideCancel: { type: Boolean, default: false },

  // ── Search box (chrome) ─────────────────────────────────────────────────
  searchable: { type: Boolean, default: false },
  search: { type: String, default: '' },          // v-model:search
  searchPlaceholder: { type: String, default: 'Search…' },

  // ── Tabs (chrome) ─────────────────────────────────────────────────────────
  // Opt-in segmented tab bar under the header. Each entry: { key, label, icon? }
  // where `icon` is an SVG path string. The active key is exposed to the body
  // slot (#default="{ activeTab }") and via v-model:tab, so a modal can switch
  // sections without every dialog being rebuilt around tabs.
  tabs: { type: Array, default: () => [] },
  tab: { type: String, default: '' },             // v-model:tab (optional; defaults to first tab)

  // ── Sizing & layout ──────────────────────────────────────────────────────
  // Preferred width. `panelClass` (below) wins if provided.
  size: { type: String, default: 'sm' },          // xs | sm | md | lg | xl
  panelClass: { type: String, default: '' },       // explicit width/appearance override
  // Lock the panel to a constant height (instead of hugging its content) so the
  // body scrolls and the modal doesn't jump when its content changes — e.g. when
  // switching between tabs of differing length. `true` → 85vh; a string → that
  // Tailwind height class (e.g. 'h-[600px]').
  fixedHeight: { type: [Boolean, String], default: false },
  bodyClass: { type: String, default: 'px-5 pb-5 pt-1' },
  z: { type: String, default: 'z-[200]' },
})
const emit = defineEmits(['confirm', 'cancel', 'update:search', 'update:tab'])

const slots = useSlots()

// Tabs: controlled via v-model:tab when bound, else self-managed. `activeTab`
// prefers the bound prop, then the last internal selection, then the first tab.
const hasTabs = computed(() => props.tabs.length > 0)
const internalTab = ref('')
const activeTab = computed(() => props.tab || internalTab.value || props.tabs[0]?.key || '')
function selectTab(key) {
  internalTab.value = key
  emit('update:tab', key)
}

// Comfortable, a touch wider than before — modals were feeling slim on desktop.
const SIZES = {
  xs: 'max-w-sm',   // 24rem
  sm: 'max-w-md',   // 28rem
  md: 'max-w-lg',   // 32rem
  lg: 'max-w-2xl',  // 42rem
  xl: 'max-w-4xl',  // 56rem
}
const widthClass = computed(() => props.panelClass || SIZES[props.size] || SIZES.sm)
const heightClass = computed(() =>
  props.fixedHeight === true ? 'h-[85vh]' : (props.fixedHeight || ''))

const hasHeader = computed(() => props.header || !!slots.header)
const hasFooter = computed(() => props.footer || !!slots.footer)
// "Chrome" = the framed header/body/footer layout. Plain mode (none of these)
// keeps the legacy behaviour: render #default directly, or a confirm dialog.
const chrome = computed(() => hasHeader.value || props.searchable || hasFooter.value || hasTabs.value)

// Button label/variant fallbacks differ by context: a plain confirm dialog is
// destructive-by-default ("Delete"), a framed footer is a "Save" affirmative.
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

// `immediate` so a modal mounted while already open (e.g. an on-demand picker
// rendered with :show=true from the start) still wires up Escape-to-close, the
// scroll lock and autofocus — not only when `show` transitions false→true.
watch(() => props.show, (val) => {
  if (val) {
    window.addEventListener('keydown', onKeydown)
    lockScroll()
    internalTab.value = ''   // reopen lands on the first tab (uncontrolled use)
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
          <!-- ── Chrome mode: header / search / scroll body / footer ────────── -->
          <template v-if="chrome">
            <!-- Header -->
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
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <!-- Tabs -->
            <div v-if="hasTabs" class="px-5 sm:px-6 pt-3 pb-3 shrink-0 border-b border-black/[0.06] dark:border-white/10">
              <div class="flex gap-1 p-1 rounded-xl bg-black/5 dark:bg-white/8" role="tablist">
                <button
                  v-for="tb in tabs"
                  :key="tb.key"
                  type="button"
                  role="tab"
                  :aria-selected="activeTab === tb.key"
                  class="cursor-pointer flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  :class="activeTab === tb.key
                    ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'"
                  @click="selectTab(tb.key)"
                >
                  <svg v-if="tb.icon" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" :d="tb.icon" />
                  </svg>
                  {{ tb.label }}
                </button>
              </div>
            </div>

            <!-- Search -->
            <div v-if="searchable" class="px-5 sm:px-6 pt-4 pb-3 shrink-0">
              <div class="relative">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
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

            <!-- Body -->
            <div class="flex-1 overflow-y-auto min-h-0" :class="bodyClass">
              <slot :active-tab="activeTab" />
            </div>

            <!-- Footer -->
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
                    <svg v-if="busy" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {{ busy && busyLabel ? busyLabel : confirmText }}
                  </button>
                </div>
              </slot>
            </div>
          </template>

          <!-- ── Plain mode: custom content via #default; else a confirm dialog ─ -->
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
                  <svg v-if="busy" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
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
/* Backdrop fades; the panel also rises + scales in for a sleeker entrance. */
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
