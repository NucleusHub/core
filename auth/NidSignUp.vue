<script setup>
import { ref, reactive, watch } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, HANDLE_RE, EMAIL_RE, MIN_PASSWORD } from './nidErrors.js'
import { Icon } from '../icons'

defineProps({
  admin: { type: Boolean, default: false },
})
const emit = defineEmits(['signed-in', 'cancel'])

const { t } = useI18n()
const { nidRegister } = useAuth()
const { refresh: refreshSettings } = useAuthSettings()

const form = reactive({ displayName: '', handle: '', email: '', password: '' })
const fields = ref({})
const error = ref(null)
const busy = ref(false)
const sentTo = ref(null)
const handleEdited = ref(false)

// Suggest a handle from the name until the user types their own.
watch(() => form.displayName, (name) => {
  if (handleEdited.value) return
  form.handle = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39)
})

function validate() {
  const f = {}
  if (!form.displayName.trim() || form.displayName.trim().length > 64) f.displayName = t('core.nid.field.displayNameInvalid')
  if (!HANDLE_RE.test(form.handle.trim().toLowerCase())) f.handle = t('core.nid.field.handleInvalid')
  if (!EMAIL_RE.test(form.email.trim())) f.email = t('core.nid.field.emailInvalid')
  if (form.password.length < MIN_PASSWORD) f.password = t('core.nid.field.passwordShort', { min: MIN_PASSWORD })
  fields.value = f
  return !Object.keys(f).length
}

async function submit() {
  if (busy.value) return
  error.value = null
  if (!validate()) return
  busy.value = true
  try {
    const data = await nidRegister({
      displayName: form.displayName.trim(),
      handle: form.handle.trim().toLowerCase(),
      email: form.email.trim(),
      password: form.password,
    })
    if (data?.pending) sentTo.value = data.email
    else emit('signed-in')
  } catch (err) {
    if (err.code === 'server_code_required') refreshSettings()
    fields.value = err.code === 'invalid' ? (err.fields || {}) : {}
    error.value = err.code === 'invalid' ? null : nidError(t, err)
  } finally {
    busy.value = false
  }
}

const inputClass = 'w-full px-3 py-2 rounded-xl bg-white/15 border border-white/25 text-white placeholder-white/40 outline-none focus:border-violet-400 text-sm transition-colors'
</script>

<template>
  <div v-if="sentTo" class="flex flex-col items-center gap-3 text-center">
    <div class="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-200 flex items-center justify-center">
      <Icon name="check" class="w-6 h-6" :sw="2" />
    </div>
    <h2 class="font-semibold text-white">{{ t('core.nid.checkEmailTitle') }}</h2>
    <p class="text-sm text-white/65">{{ t('core.nid.checkEmailBody', { email: sentTo }) }}</p>
    <button v-if="!admin" type="button" class="text-sm text-white/60 hover:text-white transition-colors cursor-pointer" @click="emit('cancel')">
      {{ t('core.nid.backToSignIn') }}
    </button>
  </div>

  <form v-else class="flex flex-col gap-3 w-full" novalidate @submit.prevent="submit">
    <h2 class="font-semibold text-white text-center">{{ admin ? t('core.nid.createAdminTitle') : t('core.nid.createAccountTitle') }}</h2>
    <p v-if="admin" class="text-xs text-white/60 text-center -mt-1">{{ t('core.nid.createAdminBody') }}</p>

    <div>
      <input v-model="form.displayName" :class="inputClass" :placeholder="t('core.nid.field.displayName')"
        autocomplete="name" maxlength="64" />
      <p v-if="fields.displayName" class="mt-1 text-[11px] text-red-300">{{ fields.displayName }}</p>
    </div>
    <div>
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40 pointer-events-none">@</span>
        <input v-model="form.handle" :class="[inputClass, 'pl-7']" :placeholder="t('core.nid.field.handle')"
          autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="39" @input="handleEdited = true" />
      </div>
      <p v-if="fields.handle" class="mt-1 text-[11px] text-red-300">{{ fields.handle }}</p>
    </div>
    <div>
      <input v-model="form.email" type="email" :class="inputClass" :placeholder="t('core.nid.field.email')"
        autocomplete="email" autocapitalize="off" maxlength="200" />
      <p v-if="fields.email" class="mt-1 text-[11px] text-red-300">{{ fields.email }}</p>
    </div>
    <div>
      <input v-model="form.password" type="password" :class="inputClass" :placeholder="t('core.nid.field.newPassword', { min: MIN_PASSWORD })"
        autocomplete="new-password" maxlength="200" />
      <p v-if="fields.password" class="mt-1 text-[11px] text-red-300">{{ fields.password }}</p>
    </div>

    <p v-if="error" class="text-xs text-red-300 text-center" role="alert">{{ error }}</p>

    <button type="submit" :disabled="busy"
      class="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors cursor-pointer">
      {{ busy ? t('core.nid.working') : (admin ? t('core.nid.createAdmin') : t('core.nid.createAccount')) }}
    </button>
    <button v-if="!admin" type="button" class="text-sm text-white/60 hover:text-white transition-colors cursor-pointer" @click="emit('cancel')">
      {{ t('core.nid.haveAccount') }}
    </button>
  </form>
</template>
