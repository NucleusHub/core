<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuthSettings } from './useAuthSettings.js'
import { Icon } from '../icons'

const { t } = useI18n()
const { submitServerCode } = useAuthSettings()

const FORMAT = /^nucleus[0-9A-Za-z]{32}home$/
const ERRORS = {
  server_code_invalid: 'core.serverKey.invalid',
  server_code_rejected: 'core.serverKey.rejected',
  rate_limited: 'core.serverKey.rateLimited',
}

const code = ref('')
const busy = ref(false)
const error = ref(null)
const inputRef = ref(null)
const trimmed = computed(() => code.value.trim())

onMounted(() => inputRef.value?.focus())

async function submit() {
  if (busy.value || !trimmed.value) return
  error.value = null
  if (!FORMAT.test(trimmed.value)) { error.value = t('core.serverKey.invalid'); return }
  busy.value = true
  try {
    await submitServerCode(trimmed.value)
  } catch (err) {
    error.value = t(ERRORS[err.code] || (err instanceof TypeError ? 'core.serverKey.offline' : 'core.serverKey.failed'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[500] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/15 backdrop-blur-2xl" />
      <form class="relative bg-white/15 dark:bg-white/8 border border-white/30 dark:border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl nuc-surface-dark w-full max-w-sm p-8 flex flex-col items-center gap-4"
        @submit.prevent="submit">
        <div class="w-12 h-12 rounded-full bg-violet-500/20 text-violet-200 flex items-center justify-center">
          <Icon name="lock" class="w-6 h-6" :sw="1.6" />
        </div>
        <h1 class="text-lg font-bold text-white text-center">{{ t('core.serverKey.title') }}</h1>
        <p class="text-sm text-white/65 text-center -mt-2">{{ t('core.serverKey.body') }}</p>
        <label class="sr-only" for="nucleus-server-key">{{ t('core.serverKey.label') }}</label>
        <input id="nucleus-server-key" ref="inputRef" v-model="code"
          class="w-full px-3 py-2 rounded-xl bg-white/15 border border-white/25 text-white placeholder-white/40 outline-none focus:border-violet-400 text-sm font-mono transition-colors"
          :placeholder="t('core.serverKey.placeholder')"
          autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" />
        <p v-if="error" class="text-xs text-red-300 text-center" role="alert">{{ error }}</p>
        <button type="submit" :disabled="busy || !trimmed"
          class="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors cursor-pointer">
          {{ busy ? t('core.serverKey.checking') : t('core.serverKey.continue') }}
        </button>
      </form>
    </div>
  </Teleport>
</template>
