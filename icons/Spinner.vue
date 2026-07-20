<script setup>
// Shared loading spinner — the two-tone `animate-spin` glyph that was pasted
// inline in nearly every busy button/overlay across the apps. It mixes a faint
// stroked ring with a solid arc and its own spin animation, so it lives here as
// a dedicated component rather than in the flat icon registry.
//
//   <Spinner class="w-4 h-4" />
//
// Colour is currentColor; size comes from the caller's Tailwind classes.
</script>

<template>
  <svg class="animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8H4z" />
  </svg>
</template>
