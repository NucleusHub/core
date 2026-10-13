<script setup>
import { ref, reactive, computed } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { nidError, fieldErrors, HANDLE_RE, EMAIL_RE, MIN_PASSWORD } from './nidErrors.js'
import NidDialog from './NidDialog.vue'
import NidField from './NidField.vue'
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
    fields.value = fieldErrors(t, err)
    error.value = Object.keys(fields.value).length ? null : nidError(t, err)
    if (err.code === 'wrong_pin') { form.pin = ''; pinKey.value++ }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <NidDialog :title="t('core.account.upgradeTitle')" :subtitle="done || !hasPin ? '' : t('core.account.upgradeBody')" @close="emit('close')">
    <div v-if="done" class="nid-done" role="status">
      <span class="nid-done__mark"><Icon :name="done.pending ? 'send' : 'check'" :sw="1.9" /></span>
      <h3 v-if="done.pending" class="nid-title">{{ t('core.nid.checkEmailTitle') }}</h3>
      <p class="nid-body-text">
        {{ done.pending ? t('core.nid.checkEmailBody', { email: done.email }) : t('core.account.upgradeDone') }}
      </p>
      <button type="button" class="nid-btn nid-btn--primary nid-btn--block" data-autofocus @click="emit('close')">
        {{ t('core.nid.continue') }}
      </button>
    </div>

    <div v-else-if="!hasPin" class="nid-form">
      <p class="nid-alert nid-alert--warn" role="status">
        <Icon name="lock" class="nid-alert__icon" :sw="1.8" /><span>{{ t('core.nid.err.pinRequired') }}</span>
      </p>
      <button type="button" class="nid-btn nid-btn--quiet nid-btn--block" data-autofocus @click="emit('close')">{{ t('core.button.close') }}</button>
    </div>

    <form v-else class="nid-form" novalidate :aria-busy="busy" @submit.prevent="submit">
      <NidField v-model="form.handle" prefix="@" :label="t('core.nid.field.handle')" :error="fields.handle"
        :hint="t('core.nid.field.handleHint')" data-autofocus
        autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="39" />
      <NidField v-model="form.email" type="email" :label="t('core.nid.field.email')" :error="fields.email"
        autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="200" />
      <NidField v-model="form.password" type="password" :label="t('core.nid.field.password')" :error="fields.password"
        :hint="t('core.nid.field.passwordShort', { min: MIN_PASSWORD })" autocomplete="new-password" maxlength="200" />
      <div class="nid-field up-pin">
        <span class="nid-label">{{ t('core.account.upgradePin') }}</span>
        <PinInput :key="pinKey" :error="fields.pin || null" @complete="pin => form.pin = pin" @incomplete="form.pin = ''" />
      </div>
      <p v-if="error" class="nid-alert nid-alert--error" role="alert">
        <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ error }}</span>
      </p>
      <button type="submit" class="nid-btn nid-btn--primary nid-btn--block" :disabled="busy">
        <span v-if="busy" class="nid-spinner" aria-hidden="true" />
        {{ busy ? t('core.nid.working') : t('core.account.upgrade') }}
      </button>
    </form>
  </NidDialog>
</template>

<style scoped>
.up-pin {
  align-items: center;
  padding: 16px 12px 14px;
  border-radius: 16px;
  background: var(--nid-raise);
  box-shadow: inset 0 0 0 1px var(--nid-line-soft);
}
</style>
