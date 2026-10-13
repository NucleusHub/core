<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, useId, useSlots } from 'vue'
import { useI18n } from '../useI18n.js'
import NidCrest from './NidCrest.vue'
import CloseIcon from '@core/assets/icons/close.svg?component'
import './nid.css'

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  size: { type: String, default: 'sm' },
  z: { type: Number, default: 600 },
  crest: { type: Boolean, default: true },
  tall: { type: Boolean, default: false },
  flush: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const slots = useSlots()
const titleId = useId()
const panel = ref(null)
const hasFoot = computed(() => !!slots.footer)

// Dialogs can stack (account → upgrade); only the topmost answers Escape and Tab.
const stack = (window.__nidDialogs ||= [])
const me = Symbol('nid-dialog')
let previous = null

function onKeydown(e) {
  if (stack[stack.length - 1] !== me) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.getClientRects().length)
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (!panel.value.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

onMounted(async () => {
  previous = document.activeElement
  stack.push(me)
  window.addEventListener('keydown', onKeydown, true)
  document.body.style.overflow = 'hidden'
  await nextTick()
  const root = panel.value
  const target = root?.querySelector('[data-autofocus]') || root?.querySelector('input:not([type="hidden"]):not([disabled]), textarea') || root
  target?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  stack.splice(stack.indexOf(me), 1)
  window.removeEventListener('keydown', onKeydown, true)
  if (!stack.length) document.body.style.overflow = ''
  if (previous?.isConnected) previous.focus?.({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <div class="nid nid-dialog" :style="{ zIndex: z }" role="presentation">
      <div class="nid-scrim nid-dialog__scrim" @pointerdown.self.prevent="emit('close')" />
      <div ref="panel" class="nid-panel nid-rise" :class="[`nid-panel--${size}`, { 'nid-panel--tall': tall }]"
        role="dialog" aria-modal="true" tabindex="-1" :aria-labelledby="title ? titleId : undefined">
        <header class="nid-panel__head">
          <slot name="lead">
            <NidCrest v-if="crest" :size="40" />
          </slot>
          <div class="nid-panel__titles">
            <h2 :id="titleId" class="nid-title">{{ title }}</h2>
            <p v-if="subtitle" class="nid-sub">{{ subtitle }}</p>
          </div>
          <button type="button" class="nid-icon-btn nid-panel__close" :aria-label="t('core.button.close')" @click="emit('close')">
            <CloseIcon class="nid-x" />
          </button>
        </header>
        <div class="nid-panel__body" :class="{ 'nid-panel__body--flush': flush }">
          <slot />
        </div>
        <footer v-if="hasFoot" class="nid-panel__foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nid-dialog {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.nid-dialog__scrim { animation: nid-dialog-fade 0.16s ease both; }

@keyframes nid-dialog-fade { from { opacity: 0; } }

.nid-panel {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(88vh, 900px);
  border-radius: 22px;
  outline: none;
  overflow: hidden;
  background: var(--nid-surface);
  -webkit-backdrop-filter: blur(30px) saturate(160%);
  backdrop-filter: blur(30px) saturate(160%);
  box-shadow: var(--nid-shadow);
}

.nid-panel--sm { max-width: 27rem; }
.nid-panel--md { max-width: 32rem; }
.nid-panel--lg { max-width: 46rem; }
.nid-panel--tall { height: min(40rem, 88vh); }

.nid-panel__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
  padding: 20px 20px 18px 22px;
  border-bottom: 1px solid var(--nid-line-soft);
}

.nid-panel__titles { flex: 1; min-width: 0; }
.nid-panel__titles .nid-sub { margin-top: 2px; }
.nid-panel__close { align-self: flex-start; margin: -4px -4px 0 0; }

.nid-panel__body {
  flex: 1;
  min-height: 0;
  padding: 22px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.nid-panel__body--flush { padding: 0; display: flex; overflow: hidden; }

.nid-panel__foot {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px;
  border-top: 1px solid var(--nid-line-soft);
}

/* Phones get a bottom sheet: it meets the thumb instead of floating mid-screen. */
@media (max-width: 560px) {
  .nid-dialog { padding: 10px; align-items: flex-end; }
  .nid-panel { max-height: 92vh; border-radius: 22px; }
  .nid-panel--tall { height: 90vh; }
  .nid-panel__head { padding: 16px 14px 14px 18px; }
  .nid-panel__body { padding: 18px; }
  .nid-panel__body--flush { padding: 0; }
  .nid-panel__foot { padding: 12px 18px; }
  .nid-panel__foot > :deep(*) { flex: 1; }
}
</style>
