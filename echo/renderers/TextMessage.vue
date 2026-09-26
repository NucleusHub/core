<script setup>
import { computed, inject } from 'vue'
import { linkify } from '../linkify.js'

const props = defineProps({
  payload: { type: Object, required: true },
})

const parts = computed(() => linkify(props.payload.text))

// Sky links are unreadable on the indigo "mine" bubble; use a contrasting blue.
const onAccent = inject('echoOnAccent', null)
const linkClass = computed(() =>
  onAccent?.value
    ? 'echo-accent-link break-all underline decoration-sky-200/60 underline-offset-2 hover:decoration-sky-100'
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

<style scoped>
.echo-accent-link { color: rgb(122, 198, 242); }
:where(.dark) .echo-accent-link { color: #bae6fd; }
</style>
