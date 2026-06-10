<script setup>
import { ref, reactive, onMounted } from 'vue'

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
        <svg v-if="!visible" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <!-- eye-off -->
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
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
