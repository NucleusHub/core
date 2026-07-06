<script setup>
import { onMounted } from 'vue'
import { useAuth } from './useAuth.js'
import { initI18n } from '../useI18n.js'
import ProfileSelector from './ProfileSelector.vue'
import MaintenanceBanner from '../MaintenanceBanner.vue'
import WhatsNewModal from '../WhatsNewModal.vue'

const { isAuthenticated, checked, checkSession } = useAuth()

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

  <template v-if="!checked">
    <!-- checking session — render nothing to prevent flash of unauthenticated content -->
  </template>
  <template v-else-if="isAuthenticated">
    <slot />
    <!-- What's New changelog — auto-opens on login when there's an unseen
         announcement; also opened from the sidebar launcher. Authenticated only,
         so it can read the viewer's profile.whatsNew state. -->
    <WhatsNewModal />
  </template>
  <ProfileSelector v-else />
</template>
