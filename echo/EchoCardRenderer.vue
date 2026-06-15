<script setup>
import { computed } from 'vue'
import { resolveRenderer } from './renderers/index.js'

// The deterministic rendering pipeline. Given a message and the unified registry
// snapshot, it resolves exactly one core component for the message's type and
// renders it with a uniform prop contract ({ type, payload, message }). It never
// mounts app-supplied components and never throws — unknown types degrade to the
// UnknownMessage fallback. This is the ONLY place a message turns into UI.
const props = defineProps({
  message: { type: Object, required: true },
  registry: { type: Object, default: () => ({ messageTypes: {} }) },
})

const component = computed(() => resolveRenderer(props.message.type, props.registry))
</script>

<template>
  <component
    :is="component"
    :type="message.type"
    :payload="message.payload"
    :message="message"
  />
</template>
