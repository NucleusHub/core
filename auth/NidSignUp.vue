<script setup>
import { ref, reactive, watch } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, fieldErrors, HANDLE_RE, EMAIL_RE, MIN_PASSWORD } from './nidErrors.js'
import NidCrest from './NidCrest.vue'
import NidField from './NidField.vue'
import { Icon } from '../icons'
import './nid.css'

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
    fields.value = fieldErrors(t, err)
    error.value = Object.keys(fields.value).length ? null : nidError(t, err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="sentTo" class="nid-done" role="status">
    <span class="nid-done__mark"><Icon name="send" :sw="1.8" /></span>
    <h2 class="nid-title">{{ t('core.nid.checkEmailTitle') }}</h2>
    <p class="nid-body-text">{{ t('core.nid.checkEmailBody', { email: sentTo }) }}</p>
    <button v-if="!admin" type="button" class="nid-btn nid-btn--quiet nid-btn--block" @click="emit('cancel')">
      {{ t('core.nid.backToSignIn') }}
    </button>
  </div>

  <div v-else>
    <div class="nid-head">
      <NidCrest />
      <div class="nid-head__text">
        <h2 class="nid-title">{{ admin ? t('core.nid.createAdminTitle') : t('core.nid.createAccountTitle') }}</h2>
        <p class="nid-sub">{{ admin ? t('core.nid.createAdminBody') : t('core.nid.createAccountSub') }}</p>
      </div>
    </div>

    <form class="nid-form" novalidate :aria-busy="busy" @submit.prevent="submit">
      <NidField v-model="form.displayName" :label="t('core.nid.field.displayName')" :error="fields.displayName"
        autocomplete="name" maxlength="64" />
      <NidField v-model="form.handle" prefix="@" :label="t('core.nid.field.handle')" :error="fields.handle"
        :hint="t('core.nid.field.handleHint')"
        autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="39" @input="handleEdited = true" />
      <NidField v-model="form.email" type="email" :label="t('core.nid.field.email')" :error="fields.email"
        autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="200" />
      <NidField v-model="form.password" type="password" :label="t('core.nid.field.password')" :error="fields.password"
        :hint="t('core.nid.field.passwordShort', { min: MIN_PASSWORD })" autocomplete="new-password" maxlength="200" />

      <p v-if="error" class="nid-alert nid-alert--error" role="alert">
        <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ error }}</span>
      </p>

      <div class="nid-actions">
        <button type="submit" class="nid-btn nid-btn--primary nid-btn--block" :disabled="busy">
          <span v-if="busy" class="nid-spinner" aria-hidden="true" />
          {{ busy ? t('core.nid.working') : (admin ? t('core.nid.createAdmin') : t('core.nid.createAccount')) }}
        </button>
        <template v-if="!admin">
          <p class="nid-rule"><span>{{ t('core.nid.haveAccountPrompt') }}</span></p>
          <button type="button" class="nid-btn nid-btn--quiet nid-btn--block nid-btn--sm" @click="emit('cancel')">
            {{ t('core.nid.signIn') }}
          </button>
        </template>
      </div>
    </form>
  </div>
</template>
