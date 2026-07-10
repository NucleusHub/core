<script setup>
/* ─────────────────────────────────────────────────────────────────────────────
   Ambient delights — the quiet, hidden touches that make Nucleus fun to live in.
   Mounted once from core/auth/AuthGuard.vue, so these run across every app in
   every auth state, with zero per-app wiring.

   Two things live here:
     1. Konami code (↑ ↑ ↓ ↓ ← → ← → B A) → a confetti burst + a glass toast.
     2. Tab-away title tease — when you leave the tab, the browser title turns
        into a little "come back" nudge, and restores the instant you return.

   Both are strictly cosmetic and self-contained: no network, no state, and a
   graceful no-op under prefers-reduced-motion (the confetti engine bows out on
   its own; the toast simply appears without motion).
   ───────────────────────────────────────────────────────────────────────────── */
import { ref, onMounted, onUnmounted } from 'vue'
import { celebrate } from './confetti.js'
import { useI18n } from './useI18n.js'

const { t } = useI18n()

// ── Konami code ──────────────────────────────────────────────────────────────
const SEQUENCE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
]
let progress = 0
const toastVisible = ref(false)
let toastTimer = null

function onKeydown(e) {
  // Ignore while typing in a field — the sequence should never fire mid-compose.
  const el = e.target
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  progress = key === SEQUENCE[progress] ? progress + 1 : (key === SEQUENCE[0] ? 1 : 0)

  if (progress === SEQUENCE.length) {
    progress = 0
    trigger()
  }
}

function trigger() {
  celebrate()
  toastVisible.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastVisible.value = false }, 3400)
}

// ── Tab-away title tease ───────────────────────────────────────────────────────
let originalTitle = ''
let awayIndex = 0

function onVisibility() {
  if (document.hidden) {
    originalTitle = document.title
    const keys = ['core.egg.away1', 'core.egg.away2', 'core.egg.away3']
    document.title = t(keys[awayIndex % keys.length])
    awayIndex++
  } else if (originalTitle) {
    document.title = originalTitle
    originalTitle = ''
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibility)
  clearTimeout(toastTimer)
  // Never leave a teased title behind if this unmounts while hidden.
  if (originalTitle) document.title = originalTitle
})
</script>

<template>
  <Teleport to="body">
    <Transition name="egg-toast">
      <div
        v-if="toastVisible"
        class="egg-toast"
        role="status"
      >
        <span class="egg-toast__spark">✦</span>
        <div class="egg-toast__text">
          <p class="egg-toast__title">{{ t('core.egg.title') }}</p>
          <p class="egg-toast__subtitle">{{ t('core.egg.subtitle') }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.egg-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px 12px 14px;
  border-radius: 16px;
  pointer-events: none;
  color: #0f172a;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 16px 40px -12px rgba(79, 70, 229, 0.45), 0 0 0 1px rgba(99, 102, 241, 0.14);
}
:global(.dark) .egg-toast {
  color: #fff;
  background: rgba(15, 23, 42, 0.85);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 16px 44px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(99, 102, 241, 0.22);
}

.egg-toast__spark {
  font-size: 20px;
  line-height: 1;
  background: linear-gradient(135deg, #6366f1, #a78bfa 55%, #f472b6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: egg-spin 2.4s linear infinite;
}
.egg-toast__title { font-size: 13.5px; font-weight: 700; line-height: 1.2; margin: 0; }
.egg-toast__subtitle { font-size: 12px; line-height: 1.2; margin: 2px 0 0; opacity: 0.6; }

@keyframes egg-spin {
  from { transform: rotate(0deg) scale(1); }
  50%  { transform: rotate(180deg) scale(1.18); }
  to   { transform: rotate(360deg) scale(1); }
}

/* Enter/leave — a soft rise, matching the shared --nuc-ease feel. */
.egg-toast-enter-active { transition: opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1), transform 0.32s cubic-bezier(0.22, 1, 0.36, 1); }
.egg-toast-leave-active { transition: opacity 0.24s ease, transform 0.24s ease; }
.egg-toast-enter-from,
.egg-toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(14px); }

@media (prefers-reduced-motion: reduce) {
  .egg-toast__spark { animation: none; }
  .egg-toast-enter-active,
  .egg-toast-leave-active { transition: opacity 0.2s ease; }
  .egg-toast-enter-from,
  .egg-toast-leave-to { transform: translateX(-50%); }
}
</style>
