<script setup>
import { computed, inject } from 'vue'
import { resolveRenderer } from './renderers/index.js'

// The deterministic rendering pipeline. Given a message, it resolves exactly one
// component for the message's type and renders it with a uniform prop contract
// ({ type, payload, message }). App renderers come from the `echoRenderers` map
// the host provides (auto-discovered from each app's integration); core never
// imports an app. Unknown types degrade to UnknownMessage and it never throws.
// This is the ONLY place a message turns into UI.
const props = defineProps({
  message: { type: Object, required: true },
})

// type -> component map, provided by the host (ChatView). Empty until provided.
const appRenderers = inject('echoRenderers', {})

const component = computed(() => resolveRenderer(props.message.type, appRenderers))
</script>

<template>
  <component
    :is="component"
    :type="message.type"
    :payload="message.payload"
    :message="message"
  />
</template>
