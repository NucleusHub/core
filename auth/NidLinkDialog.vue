<script setup>
import { ref, computed } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, fieldErrors, MIN_PASSWORD } from './nidErrors.js'
import NidDialog from './NidDialog.vue'
import NidField from './NidField.vue'
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
const fields = ref({})
const done = ref(false)

async function submit() {
  if (busy.value) return
  error.value = null
  fields.value = {}
  if (isReset.value) {
    if (password.value.length < MIN_PASSWORD) { fields.value = { password: t('core.nid.field.passwordShort', { min: MIN_PASSWORD }) }; return }
    if (password.value !== repeat.value) { fields.value = { repeat: t('core.nid.field.passwordsDiffer') }; return }
  }
  busy.value = true
  try {
    await nidPost(props.kind, { token: props.token, password: password.value || undefined })
    await checkSession()
    done.value = true
  } catch (err) {
    if (err.code === 'server_code_required') refreshSettings()
    const f = fieldErrors(t, err)
    // A bad token has no field of its own here, so it goes to the form-wide message.
    if (f.token) delete f.token
    fields.value = f
    error.value = Object.keys(f).length ? null : nidError(t, err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <NidDialog :title="isReset ? t('core.nid.resetTitle') : t('core.nid.verifyTitle')"
    :subtitle="done ? '' : (isReset ? t('core.nid.resetBody') : t('core.nid.verifyBody'))" :z="700" @close="emit('close')">
    <div v-if="done" class="nid-done" role="status">
      <span class="nid-done__mark"><Icon name="check" :sw="2" /></span>
      <p class="nid-body-text">{{ isReset ? t('core.nid.resetDone') : t('core.nid.verifyDone') }}</p>
      <button type="button" class="nid-btn nid-btn--primary nid-btn--block" data-autofocus @click="emit('close')">
        {{ t('core.nid.continue') }}
      </button>
    </div>

    <form v-else class="nid-form" novalidate :aria-busy="busy" @submit.prevent="submit">
      <NidField v-model="password" type="password" :error="fields.password"
        :label="isReset ? t('core.account.newPassword') : t('core.nid.field.password')"
        :hint="isReset ? t('core.nid.field.passwordShort', { min: MIN_PASSWORD }) : t('core.nid.verifySsoHint')"
        :autocomplete="isReset ? 'new-password' : 'current-password'" maxlength="200" />
      <NidField v-if="isReset" v-model="repeat" type="password" :label="t('core.nid.field.repeatPassword')" :error="fields.repeat"
        autocomplete="new-password" maxlength="200" />
      <p v-if="error" class="nid-alert nid-alert--error" role="alert">
        <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ error }}</span>
      </p>
      <button type="submit" class="nid-btn nid-btn--primary nid-btn--block" :disabled="busy">
        <span v-if="busy" class="nid-spinner" aria-hidden="true" />
        {{ busy ? t('core.nid.working') : (isReset ? t('core.nid.resetSubmit') : t('core.nid.verifySubmit')) }}
      </button>
    </form>
  </NidDialog>
</template>
