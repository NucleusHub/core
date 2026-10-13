<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, EMAIL_RE } from './nidErrors.js'
import NidSignUp from './NidSignUp.vue'
import { Icon } from '../icons'

const props = defineProps({
  notice: { type: String, default: null },
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

const view = ref('login')
const identifier = ref('')
const password = ref('')
const busy = ref(false)
const error = ref(props.notice)
const identifierRef = ref(null)

onMounted(() => identifierRef.value?.focus())

function show(next) {
  error.value = null
  view.value = next
}

async function submit() {
  if (busy.value) return
  error.value = null
  if (!identifier.value.trim() || !password.value) { error.value = t('core.nid.err.fillBoth'); return }
  busy.value = true
  try {
    await nidLogin(identifier.value.trim(), password.value)
    emit('signed-in')
  } catch (err) {
    if (err.code === 'server_code_required') refreshSettings()
    error.value = nidError(t, err)
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
  if (!EMAIL_RE.test(identifier.value.trim())) { error.value = t('core.nid.field.emailInvalid'); return }
  busy.value = true
  try {
    await nidPost('forgot', { email: identifier.value.trim() })
    view.value = 'forgot-sent'
  } catch (err) {
    if (err.code === 'server_code_required') refreshSettings()
    error.value = nidError(t, err)
  } finally {
    busy.value = false
  }
}

const inputClass = 'w-full px-3 py-2 rounded-xl bg-white/15 border border-white/25 text-white placeholder-white/40 outline-none focus:border-violet-400 text-sm transition-colors'
const primaryClass = 'w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors cursor-pointer'
const linkClass = 'text-sm text-white/60 hover:text-white transition-colors cursor-pointer'
</script>

<template>
  <NidSignUp v-if="view === 'signup'" @signed-in="emit('signed-in')" @cancel="show('login')" />

  <div v-else-if="view === 'forgot-sent'" class="flex flex-col items-center gap-3 text-center">
    <div class="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-200 flex items-center justify-center">
      <Icon name="check" class="w-6 h-6" :sw="2" />
    </div>
    <p class="text-sm text-white/75">{{ t('core.nid.resetSent') }}</p>
    <button type="button" :class="linkClass" @click="show('login')">{{ t('core.nid.backToSignIn') }}</button>
  </div>

  <form v-else-if="view === 'forgot'" class="flex flex-col gap-3 w-full" novalidate @submit.prevent="sendReset">
    <h2 class="font-semibold text-white text-center">{{ t('core.nid.forgotTitle') }}</h2>
    <p class="text-xs text-white/60 text-center -mt-1">{{ t('core.nid.forgotBody') }}</p>
    <input v-model="identifier" type="email" :class="inputClass" :placeholder="t('core.nid.field.email')"
      autocomplete="email" autocapitalize="off" maxlength="200" />
    <p v-if="error" class="text-xs text-red-300 text-center" role="alert">{{ error }}</p>
    <button type="submit" :disabled="busy" :class="primaryClass">{{ busy ? t('core.nid.working') : t('core.nid.sendLink') }}</button>
    <button type="button" :class="linkClass" @click="show('login')">{{ t('core.nid.backToSignIn') }}</button>
  </form>

  <div v-else class="flex flex-col gap-3 w-full">
    <form class="flex flex-col gap-3" novalidate @submit.prevent="submit">
      <input ref="identifierRef" v-model="identifier" :class="inputClass" :placeholder="t('core.nid.field.emailOrHandle')"
        autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="200" />
      <input v-model="password" type="password" :class="inputClass" :placeholder="t('core.nid.field.password')"
        autocomplete="current-password" maxlength="200" />
      <p v-if="error" class="text-xs text-red-300 text-center" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy" :class="primaryClass">{{ busy ? t('core.nid.working') : t('core.nid.signIn') }}</button>
    </form>
    <button type="button" class="text-xs text-white/55 hover:text-white transition-colors cursor-pointer self-center" @click="show('forgot')">
      {{ t('core.nid.forgotPassword') }}
    </button>

    <slot name="extra" />

    <template v-if="providers.length">
      <div class="flex items-center gap-3 text-[11px] uppercase tracking-wider text-white/40">
        <span class="flex-1 h-px bg-white/15" />{{ t('core.nid.or') }}<span class="flex-1 h-px bg-white/15" />
      </div>
      <button v-for="p in providers" :key="p.id" type="button"
        class="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-medium transition-colors cursor-pointer"
        @click="startSso(p.id)">
        {{ t('core.nid.continueWith', { provider: p.label }) }}
      </button>
    </template>

    <button v-if="canSignUp" type="button" :class="[linkClass, 'mt-1']" @click="show('signup')">
      {{ t('core.nid.noAccount') }}
    </button>
  </div>
</template>
