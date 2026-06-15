<script setup>
// Built-in renderer for system messages (joins, leaves, renames, automated
// notices). payload = { text }. Rendered as a divider with the text centred.
defineProps({
  payload: { type: Object, required: true },
})
</script>

<template>
  <div class="flex w-full items-center gap-3">
    <span class="h-px flex-1 bg-slate-200/80 dark:bg-white/10" />
    <span class="shrink-0 text-center text-[0.7rem] font-medium text-slate-400 dark:text-white/40">{{ payload.text }}</span>
    <span class="h-px flex-1 bg-slate-200/80 dark:bg-white/10" />
  </div>
</template>
