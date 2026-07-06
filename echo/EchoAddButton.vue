<script setup>
import { ref } from 'vue'
import { useI18n } from '../useI18n.js'

const { t } = useI18n()

// Small "Add to my <app>" button for embed cards. Runs the supplied async
// handler (which calls the owning app's API) and reflects idle → loading →
// done / error state. The DB write itself lives in the respective app.
const props = defineProps({
  handler: { type: Function, required: true },
  label: { type: String, default: '' },
  doneLabel: { type: String, default: '' },
})

const state = ref('idle') // idle | loading | done | error

async function click() {
  if (state.value === 'loading' || state.value === 'done') return
  state.value = 'loading'
  try {
    await props.handler()
    state.value = 'done'
  } catch {
    state.value = 'error'
    setTimeout(() => { if (state.value === 'error') state.value = 'idle' }, 2500)
  }
}
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] font-semibold normal-case transition-colors"
    :class="{
      'cursor-pointer text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white': state === 'idle',
      'cursor-default text-slate-400 dark:text-white/40': state === 'loading',
      'cursor-default text-emerald-600 dark:text-emerald-400': state === 'done',
      'cursor-pointer text-red-500': state === 'error',
    }"
    :disabled="state === 'loading' || state === 'done'"
    @click.stop.prevent="click"
  >
    <svg v-if="state === 'done'" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    <svg v-else-if="state === 'loading'" class="animate-spin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    <svg v-else viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
    <span>{{ state === 'done' ? (doneLabel || t('core.echo.added')) : state === 'error' ? t('core.echo.failed') : (label || t('core.echo.add')) }}</span>
  </button>
</template>
