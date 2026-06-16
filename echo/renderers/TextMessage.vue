<script setup>
import { computed, inject } from 'vue'
import { linkify } from '../linkify.js'

// Built-in renderer for plain text messages. payload = { text }. URLs in the
// text are auto-detected and rendered as new-tab links.
const props = defineProps({
  payload: { type: Object, required: true },
})

const parts = computed(() => linkify(props.payload.text))

// On the indigo "mine" bubble (white text), sky links are invisible — use a
// light blue that contrasts. Off the accent, use the theme-aware sky pair.
const onAccent = inject('echoOnAccent', null)
const linkClass = computed(() =>
  onAccent?.value
    ? 'break-all text-sky-200 underline decoration-sky-200/60 underline-offset-2 hover:decoration-sky-100'
    : 'break-all text-sky-500 underline decoration-sky-500/40 underline-offset-2 hover:decoration-sky-500 dark:text-sky-300 dark:decoration-sky-300/40 dark:hover:decoration-sky-300'
)
</script>

<template>
  <p class="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed"><template
    v-for="(p, i) in parts"
    :key="i"
  ><a
    v-if="p.href"
    :href="p.href"
    target="_blank"
    rel="noopener noreferrer"
    :class="linkClass"
  >{{ p.text }}</a><template v-else>{{ p.text }}</template></template></p>
</template>
