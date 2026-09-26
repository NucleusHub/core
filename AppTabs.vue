<script setup>
import { computed } from 'vue'

const props = defineProps({
  tabs: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
  variant: { type: String, default: 'underline' },
  router: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const isRail = computed(() => props.variant === 'rail')

const rootClass = computed(() => (isRail.value ? 'flex sm:flex-col gap-1' : 'flex gap-5'))

const itemBase = computed(() =>
  isRail.value
    ? 'shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium cursor-pointer transition-colors text-left'
    : 'shrink-0 cursor-pointer inline-flex items-center gap-1.5 pt-3 pb-2.5 -mb-px text-sm font-semibold border-b-2 border-transparent transition-colors',
)
// `!` so the active look beats the base utilities RouterLink leaves underneath.
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
