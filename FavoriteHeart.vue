<script setup>
// Shared favorite heart with a "fill from the centre outward" reveal. The red
// fill is a circle clipped to the heart shape that scales up from the middle, so
// favoriting reads as the colour blooming out to the edges rather than a flat
// toggle. Used everywhere a favorite appears in Prism (media tiles, the viewer,
// context menus, the selection toolbar) so the gesture is identical throughout.
//
// The fill shows when `active` (the current favorite state) OR while an enclosing
// `.nuc-fav` element is hovered — so action buttons that don't track per-item
// state still preview the bloom on hover. Reduced-motion drops the animation but
// keeps the state. See core/assets/motion.css for the tokens.
const props = defineProps({
  active: { type: Boolean, default: false },
  strokeWidth: { type: [Number, String], default: 1.6 },
})

// Each instance needs its own <clipPath> id (many hearts can share a page).
let _uid = 0
const cid = `nuc-heart-${(_uid = (globalThis.__nucHeartId = (globalThis.__nucHeartId || 0) + 1))}`

const HEART = 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z'
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="strokeWidth"
       stroke-linecap="round" stroke-linejoin="round" class="favheart" :class="{ on: active }">
    <defs>
      <clipPath :id="cid"><path :d="HEART" /></clipPath>
    </defs>
    <!-- Outline, always present so the shape reads even when unfilled. -->
    <path :d="HEART" />
    <!-- Red bloom: a circle clipped to the heart, scaled from its own centre. -->
    <g :clip-path="`url(#${cid})`">
      <circle class="favheart-fill" cx="12" cy="11" r="13" fill="#f43f5e" stroke="none" />
    </g>
  </svg>
</template>

<style scoped>
.favheart-fill {
  transform: scale(0);
  transform-box: fill-box;
  transform-origin: center;
  transition: transform 0.42s var(--nuc-ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.favheart.on .favheart-fill,
:global(.nuc-fav):hover .favheart-fill { transform: scale(1); }

@media (prefers-reduced-motion: reduce) {
  .favheart-fill { transition: none; }
}
</style>
