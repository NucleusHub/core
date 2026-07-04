<script setup>
import { ref, watch, onUnmounted, computed } from 'vue'
import logoDark from './assets/nucleus-logo-transparent.png'
import logoLight from './assets/nucleus-logo-light-1.png'
import { useRegistry } from './useRegistry.js'
import { useTheme } from './useTheme.js'
import { useI18n } from './useI18n.js'
import { useAuth } from './auth/useAuth.js'
import AvatarCircle from './auth/AvatarCircle.vue'
import ProfileSelector from './auth/ProfileSelector.vue'
import AppIcon from './AppIcon.vue'

const { apps } = useRegistry()
const { t } = useI18n()
const NAV_ITEMS = computed(() =>
  apps.value
    .filter(a => a.hub?.showInSidebar !== false)
    .map(a => ({ label: a.name, to: a.route + '/', description: a.description, iconSvg: a.iconSvg }))
)

const isAdmin = computed(() => profile.value?.role === 'admin')

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

function isActive(path) {
  if (path === '/') return window.location.pathname === '/'
  return window.location.pathname.startsWith(path)
}

function onKeydown(e) { if (e.key === 'Escape') emit('close') }
watch(() => props.open, (val) => {
  val ? window.addEventListener('keydown', onKeydown) : window.removeEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const THEMES = [
  { key: 'light',  label: 'Light',  icon: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0z' },
  { key: 'system', label: 'System', icon: 'M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0H3' },
  { key: 'dark',   label: 'Dark',   icon: 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998z' },
]

const { theme, isDark, setTheme } = useTheme()
const logoUrl = computed(() => isDark.value ? logoDark : logoLight)

const { profile } = useAuth()
const showSwitch = ref(false)

function openSwitch() {
  emit('close')
  showSwitch.value = true
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex"
      :class="open ? 'pointer-events-auto' : 'pointer-events-none'"
    >
      <!-- Sidebar panel -->
      <div
        class="w-60 backdrop-blur-xl bg-white/80 dark:bg-slate-900/85 border-r border-white/50 dark:border-white/10 flex flex-col shadow-2xl shadow-indigo-500/10 dark:shadow-black/40 shrink-0 transition-transform duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="open ? 'translate-x-0' : '-translate-x-full'"
      >
        <div class="flex items-center justify-between px-5 py-4 border-b border-white/40 dark:border-white/8">
          <a
            href="/"
            @click="emit('close')"
            class="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <img :src="logoUrl" alt="" class="w-6 h-6 object-contain" />
            Nucleus
          </a>
          <button
            @click="emit('close')"
            class="cursor-pointer p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav class="flex-1 p-3 flex flex-col gap-1">
          <a
            v-for="item in NAV_ITEMS"
            :key="item.to"
            :href="item.to"
            @click="emit('close')"
            class="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/8 transition-colors"
            :class="isActive(item.to) ? 'bg-white/60 dark:bg-white/8 text-slate-900 dark:text-white' : ''"
          >
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
              :class="isActive(item.to) ? 'bg-indigo-600' : 'bg-black/5 dark:bg-white/8 group-hover:bg-black/8 dark:group-hover:bg-white/15'"
            >
              <AppIcon :svg="item.iconSvg" class="w-4 h-4" />
            </div>
            <div>
              <p class="text-sm font-medium leading-tight">{{ item.label }}</p>
              <p class="text-xs text-slate-400 dark:text-slate-500 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors">{{ item.description }}</p>
            </div>
          </a>
        </nav>

        <!-- Account / switch -->
        <div v-if="profile" class="px-3 pt-3 pb-1 border-t border-white/40 dark:border-white/8">
          <button @click="openSwitch"
            class="cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/8 transition-colors">
            <AvatarCircle :name="profile.name" :color="profile.color" :emoji="profile.emoji"
              :admin="profile.role === 'admin'" :size="32" />
            <div class="flex-1 text-left min-w-0">
              <p class="text-sm font-medium leading-tight truncate">{{ profile.name }}</p>
              <p class="text-xs text-slate-400 dark:text-slate-500">{{ t('core.sidebar.switchAccount') }}</p>
            </div>
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </button>
        </div>

        <div v-if="isAdmin" class="sidebar-footer">
          <a class="admin-btn" :class="{ 'theme-light': !isDark }" href="/admin/">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L3 6v6c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V6l-9-4z" />
            </svg>
            {{ t('core.sidebar.adminConsole') }}
          </a>
        </div>

        <!-- Theme switcher -->
        <div class="px-3 py-3 border-t border-white/40 dark:border-white/8">
          <div class="flex bg-black/5 dark:bg-white/8 rounded-lg p-0.5 gap-0.5">
            <button
              v-for="themeOpt in THEMES"
              :key="themeOpt.key"
              @click="setTheme(themeOpt.key)"
              :title="t(`core.theme.${themeOpt.key}`)"
              :class="['cursor-pointer flex-1 flex items-center justify-center py-1.5 rounded-md transition-colors',
                theme === themeOpt.key
                  ? 'bg-white/80 dark:bg-white/20 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-white']"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" :d="themeOpt.icon" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Backdrop -->
      <div
        class="flex-1 bg-black/50 backdrop-blur-sm cursor-pointer transition-opacity duration-[220ms]"
        :class="open ? 'opacity-100' : 'opacity-0'"
        @click="emit('close')"
      />
    </div>
  </Teleport>

  <ProfileSelector v-if="showSwitch" :closeable="true" @close="showSwitch = false" />
</template>

<style scoped>
.admin-btn {
  width: 95%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.13s, border-color 0.13s, color 0.13s;

  margin: 10px auto;

  /* Dark (default) */
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.admin-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

/* Light mode (theme-light class set from useTheme) */
.admin-btn.theme-light {
  color: rgba(30, 41, 59, 0.8);
  background: rgba(15, 23, 42, 0.05);
  border-color: rgba(15, 23, 42, 0.12);
}

.admin-btn.theme-light:hover {
  background: rgba(15, 23, 42, 0.09);
  border-color: rgba(15, 23, 42, 0.2);
  color: #0f172a;
}
</style>
