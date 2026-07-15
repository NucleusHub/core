<script setup>
import { computed } from 'vue'

// ─────────────────────────────────────────────────────────────────────────────
// The one tab bar for all of Nucleus.
//
// Every tabbed surface — TemplateModal, the admin Group/User modals, echo's
// New-chat modal, Profile settings, the admin console's nav — used to hand-roll
// its own row of tabs. They all render through here now. Two visual variants,
// two selection modes:
//
//   • underline (default) — the admin/modal look: a row of text tabs with an
//     indigo underline under the active one.
//   • rail — a vertical pill rail (a horizontal scroll row on mobile), used by
//     Profile settings.
//
//   • select mode (default) — bind the active key with v-model; tab items are
//     { key, label, icon? }.
//   • router mode (:router) — each tab is a <RouterLink>; tab items are
//     { to, label, icon? } and the active state follows the current route.
//
// `icon` is an SVG path `d` string (optional). Container chrome — padding,
// borders, width, background — is intentionally left to the call site via the
// merged `class` attribute, so this component owns only the tab items and their
// layout direction.
// ─────────────────────────────────────────────────────────────────────────────

const props = defineProps({
  tabs: { type: Array, default: () => [] },        // [{ key|to, label, icon? }]
  modelValue: { type: String, default: '' },        // active key (select mode)
  variant: { type: String, default: 'underline' },  // 'underline' | 'rail'
  router: { type: Boolean, default: false },         // RouterLink mode (uses `to`)
})
const emit = defineEmits(['update:modelValue'])

const isRail = computed(() => props.variant === 'rail')

// Root layout per variant; call-site classes (padding/border/bg) merge on top.
const rootClass = computed(() => (isRail.value ? 'flex sm:flex-col gap-1' : 'flex gap-5'))

// Resting classes for an item. In router mode the active look is layered on via
// RouterLink's active-class; in select mode it replaces the idle class.
const itemBase = computed(() =>
  isRail.value
    ? 'shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium cursor-pointer transition-colors text-left'
    : 'shrink-0 cursor-pointer inline-flex items-center gap-1.5 pt-3 pb-2.5 -mb-px text-sm font-semibold border-b-2 border-transparent transition-colors',
)
// `!` overrides so the active look wins over the base/idle utilities that stay
// applied underneath it (RouterLink layers active-class on top of the base).
const activeClass = computed(() =>
  isRail.value
    ? 'bg-indigo-600 text-white shadow-sm'
    : '!border-indigo-500 !text-indigo-600 dark:!text-indigo-300',
)
const idleClass = computed(() =>
  isRail.value
    ? 'text-slate-600 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white'
    : 'text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white',
)

const keyOf = (tb) => (props.router ? tb.to : tb.key)
</script>

<template>
  <div :class="rootClass" :role="router ? undefined : 'tablist'">
    <template v-for="tb in tabs" :key="keyOf(tb)">
      <!-- Router mode: navigate; active state follows the current route. -->
      <RouterLink
        v-if="router"
        :to="tb.to"
        :class="[itemBase, idleClass]"
        :active-class="activeClass"
      >
        <svg v-if="tb.icon" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" :d="tb.icon" />
        </svg>
        {{ tb.label }}
      </RouterLink>

      <!-- Select mode: v-model drives the active tab. -->
      <button
        v-else
        type="button"
        role="tab"
        :aria-selected="modelValue === tb.key"
        :class="[itemBase, modelValue === tb.key ? activeClass : idleClass]"
        @click="emit('update:modelValue', tb.key)"
      >
        <svg v-if="tb.icon" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" :stroke-width="isRail ? 1.8 : 1.75" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" :d="tb.icon" />
        </svg>
        {{ tb.label }}
      </button>
    </template>
  </div>
</template>
