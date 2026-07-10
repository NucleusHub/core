<script setup>
// Shared trash icon whose lid tips open on hover — the ecosystem's delete
// affordance, so a delete control feels the same in every app (context menus,
// selection toolbar, item cards, …).
//
// It's a *two-part* trash on purpose: the lid (rim + handle) is its own <path>
// carrying `.nuc-lid`, separate from the can body, so the lid can pivot open.
// The hover trigger is the enclosing `.nuc-trash` element (usually the button or
// menu row that holds this icon) — NOT a generic Tailwind `.group`, so hovering
// a whole card never springs the lid. See core/assets/motion.css.
defineProps({ strokeWidth: { type: [Number, String], default: 1.8 } })
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="strokeWidth"
       stroke-linecap="round" stroke-linejoin="round">
    <path class="nuc-lid" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  </svg>
</template>
