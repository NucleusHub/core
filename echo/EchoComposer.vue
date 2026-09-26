<script setup>
import { ref, nextTick } from 'vue'
import EchoActionButton from './EchoActionButton.vue'
import { useI18n } from '../useI18n.js'
import { Icon } from '../icons'

const { t } = useI18n()

const props = defineProps({
  actions: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['send', 'action', 'typing'])

const text = ref('')
const textarea = ref(null)
const menuOpen = ref(false)

function autosize() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

function onInput() {
  autosize()
  emit('typing')
}

function submit() {
  const value = text.value.trim()
  if (!value || props.disabled) return
  emit('send', { type: 'text', payload: { text: value } })
  text.value = ''
  nextTick(() => { autosize(); textarea.value?.focus() })
}

function pick(action) {
  menuOpen.value = false
  emit('action', action)
}
</script>

<template>
  <div class="px-3 pb-3 pt-1.5">
    <div
      class="relative flex items-end gap-1.5 rounded-[1.4rem] border border-slate-200/80 bg-white/70 py-1.5 pl-1.5 pr-1.5 shadow-sm backdrop-blur-md transition-colors focus-within:border-indigo-300 dark:border-white/10 dark:bg-white/[0.06] dark:focus-within:border-indigo-400/40"
    >
      <template v-if="actions.length">
        <button
          type="button"
          :aria-label="t('core.echo.attach')"
          :title="t('core.echo.attach')"
          class="group flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-500/10 hover:text-slate-700 dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white"
          :class="menuOpen ? 'bg-slate-500/10 text-slate-700 dark:bg-white/10 dark:text-white' : ''"
          @click="menuOpen = !menuOpen"
        >
          <Icon width="20" height="20" name="plus" class="transition-transform duration-200" :class="menuOpen ? 'rotate-45' : ''" />
        </button>

        <div v-if="menuOpen" class="fixed inset-0 z-40" @click="menuOpen = false" />
        <div
          v-if="menuOpen"
          class="absolute bottom-full left-0 z-50 mb-2 min-w-52 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-1.5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-800/90"
        >
          <p class="px-2.5 pb-1 pt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
            {{ t('core.echo.attach') }}
          </p>
          <EchoActionButton
            v-for="a in actions"
            :key="a.app + ':' + a.id"
            :action="a"
            class="!w-full !justify-start !rounded-xl !border-0 !bg-transparent !px-2.5 !py-2 hover:!bg-slate-500/[0.08] dark:hover:!bg-white/[0.08]"
            @invoke="pick"
          />
        </div>
      </template>

      <textarea
        ref="textarea"
        v-model="text"
        rows="1"
        :placeholder="placeholder || t('core.echo.messagePlaceholder')"
        :disabled="disabled"
        class="max-h-40 flex-1 resize-none self-center bg-transparent px-2 py-2 text-[0.95rem] leading-relaxed text-slate-900 placeholder-slate-400 outline-none dark:text-white dark:placeholder-white/35"
        @input="onInput"
        @keydown.enter.exact.prevent="submit"
      />

      <button
        type="button"
        :disabled="disabled || !text.trim()"
        class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm shadow-indigo-500/25 transition enabled:hover:brightness-110 enabled:active:scale-95 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:text-white/70 disabled:shadow-none dark:disabled:from-white/10 dark:disabled:to-white/10 dark:disabled:text-white/30"
        :title="t('core.echo.send')"
        @click="submit"
      >
        <Icon width="17" height="17" name="send" />
      </button>
    </div>
  </div>
</template>
