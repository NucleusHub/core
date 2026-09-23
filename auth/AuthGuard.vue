<script setup>
import { onMounted, computed, defineAsyncComponent } from 'vue'
import { useAuth } from './useAuth.js'
import { useRegistry } from '../useRegistry.js'
import { initI18n } from '../useI18n.js'
import ProfileSelector from './ProfileSelector.vue'
import { coreMounts } from '../usePluginExtensions.js'
import MadeByAttribution from '../MadeByAttribution.vue'
import EasterEggs from '../EasterEggs.vue'
import SlashIcon from '@core/assets/icons/slash.svg?component'

const { isAuthenticated, checked, checkSession, profile } = useAuth()
const { allApps, disabledAppIds, loading: registryLoading, isPluginEnabled } = useRegistry()

// Plugin-owned chrome (maintenance banner, What's New modal, …) comes in through
// the core extension point — see core/usePluginExtensions.js. Only mount once
// the registry (with the disabled-plugin set) has loaded and the plugin is
// enabled, so disabling it in Admin actually stops it (no auto-open) — not just
// its admin tab. Gating on load avoids a flash-mount before overrides arrive.
const enabledMounts = computed(() =>
  registryLoading.value ? [] : coreMounts.filter(m => isPluginEnabled(m.pluginId)),
)
const publicMounts = computed(() => enabledMounts.value.filter(m => !m.auth))
const authMounts = computed(() => enabledMounts.value.filter(m => m.auth))

// The cross-app widget overlay belongs to the optional widget package. Globbed
// (not imported) so apps still build and run when /widgets isn't installed.
const overlayHostLoader = Object.values(import.meta.glob('@widgets-core/components/WidgetOverlayHost.vue'))[0]
const WidgetOverlayHost = overlayHostLoader ? defineAsyncComponent(overlayHostLoader) : null

// Which app is this bundle? Match the Vite base path against each app's route
// (base '/goals' → the app whose route is '/goals', id 'goal-calendar'). The hub
// (base '/') is never an app and never blocked.
const basePath = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') || '/'
const currentApp = computed(() =>
  basePath === '/' ? null : allApps.value.find(a => (a.route || '').replace(/\/+$/, '') === basePath) || null,
)

// Block the whole app when it's been disabled for this user (admin override).
// Admins bypass — they manage the toggles and must still reach every app. The
// app servers enforce the same rule, so this is the friendly UX layer, not the
// security boundary.
const appBlocked = computed(() =>
  !!currentApp.value &&
  disabledAppIds.value.has(currentApp.value.id) &&
  profile.value?.role !== 'admin',
)

onMounted(() => {
  checkSession()
  // Start localization once, from the one component every app wraps in — the
  // app scope is derived from the bundle's base path. See core/useI18n.js.
  initI18n()
})
</script>

<template>
  <!-- Plugin mounts shown across every app regardless of auth state (e.g. the
       maintenance banner). Hidden when the owning plugin is disabled. -->
  <component :is="m.component" v-for="m in publicMounts" :key="m.pluginId" />

  <!-- "Made by _only" credit — shown across every app, in every auth state. -->
  <MadeByAttribution />

  <!-- Ambient delights (Konami code, tab-away title tease) — hosted once here so
       they run across every app in every auth state. See core/EasterEggs.vue. -->
  <EasterEggs />

  <template v-if="!checked">
    <!-- checking session — render nothing to prevent flash of unauthenticated content -->
  </template>
  <template v-else-if="isAuthenticated">
    <!-- This app has been turned off for the current user (admin override). The
         app server refuses its API too; this is the friendly stand-in for the
         otherwise-broken SPA. -->
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
      <!-- Plugin mounts for signed-in viewers (e.g. the What's New changelog,
           which reads the viewer's profile.whatsNew state). -->
      <component :is="m.component" v-for="m in authMounts" :key="m.pluginId" />
      <!-- Pulse widgets the user opted to float inside this app. Rendered here
           (the one component every app already wraps in) so apps never import
           widget code themselves. No-op on the hub (its own dashboard renders
           widgets) and whenever Pulse or the widget package isn't installed.
           See @widgets-core. -->
      <WidgetOverlayHost v-if="WidgetOverlayHost" />
    </template>
  </template>
  <ProfileSelector v-else />
</template>

<style scoped>
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
