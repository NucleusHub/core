<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import TemplateModal from '../TemplateModal.vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { nidError, HANDLE_RE, EMAIL_RE, MIN_PASSWORD } from './nidErrors.js'
import PinInput from './PinInput.vue'
import { Icon } from '../icons'

const emit = defineEmits(['close'])

const { t } = useI18n()
const { profile, upgrade } = useAuth()

const hasPin = computed(() => !!profile.value?.hasPin)
const form = reactive({ handle: '', email: '', password: '', pin: '' })
const fields = ref({})
const error = ref(null)
const busy = ref(false)
const pinKey = ref(0)
const done = ref(null)
const handleRef = ref(null)

// After children mount, so PinInput's own autofocus doesn't win.
onMounted(() => handleRef.value?.focus())

function validate() {
  const f = {}
  if (!HANDLE_RE.test(form.handle.trim().toLowerCase())) f.handle = t('core.nid.field.handleInvalid')
  if (!EMAIL_RE.test(form.email.trim())) f.email = t('core.nid.field.emailInvalid')
  if (form.password.length < MIN_PASSWORD) f.password = t('core.nid.field.passwordShort', { min: MIN_PASSWORD })
  if (form.pin.length !== 4) f.pin = t('core.nid.field.pinRequired')
  fields.value = f
  return !Object.keys(f).length
}

async function submit() {
  if (busy.value) return
  error.value = null
  if (!validate()) return
  busy.value = true
  try {
    const data = await upgrade({
      handle: form.handle.trim().toLowerCase(),
      email: form.email.trim(),
      password: form.password,
      pin: form.pin,
    })
    done.value = data?.pending ? { pending: true, email: data.email } : { pending: false }
  } catch (err) {
    fields.value = err.code === 'invalid' ? (err.fields || {}) : {}
    error.value = err.code === 'invalid' ? null : nidError(t, err)
    if (err.code === 'wrong_pin') { form.pin = ''; pinKey.value++ }
  } finally {
    busy.value = false
  }
}

const labelClass = 'block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-1.5'
const inputClass = 'w-full text-sm rounded-xl border border-slate-300 dark:border-white/15 bg-white/70 dark:bg-white/5 text-slate-900 dark:text-white px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-colors'
</script>

<template>
  <TemplateModal :show="true" header :title="t('core.account.upgradeTitle')" size="sm" z="z-[600]" body-class="px-5 sm:px-6 py-5" @cancel="emit('close')">
    <div v-if="done" class="flex flex-col items-center gap-3 text-center py-4">
      <div class="w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
        <Icon name="check" class="w-6 h-6" :sw="2" />
      </div>
      <p class="text-sm text-slate-700 dark:text-white/80">
        {{ done.pending ? t('core.nid.checkEmailBody', { email: done.email }) : t('core.account.upgradeDone') }}
      </p>
      <button class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer transition-colors" @click="emit('close')">
        {{ t('core.button.close') }}
      </button>
    </div>

    <div v-else-if="!hasPin" class="flex flex-col gap-3 py-2">
      <p class="text-sm text-slate-700 dark:text-white/80">{{ t('core.nid.err.pinRequired') }}</p>
    </div>

    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p class="text-sm text-slate-500 dark:text-white/60">{{ t('core.account.upgradeBody') }}</p>
      <div>
        <label :class="labelClass">{{ t('core.nid.field.handle') }}</label>
        <input ref="handleRef" v-model="form.handle" :class="inputClass" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="39" />
        <p v-if="fields.handle" class="mt-1 text-[11px] text-red-500">{{ fields.handle }}</p>
      </div>
      <div>
        <label :class="labelClass">{{ t('core.nid.field.email') }}</label>
        <input v-model="form.email" type="email" :class="inputClass" autocomplete="email" autocapitalize="off" maxlength="200" />
        <p v-if="fields.email" class="mt-1 text-[11px] text-red-500">{{ fields.email }}</p>
      </div>
      <div>
        <label :class="labelClass">{{ t('core.nid.field.password') }}</label>
        <input v-model="form.password" type="password" :class="inputClass" :placeholder="t('core.nid.field.newPassword', { min: MIN_PASSWORD })"
          autocomplete="new-password" maxlength="200" />
        <p v-if="fields.password" class="mt-1 text-[11px] text-red-500">{{ fields.password }}</p>
      </div>
      <div class="flex flex-col items-center gap-1 pt-1">
        <p class="text-xs text-slate-500 dark:text-white/60">{{ t('core.account.upgradePin') }}</p>
        <PinInput :key="pinKey" :error="fields.pin || null" @complete="pin => form.pin = pin" @incomplete="form.pin = ''" />
      </div>
      <p v-if="error" class="text-xs text-red-500 text-center" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy"
        class="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors cursor-pointer">
        {{ busy ? t('core.nid.working') : t('core.account.upgrade') }}
      </button>
    </form>
  </TemplateModal>
</template>
