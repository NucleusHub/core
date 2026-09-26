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

onMounted(() => {
  checkSession()
  initI18n()
})
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
