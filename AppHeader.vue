<template>
  <header class="app-header sticky top-0 z-30 h-14 px-4
                 bg-white/70 dark:bg-[#0d0d1a]/80
                 backdrop-blur-md
                 border-b border-white/50 dark:border-white/8
                 shadow-sm shadow-indigo-500/5">
    <div class="app-header-left"><slot name="left" /></div>
    <div class="app-header-center"><slot /></div>
    <div class="app-header-right"><slot name="right" /></div>
  </header>
</template>

<style scoped>
.app-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}
.app-header-left  { display: flex; align-items: center; gap: 8px; justify-self: start; }
.app-header-center { display: flex; align-items: center; justify-content: center; gap: 8px; }
.app-header-right { display: flex; align-items: center; gap: 8px; justify-self: end; }
</style>
