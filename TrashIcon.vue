<script setup>
// Lid pivots on hover of the enclosing .nuc-trash, not .group, so hovering a card never opens it.
defineProps({ strokeWidth: { type: [Number, String], default: 1.8 } })
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="strokeWidth"
       stroke-linecap="round" stroke-linejoin="round">
    <path class="nuc-lid" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  </svg>
</template>
