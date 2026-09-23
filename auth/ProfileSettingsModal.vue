<script setup>
import { ref, computed, onMounted } from 'vue'
import TemplateModal from '../TemplateModal.vue'
import AppTabs from '../AppTabs.vue'
import { useI18n } from '../useI18n.js'
import { useRegistry } from '../useRegistry.js'
import { usePlugins } from '../usePlugins.js'
import { useAuth, avatarUrl } from './useAuth.js'
import { corePreferences } from '../usePluginExtensions.js'
import AvatarCircle from './AvatarCircle.vue'
import PinInput from './PinInput.vue'
import { Icon } from '../icons'
import GiftIcon from '@core/assets/icons/gift.svg?component'
import ArrowLeftIcon from '@core/assets/icons/arrow-left.svg?component'

// Self-service profile settings, opened from the profile selector for the
// currently signed-in profile. A tabbed panel: Profile (name/color/photo),
// Security (PIN), and Plugins (turn optional non-core plugins on/off for this
// account + plugin preferences). Guests have no settings — the caller must not
// open this for a guest.
const props = defineProps({
  profile: { type: Object, required: true },
})
const emit = defineEmits(['close', 'updated'])

const { t } = useI18n()
const { isPluginEnabled, refresh: refreshRegistry } = useRegistry()
const { authFetch, checkSession } = useAuth()

// ── Tabs ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'profile',  label: 'core.profiles.tabProfile',  icon: 'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0' },
  { id: 'security', label: 'core.profiles.tabSecurity', icon: 'M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z' },
  { id: 'plugins',  label: 'core.profiles.tabPlugins',  icon: 'M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.4 48.4 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.036 1.007-1.875 2.25-1.875s2.25.84 2.25 1.875c0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.676.32-3.4.475-5.157.475a.64.64 0 0 1-.657-.643Z' },
]
const tab = ref('profile')
// The shared tab bar takes { key, label, icon }; our tabs carry i18n keys.
const tabItems = computed(() => TABS.map(tb => ({ key: tb.id, label: t(tb.label), icon: tb.icon })))

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

// ── Plugins (self-service, non-core only) ────────────────────────────────────
// Users toggle their OWN optional (non-core) plugins. Core plugins are
// admin-managed and never listed here. A plugin an admin/group turned off shows
// as locked. See /api/auth/me/overrides/plugin/:id + /me/plugin-overrides.
const { plugins, load: loadPluginList } = usePlugins()
const userDisabled = ref(new Set())   // ids this user turned off
const locked = ref(new Set())         // ids an admin/group turned off (not re-enablable)
const pluginError = ref(null)
const pluginBusy = ref(null)          // id currently in-flight
const pluginsLoaded = ref(false)

// Non-core = the plugin's target doesn't include 'core'. Only well-formed
// (discovered) plugins are offered.
const nonCorePlugins = computed(() => plugins.value.filter(p =>
  p.state === 'discovered' && Array.isArray(p.target) && !p.target.includes('core')))

const isLocked = (p) => locked.value.has(p.id)
const isPluginOn = (p) => !locked.value.has(p.id) && !userDisabled.value.has(p.id)

async function loadPlugins() {
  try {
    await Promise.all([
      loadPluginList(),
      authFetch('/api/auth/me/plugin-overrides').then(async r => {
        if (!r.ok) return
        const d = await r.json()
        userDisabled.value = new Set(d.userDisabled || [])
        locked.value = new Set(d.locked || [])
      }),
    ])
  } catch { /* leave empty; the tab shows the empty state */ }
  finally { pluginsLoaded.value = true }
}
onMounted(loadPlugins)

async function togglePlugin(p) {
  if (isLocked(p) || pluginBusy.value) return
  const disable = isPluginOn(p) // currently on → turn off
  pluginBusy.value = p.id
  pluginError.value = null
  try {
    const res = await authFetch(`/api/auth/me/overrides/plugin/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: disable }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    const next = new Set(userDisabled.value)
    disable ? next.add(p.id) : next.delete(p.id)
    userDisabled.value = next
    await refreshRegistry()   // plugin-owned UI reacts live (isPluginEnabled)
  } catch (e) {
    pluginError.value = e.message
  } finally {
    pluginBusy.value = null
  }
}

// ── Plugin preferences ────────────────────────────────────────────────────────
// Contributed by enabled plugins through the core extension point (e.g. the
// What's New auto-open toggle) — see core/usePluginExtensions.js. The block is
// shown only when at least one applies.
const pluginPreferences = computed(() => corePreferences.filter(p => isPluginEnabled(p.pluginId)))
</script>

<template>
  <TemplateModal :show="true" size="lg" z="z-[600]" @cancel="emit('close')">
    <!-- Own, less-transparent surface over the template's glass panel. Fixed
         height so the modal doesn't resize when switching tabs — each tab's body
         scrolls within it. Capped to 85vh on short screens. -->
    <div class="flex flex-col h-[min(36rem,85vh)] bg-white/95 dark:bg-slate-900/95">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 sm:px-6 pt-5 pb-4 border-b border-black/[0.06] dark:border-white/10 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <AvatarCircle
            :name="name.trim() || profile.name"
            :color="color"
            :emoji="profile.emoji"
            :image="previewImage"
            :admin="profile.role === 'admin'"
            :size="34"
          />
          <h2 class="text-sm font-semibold text-slate-900 dark:text-white truncate">{{ t('core.profiles.settings') }}</h2>
        </div>
        <button
          class="cursor-pointer p-1.5 -mr-1 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"
          :aria-label="t('core.button.close')"
          @click="emit('close')"
        >
          <Icon name="close" class="w-4 h-4" :sw="2.5" />
        </button>
      </div>

      <!-- Tabs + content: rail on desktop, scrollable row on mobile -->
      <div class="flex-1 min-h-0 flex flex-col sm:flex-row">
        <AppTabs
          v-model="tab"
          variant="rail"
          :tabs="tabItems"
          class="shrink-0 sm:w-48 px-3 py-3 overflow-x-auto border-b sm:border-b-0 sm:border-r border-black/[0.06] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]"
        />

        <div class="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5">
          <!-- ── Profile ─────────────────────────────────────────────────── -->
          <section v-show="tab === 'profile'" class="flex flex-col gap-5">
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
                  <GiftIcon class="w-6 h-6 text-white" />
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
              <div class="grid grid-cols-6 gap-2 max-w-xs">
                <button
                  v-for="c in COLORS"
                  :key="c"
                  type="button"
                  class="aspect-square rounded-full cursor-pointer transition-transform hover:scale-110"
                  :class="color === c ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 ring-slate-900 dark:ring-white' : ''"
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
                <Icon name="check" class="w-3.5 h-3.5" :sw="2.5" />
                {{ t('core.profiles.saved') }}
              </span>
            </div>
          </section>

          <!-- ── Security (PIN) ──────────────────────────────────────────── -->
          <section v-show="tab === 'security'">
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-2">{{ t('core.profiles.pin') }}</label>

            <!-- Idle: status + trigger -->
            <template v-if="!changingPin">
              <p class="text-xs text-slate-500 dark:text-white/50 mb-2">
                <span v-if="pinDone" class="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                  <Icon name="check" class="w-3.5 h-3.5" :sw="2.5" />
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
            <div v-else class="flex flex-col items-center gap-3 py-2">
              <p class="text-xs text-slate-500 dark:text-white/60 text-center">{{ pinStepLabel }}</p>
              <PinInput :key="pinStep" :error="pinError" :disabled="savingPin" @complete="onPinComplete" />
              <button
                class="flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                @click="cancelPinChange"
              >
                <ArrowLeftIcon width="13" height="13" />
                {{ t('core.button.cancel') }}
              </button>
            </div>
          </section>

          <!-- ── Plugins ─────────────────────────────────────────────────── -->
          <section v-show="tab === 'plugins'" class="flex flex-col gap-5">
            <div>
              <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-1">{{ t('core.profiles.pluginsTitle') }}</label>
              <p class="text-[11px] text-slate-400 dark:text-white/40">{{ t('core.profiles.pluginsHint') }}</p>
            </div>

            <p v-if="pluginError" class="text-[11px] text-red-500">{{ pluginError }}</p>

            <p v-if="pluginsLoaded && !nonCorePlugins.length" class="text-xs text-slate-400 dark:text-white/35 py-2">
              {{ t('core.profiles.pluginsEmpty') }}
            </p>

            <ul v-else class="flex flex-col divide-y divide-slate-200/60 dark:divide-white/8">
              <li v-for="p in nonCorePlugins" :key="p.id" class="flex items-center gap-3 py-3">
                <span
                  class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-black/5 dark:bg-white/8 text-slate-600 dark:text-white/70 [&_svg]:w-5 [&_svg]:h-5"
                  v-html="p.iconSvg || ''"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-slate-900 dark:text-white truncate">{{ p.name }}</p>
                  <p v-if="p.description" class="text-[11px] text-slate-400 dark:text-white/40 truncate">{{ p.description }}</p>
                  <p v-if="isLocked(p)" class="text-[11px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">{{ t('core.profiles.pluginLocked') }}</p>
                </div>
                <button
                  type="button" role="switch" :aria-checked="isPluginOn(p)"
                  :disabled="isLocked(p) || pluginBusy === p.id"
                  class="relative shrink-0 w-10 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="isPluginOn(p) ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-white/15'"
                  @click="togglePlugin(p)"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                    :class="isPluginOn(p) ? 'translate-x-4' : ''"
                  />
                </button>
              </li>
            </ul>

            <!-- Plugin preferences (e.g. What's New auto-open) -->
            <div v-if="pluginPreferences.length" class="pt-4 border-t border-black/[0.06] dark:border-white/10 space-y-3">
              <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/35 mb-2">{{ t('core.profiles.pluginPreferences') }}</label>
              <component :is="p.component" v-for="(p, i) in pluginPreferences" :key="p.pluginId + i" :profile="profile" @updated="emit('updated')" />
            </div>
          </section>
        </div>
      </div>
    </div>
  </TemplateModal>
</template>
