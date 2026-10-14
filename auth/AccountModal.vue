<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import NidDialog from './NidDialog.vue'
import NidField from './NidField.vue'
import NidProviderIcon from './NidProviderIcon.vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, fieldErrors, HANDLE_RE, EMAIL_RE, MIN_PASSWORD } from './nidErrors.js'
import AvatarCircle from './AvatarCircle.vue'
import { Icon } from '../icons'
import { qrCall } from './qrApi.js'
import QRCode from '../vendor/qrcode.js'

const props = defineProps({
  initialTab: { type: String, default: 'profile' },
})
const emit = defineEmits(['close', 'nid-signin'])

const { t } = useI18n()
const { profile, via, authFetch, checkSession, logoutAll } = useAuth()
const { settings, ensureLoaded } = useAuthSettings()

const TABS = [
  { id: 'profile', label: 'core.account.tabProfile', icon: 'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0' },
  { id: 'password', label: 'core.account.tabPassword', icon: 'M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25z' },
  { id: 'appearance', label: 'core.account.tabAppearance', icon: 'M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z' },
  { id: 'linked', label: 'core.account.tabLinked', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244' },
  { id: 'apps', label: 'core.account.tabApps', icon: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z' },
  { id: 'delete', label: 'core.account.tabDelete', icon: 'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0' },
]
const tab = ref(TABS.some(x => x.id === props.initialTab) ? props.initialTab : 'profile')

// Mirrors nucleus-web's accents; the server stores only the id (or a custom hex).
const ACCENTS = [
  { id: 'nucleus', label: 'Nucleus', accent: '#A855F7', soft: '#C084FC' },
  { id: 'midnight', label: 'Midnight', accent: '#4F6BF6', soft: '#8FA4FF' },
  { id: 'arctic', label: 'Arctic', accent: '#22B8CF', soft: '#67E3F0' },
  { id: 'ember', label: 'Ember', accent: '#F2711C', soft: '#FFA463' },
  { id: 'forest', label: 'Forest', accent: '#2FA36B', soft: '#6EE7A8' },
]
const PROVIDERS = [
  { id: 'apple', label: 'Apple' },
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
]

const account = ref(null)
const loadError = ref(null)
const isNid = computed(() => via.value === 'nid')

async function api(method, path, body) {
  const res = await authFetch(`/api/auth/nid/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = res.status === 204 ? null : await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.status = res.status
    err.code = data?.code
    err.fields = data?.fields || null
    throw err
  }
  return data
}

onMounted(async () => {
  ensureLoaded()
  try {
    setAccount(await api('GET', 'account'))
  } catch (err) {
    loadError.value = nidError(t, err)
  }
})

const form = reactive({ displayName: '', handle: '', email: '', confirm: '' })
const look = reactive({ accent: 'nucleus', customAccent: '#A855F7' })

function setAccount(a) {
  account.value = a
  form.displayName = a.displayName ?? ''
  form.handle = a.handle ?? ''
  form.email = a.email ?? ''
  form.confirm = ''
  look.accent = a.appearance?.accent ?? 'nucleus'
  if (a.appearance?.customAccent) look.customAccent = a.appearance.customAccent
}

// Profile tab
const profileBusy = ref(false)
const profileError = ref(null)
const profileFields = ref({})
const profileSaved = ref(false)
const emailChanged = computed(() => !!account.value && form.email.trim().toLowerCase() !== (account.value.email || '').toLowerCase())
const profileDirty = computed(() => !!account.value && (
  form.displayName.trim() !== account.value.displayName ||
  form.handle.trim().toLowerCase() !== account.value.handle ||
  emailChanged.value))

async function saveProfile() {
  if (profileBusy.value || !profileDirty.value) return
  const f = {}
  if (!form.displayName.trim() || form.displayName.trim().length > 64) f.displayName = t('core.nid.field.displayNameInvalid')
  if (!HANDLE_RE.test(form.handle.trim().toLowerCase())) f.handle = t('core.nid.field.handleInvalid')
  if (!EMAIL_RE.test(form.email.trim())) f.email = t('core.nid.field.emailInvalid')
  if (emailChanged.value && !form.confirm) f.confirm = t('core.account.confirmNeeded')
  profileFields.value = f
  profileError.value = null
  profileSaved.value = false
  if (Object.keys(f).length) return

  const body = {}
  if (form.displayName.trim() !== account.value.displayName) body.displayName = form.displayName.trim()
  if (form.handle.trim().toLowerCase() !== account.value.handle) body.handle = form.handle.trim().toLowerCase()
  if (emailChanged.value) {
    body.email = form.email.trim()
    if (account.value.hasPassword) body.currentPassword = form.confirm
    else body.confirm = form.confirm
  }
  profileBusy.value = true
  try {
    setAccount(await api('PATCH', 'account', body))
    profileSaved.value = true
    checkSession()
  } catch (err) {
    const f = fieldErrors(t, err)
    profileFields.value = { ...f, confirm: f.currentPassword || f.confirm }
    profileError.value = Object.keys(f).length ? null : nidError(t, err)
  } finally {
    profileBusy.value = false
  }
}

// Password tab
const pw = reactive({ current: '', next: '' })
const pwBusy = ref(false)
const pwError = ref(null)
const pwDone = ref(null)
const pwFields = ref({})

async function changePassword() {
  if (pwBusy.value) return
  pwError.value = null
  pwDone.value = null
  pwFields.value = {}
  if (pw.next.length < MIN_PASSWORD) { pwFields.value = { newPassword: t('core.nid.field.passwordShort', { min: MIN_PASSWORD }) }; return }
  pwBusy.value = true
  try {
    await api('POST', 'password', { currentPassword: pw.current, newPassword: pw.next })
    pw.current = ''
    pw.next = ''
    pwDone.value = t('core.account.passwordChanged')
  } catch (err) {
    pwFields.value = fieldErrors(t, err)
    pwError.value = Object.keys(pwFields.value).length ? null : nidError(t, err)
  } finally {
    pwBusy.value = false
  }
}

async function mailPasswordLink() {
  if (pwBusy.value) return
  pwBusy.value = true
  pwError.value = null
  try {
    await api('POST', 'forgot', { email: account.value.email })
    pwDone.value = t('core.nid.resetSent')
  } catch (err) {
    pwError.value = nidError(t, err)
  } finally {
    pwBusy.value = false
  }
}

const confirmingLogoutAll = ref(false)
async function signOutEverywhere() {
  try {
    await logoutAll()
    emit('close')
  } catch (err) {
    pwError.value = nidError(t, err)
  }
}

// Appearance tab
const lookBusy = ref(false)
const lookError = ref(null)
const lookSaved = ref(false)
const pickedLook = computed(() => look.accent === 'custom'
  ? { accent: 'custom', customAccent: look.customAccent.toUpperCase() }
  : { accent: look.accent })
const lookDirty = computed(() => {
  const saved = account.value?.appearance
  if ((saved?.accent ?? 'nucleus') !== look.accent) return true
  return look.accent === 'custom' && (saved?.customAccent || '').toUpperCase() !== look.customAccent.toUpperCase()
})

async function saveLook() {
  if (lookBusy.value) return
  lookBusy.value = true
  lookError.value = null
  lookSaved.value = false
  try {
    setAccount(await api('PATCH', 'account', { appearance: pickedLook.value }))
    lookSaved.value = true
    checkSession()
  } catch (err) {
    lookError.value = nidError(t, err)
  } finally {
    lookBusy.value = false
  }
}

// Linked sign-ins tab
const linkBusy = ref(null)
const linkError = ref(null)
const linkedRows = computed(() => PROVIDERS
  .map(p => ({ ...p, identity: account.value?.identities?.find(i => i.provider === p.id) || null }))
  .filter(p => p.identity || settings.value.sso?.[p.id]))

function connect(id) {
  const back = window.location.pathname
  window.location.href = `/api/auth/nid/sso/${id}/start?mode=link&return=${encodeURIComponent(back)}`
}

async function disconnect(id) {
  if (linkBusy.value) return
  linkBusy.value = id
  linkError.value = null
  try {
    await api('DELETE', `sso/${id}`)
    account.value = { ...account.value, identities: account.value.identities.filter(i => i.provider !== id) }
  } catch (err) {
    linkError.value = nidError(t, err)
  } finally {
    linkBusy.value = null
  }
}

// Apps tab
const apps = ref(null)
const appsError = ref(null)
const appsBusy = ref(null)
const appsDone = ref(null)

async function loadApps() {
  appsError.value = null
  try {
    apps.value = (await api('GET', 'apps')).apps
  } catch (err) {
    appsError.value = nidError(t, err)
  }
}
watch(tab, (now) => { if (now === 'apps' && apps.value === null) loadApps() }, { immediate: true })

function scopeName(scope) {
  const cross = /^(read|send):([^/]+)\/(.+)$/.exec(scope)
  if (!cross) return t(`core.account.appScope.${scope}`)
  return t(`core.account.appScope.${cross[1]}`, { app: cross[2], name: cross[3] })
}

const appDetail = (a) => [
  a.scopes.map(scopeName).join(', '),
  t('core.account.appLastUsed', { date: new Date(a.lastUsedAt).toLocaleDateString() }),
].join(' · ')

async function disconnectApp(a) {
  if (appsBusy.value) return
  appsBusy.value = a.clientId
  appsError.value = null
  appsDone.value = null
  try {
    await api('DELETE', `apps/${encodeURIComponent(a.clientId)}`)
    apps.value = apps.value.filter(x => x.clientId !== a.clientId)
    appsDone.value = t('core.account.appDisconnected', { name: a.name })
  } catch (err) {
    appsError.value = nidError(t, err)
  } finally {
    appsBusy.value = null
  }
}

// Sign in an app: show a QR code, then approve the app that claims it.
const qr = reactive({ state: 'idle', image: null, id: null, client: null, device: null, error: null })
let qrTimer = null

function qrStop() {
  clearTimeout(qrTimer)
  qrTimer = null
}

async function qrStart() {
  qrStop()
  qr.state = 'loading'
  qr.error = null
  qr.client = null
  try {
    const created = await qrCall('POST', '/app')
    qr.image = await QRCode.toDataURL(created.qr, { margin: 1, width: 200, errorCorrectionLevel: 'M' })
    qr.id = created.id
    qr.state = 'waiting'
    qrSchedule(created.id)
  } catch (err) {
    qr.state = 'error'
    qr.error = err.code === 'server_code_required' ? t('core.qr.needsServerCode') : err.message
  }
}

function qrSchedule(id) {
  qrTimer = setTimeout(() => qrWatch(id), 2000)
}

async function qrWatch(id) {
  if (qr.id !== id) return
  try {
    const seen = await qrCall('GET', `/${id}`)
    if (qr.id !== id) return
    if (seen.status === 'scanned') {
      qr.client = seen.client
      qr.device = seen.device
      qr.state = 'claimed'
    } else if (seen.status === 'expired') {
      qr.state = 'expired'
      return
    } else if (seen.status === 'used' || seen.status === 'approved') {
      qr.state = 'done'
      return
    } else if (seen.status === 'denied') {
      qr.state = 'idle'
      return
    }
  } catch (err) {
    if (err.status === 404) { qr.state = 'expired'; return }
  }
  qrSchedule(id)
}

async function qrDecide(approve) {
  const id = qr.id
  qrStop()
  try {
    await qrCall('POST', `/${id}/approve`, { approve })
    qr.state = approve ? 'done' : 'idle'
  } catch (err) {
    qr.state = err.status === 404 ? 'expired' : 'error'
    qr.error = err.message
  }
}

onBeforeUnmount(qrStop)

// Delete tab
const delConfirm = ref('')
const delBusy = ref(false)
const delError = ref(null)

async function deleteAccount() {
  if (delBusy.value || !delConfirm.value) return
  delBusy.value = true
  delError.value = null
  try {
    await api('DELETE', 'account', account.value.hasPassword ? { password: delConfirm.value } : { confirm: delConfirm.value })
    emit('close')
    await checkSession()
  } catch (err) {
    const f = fieldErrors(t, err)
    delError.value = f.password || f.handle || f.confirm || nidError(t, err)
  } finally {
    delBusy.value = false
  }
}
</script>

<template>
  <NidDialog size="lg" tall flush :title="account?.displayName || t('core.account.title')"
    :subtitle="account ? `@${account.handle}` : ''" @close="emit('close')">
    <template #lead>
      <AvatarCircle :profile="profile" :size="40" />
    </template>

    <div class="am">
      <nav class="am-tabs" role="tablist" :aria-label="t('core.account.title')">
        <button v-for="x in TABS" :key="x.id" type="button" role="tab" class="am-tab" :class="{ 'is-on': tab === x.id, 'am-tab--danger': x.id === 'delete' }"
          :aria-selected="tab === x.id" @click="tab = x.id">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="x.icon" /></svg>
          <span>{{ t(x.label) }}</span>
        </button>
      </nav>

      <div class="am-main" role="tabpanel">
        <p v-if="loadError" class="nid-alert nid-alert--error" role="alert">
          <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ loadError }}</span>
        </p>
        <p v-else-if="!account" class="nid-note" role="status">{{ t('core.profiles.loading') }}</p>
        <template v-else>
          <div v-if="!isNid && tab !== 'apps' && tab !== 'delete'" class="nid-alert nid-alert--warn am-gap">
            <Icon name="lock" class="nid-alert__icon" :sw="1.8" />
            <div class="am-banner">
              <span>{{ t('core.account.pinSession') }}</span>
              <button type="button" class="nid-btn nid-btn--quiet nid-btn--sm" @click="emit('nid-signin')">{{ t('core.nid.signInWith') }}</button>
            </div>
          </div>

          <section v-show="tab === 'profile'" class="am-stack">
            <div class="am-identity">
              <span class="am-identity__ring"><AvatarCircle :profile="profile" :size="56" /></span>
              <div class="am-identity__text">
                <p class="am-identity__name">{{ account.displayName }}</p>
                <ul class="am-chips">
                  <li class="am-chip am-chip--accent">@{{ account.handle }}</li>
                  <li class="am-chip" :class="account.emailVerified ? 'am-chip--ok' : 'am-chip--warn'">
                    <Icon :name="account.emailVerified ? 'check' : 'clock'" class="am-chip__icon" :sw="2.2" />
                    {{ account.emailVerified ? t('core.account.emailConfirmed') : t('core.account.emailUnconfirmed') }}
                  </li>
                </ul>
              </div>
            </div>

            <form class="am-block" novalidate @submit.prevent="saveProfile">
              <div class="am-grid">
                <NidField v-model="form.displayName" :label="t('core.nid.field.displayName')" :error="profileFields.displayName" :disabled="!isNid" maxlength="64" />
                <NidField v-model="form.handle" prefix="@" :label="t('core.nid.field.handle')" :error="profileFields.handle" :disabled="!isNid"
                  autocapitalize="off" spellcheck="false" maxlength="39" />
                <NidField v-model="form.email" class="am-wide" type="email" :label="t('core.nid.field.email')" :error="profileFields.email" :disabled="!isNid"
                  :hint="account.pendingEmail ? t('core.account.pendingEmail', { email: account.pendingEmail }) : null"
                  autocapitalize="off" spellcheck="false" maxlength="200" />
                <NidField v-if="emailChanged" v-model="form.confirm" class="am-wide" :type="account.hasPassword ? 'password' : 'text'"
                  :label="account.hasPassword ? t('core.account.currentPassword') : t('core.account.typeHandle', { handle: account.handle })"
                  :error="profileFields.confirm" :autocomplete="account.hasPassword ? 'current-password' : 'off'" maxlength="200" />
              </div>
              <p v-if="profileError" class="nid-alert nid-alert--error" role="alert">
                <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ profileError }}</span>
              </p>
              <div class="am-foot">
                <span v-if="profileSaved && !profileDirty" class="am-saved" role="status">
                  <Icon name="check" class="am-saved__icon" :sw="2.4" />
                  {{ account.pendingEmail ? t('core.account.confirmViaEmail') : t('core.profiles.saved') }}
                </span>
                <button type="submit" class="nid-btn nid-btn--primary nid-btn--sm" :disabled="!isNid || profileBusy || !profileDirty">
                  <span v-if="profileBusy" class="nid-spinner" aria-hidden="true" />
                  {{ profileBusy ? t('core.profiles.saving') : t('core.profiles.saveChanges') }}
                </button>
              </div>
            </form>
          </section>

          <section v-show="tab === 'password'" class="am-stack">
            <form class="am-block" novalidate @submit.prevent="changePassword">
              <div class="am-block__head">
                <h3 class="am-block__title">{{ t('core.account.tabPassword') }}</h3>
                <p class="am-block__hint">{{ account.hasPassword ? t('core.account.passwordHint') : t('core.account.noPassword') }}</p>
              </div>
              <template v-if="account.hasPassword">
                <NidField v-model="pw.current" type="password" :label="t('core.account.currentPassword')" :error="pwFields.currentPassword"
                  :disabled="!isNid" autocomplete="current-password" maxlength="200" />
                <NidField v-model="pw.next" type="password" :label="t('core.account.newPassword')" :error="pwFields.newPassword"
                  :hint="t('core.nid.field.passwordShort', { min: MIN_PASSWORD })" :disabled="!isNid" autocomplete="new-password" maxlength="200" />
              </template>
              <p v-if="pwError" class="nid-alert nid-alert--error" role="alert">
                <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ pwError }}</span>
              </p>
              <p v-if="pwDone" class="nid-alert nid-alert--ok" role="status">
                <Icon name="check" class="nid-alert__icon" :sw="2" /><span>{{ pwDone }}</span>
              </p>
              <div class="am-foot">
                <button v-if="account.hasPassword" type="submit" class="nid-btn nid-btn--primary nid-btn--sm" :disabled="!isNid || pwBusy || !pw.current || !pw.next">
                  <span v-if="pwBusy" class="nid-spinner" aria-hidden="true" />
                  {{ pwBusy ? t('core.profiles.saving') : t('core.account.changePassword') }}
                </button>
                <button v-else type="button" class="nid-btn nid-btn--accent nid-btn--sm" :disabled="pwBusy" @click="mailPasswordLink">{{ t('core.account.mailPasswordLink') }}</button>
              </div>
            </form>

            <div class="am-block">
              <div class="am-block__head">
                <h3 class="am-block__title">{{ t('core.account.sessions') }}</h3>
                <p class="am-block__hint">{{ t('core.account.logoutAllHint') }}</p>
              </div>
              <div class="am-foot am-foot--start">
                <button v-if="!confirmingLogoutAll" type="button" class="nid-btn nid-btn--quiet nid-btn--sm" @click="confirmingLogoutAll = true">{{ t('core.account.logoutAll') }}</button>
                <template v-else>
                  <button type="button" class="nid-btn nid-btn--danger nid-btn--sm" @click="signOutEverywhere">{{ t('core.account.logoutAllConfirm') }}</button>
                  <button type="button" class="nid-btn nid-btn--quiet nid-btn--sm" @click="confirmingLogoutAll = false">{{ t('core.button.cancel') }}</button>
                </template>
              </div>
            </div>
          </section>

          <section v-show="tab === 'appearance'" class="am-stack">
            <div class="am-block">
              <div class="am-block__head">
                <h3 class="am-block__title">{{ t('core.account.accentTitle') }}</h3>
                <p class="am-block__hint">{{ t('core.account.appearanceHint') }}</p>
              </div>
              <div class="am-looks" role="radiogroup" :aria-label="t('core.account.accentTitle')">
                <label v-for="a in ACCENTS" :key="a.id" class="am-look" :class="{ 'is-on': look.accent === a.id, 'is-disabled': !isNid }">
                  <input v-model="look.accent" class="nid-sr" type="radio" :value="a.id" :disabled="!isNid" />
                  <span class="am-look__swatch" :style="{ background: `linear-gradient(${a.soft}, ${a.accent})` }" aria-hidden="true" />
                  <span class="am-look__name">{{ a.label }}</span>
                </label>
                <label class="am-look" :class="{ 'is-on': look.accent === 'custom', 'is-disabled': !isNid }">
                  <input v-model="look.accent" class="nid-sr" type="radio" value="custom" :disabled="!isNid" />
                  <span class="am-look__swatch" :style="{ background: look.customAccent }" aria-hidden="true" />
                  <span class="am-look__name">{{ t('core.account.customAccent') }}</span>
                  <input v-model="look.customAccent" type="color" class="am-look__color" :disabled="!isNid"
                    :aria-label="t('core.account.customAccent')" @input="look.accent = 'custom'" />
                </label>
              </div>
              <p v-if="lookError" class="nid-alert nid-alert--error" role="alert">
                <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ lookError }}</span>
              </p>
              <div class="am-foot">
                <span v-if="lookSaved && !lookDirty" class="am-saved" role="status">
                  <Icon name="check" class="am-saved__icon" :sw="2.4" />{{ t('core.profiles.saved') }}
                </span>
                <button type="button" class="nid-btn nid-btn--primary nid-btn--sm" :disabled="!isNid || lookBusy || !lookDirty" @click="saveLook">
                  <span v-if="lookBusy" class="nid-spinner" aria-hidden="true" />
                  {{ lookBusy ? t('core.profiles.saving') : t('core.profiles.saveChanges') }}
                </button>
              </div>
            </div>
          </section>

          <section v-show="tab === 'linked'" class="am-stack">
            <div class="am-block">
              <div class="am-block__head">
                <h3 class="am-block__title">{{ t('core.account.tabLinked') }}</h3>
                <p class="am-block__hint">{{ t('core.account.linkedHint') }}</p>
              </div>
              <p v-if="!linkedRows.length" class="am-empty">{{ t('core.account.linkedNone') }}</p>
              <ul v-else class="am-ways">
                <li v-for="p in linkedRows" :key="p.id" class="am-way">
                  <span class="am-way__icon"><NidProviderIcon :id="p.id" /></span>
                  <div class="am-way__text">
                    <span class="am-way__name">{{ p.label }}</span>
                    <span class="am-way__detail">{{ p.identity ? (p.identity.email || t('core.account.linked')) : t('core.account.notLinked') }}</span>
                  </div>
                  <button v-if="p.identity" type="button" class="nid-btn nid-btn--quiet nid-btn--sm" :disabled="!isNid || linkBusy === p.id" @click="disconnect(p.id)">
                    {{ t('core.account.disconnect') }}<span class="nid-sr"> {{ p.label }}</span>
                  </button>
                  <button v-else type="button" class="nid-btn nid-btn--accent nid-btn--sm" :disabled="!isNid" @click="connect(p.id)">
                    {{ t('core.account.connect') }}<span class="nid-sr"> {{ p.label }}</span>
                  </button>
                </li>
              </ul>
              <p v-if="linkError" class="nid-alert nid-alert--error" role="alert">
                <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ linkError }}</span>
              </p>
            </div>
          </section>

          <section v-show="tab === 'apps'" class="am-stack">
            <p v-if="apps === null && !appsError" class="nid-note" role="status">{{ t('core.profiles.loading') }}</p>
            <div v-else-if="apps && !apps.length" class="am-block am-block--empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="TABS[4].icon" /></svg>
              <h3 class="am-block__title">{{ t('core.account.appsEmptyTitle') }}</h3>
              <p class="am-block__hint">{{ t('core.account.appsEmpty') }}</p>
              <p v-if="appsDone" class="nid-alert nid-alert--ok" role="status">
                <Icon name="check" class="nid-alert__icon" :sw="2" /><span>{{ appsDone }}</span>
              </p>
            </div>
            <div v-else-if="apps" class="am-block">
              <div class="am-block__head">
                <h3 class="am-block__title">{{ t('core.account.tabApps') }}</h3>
                <p class="am-block__hint">{{ t('core.account.appsHint') }}</p>
              </div>
              <ul class="am-ways">
                <li v-for="a in apps" :key="a.clientId" class="am-way">
                  <span class="am-way__icon am-way__icon--app" aria-hidden="true">{{ a.name.slice(0, 1).toUpperCase() }}</span>
                  <div class="am-way__text">
                    <span class="am-way__name">{{ a.name }}</span>
                    <span class="am-way__detail" :title="appDetail(a)">{{ appDetail(a) }}</span>
                  </div>
                  <button type="button" class="nid-btn nid-btn--quiet nid-btn--sm" :disabled="appsBusy === a.clientId" @click="disconnectApp(a)">
                    {{ t('core.account.disconnect') }}<span class="nid-sr"> {{ a.name }}</span>
                  </button>
                </li>
              </ul>
              <p v-if="appsDone" class="nid-alert nid-alert--ok" role="status">
                <Icon name="check" class="nid-alert__icon" :sw="2" /><span>{{ appsDone }}</span>
              </p>
            </div>
            <p v-if="appsError" class="nid-alert nid-alert--error" role="alert">
              <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ appsError }}</span>
            </p>

            <div class="am-block">
              <div class="am-block__head">
                <h3 class="am-block__title">{{ t('core.qr.appTitle') }}</h3>
                <p class="am-block__hint">{{ t('core.qr.appHint') }}</p>
              </div>
              <div v-if="qr.state === 'waiting' || qr.state === 'claimed'" class="am-qr">
                <img :src="qr.image" width="200" height="200" :alt="t('core.qr.alt')" class="am-qr__img" :class="{ 'is-claimed': qr.state === 'claimed' }">
                <p v-if="qr.state === 'claimed'" class="nid-note" role="status">
                  {{ t('core.qr.wantsIn', { app: qr.client?.name || '', device: qr.device || '' }) }}
                </p>
              </div>
              <p v-if="qr.state === 'done'" class="nid-alert nid-alert--ok" role="status">
                <Icon name="check" class="nid-alert__icon" :sw="2" /><span>{{ t('core.qr.approved') }}</span>
              </p>
              <p v-else-if="qr.state === 'expired'" class="nid-note" role="status">{{ t('core.qr.expired') }}</p>
              <p v-else-if="qr.state === 'error'" class="nid-alert nid-alert--error" role="alert">
                <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ qr.error }}</span>
              </p>
              <div class="am-foot">
                <template v-if="qr.state === 'claimed'">
                  <button type="button" class="nid-btn nid-btn--primary nid-btn--sm" @click="qrDecide(true)">{{ t('core.qr.approve') }}</button>
                  <button type="button" class="nid-btn nid-btn--quiet nid-btn--sm" @click="qrDecide(false)">{{ t('core.qr.deny') }}</button>
                </template>
                <button v-else-if="qr.state !== 'waiting'" type="button" class="nid-btn nid-btn--accent nid-btn--sm" :disabled="!isNid || qr.state === 'loading'" @click="qrStart">
                  {{ qr.state === 'expired' || qr.state === 'error' ? t('core.qr.newCode') : t('core.qr.showCode') }}
                </button>
              </div>
            </div>
          </section>

          <section v-show="tab === 'delete'" class="am-stack">
            <form class="am-block am-danger" novalidate @submit.prevent="deleteAccount">
              <div class="am-block__head">
                <h3 class="am-block__title am-danger__title">{{ t('core.account.tabDelete') }}</h3>
                <p class="am-block__hint">{{ t('core.account.deleteBody') }}</p>
              </div>
              <NidField v-model="delConfirm" :type="account.hasPassword ? 'password' : 'text'" :error="delError"
                :label="account.hasPassword ? t('core.nid.field.password') : t('core.account.typeHandle', { handle: account.handle })"
                :autocomplete="account.hasPassword ? 'current-password' : 'off'" maxlength="200" />
              <div class="am-foot">
                <button type="submit" class="nid-btn nid-btn--danger nid-btn--sm" :disabled="delBusy || !delConfirm">
                  <span v-if="delBusy" class="nid-spinner" aria-hidden="true" />
                  {{ delBusy ? t('core.nid.working') : t('core.account.deleteConfirm') }}
                </button>
              </div>
            </form>
          </section>
        </template>
      </div>
    </div>
  </NidDialog>
</template>

<style scoped>
.am { display: flex; flex: 1; min-height: 0; width: 100%; }

.am-tabs {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 13rem;
  padding: 14px 10px;
  overflow-y: auto;
  border-right: 1px solid var(--nid-line-soft);
  background: var(--nid-raise);
}

.am-tab {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: left;
  color: var(--nid-ink-2);
  background: none;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.16s var(--nid-ease-std), background-color 0.16s var(--nid-ease-std), box-shadow 0.16s var(--nid-ease-std);
}

.am-tab svg { flex: none; width: 18px; height: 18px; }
.am-tab:hover { color: var(--nid-ink-hi); background: var(--nid-quiet); }
.am-tab:focus-visible { outline: 2px solid var(--nid-focus); outline-offset: -2px; }
.am-tab.is-on { color: var(--nid-ink-hi); background: var(--nid-accent-bg); box-shadow: inset 0 0 0 1px var(--nid-accent-line); }
.am-tab.is-on svg { color: var(--nid-accent); }
.am-tab--danger { margin-top: auto; }
.am-tab--danger:hover, .am-tab--danger.is-on { color: var(--nid-danger-ink); }
.am-tab--danger.is-on { background: var(--nid-danger-bg); box-shadow: inset 0 0 0 1px var(--nid-danger-line); }
.am-tab--danger.is-on svg { color: var(--nid-danger); }

.am-main {
  flex: 1;
  min-width: 0;
  padding: 22px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.am-gap { margin-bottom: 16px; }
.am-banner { display: flex; flex: 1; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }

.am-qr { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.am-qr__img { padding: 8px; border-radius: 12px; background: #fff; transition: opacity 0.2s; }
.am-qr__img.is-claimed { opacity: 0.35; }
.am-stack { display: flex; flex-direction: column; gap: 16px; }

.am-identity {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px;
  border-radius: 18px;
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(168, 85, 247, 0.16) 0%, transparent 55%),
    radial-gradient(90% 120% at 100% 100%, rgba(99, 102, 241, 0.1) 0%, transparent 60%),
    var(--nid-raise);
  box-shadow: inset 0 0 0 1px var(--nid-line);
}

.am-identity__ring { padding: 3px; border-radius: 50%; box-shadow: 0 0 0 1.5px var(--nid-accent-line), 0 14px 30px -14px rgba(168, 85, 247, 0.7); }
.am-identity__text { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

.am-identity__name {
  margin: 0;
  overflow: hidden;
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--nid-ink-hi);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.am-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }

.am-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--nid-ink-2);
  background: var(--nid-quiet);
  box-shadow: inset 0 0 0 1px var(--nid-line);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.am-chip__icon { width: 12px; height: 12px; }
.am-chip--accent { color: var(--nid-accent-ink); background: var(--nid-accent-bg); box-shadow: inset 0 0 0 1px var(--nid-accent-line); }
.am-chip--ok { color: var(--nid-ok-ink); background: var(--nid-ok-bg); box-shadow: inset 0 0 0 1px var(--nid-ok-line); }
.am-chip--warn { color: var(--nid-warn-ink); background: var(--nid-warn-bg); box-shadow: inset 0 0 0 1px var(--nid-warn-line); }

.am-block {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-radius: 18px;
  background: var(--nid-raise);
  box-shadow: inset 0 0 0 1px var(--nid-line);
}

.am-block__head { display: flex; flex-direction: column; gap: 3px; }
.am-block__title { margin: 0; font-size: 0.95rem; font-weight: 600; letter-spacing: -0.012em; color: var(--nid-ink-hi); }
.am-block__hint { margin: 0; font-size: 0.8125rem; line-height: 1.5; color: var(--nid-ink-3); text-wrap: pretty; }

.am-block--empty { align-items: center; gap: 8px; padding: 36px 20px; text-align: center; }
.am-block--empty svg { width: 30px; height: 30px; margin-bottom: 4px; color: var(--nid-ink-3); }

.am-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.am-wide { grid-column: 1 / -1; }

.am-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; }
.am-foot--start { justify-content: flex-start; }

.am-saved { display: inline-flex; align-items: center; gap: 5px; font-size: 0.8125rem; font-weight: 500; color: var(--nid-ok-ink); }
.am-saved__icon { width: 14px; height: 14px; }

.am-looks { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: 8px; }

.am-look {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px 12px;
  border-radius: 14px;
  background: var(--nid-raise);
  box-shadow: inset 0 0 0 1px var(--nid-line);
  cursor: pointer;
  transition: background-color 0.16s var(--nid-ease-std), box-shadow 0.16s var(--nid-ease-std);
}

.am-look:hover { background: var(--nid-quiet); }
.am-look:focus-within { outline: 2px solid var(--nid-focus); outline-offset: 2px; }
.am-look.is-on { background: var(--nid-accent-bg); box-shadow: inset 0 0 0 1.5px var(--nid-accent); }
.am-look.is-disabled { cursor: not-allowed; opacity: 0.6; }
.am-look__swatch { width: 34px; height: 34px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2), 0 6px 14px -8px rgba(0, 0, 0, 0.5); }
.am-look__name { font-size: 0.8125rem; color: var(--nid-ink-2); }
.am-look.is-on .am-look__name { color: var(--nid-ink-hi); font-weight: 600; }
.am-look__color { position: absolute; top: 14px; width: 34px; height: 34px; opacity: 0; cursor: pointer; }

.am-empty { margin: 0; font-size: 0.875rem; color: var(--nid-ink-3); }

.am-ways {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
  border-radius: 14px;
  overflow: hidden;
  background: var(--nid-line-soft);
}

.am-way { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--nid-field); }
.am-way__icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: var(--nid-ink-hi); background: var(--nid-quiet); }
.am-way__icon :deep(svg) { width: 17px; height: 17px; }
.am-way__icon--app { font-size: 0.875rem; font-weight: 700; color: var(--nid-accent-ink); background: var(--nid-accent-bg); box-shadow: inset 0 0 0 1px var(--nid-accent-line); }
.am-way__text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.am-way__name { font-size: 0.9rem; font-weight: 500; color: var(--nid-ink-hi); }
.am-way__detail { overflow: hidden; font-size: 0.8125rem; color: var(--nid-ink-3); white-space: nowrap; text-overflow: ellipsis; }

.am-danger {
  background: linear-gradient(180deg, var(--nid-danger-bg), transparent 140%);
  box-shadow: inset 0 0 0 1px var(--nid-danger-line);
}

.am-danger__title { color: var(--nid-danger-ink); }

@media (max-width: 640px) {
  .am { flex-direction: column; }
  .am-tabs {
    flex-direction: row;
    width: auto;
    padding: 8px 10px;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: 0;
    border-bottom: 1px solid var(--nid-line-soft);
    scrollbar-width: none;
  }
  .am-tabs::-webkit-scrollbar { display: none; }
  .am-tab { min-height: 36px; padding: 0 12px; }
  .am-tab--danger { margin-top: 0; }
  .am-main { padding: 16px; }
  .am-grid { grid-template-columns: 1fr; }
  .am-identity { padding: 14px; }
  .am-block { padding: 16px; }
}
</style>
