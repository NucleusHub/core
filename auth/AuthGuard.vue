<script setup>
import { onMounted, computed } from 'vue'
import { useAuth } from './useAuth.js'
import { useRegistry } from '../useRegistry.js'
import { initI18n } from '../useI18n.js'
import ProfileSelector from './ProfileSelector.vue'
import MaintenanceBanner from '../MaintenanceBanner.vue'
import WhatsNewModal from '../../plugins/whats-new/client/WhatsNewModal.vue'
import MadeByAttribution from '../MadeByAttribution.vue'
import EasterEggs from '../EasterEggs.vue'
import WidgetOverlayHost from '@widgets-core/components/WidgetOverlayHost.vue'

const { isAuthenticated, checked, checkSession, profile } = useAuth()
const { allApps, disabledAppIds, loading: registryLoading, isPluginEnabled } = useRegistry()

// The What's New modal is owned by the whats-new plugin; only mount it once the
// registry (with the disabled-plugin set) has loaded and the plugin is enabled,
// so disabling it in Admin actually stops the modal (no auto-open) — not just its
// admin tab. Gating on load avoids a flash-mount before overrides arrive.
const whatsNewEnabled = computed(() => !registryLoading.value && isPluginEnabled('whats-new'))

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
  <!-- Shown across every app (regardless of auth state) whenever the platform
       is being updated — see core/MaintenanceBanner.vue. -->
  <MaintenanceBanner />

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
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" />
        </svg>
        <h1>{{ currentApp?.name || 'This app' }} isn’t available</h1>
        <p>It’s been turned off for your account. Contact an administrator if you think this is a mistake.</p>
        <a href="/">← Back to Nucleus</a>
      </div>
    </div>
    <template v-else>
      <slot />
      <!-- What's New changelog — auto-opens on login when there's an unseen
           announcement; also opened from the sidebar launcher. Authenticated only,
           so it can read the viewer's profile.whatsNew state. -->
      <WhatsNewModal v-if="whatsNewEnabled" />
      <!-- Pulse widgets the user opted to float inside this app. Rendered here
           (the one component every app already wraps in) so apps never import
           widget code themselves. No-op on the hub (its own dashboard renders
           widgets) and whenever Pulse isn't installed. See @widgets-core. -->
      <WidgetOverlayHost />
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
