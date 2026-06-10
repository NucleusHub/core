<script setup>
import { ref, onMounted, onUnmounted, onBeforeUnmount } from 'vue'
import { LiquidGlass } from '@zaosoula/liquid-glass-vue/components'
import { useAuth } from './useAuth.js'
import AvatarCircle from './AvatarCircle.vue'
import PinInput from './PinInput.vue'

const props = defineProps({
  closeable: { type: Boolean, default: false },
  preselectedId: { type: String, default: null },
})
const emit = defineEmits(['close'])

const { login, profile: currentProfile } = useAuth()

const profiles = ref([])
const selected = ref(null)
const pinError = ref(null)
const pinShake = ref(false)
const pinInputRef = ref(null)
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

onMounted(async () => {
  const storedUntil = parseInt(localStorage.getItem(RATE_LIMIT_KEY) || '0', 10)
  if (storedUntil > Date.now()) {
    pinError.value = 'Too many attempts — try again in 15 minutes'
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
  if (creating.value) { creating.value = false; return }
  if (selected.value) { pinOnly.value ? emit('close') : back(); return }
  if (props.closeable) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
onBeforeUnmount(() => clearTimeout(rateLimitTimer.value))

async function loadProfiles() {
  const res = await fetch('/api/auth/profiles', { credentials: 'include' })
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
    await login(profileId, pin)
    if (props.closeable) window.location.reload()
    // else AuthGuard handles the transition via profile ref
  } catch (err) {
    if (err.status === 429 || err.message?.toLowerCase().includes('too many')) {
      const until = Date.now() + 15 * 60 * 1000
      localStorage.setItem(RATE_LIMIT_KEY, String(until))
      pinError.value = 'Too many attempts — try again in 15 minutes'
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
}

async function createProfile() {
  createError.value = null
  if (!newName.value.trim()) { createError.value = 'Name is required'; return }
  const body = { name: newName.value.trim(), role: 'admin' }
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

      <!-- Global close button -->
      <button v-if="closeable && !selected && !creating"
        @click="emit('close')"
        class="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors cursor-pointer">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M1 1l12 12M13 1L1 13" />
        </svg>
      </button>

      <!-- Profile grid -->
      <div v-if="!pinOnly" class="relative z-10 flex flex-col items-center gap-8">
        <h1 class="text-2xl font-bold text-white tracking-tight drop-shadow">Who are you?</h1>
        <div v-if="loading" class="text-sm text-white/50">Loading…</div>
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
                  <AvatarCircle :name="p.name" :color="p.color" :emoji="p.emoji"
                    :admin="p.role === 'admin'" :size="64" />
                  <span class="text-xs font-semibold text-white w-full truncate text-center" style="text-shadow: none">{{ p.name }}</span>
                </div>
              </LiquidGlass>
              <span v-if="p.hasPin && p._id !== currentProfile?._id"
                class="absolute top-1 right-1 z-10 text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-300">PIN</span>
            </div>
            <span v-if="p._id === currentProfile?._id"
              class="text-[11px] font-semibold tracking-wide px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 whitespace-nowrap">
              Active
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
                <span class="text-xs font-semibold text-white/60 w-full text-center" style="text-shadow: none">Add Profile</span>
              </div>
            </LiquidGlass>
          </div>
        </div>
      </div>

      <!-- PIN entry modal -->
      <Transition name="fade">
        <div v-if="selected"
          class="absolute inset-0 z-20 flex items-center justify-center p-4"
          @click.self="pinOnly ? emit('close') : back()">
          <div class="relative bg-white/15 dark:bg-white/8 border border-white/30 dark:border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl w-full max-w-xs p-8 flex flex-col items-center gap-5">
            <button @click="pinOnly ? emit('close') : back()"
              class="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors cursor-pointer">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M1 1l12 12M13 1L1 13" />
              </svg>
            </button>
            <AvatarCircle :name="selected.name" :color="selected.color" :emoji="selected.emoji"
              :admin="selected.role === 'admin'" :size="76" />
            <p class="font-semibold text-white">{{ selected.name }}</p>
            <PinInput ref="pinInputRef" :error="pinError" :shake="pinShake" :disabled="rateLimited" @complete="submitPin" />
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
            <h2 class="font-semibold text-white">New Profile</h2>
            <input v-model="newName"
              class="w-full px-3 py-2 rounded-xl bg-white/15 border border-white/25 text-white placeholder-white/40 outline-none focus:border-violet-400 text-sm transition-colors"
              placeholder="Name" maxlength="32" />
            <div class="w-full flex flex-col items-center gap-1">
              <p class="text-xs text-white/50">PIN (optional)</p>
              <PinInput @complete="pin => newPin = pin" @incomplete="newPin = ''" />
            </div>
            <p v-if="createError" class="text-xs text-red-400">{{ createError }}</p>
            <button @click="createProfile"
              class="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors cursor-pointer">
              Create
            </button>
          </div>
        </div>
      </Transition>

    </div>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
