<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import TemplateModal from '../TemplateModal.vue'
import AppTabs from '../AppTabs.vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, HANDLE_RE, EMAIL_RE, MIN_PASSWORD } from './nidErrors.js'
import AvatarCircle from './AvatarCircle.vue'
import { Icon } from '../icons'

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
const tabItems = computed(() => TABS.map(x => ({ key: x.id, label: t(x.label), icon: x.icon })))

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
    profileFields.value = err.fields ? { ...err.fields, confirm: err.fields.currentPassword || err.fields.confirm } : {}
    profileError.value = nidError(t, err)
  } finally {
    profileBusy.value = false
  }
}

// Password tab
const pw = reactive({ current: '', next: '' })
const pwBusy = ref(false)
const pwError = ref(null)
const pwDone = ref(null)

async function changePassword() {
  if (pwBusy.value) return
  pwError.value = null
  pwDone.value = null
  if (pw.next.length < MIN_PASSWORD) { pwError.value = t('core.nid.field.passwordShort', { min: MIN_PASSWORD }); return }
  pwBusy.value = true
  try {
    await api('POST', 'password', { currentPassword: pw.current, newPassword: pw.next })
    pw.current = ''
    pw.next = ''
    pwDone.value = t('core.account.passwordChanged')
  } catch (err) {
    pwError.value = nidError(t, err)
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
    delError.value = nidError(t, err)
  } finally {
    delBusy.value = false
  }
}

const labelClass = 'block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-1.5'
const inputClass = 'w-full text-sm rounded-xl border border-slate-300 dark:border-white/15 bg-white/70 dark:bg-white/5 text-slate-900 dark:text-white px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-colors disabled:opacity-60'
const primaryClass = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors'
const softClass = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-700 dark:text-violet-300 bg-violet-500/15 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors'
const hintClass = 'text-[11px] text-slate-400 dark:text-white/40'
</script>

<template>
  <TemplateModal :show="true" size="lg" z="z-[600]" @cancel="emit('close')">
    <div class="flex flex-col h-[min(36rem,85vh)] bg-white/95 dark:bg-slate-900/95">
      <div class="flex items-center justify-between px-5 sm:px-6 pt-5 pb-4 border-b border-black/[0.06] dark:border-white/10 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <AvatarCircle :profile="profile" :size="34" />
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-slate-900 dark:text-white truncate">{{ t('core.account.title') }}</h2>
            <p v-if="account" class="text-[11px] text-slate-400 dark:text-white/40 truncate">@{{ account.handle }}</p>
          </div>
        </div>
        <button
          class="cursor-pointer p-1.5 -mr-1 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"
          :aria-label="t('core.button.close')"
          @click="emit('close')"
        >
          <Icon name="close" class="w-4 h-4" :sw="2.5" />
        </button>
      </div>

      <div class="flex-1 min-h-0 flex flex-col sm:flex-row">
        <AppTabs
          v-model="tab"
          variant="rail"
          :tabs="tabItems"
          class="shrink-0 sm:w-48 px-3 py-3 overflow-x-auto border-b sm:border-b-0 sm:border-r border-black/[0.06] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]"
        />

        <div class="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5">
          <p v-if="loadError" class="text-sm text-red-500">{{ loadError }}</p>
          <p v-else-if="!account" class="text-sm text-slate-400 dark:text-white/40">{{ t('core.profiles.loading') }}</p>
          <template v-else>
            <div v-if="!isNid && tab !== 'apps' && tab !== 'delete'"
              class="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex flex-col gap-2">
              <p class="text-xs text-amber-800 dark:text-amber-200">{{ t('core.account.pinSession') }}</p>
              <button :class="[softClass, 'self-start']" @click="emit('nid-signin')">{{ t('core.nid.signInWith') }}</button>
            </div>

            <section v-show="tab === 'profile'" class="flex flex-col gap-4">
              <div>
                <label :class="labelClass">{{ t('core.nid.field.displayName') }}</label>
                <input v-model="form.displayName" :class="inputClass" :disabled="!isNid" maxlength="64" />
                <p v-if="profileFields.displayName" class="mt-1 text-[11px] text-red-500">{{ profileFields.displayName }}</p>
              </div>
              <div>
                <label :class="labelClass">{{ t('core.nid.field.handle') }}</label>
                <input v-model="form.handle" :class="inputClass" :disabled="!isNid" autocapitalize="off" spellcheck="false" maxlength="39" />
                <p v-if="profileFields.handle" class="mt-1 text-[11px] text-red-500">{{ profileFields.handle }}</p>
              </div>
              <div>
                <label :class="labelClass">{{ t('core.nid.field.email') }}</label>
                <input v-model="form.email" type="email" :class="inputClass" :disabled="!isNid" autocapitalize="off" maxlength="200" />
                <p v-if="profileFields.email" class="mt-1 text-[11px] text-red-500">{{ profileFields.email }}</p>
                <p v-if="account.pendingEmail" class="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                  {{ t('core.account.pendingEmail', { email: account.pendingEmail }) }}
                </p>
                <p v-else-if="!account.emailVerified" class="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                  {{ t('core.account.emailUnverified') }}
                </p>
              </div>
              <div v-if="emailChanged">
                <label :class="labelClass">{{ account.hasPassword ? t('core.account.currentPassword') : t('core.account.typeHandle', { handle: account.handle }) }}</label>
                <input v-model="form.confirm" :type="account.hasPassword ? 'password' : 'text'" :class="inputClass"
                  :autocomplete="account.hasPassword ? 'current-password' : 'off'" maxlength="200" />
                <p v-if="profileFields.confirm" class="mt-1 text-[11px] text-red-500">{{ profileFields.confirm }}</p>
              </div>
              <p v-if="profileError" class="text-[11px] text-red-500">{{ profileError }}</p>
              <div class="flex items-center gap-2">
                <button :class="primaryClass" :disabled="!isNid || profileBusy || !profileDirty" @click="saveProfile">
                  {{ profileBusy ? t('core.profiles.saving') : t('core.profiles.saveChanges') }}
                </button>
                <span v-if="profileSaved && !profileDirty" class="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <Icon name="check" class="w-3.5 h-3.5" :sw="2.5" />
                  {{ account.pendingEmail ? t('core.account.confirmViaEmail') : t('core.profiles.saved') }}
                </span>
              </div>
            </section>

            <section v-show="tab === 'password'" class="flex flex-col gap-4">
              <template v-if="account.hasPassword">
                <div>
                  <label :class="labelClass">{{ t('core.account.currentPassword') }}</label>
                  <input v-model="pw.current" type="password" :class="inputClass" :disabled="!isNid" autocomplete="current-password" maxlength="200" />
                </div>
                <div>
                  <label :class="labelClass">{{ t('core.account.newPassword') }}</label>
                  <input v-model="pw.next" type="password" :class="inputClass" :disabled="!isNid" autocomplete="new-password" maxlength="200"
                    :placeholder="t('core.nid.field.newPassword', { min: MIN_PASSWORD })" />
                </div>
                <div>
                  <button :class="primaryClass" :disabled="!isNid || pwBusy || !pw.current || !pw.next" @click="changePassword">
                    {{ pwBusy ? t('core.profiles.saving') : t('core.account.changePassword') }}
                  </button>
                </div>
              </template>
              <template v-else>
                <p class="text-xs text-slate-500 dark:text-white/60">{{ t('core.account.noPassword') }}</p>
                <div>
                  <button :class="softClass" :disabled="pwBusy" @click="mailPasswordLink">{{ t('core.account.mailPasswordLink') }}</button>
                </div>
              </template>
              <p v-if="pwError" class="text-[11px] text-red-500">{{ pwError }}</p>
              <p v-if="pwDone" class="text-[11px] text-emerald-600 dark:text-emerald-400">{{ pwDone }}</p>

              <div class="pt-4 mt-2 border-t border-black/[0.06] dark:border-white/10 flex flex-col gap-2">
                <label :class="labelClass">{{ t('core.account.sessions') }}</label>
                <p :class="hintClass">{{ t('core.account.logoutAllHint') }}</p>
                <div v-if="!confirmingLogoutAll">
                  <button :class="softClass" @click="confirmingLogoutAll = true">{{ t('core.account.logoutAll') }}</button>
                </div>
                <div v-else class="flex items-center gap-2">
                  <button class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 cursor-pointer transition-colors" @click="signOutEverywhere">
                    {{ t('core.account.logoutAllConfirm') }}
                  </button>
                  <button class="text-xs text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white cursor-pointer" @click="confirmingLogoutAll = false">
                    {{ t('core.button.cancel') }}
                  </button>
                </div>
              </div>
            </section>

            <section v-show="tab === 'appearance'" class="flex flex-col gap-4">
              <p :class="hintClass">{{ t('core.account.appearanceHint') }}</p>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" :aria-label="t('core.account.tabAppearance')">
                <label v-for="a in ACCENTS" :key="a.id"
                  class="flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors"
                  :class="look.accent === a.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-black/[0.03] dark:hover:bg-white/5'">
                  <input v-model="look.accent" class="sr-only" type="radio" :value="a.id" :disabled="!isNid" />
                  <span class="w-6 h-6 rounded-full shrink-0" :style="{ background: `linear-gradient(${a.soft}, ${a.accent})` }" />
                  <span class="text-sm text-slate-800 dark:text-white/85">{{ a.label }}</span>
                </label>
                <label
                  class="flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors"
                  :class="look.accent === 'custom' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-black/[0.03] dark:hover:bg-white/5'">
                  <input v-model="look.accent" class="sr-only" type="radio" value="custom" :disabled="!isNid" />
                  <span class="w-6 h-6 rounded-full shrink-0" :style="{ background: look.customAccent }" />
                  <span class="text-sm text-slate-800 dark:text-white/85 flex-1">{{ t('core.account.customAccent') }}</span>
                  <input v-model="look.customAccent" type="color" class="w-6 h-6 rounded cursor-pointer bg-transparent" :disabled="!isNid"
                    :aria-label="t('core.account.customAccent')" @input="look.accent = 'custom'" />
                </label>
              </div>
              <p v-if="lookError" class="text-[11px] text-red-500">{{ lookError }}</p>
              <div class="flex items-center gap-2">
                <button :class="primaryClass" :disabled="!isNid || lookBusy || !lookDirty" @click="saveLook">
                  {{ lookBusy ? t('core.profiles.saving') : t('core.profiles.saveChanges') }}
                </button>
                <span v-if="lookSaved && !lookDirty" class="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <Icon name="check" class="w-3.5 h-3.5" :sw="2.5" />
                  {{ t('core.profiles.saved') }}
                </span>
              </div>
            </section>

            <section v-show="tab === 'linked'" class="flex flex-col gap-3">
              <p :class="hintClass">{{ t('core.account.linkedHint') }}</p>
              <p v-if="!linkedRows.length" class="text-xs text-slate-400 dark:text-white/35 py-2">{{ t('core.account.linkedNone') }}</p>
              <ul v-else class="flex flex-col divide-y divide-slate-200/60 dark:divide-white/8">
                <li v-for="p in linkedRows" :key="p.id" class="flex items-center gap-3 py-3">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-900 dark:text-white">{{ p.label }}</p>
                    <p :class="[hintClass, 'truncate']">{{ p.identity ? (p.identity.email || t('core.account.linked')) : t('core.account.notLinked') }}</p>
                  </div>
                  <button v-if="p.identity" :class="softClass" :disabled="!isNid || linkBusy === p.id" @click="disconnect(p.id)">
                    {{ t('core.account.disconnect') }}
                  </button>
                  <button v-else :class="softClass" :disabled="!isNid" @click="connect(p.id)">{{ t('core.account.connect') }}</button>
                </li>
              </ul>
              <p v-if="linkError" class="text-[11px] text-red-500">{{ linkError }}</p>
            </section>

            <!-- Connected OAuth apps arrive with the OAuth provider. -->
            <section v-show="tab === 'apps'" class="flex flex-col gap-3">
              <p class="text-xs text-slate-400 dark:text-white/35 py-2">{{ t('core.account.appsEmpty') }}</p>
            </section>

            <section v-show="tab === 'delete'" class="flex flex-col gap-4">
              <p class="text-sm text-slate-700 dark:text-white/80">{{ t('core.account.deleteBody') }}</p>
              <div>
                <label :class="labelClass">{{ account.hasPassword ? t('core.nid.field.password') : t('core.account.typeHandle', { handle: account.handle }) }}</label>
                <input v-model="delConfirm" :type="account.hasPassword ? 'password' : 'text'" :class="inputClass"
                  :autocomplete="account.hasPassword ? 'current-password' : 'off'" maxlength="200" />
              </div>
              <p v-if="delError" class="text-[11px] text-red-500">{{ delError }}</p>
              <div>
                <button class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  :disabled="delBusy || !delConfirm" @click="deleteAccount">
                  {{ delBusy ? t('core.nid.working') : t('core.account.deleteConfirm') }}
                </button>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </TemplateModal>
</template>
