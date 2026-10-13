<script setup>
import { ref, computed, onMounted } from 'vue'
import TemplateModal from '../TemplateModal.vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, MIN_PASSWORD } from './nidErrors.js'
import { Icon } from '../icons'

// Landing for mailed links: ?verify= (sign-up or email change) and ?reset=.
const props = defineProps({
  kind: { type: String, required: true },
  token: { type: String, required: true },
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { nidPost, checkSession } = useAuth()
const { refresh: refreshSettings } = useAuthSettings()

const isReset = computed(() => props.kind === 'reset')
const password = ref('')
const repeat = ref('')
const busy = ref(false)
const error = ref(null)
const done = ref(false)
const inputRef = ref(null)

onMounted(() => inputRef.value?.focus())

async function submit() {
  if (busy.value) return
  error.value = null
  if (isReset.value) {
    if (password.value.length < MIN_PASSWORD) { error.value = t('core.nid.field.passwordShort', { min: MIN_PASSWORD }); return }
    if (password.value !== repeat.value) { error.value = t('core.nid.field.passwordsDiffer'); return }
  }
  busy.value = true
  try {
    await nidPost(props.kind, { token: props.token, password: password.value || undefined })
    await checkSession()
    done.value = true
  } catch (err) {
    if (err.code === 'server_code_required') refreshSettings()
    error.value = err.code === 'invalid' ? (Object.values(err.fields || {})[0] || err.message) : nidError(t, err)
  } finally {
    busy.value = false
  }
}

const inputClass = 'w-full text-sm rounded-xl border border-slate-300 dark:border-white/15 bg-white/70 dark:bg-white/5 text-slate-900 dark:text-white px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-colors'
</script>

<template>
  <TemplateModal :show="true" header :title="isReset ? t('core.nid.resetTitle') : t('core.nid.verifyTitle')" size="sm" z="z-[700]"
    body-class="px-5 sm:px-6 py-5" @cancel="emit('close')">
    <div v-if="done" class="flex flex-col items-center gap-3 text-center py-4">
      <div class="w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
        <Icon name="check" class="w-6 h-6" :sw="2" />
      </div>
      <p class="text-sm text-slate-700 dark:text-white/80">{{ isReset ? t('core.nid.resetDone') : t('core.nid.verifyDone') }}</p>
      <button class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer transition-colors" @click="emit('close')">
        {{ t('core.button.close') }}
      </button>
    </div>

    <form v-else class="flex flex-col gap-3" novalidate @submit.prevent="submit">
      <p class="text-sm text-slate-500 dark:text-white/60">{{ isReset ? t('core.nid.resetBody') : t('core.nid.verifyBody') }}</p>
      <input ref="inputRef" v-model="password" type="password" :class="inputClass"
        :placeholder="isReset ? t('core.nid.field.newPassword', { min: MIN_PASSWORD }) : t('core.nid.field.password')"
        :autocomplete="isReset ? 'new-password' : 'current-password'" maxlength="200" />
      <input v-if="isReset" v-model="repeat" type="password" :class="inputClass" :placeholder="t('core.nid.field.repeatPassword')"
        autocomplete="new-password" maxlength="200" />
      <p v-if="!isReset" class="text-[11px] text-slate-400 dark:text-white/40">{{ t('core.nid.verifySsoHint') }}</p>
      <p v-if="error" class="text-xs text-red-500 text-center" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy"
        class="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors cursor-pointer">
        {{ busy ? t('core.nid.working') : (isReset ? t('core.nid.resetSubmit') : t('core.nid.verifySubmit')) }}
      </button>
    </form>
  </TemplateModal>
</template>
