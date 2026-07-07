<script setup>
import { ref, computed } from 'vue'
import TemplateModal from '../TemplateModal.vue'
import { useI18n } from '../useI18n.js'
import { useAuth, avatarUrl } from './useAuth.js'
import AvatarCircle from './AvatarCircle.vue'
import PinInput from './PinInput.vue'

// Self-service profile settings, opened from the profile selector for the
// currently signed-in profile. Lets a user rename themselves, recolor their
// avatar and change their PIN (re-proving the current one). Guests have no
// settings — the caller must not open this for a guest.
const props = defineProps({
  profile: { type: Object, required: true },
})
const emit = defineEmits(['close', 'updated'])

const { t } = useI18n()
const { authFetch, checkSession } = useAuth()

// Avatar palette — mirrors auth-server/models/Profile.js COLORS.
const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#06b6d4',
  '#a855f7', '#f43f5e',
]

// ── Name / color / photo ──────────────────────────────────────────────────────
const name = ref(props.profile.name ?? '')
const color = ref(props.profile.color ?? COLORS[0])
const savingProfile = ref(false)
const profileError = ref(null)
const profileSaved = ref(false)

// Avatar photo. `imageData` is a pending, not-yet-saved data URL; `removeImage`
// requests clearing an existing photo. Neither is persisted until Save.
const fileInput = ref(null)
const imageData = ref(null)
const removeImage = ref(false)
const uploadError = ref(null)

const hasImage = computed(() => !!props.profile.hasImage)
// What the preview (and, after save, the avatar) shows right now.
const previewImage = computed(() => {
  if (imageData.value) return imageData.value
  if (removeImage.value) return null
  return avatarUrl(props.profile)
})

const dirty = computed(() =>
  name.value.trim() !== (props.profile.name ?? '') ||
  color.value !== props.profile.color ||
  !!imageData.value || removeImage.value)

// Center-crop an uploaded image to a square and downscale it, so what we store
// (and ship on every avatar request) stays small regardless of the source file.
function fileToSquareDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      let out = canvas.toDataURL('image/webp', 0.85)
      if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.85)
      resolve(out)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    img.src = url
  })
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''   // let the user re-pick the same file
  if (!file) return
  if (!file.type.startsWith('image/')) { uploadError.value = t('core.profiles.invalidImage'); return }
  uploadError.value = null
  try {
    imageData.value = await fileToSquareDataUrl(file)
    removeImage.value = false
  } catch {
    uploadError.value = t('core.profiles.invalidImage')
  }
}

function clearPhoto() {
  imageData.value = null
  uploadError.value = null
  // Only mark for removal if there's actually a saved photo to remove.
  removeImage.value = hasImage.value
}

async function saveProfile() {
  const n = name.value.trim()
  if (!n) { profileError.value = t('core.profiles.nameRequired'); return }
  savingProfile.value = true
  profileError.value = null
  profileSaved.value = false
  try {
    const body = { name: n, color: color.value }
    if (imageData.value) body.image = imageData.value
    else if (removeImage.value) body.image = null
    const res = await authFetch(`/api/auth/profiles/${props.profile._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`)
    imageData.value = null
    removeImage.value = false
    profileSaved.value = true
    await checkSession()   // refresh the shared profile ref (sidebar avatar, etc.)
    emit('updated')
  } catch (e) {
    profileError.value = e.message
  } finally {
    savingProfile.value = false
  }
}

// ── PIN ──────────────────────────────────────────────────────────────────────
const hasPin = computed(() => !!props.profile.hasPin)
const changingPin = ref(false)
const pinStep = ref('current')       // 'current' | 'new' | 'confirm'
const currentPin = ref('')
const firstNewPin = ref('')
const pinError = ref(null)
const savingPin = ref(false)
const pinDone = ref(false)

const pinStepLabel = computed(() => ({
  current: t('core.profiles.enterCurrentPin'),
  new: hasPin.value ? t('core.profiles.chooseNewPin') : t('core.profiles.choosePin'),
  confirm: t('core.profiles.confirmNewPin'),
}[pinStep.value]))

function startPinChange() {
  changingPin.value = true
  pinDone.value = false
  pinError.value = null
  currentPin.value = ''
  firstNewPin.value = ''
  pinStep.value = hasPin.value ? 'current' : 'new'
}

function cancelPinChange() {
  changingPin.value = false
  pinError.value = null
}

async function onPinComplete(pin) {
  pinError.value = null
  if (pinStep.value === 'current') {
    currentPin.value = pin
    pinStep.value = 'new'
    return
  }
  if (pinStep.value === 'new') {
    firstNewPin.value = pin
    pinStep.value = 'confirm'
    return
  }
  // confirm
  if (pin !== firstNewPin.value) {
    firstNewPin.value = ''
    pinStep.value = 'new'
    pinError.value = t('core.profiles.pinsDontMatch')
    return
  }
  await submitPin(pin)
}

// ── What's New (update logs) ───────────────────────────────────────────────
// The auto-open toggle is the inverse of the profile's whatsNew.optOut flag.
const showUpdates = ref(!(props.profile.whatsNew?.optOut))
const savingUpdates = ref(false)

async function toggleUpdates() {
  const next = !showUpdates.value
  showUpdates.value = next
  savingUpdates.value = true
  try {
    const res = await authFetch('/api/auth/whats-new/opt-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optOut: !next }),
    })
    if (!res.ok) throw new Error()
    await checkSession()   // keep the shared profile ref in sync
    emit('updated')
  } catch {
    showUpdates.value = !next   // revert on failure
  } finally {
    savingUpdates.value = false
  }
}

async function submitPin(newPin) {
  savingPin.value = true
  pinError.value = null
  try {
    const body = { pin: newPin }
    if (hasPin.value) body.currentPin = currentPin.value
    const res = await authFetch(`/api/auth/profiles/${props.profile._id}/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`)
    changingPin.value = false
    pinDone.value = true
    emit('updated')
  } catch (e) {
    pinError.value = e.message
    // A wrong current PIN sends us back to the start of the flow.
    if (hasPin.value) { pinStep.value = 'current'; currentPin.value = '' }
    else { pinStep.value = 'new' }
    firstNewPin.value = ''
  } finally {
    savingPin.value = false
  }
}
</script>

<template>
  <TemplateModal :show="true" size="sm" z="z-[600]" @cancel="emit('close')">
    <div class="flex flex-col max-h-[85vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/30 dark:border-white/8 shrink-0">
        <h2 class="text-sm font-semibold text-slate-900 dark:text-white">{{ t('core.profiles.settings') }}</h2>
        <button
          class="cursor-pointer p-1.5 -mr-1 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors"
          :aria-label="t('core.button.close')"
          @click="emit('close')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto min-h-0 px-5 py-5 flex flex-col gap-5">
        <!-- Live avatar preview + photo controls -->
        <div class="flex flex-col items-center gap-3">
          <button type="button"
            class="rounded-full cursor-pointer relative group"
            :title="previewImage ? t('core.profiles.changePhoto') : t('core.profiles.uploadPhoto')"
            @click="fileInput?.click()">
            <AvatarCircle
              :name="name.trim() || profile.name"
              :color="color"
              :emoji="profile.emoji"
              :image="previewImage"
              :admin="profile.role === 'admin'"
              :size="88"
            />
            <span class="absolute inset-0 rounded-full flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
              </svg>
            </span>
          </button>
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange" />
          <div class="flex items-center gap-3">
            <button type="button" class="text-xs font-semibold text-violet-700 dark:text-violet-300 hover:underline cursor-pointer" @click="fileInput?.click()">
              {{ previewImage ? t('core.profiles.changePhoto') : t('core.profiles.uploadPhoto') }}
            </button>
            <button v-if="previewImage" type="button" class="text-xs font-semibold text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white cursor-pointer" @click="clearPhoto">
              {{ t('core.profiles.removePhoto') }}
            </button>
          </div>
          <p v-if="uploadError" class="text-[11px] text-red-500">{{ uploadError }}</p>
        </div>

        <!-- Name -->
        <div>
          <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-1.5">{{ t('core.profiles.name') }}</label>
          <input
            v-model="name"
            type="text"
            maxlength="64"
            class="w-full text-sm rounded-xl border border-slate-300 dark:border-white/15 bg-white/70 dark:bg-white/5 text-slate-900 dark:text-white px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-colors"
            @keydown.enter.prevent="dirty && saveProfile()"
          />
        </div>

        <!-- Color -->
        <div>
          <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-1.5">{{ t('core.profiles.avatarColor') }}</label>
          <div class="grid grid-cols-6 gap-2">
            <button
              v-for="c in COLORS"
              :key="c"
              type="button"
              class="aspect-square rounded-full cursor-pointer transition-transform hover:scale-110"
              :class="color === c ? 'ring-2 ring-offset-2 ring-offset-white/40 dark:ring-offset-transparent ring-slate-900 dark:ring-white' : ''"
              :style="{ background: c }"
              :aria-label="c"
              @click="color = c"
            />
          </div>
        </div>

        <p v-if="profileError" class="text-[11px] text-red-500 -mt-1">{{ profileError }}</p>

        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
            :disabled="savingProfile || !dirty || !name.trim()"
            @click="saveProfile"
          >{{ savingProfile ? t('core.profiles.saving') : t('core.profiles.saveChanges') }}</button>
          <span v-if="profileSaved && !dirty" class="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            {{ t('core.profiles.saved') }}
          </span>
        </div>

        <!-- PIN -->
        <div class="pt-4 border-t border-white/30 dark:border-white/8">
          <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-2">{{ t('core.profiles.pin') }}</label>

          <!-- Idle: status + trigger -->
          <template v-if="!changingPin">
            <p class="text-xs text-slate-500 dark:text-white/50 mb-2">
              <span v-if="pinDone" class="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                {{ t('core.profiles.pinUpdated') }}
              </span>
              <span v-else-if="hasPin">{{ t('core.profiles.pinProtected') }}</span>
              <span v-else>{{ t('core.profiles.noPin') }}</span>
            </p>
            <button
              class="px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-700 dark:text-violet-300 bg-violet-500/15 hover:bg-violet-500/25 cursor-pointer transition-colors"
              @click="startPinChange"
            >{{ hasPin ? t('core.profiles.changePin') : t('core.profiles.setPin') }}</button>
          </template>

          <!-- Active: stepped PIN flow -->
          <div v-else class="flex flex-col items-center gap-3">
            <p class="text-xs text-slate-500 dark:text-white/60 text-center">{{ pinStepLabel }}</p>
            <PinInput :key="pinStep" :error="pinError" :disabled="savingPin" @complete="onPinComplete" />
            <button
              class="flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              @click="cancelPinChange"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              {{ t('core.button.cancel') }}
            </button>
          </div>
        </div>

        <!-- What's New -->
        <div class="pt-4 border-t border-white/30 dark:border-white/8">
          <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-2">{{ t('core.whatsNew.launch') }}</label>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-medium text-slate-700 dark:text-white/70">{{ t('core.whatsNew.showUpdates') }}</p>
              <p class="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{{ t('core.whatsNew.showUpdatesHint') }}</p>
            </div>
            <button
              type="button" role="switch" :aria-checked="showUpdates" :disabled="savingUpdates"
              class="relative shrink-0 w-10 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50"
              :class="showUpdates ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-white/15'"
              @click="toggleUpdates"
            >
              <span
                class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                :class="showUpdates ? 'translate-x-4' : ''"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  </TemplateModal>
</template>
