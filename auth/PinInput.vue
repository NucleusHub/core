<script setup>
import { ref, reactive, onMounted } from 'vue'
import EyeIcon from '@core/assets/icons/eye.svg?component'
import EyeOffIcon from '@core/assets/icons/eye-off.svg?component'

defineProps({
  error: { type: String, default: null },
  shake: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['complete', 'incomplete'])

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
  <div class="flex flex-col items-center gap-2.5">
    <div class="flex items-center gap-2">
      <div class="flex gap-2.5" :class="{ shake }">
        <input
          v-for="(_, i) in 4"
          :key="i"
          :ref="el => inputRefs[i] = el"
          :type="visible ? 'text' : 'password'"
          maxlength="1"
          inputmode="text"
          autocomplete="off"
          :value="boxes[i]"
          :disabled="disabled"
          class="w-12 h-14 rounded-xl border border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-slate-900 dark:text-white text-xl font-bold text-center outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-colors caret-transparent disabled:opacity-40 disabled:cursor-not-allowed"
          @input="onInput(i, $event)"
          @keydown="onKeydown(i, $event)"
          @paste="onPaste"
        />
      </div>
      <button type="button" @click="visible = !visible"
        :disabled="disabled"
        class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        :title="visible ? 'Hide PIN' : 'Show PIN'">
        <!-- eye -->
        <EyeIcon v-if="!visible" width="18" height="18" />
        <!-- eye-off -->
        <EyeOffIcon v-else width="18" height="18" />
      </button>
    </div>
    <p class="text-xs text-slate-400 dark:text-slate-500 tracking-wide">0 – 9 and A – F</p>
    <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
  </div>
</template>

<style scoped>
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-8px); }
  40%       { transform: translateX(8px); }
  60%       { transform: translateX(-5px); }
  80%       { transform: translateX(5px); }
}
.shake { animation: shake 0.35s ease; }
</style>
