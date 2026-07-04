<script setup>
import { onMounted } from 'vue'
import { useAuth } from './useAuth.js'
import ProfileSelector from './ProfileSelector.vue'
import MaintenanceBanner from '../MaintenanceBanner.vue'

const { isAuthenticated, checked, checkSession } = useAuth()

onMounted(checkSession)
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
  </template>
  <ProfileSelector v-else />
</template>
