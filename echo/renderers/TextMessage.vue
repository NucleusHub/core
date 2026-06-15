<script setup>
// Built-in renderer for plain text messages. payload = { text }.
defineProps({
  payload: { type: Object, required: true },
})
</script>

<template>
  <p class="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">{{ payload.text }}</p>
</template>
