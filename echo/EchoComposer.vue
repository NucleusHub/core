<script setup>
import { ref, nextTick } from 'vue'
import EchoActionButton from './EchoActionButton.vue'
import { useI18n } from '../useI18n.js'

const { t } = useI18n()

// The message input. Its action row is built purely from registry-supplied
// composer actions — Echo core knows nothing about Orbit or Goals; it just
// renders the buttons each app contributed and emits `action` when one is
// clicked. The host app handles the action (e.g. open a file picker) and then
// calls send() with an app-typed message.
const props = defineProps({
  // composer actions from the unified registry: [{ id, label, icon, app }]
  actions: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['send', 'action', 'typing'])

const text = ref('')
const textarea = ref(null)

function submit() {
  const value = text.value.trim()
  if (!value || props.disabled) return
  emit('send', { type: 'text', payload: { text: value } })
  text.value = ''
  // Keep focus in the field after sending so you can keep typing — clicking the
  // send button would otherwise steal focus (pressing Enter keeps it anyway).
  nextTick(() => textarea.value?.focus())
}
</script>

<template>
  <div class="border-t border-slate-200/70 bg-white/40 px-3 py-2.5 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
    <div v-if="actions.length" class="mb-2 flex flex-wrap gap-1.5">
      <EchoActionButton
        v-for="a in actions"
        :key="a.app + ':' + a.id"
        :action="a"
        compact
        @invoke="emit('action', $event)"
      />
    </div>
    <form class="flex items-end gap-2" @submit.prevent="submit">
      <textarea
        ref="textarea"
        v-model="text"
        rows="1"
        :placeholder="placeholder || t('core.echo.messagePlaceholder')"
        :disabled="disabled"
        class="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder-white/35 dark:focus:border-indigo-400/50"
        @input="emit('typing')"
        @keydown.enter.exact.prevent="submit"
      />
      <button
        type="submit"
        :disabled="disabled || !text.trim()"
        class="cursor-pointer flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white transition enabled:hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        :title="t('core.echo.send')"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
      </button>
    </form>
  </div>
</template>
