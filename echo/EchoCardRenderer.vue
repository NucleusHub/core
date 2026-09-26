<script setup>
import { computed, inject } from 'vue'
import { resolveRenderer } from './renderers/index.js'

const props = defineProps({
  message: { type: Object, required: true },
})

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
