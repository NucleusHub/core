<script setup>
import { ref, reactive, onMounted } from 'vue'
import EyeIcon from '@core/assets/icons/eye.svg?component'
import EyeOffIcon from '@core/assets/icons/eye-off.svg?component'
import { useI18n } from '../useI18n.js'
import './nid.css'

defineProps({
  error: { type: String, default: null },
  shake: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['complete', 'incomplete'])
const { t } = useI18n()

const boxes = reactive(['', '', '', ''])
const inputRefs = ref([])
const visible = ref(false)

onMounted(() => inputRefs.value[0]?.focus())

function onInput(i, e) {
  const ch = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(-1)
  boxes[i] = ch
  e.target.value = ch
  if (ch && i < 3) inputRefs.value[i + 1]?.focus()
  if (boxes.every(b => b)) emit('complete', boxes.join(''))
  else emit('incomplete')
}

function onKeydown(i, e) {
  if (e.key === 'Backspace' && !boxes[i] && i > 0) {
    boxes[i - 1] = ''
    inputRefs.value[i - 1]?.focus()
    emit('incomplete')
  }
}

function onPaste(e) {
  e.preventDefault()
  const text = e.clipboardData.getData('text').toUpperCase().replace(/[^0-9A-F]/g, '')
  text.split('').slice(0, 4).forEach((ch, i) => { boxes[i] = ch })
  const next = boxes.findIndex(b => !b)
  inputRefs.value[next === -1 ? 3 : next]?.focus()
  if (boxes.every(b => b)) emit('complete', boxes.join(''))
  else emit('incomplete')
}

function clear() {
  boxes.fill('')
  inputRefs.value[0]?.focus()
}

defineExpose({ clear })
</script>

<template>
  <div class="nid pin">
    <div class="pin__row">
      <div class="pin__boxes" :class="{ shake }">
        <input
          v-for="(_, i) in 4"
          :key="i"
          :ref="el => inputRefs[i] = el"
          :type="visible ? 'text' : 'password'"
          maxlength="1"
          inputmode="text"
          autocomplete="off"
          :aria-label="`PIN ${i + 1}/4`"
          :value="boxes[i]"
          :disabled="disabled"
          class="pin__box"
          :class="{ 'is-filled': !!boxes[i], 'is-invalid': !!error }"
          @input="onInput(i, $event)"
          @keydown="onKeydown(i, $event)"
          @paste="onPaste"
        />
      </div>
      <button type="button" class="nid-icon-btn" @click="visible = !visible"
        :disabled="disabled" :aria-pressed="visible"
        :title="visible ? t('core.profiles.hidePin') : t('core.profiles.showPin')" :aria-label="visible ? t('core.profiles.hidePin') : t('core.profiles.showPin')">
        <EyeIcon v-if="!visible" width="18" height="18" />
        <EyeOffIcon v-else width="18" height="18" />
      </button>
    </div>
    <p class="pin__hint">{{ t('core.profiles.pinChars') }}</p>
    <p v-if="error" class="pin__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.pin { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.pin__row { display: flex; align-items: center; gap: 6px; padding-left: 40px; }
.pin__boxes { display: flex; gap: 10px; }

.pin__box {
  width: 52px;
  height: 60px;
  border: 0;
  border-radius: 14px;
  font: inherit;
  font-size: 1.4rem;
  font-weight: 650;
  text-align: center;
  color: var(--nid-ink-hi);
  caret-color: transparent;
  background: var(--nid-field);
  box-shadow: inset 0 0 0 1px var(--nid-control);
  outline: none;
  transition: box-shadow 0.16s var(--nid-ease-std), background-color 0.16s var(--nid-ease-std);
}

.pin__box:hover:not(:disabled) { box-shadow: inset 0 0 0 1px var(--nid-control-hover); }
.pin__box.is-filled { background: var(--nid-accent-bg); box-shadow: inset 0 0 0 1px var(--nid-accent-line); }
.pin__box:focus { background: var(--nid-field-hover); box-shadow: inset 0 0 0 2px var(--nid-focus), 0 0 0 4px var(--nid-halo); }
.pin__box.is-invalid { box-shadow: inset 0 0 0 1px var(--nid-danger); }
.pin__box:disabled { opacity: 0.45; cursor: not-allowed; }

.pin__hint { margin: 0; font-size: 0.75rem; letter-spacing: 0.02em; color: var(--nid-ink-3); }
.pin__error { margin: 0; font-size: 0.8125rem; text-align: center; color: var(--nid-danger-ink); }
:global(.dark) .pin__error { color: #fda4af; }

@media (max-width: 380px) {
  .pin__row { padding-left: 0; }
  .pin__box { width: 46px; height: 54px; }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-8px); }
  40%       { transform: translateX(8px); }
  60%       { transform: translateX(-5px); }
  80%       { transform: translateX(5px); }
}
.shake { animation: shake 0.35s ease; }
</style>
