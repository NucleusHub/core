<script setup>
// Shared multi-select action bar for every Nucleus app (Orbit, Prism, …), so a
// selection toolbar looks and behaves identically everywhere. The chrome — the
// floating pill, the count, the divider and the clear button — lives here; each
// app passes its own `actions` (declaratively) and localized strings, keeping
// this component i18n-agnostic.
//
// actions: [{ key, label, icon (SVG path `d`), danger?, fill?, colorClass? }]
//   danger      → destructive (rose hover)
//   fill        → render the icon filled (e.g. an active favorite heart)
//   colorClass  → override icon tint for an active/toggled state
//
// Icon-only buttons keep it compact — it already fits a narrow phone screen; the
// count text is short enough to stay. Centered via a flex wrapper (not a
// transform) so the enter/leave animation is a clean vertical slide from below.
defineProps({
  show: { type: Boolean, default: false },
  count: { type: Number, default: 0 },
  label: { type: String, default: '' },   // localized "N selected"
  actions: { type: Array, default: () => [] },
  clearTitle: { type: String, default: 'Clear selection' },
})
defineEmits(['action', 'clear'])
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-x-0 bottom-4 sm:bottom-6 z-[80] flex justify-center px-2 pointer-events-none">
      <Transition name="seltoolbar">
        <div
          v-if="show"
          class="pointer-events-auto flex items-center gap-0.5 sm:gap-1 max-w-full
                 rounded-2xl bg-slate-900/90 dark:bg-slate-800/95 backdrop-blur-md text-white
                 shadow-2xl ring-1 ring-white/10 px-2 py-1.5"
          @contextmenu.stop
        >
          <button
            @click="$emit('clear')" :title="clearTitle" :aria-label="clearTitle"
            class="nuc-press grid place-items-center w-10 h-10 rounded-xl text-slate-300 hover:text-white hover:bg-white/12 cursor-pointer transition-colors"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>

          <span class="px-2 text-sm font-semibold whitespace-nowrap">{{ label }}</span>

          <span class="w-px h-6 bg-white/15 mx-0.5" />

          <button
            v-for="a in actions" :key="a.key"
            @click="$emit('action', a.key)" :title="a.label" :aria-label="a.label"
            class="nuc-press grid place-items-center w-10 h-10 rounded-xl cursor-pointer transition-colors"
            :class="a.danger ? 'text-white hover:bg-rose-500/30' : `${a.colorClass || 'text-white'} hover:bg-white/12`"
          >
            <svg class="w-5 h-5" :fill="a.fill ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" :d="a.icon" />
            </svg>
          </button>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.seltoolbar-enter-active,
.seltoolbar-leave-active { transition: opacity .2s ease, transform .26s cubic-bezier(0.34, 1.4, 0.64, 1); }
.seltoolbar-enter-from,
.seltoolbar-leave-to { opacity: 0; transform: translateY(1.25rem) scale(0.95); }

@media (prefers-reduced-motion: reduce) {
  .seltoolbar-enter-active, .seltoolbar-leave-active { transition: opacity .15s ease; }
  .seltoolbar-enter-from, .seltoolbar-leave-to { transform: none; }
}
</style>
