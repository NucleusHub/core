<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, onBeforeUnmount } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useRegistry } from '../useRegistry.js'
import { coreLaunchers } from '../usePluginExtensions.js'
import AvatarCircle from './AvatarCircle.vue'
import PinInput from './PinInput.vue'
import ProfileSettingsModal from './ProfileSettingsModal.vue'
import NidLoginPanel from './NidLoginPanel.vue'
import NidSignUp from './NidSignUp.vue'
import NidCrest from './NidCrest.vue'
import NidField from './NidField.vue'
import { useAuthSettings } from './useAuthSettings.js'
import { nidError, shake } from './nidErrors.js'
import { Icon } from '../icons'
import CloseIcon from '@core/assets/icons/close.svg?component'
import ArrowLeftIcon from '@core/assets/icons/arrow-left.svg?component'
import './nid.css'

const props = defineProps({
  closeable: { type: Boolean, default: false },
  preselectedId: { type: String, default: null },
  initialView: { type: String, default: null },
  notice: { type: String, default: null },
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { login, nidProfileLogin, completeTempLogin, profile: currentProfile, openAccountPanel } = useAuth()
const { isPluginEnabled } = useRegistry()
const { settings: authSettings, ensureLoaded: loadAuthSettings, refresh: refreshAuthSettings } = useAuthSettings()

// userLogin: 'profiles' still offers a NucleusID link (admins need it), 'both' shows tabs, 'nid' hides the picker.
const loginMode = computed(() => authSettings.value.userLogin)
const bootstrap = computed(() => !authSettings.value.hasAdmin)
const view = ref('profiles')
const nidNotice = ref(null)
const nidStart = ref('login')
const activeNotice = computed(() => nidNotice.value || props.notice)

function onNidSignedIn() {
  refreshAuthSettings()
  if (props.closeable) window.location.reload()
}

function launch(l) {
  emit('close')
  l.open()
}
function openAccount() {
  emit('close')
  openAccountPanel(currentProfile.value?.account ? 'manage' : 'upgrade')
}

function showNid(start = 'login') {
  nidStart.value = start
  view.value = 'nid'
}

const profiles = ref([])
const selected = ref(null)
// 'password' for profiles with a NucleusID, 'pin' otherwise; the PIN stays reachable when the server allows it.
const step = ref('pin')
const pinError = ref(null)
const pinShake = ref(false)
const pinInputRef = ref(null)

const password = ref('')
const pwBusy = ref(false)
const pwError = ref(null)
const pwInfo = ref(null)
const stepCard = ref(null)
const pwField = ref(null)

const settingNewPin = ref(false)
const tempPinValue = ref('')
const newPinStep = ref('enter')
const firstNewPin = ref('')
const RATE_LIMIT_KEY = 'nucleus_pin_rate_limit_until'
const rateLimited = ref(false)
const rateLimitTimer = ref(null)

function applyRateLimit(msRemaining) {
  rateLimited.value = true
  clearTimeout(rateLimitTimer.value)
  rateLimitTimer.value = setTimeout(() => {
    rateLimited.value = false
    pinError.value = null
    localStorage.removeItem(RATE_LIMIT_KEY)
    pinInputRef.value?.clear()
  }, msRemaining)
}
const loading = ref(true)
const creating = ref(false)
const newName = ref('')
const newPin = ref('')
const createError = ref(null)

const pinOnly = ref(false)

const settingsFor = ref(null)

const canUsePin = computed(() => !!selected.value?.hasPin && authSettings.value.pinAfterUpgrade !== false && loginMode.value !== 'nid')
const stepSub = computed(() => {
  if (settingNewPin.value) return newPinStep.value === 'enter' ? t('core.profiles.chooseOwnPin') : t('core.profiles.confirmNewPin')
  return step.value === 'password' ? t('core.profiles.enterPassword') : t('core.profiles.enterPin')
})
const launchers = computed(() => coreLaunchers.filter(l => isPluginEnabled(l.pluginId)))

async function onSettingsUpdated() {
  await loadProfiles()
  const p = profiles.value.find(x => x._id === settingsFor.value?._id)
  if (p) settingsFor.value = { ...settingsFor.value, ...p }
}

onMounted(async () => {
  const storedUntil = parseInt(localStorage.getItem(RATE_LIMIT_KEY) || '0', 10)
  if (storedUntil > Date.now()) {
    pinError.value = t('core.profiles.tooManyAttempts')
    applyRateLimit(storedUntil - Date.now())
  }

  await Promise.all([loadProfiles(), loadAuthSettings()])
  if (loginMode.value === 'nid' || props.initialView === 'nid' || props.notice) view.value = 'nid'
  loading.value = false
  if (props.preselectedId) {
    const p = profiles.value.find(p => p._id === props.preselectedId)
    if (p) { pinOnly.value = true; selectProfile(p) }
  }
})

function closeStep() {
  if (settingNewPin.value) cancelNewPin()
  else if (pinOnly.value) emit('close')
  else back()
}

function onKeydown(e) {
  if (e.key !== 'Escape') return
  // TemplateModal handles its own Escape; don't also close the selector.
  if (settingsFor.value) return
  if (creating.value) { creating.value = false; return }
  if (selected.value) { closeStep(); return }
  if (props.closeable) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
onBeforeUnmount(() => clearTimeout(rateLimitTimer.value))

async function loadProfiles() {
  // picker=1 lets guests see the account list.
  const res = await fetch('/api/auth/profiles?picker=1', { credentials: 'include' })
  profiles.value = res.ok ? await res.json() : []
}

function pick(p) {
  if (p._id === currentProfile.value?._id) return emit('close')
  if (p.hasAccount || p.hasPin) return selectProfile(p)
  loginNoPin(p)
}

function selectProfile(p) {
  selected.value = p
  step.value = p.hasAccount ? 'password' : 'pin'
  pinError.value = null
  pinShake.value = false
  resetPassword()
  if (step.value === 'password') focusPassword()
}

function useStep(next) {
  step.value = next
  pinError.value = null
  resetPassword()
  if (next === 'password') focusPassword()
}

async function focusPassword() {
  await nextTick()
  pwField.value?.focus()
}

function resetPassword() {
  password.value = ''
  pwError.value = null
  pwInfo.value = null
}

function back() {
  selected.value = null
  pinError.value = null
  resetPassword()
  resetNewPin()
}

function resetNewPin() {
  settingNewPin.value = false
  tempPinValue.value = ''
  newPinStep.value = 'enter'
  firstNewPin.value = ''
}

function cancelNewPin() {
  resetNewPin()
  pinError.value = null
  if (pinOnly.value) emit('close')
  else back()
}

function forgotPassword() {
  back()
  pinOnly.value = false
  showNid('forgot')
}

function otherWays() {
  back()
  pinOnly.value = false
  showNid('login')
}

async function submitPassword() {
  if (pwBusy.value) return
  pwError.value = null
  pwInfo.value = null
  if (!password.value) { pwError.value = t('core.nid.field.passwordRequired'); return }
  pwBusy.value = true
  try {
    await nidProfileLogin(selected.value._id, password.value)
    onNidSignedIn()
  } catch (err) {
    if (err.code === 'server_code_required') refreshAuthSettings()
    if (err.code === 'email_unverified') pwInfo.value = t('core.nid.err.emailUnverified')
    else {
      pwError.value = err.code === 'invalid_credentials' ? t('core.nid.err.wrongPasswordPicker') : nidError(t, err)
      shake(stepCard.value)
    }
    password.value = ''
    focusPassword()
  } finally {
    pwBusy.value = false
  }
}

async function submitPin(pin) {
  await doLogin(selected.value._id, pin)
}

async function loginNoPin(p) {
  await doLogin(p._id, null)
}

async function doLogin(profileId, pin) {
  pinError.value = null
  try {
    const data = await login(profileId, pin)
    if (data?.pinTemporary) {
      tempPinValue.value = pin
      settingNewPin.value = true
      newPinStep.value = 'enter'
      firstNewPin.value = ''
      return
    }
    if (props.closeable) window.location.reload()
  } catch (err) {
    if (err.code === 'nid_required' || err.code === 'nid_only') {
      const p = selected.value || profiles.value.find(x => x._id === profileId)
      // A profile with an account can still sign in right here with its password.
      if (p?.hasAccount && err.code === 'nid_required') {
        if (!selected.value) selectProfile(p)
        else useStep('password')
        pwInfo.value = t('core.nid.err.nidRequired')
        return
      }
      back()
      pinOnly.value = false
      nidNotice.value = t('core.nid.err.nidRequired')
      showNid()
      return
    }
    handlePinError(err)
  }
}

async function onNewPin(pin) {
  pinError.value = null
  if (newPinStep.value === 'enter') {
    firstNewPin.value = pin
    newPinStep.value = 'confirm'   // :key swap remounts PinInput fresh
    return
  }
  if (pin !== firstNewPin.value) {
    firstNewPin.value = ''
    newPinStep.value = 'enter'
    pinError.value = t('core.profiles.pinsDontMatch')
    return
  }
  try {
    await completeTempLogin(selected.value._id, tempPinValue.value, pin)
    if (props.closeable) window.location.reload()
  } catch (err) {
    firstNewPin.value = ''
    newPinStep.value = 'enter'
    handlePinError(err)
  }
}

function handlePinError(err) {
  if (err.status === 429 || err.message?.toLowerCase().includes('too many')) {
    const until = Date.now() + 15 * 60 * 1000
    localStorage.setItem(RATE_LIMIT_KEY, String(until))
    pinError.value = t('core.profiles.tooManyAttempts')
    applyRateLimit(15 * 60 * 1000)
  } else {
    pinError.value = err.code === 'wrong_pin' || err.status === 401 ? t('core.nid.err.wrongPin') : err.message
    pinShake.value = true
    setTimeout(() => {
      pinShake.value = false
      pinInputRef.value?.clear()
    }, 400)
  }
}

async function createProfile() {
  createError.value = null
  if (!newName.value.trim()) { createError.value = t('core.profiles.nameRequired'); return }
  const body = { name: newName.value.trim(), role: 'user' }
  if (newPin.value) body.pin = newPin.value.toUpperCase()
  const res = await fetch('/api/auth/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) { createError.value = (await res.json()).error; return }
  newName.value = ''
  newPin.value = ''
  creating.value = false
  await loadProfiles()
}
</script>

<template>
  <Teleport to="body">
    <div class="nid nid-stage ps">
      <div class="nid-scrim"
        @click="closeable && (pinOnly || (!selected && !creating)) ? emit('close') : null" />

      <div v-if="closeable && !selected && !creating" class="ps-bar">
        <template v-if="currentProfile">
          <button v-for="l in launchers" :key="l.pluginId + l.labelKey" type="button"
            class="nid-pill-btn nid-pill-btn--round" :title="t(l.labelKey)" :aria-label="t(l.labelKey)" @click="launch(l)">
            <component :is="l.iconOutline || l.icon" v-if="l.iconOutline || l.icon" class="ps-bar__icon" />
          </button>
        </template>
        <button v-if="currentProfile && !currentProfile.isGuest" type="button" class="nid-pill-btn" @click="openAccount">
          <NidCrest :size="22" />
          {{ currentProfile.account ? t('core.account.manage') : t('core.account.upgrade') }}
        </button>
        <button v-if="currentProfile && !currentProfile.isGuest" type="button" class="nid-pill-btn nid-pill-btn--round"
          :title="t('core.profiles.settings')" :aria-label="t('core.profiles.settings')"
          @click="settingsFor = { ...currentProfile }">
          <Icon name="cog" class="ps-bar__icon" :sw="1.6" />
        </button>
        <button type="button" class="nid-pill-btn nid-pill-btn--round" :aria-label="t('core.button.close')" @click="emit('close')">
          <CloseIcon width="14" height="14" />
        </button>
      </div>

      <div v-if="!pinOnly && !loading && bootstrap" class="nid-stage__body">
        <div class="nid-stage__center">
          <div class="nid-card nid-rise">
            <NidSignUp admin @signed-in="onNidSignedIn" />
          </div>
        </div>
      </div>

      <div v-else-if="!pinOnly" class="nid-stage__body">
        <div class="nid-stage__center">
          <p v-if="loading" class="nid-note" role="status">{{ t('core.profiles.loading') }}</p>

          <template v-else>
            <h1 v-if="view === 'profiles'" class="nid-stage__title">{{ t('core.profiles.whoAreYou') }}</h1>
            <p v-if="view === 'profiles'" class="nid-stage__sub">{{ t('core.profiles.pickSub') }}</p>

            <div v-if="loginMode === 'both'" role="tablist" class="nid-seg" :aria-label="t('core.nid.signInMethod')">
              <button v-for="tab in ['profiles', 'nid']" :key="tab" type="button" role="tab" :aria-selected="view === tab"
                class="nid-seg__btn" :class="{ 'is-on': view === tab }" @click="tab === 'nid' ? showNid() : (view = 'profiles')">
                {{ tab === 'nid' ? t('core.nid.tab') : t('core.nid.tabProfiles') }}
              </button>
            </div>

            <template v-if="view === 'nid'">
              <div class="nid-card nid-rise">
                <NidLoginPanel :key="(activeNotice || '') + nidStart" :notice="activeNotice" :initial-view="nidStart" @signed-in="onNidSignedIn" />
              </div>
              <button v-if="loginMode === 'profiles'" type="button" class="nid-link nid-link--muted ps-under"
                @click="view = 'profiles'; nidNotice = null">
                <ArrowLeftIcon width="14" height="14" />
                {{ t('core.nid.backToProfiles') }}
              </button>
            </template>

            <template v-else>
              <ul class="ps-grid" role="list">
                <li v-for="p in profiles" :key="p._id">
                  <button type="button" class="ps-tile" :class="{ 'is-active': p._id === currentProfile?._id }"
                    :aria-label="p.name" @click="pick(p)">
                    <span class="ps-tile__avatar"><AvatarCircle :profile="p" :size="64" /></span>
                    <span class="ps-tile__name">{{ p.name }}</span>
                    <span v-if="p._id === currentProfile?._id" class="ps-chip ps-chip--active">{{ t('core.profiles.active') }}</span>
                    <span v-else-if="p.hasAccount" class="ps-chip ps-chip--nid">
                      <span class="ps-chip__dot" aria-hidden="true" />NucleusID
                    </span>
                    <span v-else-if="p.hasPin && p.pinTemporary" class="ps-chip ps-chip--temp">
                      <Icon name="clock" class="ps-chip__icon" :sw="2.2" />PIN
                    </span>
                    <span v-else-if="p.hasPin" class="ps-chip">
                      <Icon name="lock" class="ps-chip__icon" :sw="2.2" />PIN
                    </span>
                    <span v-else class="ps-chip ps-chip--open">{{ t('core.profiles.noLock') }}</span>
                  </button>
                </li>
                <li>
                  <button type="button" class="ps-tile ps-tile--add" @click="creating = true">
                    <span class="ps-tile__plus" aria-hidden="true"><Icon name="plus" :sw="1.8" /></span>
                    <span class="ps-tile__name">{{ t('core.profiles.addProfile') }}</span>
                  </button>
                </li>
              </ul>
              <button v-if="loginMode === 'profiles'" type="button" class="nid-btn nid-btn--quiet nid-btn--sm ps-under" @click="showNid()">
                <NidCrest :size="20" />
                {{ t('core.nid.signInWith') }}
              </button>
            </template>
          </template>
        </div>
      </div>

      <Transition name="nid-fade">
        <div v-if="selected" class="ps-step" @click.self="closeStep">
          <div class="nid-card nid-card--narrow nid-rise ps-step__card nuc-surface-dark" ref="stepCard"
            role="dialog" aria-modal="true" :aria-label="selected.name">
            <button type="button" class="nid-icon-btn ps-step__corner" :aria-label="pinOnly ? t('core.button.close') : t('core.profiles.allProfiles')"
              :title="pinOnly ? t('core.button.close') : t('core.profiles.allProfiles')" @click="closeStep">
              <CloseIcon v-if="pinOnly || settingNewPin" class="nid-x" />
              <ArrowLeftIcon v-else />
            </button>

            <div class="nid-head nid-head--center ps-step__head">
              <span class="ps-ring"><AvatarCircle :profile="selected" :size="76" /></span>
              <div>
                <h2 class="nid-title">{{ selected.name }}</h2>
                <p class="nid-sub">{{ stepSub }}</p>
              </div>
            </div>

            <form v-if="step === 'password' && !settingNewPin" class="nid-form" novalidate :aria-busy="pwBusy" @submit.prevent="submitPassword">
              <input type="text" class="nid-sr" autocomplete="username" :value="selected.name" tabindex="-1" aria-hidden="true" readonly />
              <p v-if="pwInfo" class="nid-alert" role="status">
                <Icon name="info" class="nid-alert__icon" :sw="1.8" /><span>{{ pwInfo }}</span>
              </p>
              <NidField ref="pwField" v-model="password" type="password" :label="t('core.nid.field.password')" hide-label
                :placeholder="t('core.nid.field.password')" :error="pwError" autocomplete="current-password" maxlength="200" />
              <button type="submit" class="nid-btn nid-btn--primary nid-btn--block" :disabled="pwBusy">
                <span v-if="pwBusy" class="nid-spinner" aria-hidden="true" />
                {{ pwBusy ? t('core.nid.signingIn') : t('core.nid.signIn') }}
              </button>
              <div class="ps-step__links">
                <button type="button" class="nid-link" @click="forgotPassword">{{ t('core.nid.forgotPassword') }}</button>
                <button v-if="canUsePin" type="button" class="nid-link nid-link--muted" @click="useStep('pin')">{{ t('core.profiles.usePin') }}</button>
                <button v-else type="button" class="nid-link nid-link--muted" @click="otherWays">{{ t('core.profiles.otherWays') }}</button>
              </div>
            </form>

            <div v-else-if="!settingNewPin" class="ps-step__pin">
              <PinInput ref="pinInputRef" :error="pinError" :shake="pinShake" :disabled="rateLimited" @complete="submitPin" />
              <div v-if="selected.hasAccount" class="ps-step__links">
                <button type="button" class="nid-link" @click="useStep('password')">{{ t('core.profiles.usePassword') }}</button>
              </div>
            </div>

            <div v-else class="ps-step__pin">
              <PinInput :key="newPinStep" :error="pinError" @complete="onNewPin" />
              <button type="button" class="nid-link nid-link--muted" @click="cancelNewPin">
                <ArrowLeftIcon width="14" height="14" />
                {{ t('core.button.back') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="nid-fade">
        <div v-if="creating" class="ps-step" @click.self="creating = false">
          <form class="nid-card nid-card--narrow nid-rise ps-step__card nuc-surface-dark" role="dialog" aria-modal="true" :aria-label="t('core.profiles.newProfile')"
            novalidate @submit.prevent="createProfile">
            <button type="button" class="nid-icon-btn ps-step__corner" :aria-label="t('core.button.close')" @click="creating = false">
              <CloseIcon class="nid-x" />
            </button>
            <div class="nid-head nid-head--center ps-step__head">
              <h2 class="nid-title">{{ t('core.profiles.newProfile') }}</h2>
            </div>
            <div class="nid-form">
              <NidField v-model="newName" :label="t('core.profiles.name')" :error="createError" maxlength="32" autocomplete="off" />
              <div class="nid-field">
                <span class="nid-label">{{ t('core.profiles.pinOptional') }}</span>
                <PinInput @complete="pin => newPin = pin" @incomplete="newPin = ''" />
              </div>
              <button type="submit" class="nid-btn nid-btn--primary nid-btn--block">{{ t('core.profiles.create') }}</button>
            </div>
          </form>
        </div>
      </Transition>

    </div>
  </Teleport>

  <ProfileSettingsModal
    v-if="settingsFor"
    :profile="settingsFor"
    @updated="onSettingsUpdated"
    @close="settingsFor = null"
  />
</template>

<style scoped>
.ps-bar {
  position: relative;
  z-index: 2;
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.ps-bar__icon { width: 22px; height: 22px; }

.ps-under { margin-top: 4px; }

/* ── Profile tiles ───────────────────────────────────────────────────────── */

.ps-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
  max-width: 48rem;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.ps-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 8.25rem;
  padding: 18px 10px 14px;
  border: 0;
  border-radius: 22px;
  font: inherit;
  color: var(--nid-ink-hi);
  background: var(--nid-tile);
  box-shadow: inset 0 0 0 1px var(--nid-line), 0 18px 40px -28px rgba(24, 16, 60, 0.55);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
  cursor: pointer;
  transition: transform 0.24s var(--nid-ease), background-color 0.16s var(--nid-ease-std), box-shadow 0.24s var(--nid-ease);
}

.ps-tile:hover {
  transform: translateY(-3px);
  background: var(--nid-tile-hover);
  box-shadow: inset 0 0 0 1px var(--nid-accent-line), 0 26px 50px -28px rgba(124, 58, 237, 0.55);
}

.ps-tile:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--nid-focus), 0 0 0 4px var(--nid-halo);
}

.ps-tile.is-active { box-shadow: inset 0 0 0 1px var(--nid-ok-line), 0 18px 40px -28px rgba(24, 16, 60, 0.55); }

.ps-tile__avatar { display: grid; place-items: center; }

.ps-tile__name {
  max-width: 100%;
  overflow: hidden;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ps-tile--add { color: var(--nid-ink-3); }
.ps-tile--add .ps-tile__name { font-weight: 500; }

.ps-tile__plus {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  color: var(--nid-ink-3);
  box-shadow: inset 0 0 0 1.5px var(--nid-control);
  transition: color 0.16s var(--nid-ease-std), box-shadow 0.16s var(--nid-ease-std);
}

.ps-tile__plus svg { width: 26px; height: 26px; }
.ps-tile--add:hover .ps-tile__plus { color: var(--nid-accent-ink); box-shadow: inset 0 0 0 1.5px var(--nid-accent); }

.ps-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--nid-ink-3);
  background: var(--nid-quiet);
  white-space: nowrap;
}

.ps-chip__icon { width: 11px; height: 11px; }
.ps-chip--nid { color: var(--nid-accent-ink); background: var(--nid-accent-bg); }
.ps-chip__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--nid-accent); box-shadow: 0 0 6px var(--nid-accent); }
.ps-chip--temp { color: var(--nid-warn-ink); background: var(--nid-warn-bg); }
.ps-chip--active { color: var(--nid-ok-ink); background: var(--nid-ok-bg); }
.ps-chip--open { font-weight: 500; }

/* ── Step card (password / PIN / new profile) ────────────────────────────── */

.ps-step {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow-y: auto;
  background: var(--nid-scrim);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.ps-step__card { margin: auto 0; }

.ps-step__corner { position: absolute; top: 14px; left: 14px; }

.ps-step__head { margin-top: 6px; }

.ps-ring {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: 50%;
  box-shadow: 0 0 0 1.5px var(--nid-accent-line), 0 18px 40px -16px rgba(168, 85, 247, 0.65);
}

.ps-step__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}

.ps-step__pin {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

@media (max-width: 420px) {
  .ps-grid { gap: 10px; }
  .ps-tile { width: calc(50vw - 30px); max-width: 8.25rem; }
}
</style>
