<script setup>
import { ref, onMounted, onUnmounted, onBeforeUnmount } from 'vue'
import { LiquidGlass } from '@zaosoula/liquid-glass-vue/components'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import AvatarCircle from './AvatarCircle.vue'
import PinInput from './PinInput.vue'
import ProfileSettingsModal from './ProfileSettingsModal.vue'

const props = defineProps({
  closeable: { type: Boolean, default: false },
  preselectedId: { type: String, default: null },
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { login, completeTempLogin, profile: currentProfile } = useAuth()

const profiles = ref([])
const selected = ref(null)
const pinError = ref(null)
const pinShake = ref(false)
const pinInputRef = ref(null)

// Temporary-PIN flow: after a one-time PIN is accepted the user must choose their
// own before a session is granted. Until they do, nothing is changed server-side.
const settingNewPin = ref(false)
const tempPinValue = ref('')        // the one-time PIN they just entered
const newPinStep = ref('enter')     // 'enter' | 'confirm'
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

// When opened with a preselected profile, skip the grid entirely —
// closing the PIN field closes the whole overlay.
const pinOnly = ref(false)

// Self-service settings for the signed-in profile (name / color / PIN). Never
// for guests. Holds the profile object being edited, or null when closed.
const settingsFor = ref(null)

async function onSettingsUpdated() {
  // Reflect the edited name/color on the grid card immediately.
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

  await loadProfiles()
  loading.value = false
  if (props.preselectedId) {
    const p = profiles.value.find(p => p._id === props.preselectedId)
    if (p) { pinOnly.value = true; selectProfile(p) }
  }
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  // The settings modal handles its own Escape (TemplateModal); don't also close
  // the whole selector underneath it.
  if (settingsFor.value) return
  if (creating.value) { creating.value = false; return }
  if (settingNewPin.value) { cancelNewPin(); return }
  if (selected.value) { pinOnly.value ? emit('close') : back(); return }
  if (props.closeable) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
onBeforeUnmount(() => clearTimeout(rateLimitTimer.value))

async function loadProfiles() {
  // picker=1: this is the account picker — guests may see the list here.
  const res = await fetch('/api/auth/profiles?picker=1', { credentials: 'include' })
  profiles.value = res.ok ? await res.json() : []
}

function selectProfile(p) {
  selected.value = p
  pinError.value = null
  pinShake.value = false
}

function back() {
  selected.value = null
  pinError.value = null
  resetNewPin()
}

function resetNewPin() {
  settingNewPin.value = false
  tempPinValue.value = ''
  newPinStep.value = 'enter'
  firstNewPin.value = ''
}

// Leave the set-new-PIN step without changing anything: back to the selector
// (or close, when launched for a single preselected profile).
function cancelNewPin() {
  resetNewPin()
  pinError.value = null
  if (pinOnly.value) emit('close')
  else back()
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
      // One-time PIN accepted — collect a new PIN before granting a session.
      tempPinValue.value = pin
      settingNewPin.value = true
      newPinStep.value = 'enter'
      firstNewPin.value = ''
      return
    }
    if (props.closeable) window.location.reload()
    // else AuthGuard handles the transition via profile ref
  } catch (err) {
    handlePinError(err)
  }
}

// Step through entering and confirming the new PIN, then complete the login.
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
    // else AuthGuard handles the transition via profile ref
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
    pinError.value = err.message
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
    <div class="fixed inset-0 z-[500] flex items-center justify-center p-4">

      <!-- Main backdrop -->
      <div class="absolute inset-0 bg-black/15 backdrop-blur-2xl"
        @click="closeable && (pinOnly || (!selected && !creating)) ? emit('close') : null" />

      <!-- Corner controls: settings (own profile) + close -->
      <div v-if="closeable && !selected && !creating" class="absolute top-4 right-4 z-10 flex items-center gap-2.5">
        <button v-if="currentProfile && !currentProfile.isGuest"
          @click="settingsFor = { ...currentProfile }"
          :title="t('core.profiles.settings')" :aria-label="t('core.profiles.settings')"
          class="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
        <button @click="emit('close')" :aria-label="t('core.button.close')"
          class="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors cursor-pointer">
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
      </div>

      <!-- Profile grid -->
      <div v-if="!pinOnly" class="relative z-10 flex flex-col items-center gap-8">
        <h1 class="text-2xl font-bold text-white tracking-tight drop-shadow">{{ t('core.profiles.whoAreYou') }}</h1>
        <div v-if="loading" class="text-sm text-white/50">{{ t('core.profiles.loading') }}</div>
        <div v-else class="flex flex-wrap justify-center gap-4 max-w-xl">
          <div v-for="p in profiles" :key="p._id"
            class="flex flex-col items-center gap-1.5 cursor-pointer"
            @click="p._id === currentProfile?._id ? emit('close') : (p.hasPin ? selectProfile(p) : loginNoPin(p))">
            <div class="relative overflow-hidden" style="width: 96px; height: 118px; border-radius: 20px">
              <LiquidGlass
                :style="{ position: 'absolute', top: '50%', left: '50%' }"
                :corner-radius="20" padding="12px"
                :displacement-scale="55" :blur-amount="0.08"
                :saturation="140" :elasticity="0">
                <div class="flex flex-col items-center gap-2" style="width: 72px">
                  <AvatarCircle :profile="p" :size="64" />
                  <span class="text-xs font-semibold text-white w-full truncate text-center" style="text-shadow: none">{{ p.name }}</span>
                </div>
              </LiquidGlass>
              <span v-if="p.hasPin && p.pinTemporary && p._id !== currentProfile?._id"
                class="absolute top-1 right-1 z-10 inline-flex items-center gap-0.5 text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-md bg-amber-500/25 text-amber-300">
                <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path stroke-linecap="round" d="M12 7v5l3 2" /></svg>
                PIN
              </span>
              <span v-else-if="p.hasPin && p._id !== currentProfile?._id"
                class="absolute top-1 right-1 z-10 text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-300">PIN</span>
            </div>
            <span v-if="p._id === currentProfile?._id"
              class="text-[11px] font-semibold tracking-wide px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 whitespace-nowrap">
              {{ t('core.profiles.active') }}
            </span>
          </div>

          <div class="relative overflow-hidden cursor-pointer"
            style="width: 96px; height: 118px; border-radius: 20px"
            @click="creating = true">
            <LiquidGlass
              :style="{ position: 'absolute', top: '50%', left: '50%' }"
              :corner-radius="20" padding="12px"
              :displacement-scale="55" :blur-amount="0.08"
              :saturation="140" :elasticity="0">
              <div class="flex flex-col items-center gap-2" style="width: 72px">
                <div class="w-16 h-16 rounded-full border-2 border-dashed border-white/40 flex items-center justify-center text-3xl text-white/50">+</div>
                <span class="text-xs font-semibold text-white/60 w-full text-center" style="text-shadow: none">{{ t('core.profiles.addProfile') }}</span>
              </div>
            </LiquidGlass>
          </div>
        </div>
      </div>

      <!-- PIN entry modal -->
      <Transition name="fade">
        <div v-if="selected"
          class="absolute inset-0 z-20 flex items-center justify-center p-4"
          @click.self="settingNewPin ? cancelNewPin() : (pinOnly ? emit('close') : back())">
          <div class="relative bg-white/15 dark:bg-white/8 border border-white/30 dark:border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl w-full max-w-xs p-8 flex flex-col items-center gap-5">
            <button @click="settingNewPin ? cancelNewPin() : (pinOnly ? emit('close') : back())"
              class="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors cursor-pointer">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M1 1l12 12M13 1L1 13" />
              </svg>
            </button>
            <AvatarCircle :profile="selected" :size="76" />
            <p class="font-semibold text-white">{{ selected.name }}</p>

            <!-- Normal PIN entry -->
            <PinInput v-if="!settingNewPin" ref="pinInputRef" :error="pinError" :shake="pinShake" :disabled="rateLimited" @complete="submitPin" />

            <!-- Set-your-own-PIN step (after a one-time PIN) -->
            <template v-else>
              <p class="text-xs text-white/60 text-center -mt-2">
                {{ newPinStep === 'enter' ? t('core.profiles.chooseOwnPin') : t('core.profiles.confirmNewPin') }}
              </p>
              <PinInput :key="newPinStep" :error="pinError" @complete="onNewPin" />
              <button @click="cancelNewPin"
                class="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                {{ t('core.button.back') }}
              </button>
            </template>
          </div>
        </div>
      </Transition>

      <!-- Create profile modal -->
      <Transition name="fade">
        <div v-if="creating"
          class="absolute inset-0 z-20 flex items-center justify-center p-4"
          @click.self="creating = false">
          <div class="relative bg-white/15 dark:bg-white/8 border border-white/30 dark:border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl w-full max-w-xs p-8 flex flex-col items-center gap-4">
            <button @click="creating = false"
              class="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors cursor-pointer">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M1 1l12 12M13 1L1 13" />
              </svg>
            </button>
            <h2 class="font-semibold text-white">{{ t('core.profiles.newProfile') }}</h2>
            <input v-model="newName"
              class="w-full px-3 py-2 rounded-xl bg-white/15 border border-white/25 text-white placeholder-white/40 outline-none focus:border-violet-400 text-sm transition-colors"
              :placeholder="t('core.profiles.name')" maxlength="32" />
            <div class="w-full flex flex-col items-center gap-1">
              <p class="text-xs text-white/50">{{ t('core.profiles.pinOptional') }}</p>
              <PinInput @complete="pin => newPin = pin" @incomplete="newPin = ''" />
            </div>
            <p v-if="createError" class="text-xs text-red-400">{{ createError }}</p>
            <button @click="createProfile"
              class="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors cursor-pointer">
              {{ t('core.profiles.create') }}
            </button>
          </div>
        </div>
      </Transition>

    </div>
  </Teleport>

  <!-- Self-service settings for the signed-in profile (sits above this overlay) -->
  <ProfileSettingsModal
    v-if="settingsFor"
    :profile="settingsFor"
    @updated="onSettingsUpdated"
    @close="settingsFor = null"
  />
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
