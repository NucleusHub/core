<script setup>
defineProps({
  size: { type: Number, default: 44 },
})
</script>

<template>
  <span class="nid-crest" :style="{ width: size + 'px', height: size + 'px' }" aria-hidden="true">
    <svg viewBox="0 0 32 32" :width="size * 0.56" :height="size * 0.56">
      <defs>
        <radialGradient id="nid-crest-core" cx=".36" cy=".32" r=".8">
          <stop offset="0" stop-color="#f3e8ff" />
          <stop offset=".45" stop-color="#b794ff" />
          <stop offset="1" stop-color="#6d28d9" />
        </radialGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="14" ry="6" fill="none" stroke="#818cf8" stroke-opacity=".75" stroke-width="1.6" transform="rotate(-30 16 16)" />
      <ellipse cx="16" cy="16" rx="14" ry="6" fill="none" stroke="#c084fc" stroke-opacity=".85" stroke-width="1.6" transform="rotate(30 16 16)" />
      <circle cx="16" cy="16" r="5.2" fill="url(#nid-crest-core)" />
    </svg>
  </span>
</template>

<style scoped>
.nid-crest {
  display: grid;
  flex: none;
  place-items: center;
  border-radius: 14px;
  background:
    radial-gradient(120% 120% at 30% 0%, rgba(192, 132, 252, 0.32), transparent 70%),
    var(--nid-raise, rgba(255, 255, 255, 0.04));
  box-shadow:
    inset 0 0 0 1px var(--nid-accent-line, rgba(192, 132, 252, 0.25)),
    0 12px 26px -16px rgba(168, 85, 247, 0.9);
}
</style>
