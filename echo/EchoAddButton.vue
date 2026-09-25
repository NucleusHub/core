<script setup>
import { ref } from 'vue'
import { useI18n } from '../useI18n.js'
import { Icon } from '../icons'
import SpinnerArcIcon from '@core/assets/icons/spinner-arc.svg?component'

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
    <Icon width="13" height="13" name="checkBold" v-if="state === 'done'" :sw="2.5" />
    <SpinnerArcIcon v-else-if="state === 'loading'" class="animate-spin" width="13" height="13" />
    <Icon width="13" height="13" name="plus" v-else :sw="2.5" />
    <span>{{ state === 'done' ? (doneLabel || t('core.echo.added')) : state === 'error' ? t('core.echo.failed') : (label || t('core.echo.add')) }}</span>
  </button>
</template>
