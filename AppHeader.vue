<script setup>
import { useTheme } from './useTheme.js'

const { isDark } = useTheme()
</script>

<template>
  <div class="app-header-wrap">
    <header class="app-header" :class="{ 'is-dark': isDark }">
      <div class="app-header-left"><slot name="left" /></div>
      <div class="app-header-center"><slot /></div>
      <div class="app-header-right">
        <slot name="right" />
      </div>
    </header>
  </div>
</template>

<style scoped>
.app-header-wrap {
  position: sticky;
  top: 0;
  z-index: 30;
  padding: 12px 16px 0;
  pointer-events: none;
}

.app-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 52px;
  padding: 0 14px;
  border-radius: 16px;
  pointer-events: auto;

  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow:
    0 8px 28px rgba(15, 23, 42, 0.13),
    0 2px 6px rgba(15, 23, 42, 0.06),
    0 1px 0 rgba(255, 255, 255, 0.85) inset;
}

.app-header.is-dark {
  background: rgba(45, 28, 78, 0.82);
  backdrop-filter: blur(20px) saturate(1.3);
  border-color: rgba(160, 120, 255, 0.20);
  box-shadow:
    0 4px 32px rgba(0, 0, 0, 0.5),
    0 1px 0 rgba(180, 140, 255, 0.08) inset;
}

.app-header-left   { display: flex; align-items: center; gap: 8px; justify-self: start; }
.app-header-center { display: flex; align-items: center; justify-content: center; gap: 8px; }
.app-header-right  { display: flex; align-items: center; gap: 8px; justify-self: end; }
</style>
