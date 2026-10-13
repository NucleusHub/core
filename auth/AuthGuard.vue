<script setup>
import { ref, watch, onMounted, onUnmounted, computed, defineAsyncComponent, getCurrentInstance } from 'vue'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import { useRegistry } from '../useRegistry.js'
import { initI18n, useI18n } from '../useI18n.js'
import { ssoError } from './nidErrors.js'
import ProfileSelector from './ProfileSelector.vue'
import ServerKeyGate from './ServerKeyGate.vue'
import NidLinkDialog from './NidLinkDialog.vue'
import AccountModal from './AccountModal.vue'
import NidUpgradeDialog from './NidUpgradeDialog.vue'
import { coreMounts } from '../usePluginExtensions.js'
import MadeByAttribution from '../MadeByAttribution.vue'
import EasterEggs from '../EasterEggs.vue'
import SlashIcon from '@core/assets/icons/slash.svg?component'

const { isAuthenticated, checked, checkSession, profile, account, accountPanel, openAccountPanel } = useAuth()
const { serverCode, loaded: authSettingsLoaded, ensureLoaded: loadAuthSettings, refresh: refreshAuthSettings } = useAuthSettings()
const { t } = useI18n()
const { allApps, disabledAppIds, loading: registryLoading, isPluginEnabled } = useRegistry()

// Wait for the registry so disabled plugins never flash-mount before overrides arrive.
const enabledMounts = computed(() =>
  registryLoading.value ? [] : coreMounts.filter(m => isPluginEnabled(m.pluginId)),
)
const publicMounts = computed(() => enabledMounts.value.filter(m => !m.auth))
const authMounts = computed(() => enabledMounts.value.filter(m => m.auth))

// Globbed, not imported, so apps still build without /widgets installed.
const overlayHostLoader = Object.values(import.meta.glob('@widgets-core/components/WidgetOverlayHost.vue'))[0]
const WidgetOverlayHost = overlayHostLoader ? defineAsyncComponent(overlayHostLoader) : null

const basePath = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') || '/'
const currentApp = computed(() =>
  basePath === '/' ? null : allApps.value.find(a => (a.route || '').replace(/\/+$/, '') === basePath) || null,
)

// UX layer only; app servers enforce the same rule.
const appBlocked = computed(() =>
  !!currentApp.value &&
  disabledAppIds.value.has(currentApp.value.id) &&
  profile.value?.role !== 'admin',
)

const needsServerKey = computed(() => serverCode.value.required && !serverCode.value.passed)

const linkToken = ref(null)
const ssoErrorCode = ref(null)
const pendingAccountTab = ref(null)
const nidSignIn = ref(false)
const toast = ref(null)
let toastTimer = null

function showToast(next) {
  toast.value = next
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 5000)
}

const toastText = computed(() => {
  if (!toast.value) return ''
  if (toast.value.kind === 'sso') return ssoError(t, toast.value.code)
  return t(toast.value.kind === 'welcome' ? 'core.account.toastWelcome' : 'core.account.toastLinked')
})
const ssoNotice = computed(() => ssoErrorCode.value ? ssoError(t, ssoErrorCode.value) : null)

const appGlobals = getCurrentInstance()?.appContext.config.globalProperties

// With vue-router the URL must change through it: its initial navigation would restore a bare replaceState.
function replaceUrl(url, toHome) {
  const router = appGlobals?.$router
  if (router) {
    router.isReady().then(() => router.replace(toHome ? '/' : { query: Object.fromEntries(url.searchParams), hash: url.hash }))
    return
  }
  const q = url.searchParams.toString()
  window.history.replaceState(window.history.state, '', toHome ? '/' : url.pathname + (q ? `?${q}` : '') + url.hash)
}

// Mail and iOS links land here cold; consume their params once, then clean the URL.
function readUrlActions() {
  const url = new URL(window.location.href)
  const q = url.searchParams
  const keys = ['verify', 'reset', 'sso_error', 'account']
  const had = keys.some(k => q.has(k))
  if (q.get('verify')) linkToken.value = { kind: 'verify', token: q.get('verify') }
  else if (q.get('reset')) linkToken.value = { kind: 'reset', token: q.get('reset') }
  ssoErrorCode.value = q.get('sso_error')
  const acct = q.get('account')
  if (acct === 'welcome' || acct === 'linked') showToast({ kind: acct })
  if (acct === 'manage') {
    pendingAccountTab.value = q.get('tab') || 'profile'
    q.delete('tab')
  }
  keys.forEach(k => q.delete(k))
  const deletePath = url.pathname.replace(/\/+$/, '') === '/account/delete'
  if (deletePath) pendingAccountTab.value = 'delete'
  if (deletePath || had) replaceUrl(url, deletePath)
}

// SSO errors on a live session (failed link) are a toast, not a login notice.
watch(checked, (ok) => {
  if (ok && isAuthenticated.value && ssoErrorCode.value) {
    showToast({ kind: 'sso', code: ssoErrorCode.value })
    ssoErrorCode.value = null
  }
})

watch([checked, isAuthenticated], ([ok, authed]) => {
  if (!ok || !authed || !pendingAccountTab.value) return
  if (account.value) openAccountPanel('manage', pendingAccountTab.value)
  else nidSignIn.value = true
  pendingAccountTab.value = null
})

// A pass cookie may be missing once the session that vouched for us is gone.
watch(isAuthenticated, (now, before) => {
  if (before && !now) refreshAuthSettings()
})

function openNidSignIn() {
  openAccountPanel(null)
  nidSignIn.value = true
}

onMounted(() => {
  readUrlActions()
  checkSession()
  loadAuthSettings()
  initI18n()
})
onUnmounted(() => clearTimeout(toastTimer))
</script>

<template>
  <component :is="m.component" v-for="m in publicMounts" :key="m.pluginId" />

  <MadeByAttribution />

  <EasterEggs />

  <template v-if="!checked"></template>
  <template v-else-if="isAuthenticated">
    <div v-if="appBlocked" class="nucleus-app-blocked">
      <div class="nucleus-app-blocked__card">
        <SlashIcon width="40" height="40" />
        <h1>{{ currentApp?.name || 'This app' }} isn’t available</h1>
        <p>It’s been turned off for your account. Contact an administrator if you think this is a mistake.</p>
        <a href="/">← Back to Nucleus</a>
      </div>
    </div>
    <template v-else>
      <slot />
      <component :is="m.component" v-for="m in authMounts" :key="m.pluginId" />
      <WidgetOverlayHost v-if="WidgetOverlayHost" />
    </template>
    <AccountModal v-if="accountPanel?.kind === 'manage'" :initial-tab="accountPanel.tab"
      @close="openAccountPanel(null)" @nid-signin="openNidSignIn" />
    <NidUpgradeDialog v-if="accountPanel?.kind === 'upgrade'" @close="openAccountPanel(null)" />
    <ProfileSelector v-if="nidSignIn" :closeable="true" initial-view="nid" @close="nidSignIn = false" />
  </template>
  <template v-else-if="!authSettingsLoaded"></template>
  <ServerKeyGate v-else-if="needsServerKey" />
  <ProfileSelector v-else :notice="ssoNotice" />

  <NidLinkDialog v-if="linkToken && checked && (isAuthenticated || (authSettingsLoaded && !needsServerKey))"
    :kind="linkToken.kind" :token="linkToken.token" @close="linkToken = null" />

  <Transition name="nucleus-toast">
    <div v-if="toast" class="nucleus-toast" :class="{ 'nucleus-toast--error': toast.kind === 'sso' }" role="status">{{ toastText }}</div>
  </Transition>
</template>

<style scoped>
.nucleus-toast {
  position: fixed;
  left: 50%;
  bottom: 1.5rem;
  transform: translateX(-50%);
  z-index: 800;
  max-width: calc(100vw - 2rem);
  padding: 0.6rem 1rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #fff;
  background: rgba(22, 163, 74, 0.92);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}
.nucleus-toast--error { background: rgba(220, 38, 38, 0.92); }
.nucleus-toast-enter-active, .nucleus-toast-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.nucleus-toast-enter-from, .nucleus-toast-leave-to { opacity: 0; transform: translate(-50%, 0.5rem); }
.nucleus-app-blocked {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: #0b1020;
  color: #e2e8f0;
}
.nucleus-app-blocked__card {
  max-width: 26rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
.nucleus-app-blocked__card svg { color: #f59e0b; opacity: 0.9; }
.nucleus-app-blocked__card h1 { font-size: 1.15rem; font-weight: 700; margin: 0; }
.nucleus-app-blocked__card p { font-size: 0.9rem; line-height: 1.5; color: #94a3b8; margin: 0; }
.nucleus-app-blocked__card a {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: #818cf8;
  text-decoration: none;
}
.nucleus-app-blocked__card a:hover { text-decoration: underline; }
</style>
