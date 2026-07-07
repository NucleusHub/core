<script setup>
// Subtle "Made by _only" credit pinned to the bottom-left corner. Mounted once
// from core/auth/AuthGuard.vue so it appears across every app, not just the hub.
</script>

<template>
  <!-- Attribution — subtle, always on top -->
  <div class="fixed bottom-2 left-3 z-[2147483647] pointer-events-none select-none text-[11px] text-slate-400/60 dark:text-white/25">
    Made by <a
      href="https://github.com/OnlyHouska"
      target="_blank"
      rel="noopener noreferrer"
      class="pointer-events-auto text-slate-400/70 dark:text-white/35 hover:text-indigo-500 dark:hover:text-indigo-400 hover:underline transition-colors"
    >_only</a>
  </div>
</template>
