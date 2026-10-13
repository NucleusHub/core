<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, fieldErrors, EMAIL_RE } from './nidErrors.js'
import NidSignUp from './NidSignUp.vue'
import NidCrest from './NidCrest.vue'
import NidField from './NidField.vue'
import NidProviderIcon from './NidProviderIcon.vue'
import { Icon } from '../icons'
import './nid.css'

const props = defineProps({
  notice: { type: String, default: null },
  initialView: { type: String, default: 'login' },
})
const emit = defineEmits(['signed-in'])

const { t } = useI18n()
const { nidLogin, nidPost } = useAuth()
const { settings, refresh: refreshSettings } = useAuthSettings()

const PROVIDERS = [
  { id: 'apple', label: 'Apple' },
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
]
const providers = computed(() => PROVIDERS.filter(p => settings.value.sso?.[p.id]))
const canSignUp = computed(() => settings.value.signupOpen)

const view = ref(['login', 'forgot', 'signup'].includes(props.initialView) ? props.initialView : 'login')
const identifier = ref('')
const password = ref('')
const busy = ref(false)
const error = ref(null)
const info = ref(props.notice)
const fields = ref({})
const root = ref(null)

async function focusFirst() {
  await nextTick()
  root.value?.querySelector('input')?.focus()
}

onMounted(focusFirst)

function show(next) {
  error.value = null
  info.value = null
  fields.value = {}
  view.value = next
  focusFirst()
}

function fail(err) {
  if (err.code === 'server_code_required') refreshSettings()
  fields.value = fieldErrors(t, err)
  error.value = Object.keys(fields.value).length ? null : nidError(t, err)
}

async function submit() {
  if (busy.value) return
  error.value = null
  info.value = null
  fields.value = {}
  if (!identifier.value.trim() || !password.value) { error.value = t('core.nid.err.fillBoth'); return }
  busy.value = true
  try {
    await nidLogin(identifier.value.trim(), password.value)
    emit('signed-in')
  } catch (err) {
    // Right password, unconfirmed address: a fresh link just went out, so it's news rather than a failure.
    if (err.code === 'email_unverified') info.value = t('core.nid.err.emailUnverified')
    else fail(err)
    password.value = ''
  } finally {
    busy.value = false
  }
}

function startSso(id) {
  const back = window.location.pathname + window.location.search
  window.location.href = `/api/auth/nid/sso/${id}/start?return=${encodeURIComponent(back)}`
}

async function sendReset() {
  if (busy.value) return
  error.value = null
  fields.value = {}
  if (!EMAIL_RE.test(identifier.value.trim())) { fields.value = { email: t('core.nid.field.emailInvalid') }; return }
  busy.value = true
  try {
    await nidPost('forgot', { email: identifier.value.trim() })
    view.value = 'forgot-sent'
  } catch (err) {
    fail(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div ref="root" class="nid-login">
    <NidSignUp v-if="view === 'signup'" @signed-in="emit('signed-in')" @cancel="show('login')" />

    <div v-else-if="view === 'forgot-sent'" class="nid-done" role="status">
      <span class="nid-done__mark"><Icon name="send" :sw="1.8" /></span>
      <h2 class="nid-title">{{ t('core.nid.checkEmailTitle') }}</h2>
      <p class="nid-body-text">{{ t('core.nid.resetSent') }}</p>
      <button type="button" class="nid-btn nid-btn--quiet nid-btn--block" @click="show('login')">{{ t('core.nid.backToSignIn') }}</button>
    </div>

    <template v-else-if="view === 'forgot'">
      <div class="nid-head">
        <NidCrest />
        <div class="nid-head__text">
          <h2 class="nid-title">{{ t('core.nid.forgotTitle') }}</h2>
          <p class="nid-sub">{{ t('core.nid.forgotBody') }}</p>
        </div>
      </div>
      <form class="nid-form" novalidate :aria-busy="busy" @submit.prevent="sendReset">
        <NidField v-model="identifier" type="email" :label="t('core.nid.field.email')" :error="fields.email"
          autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="200" />
        <p v-if="error" class="nid-alert nid-alert--error" role="alert">
          <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ error }}</span>
        </p>
        <div class="nid-actions">
          <button type="submit" class="nid-btn nid-btn--primary nid-btn--block" :disabled="busy">
            <span v-if="busy" class="nid-spinner" aria-hidden="true" />
            {{ busy ? t('core.nid.working') : t('core.nid.sendLink') }}
          </button>
          <button type="button" class="nid-btn nid-btn--quiet nid-btn--block" @click="show('login')">{{ t('core.nid.backToSignIn') }}</button>
        </div>
      </form>
    </template>

    <template v-else>
      <div class="nid-head">
        <NidCrest />
        <div class="nid-head__text">
          <h2 class="nid-title">{{ t('core.nid.title') }}</h2>
          <p class="nid-sub">{{ t('core.nid.signInSub') }}</p>
        </div>
      </div>

      <form class="nid-form" novalidate :aria-busy="busy" @submit.prevent="submit">
        <p v-if="info" class="nid-alert" role="status">
          <Icon name="info" class="nid-alert__icon" :sw="1.8" /><span>{{ info }}</span>
        </p>
        <NidField v-model="identifier" :label="t('core.nid.field.emailOrHandle')" :error="fields.email || fields.handle"
          autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="200" />
        <NidField v-model="password" type="password" :label="t('core.nid.field.password')" :error="fields.password"
          autocomplete="current-password" maxlength="200">
          <template #aside>
            <button type="button" class="nid-link" @click="show('forgot')">{{ t('core.nid.forgotPassword') }}</button>
          </template>
        </NidField>
        <p v-if="error" class="nid-alert nid-alert--error" role="alert">
          <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ error }}</span>
        </p>
        <button type="submit" class="nid-btn nid-btn--primary nid-btn--block" :disabled="busy">
          <span v-if="busy" class="nid-spinner" aria-hidden="true" />
          {{ busy ? t('core.nid.signingIn') : t('core.nid.signIn') }}
        </button>
      </form>

      <slot name="extra" />

      <div v-if="providers.length" class="nid-login__more">
        <p class="nid-rule"><span>{{ t('core.nid.or') }}</span></p>
        <div class="nid-providers">
          <button v-for="p in providers" :key="p.id" type="button" class="nid-provider" @click="startSso(p.id)">
            <NidProviderIcon :id="p.id" />
            {{ t('core.nid.continueWith', { provider: p.label }) }}
          </button>
        </div>
      </div>

      <div v-if="canSignUp" class="nid-login__more">
        <p class="nid-rule"><span>{{ t('core.nid.newHere') }}</span></p>
        <button type="button" class="nid-btn nid-btn--accent nid-btn--block nid-btn--sm" @click="show('signup')">
          <Icon name="plus" class="nid-login__plus" :sw="2" />
          {{ t('core.nid.createAccountAction') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nid-login__more {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
}

.nid-login__plus { width: 15px; height: 15px; }
</style>
