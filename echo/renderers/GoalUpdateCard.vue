<script setup>
import { computed } from 'vue'
import EchoEmbedContainer from '../EchoEmbedContainer.vue'
import EchoAddButton from '../EchoAddButton.vue'

// Renderer for "goal.update" messages, declared by
// apps/goal-calendar/echo/manifest.echo.json.
// payload = { goalId, name, color, status, streak, date,
//             repeat, customInterval, customUnit, startDate }.
const props = defineProps({
  payload: { type: Object, required: true },
})

const completed = computed(() => props.payload.status === 'completed')

// Human-readable cadence, inherited from the source goal.
const REPEAT_LABEL = {
  none: 'One-time', everyday: 'Daily', weekday: 'Weekdays', weekend: 'Weekends',
  week: 'Weekly', month: 'Monthly', year: 'Yearly',
}
const repeatLabel = computed(() => {
  const p = props.payload
  if (p.repeat === 'custom') return `Every ${p.customInterval || 1} ${p.customUnit || 'days'}`
  return REPEAT_LABEL[p.repeat] || ''
})

// "Add" → create the goal in the caller's own Goals (the Goals app's API does
// the insert). Cadence + start date are inherited from the shared goal.
async function addToGoals() {
  const p = props.payload
  const res = await fetch('/api/goals', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: p.name,
      color: p.color || '#6366f1',
      repeat: p.repeat || 'everyday',
      customInterval: p.customInterval ?? null,
      customUnit: p.customUnit ?? null,
      startDate: p.startDate || new Date().toISOString().slice(0, 10),
    }),
  })
  if (!res.ok) throw new Error('Failed to add')
}
</script>

<template>
  <EchoEmbedContainer app="goal-calendar" label="Goals" :accent="payload.color || '#6366f1'">
    <template #actions>
      <EchoAddButton :handler="addToGoals" label="Add" done-label="Added" />
    </template>
    <div class="flex items-center gap-3">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        :style="{ background: (payload.color || '#6366f1') + '22', color: payload.color || '#6366f1' }"
      >
        <svg v-if="completed" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      </span>
      <div class="min-w-0">
        <p class="truncate font-medium text-slate-900 dark:text-white">{{ payload.name }}</p>
        <p class="text-xs text-slate-500 dark:text-white/55">
          <span v-if="repeatLabel" class="font-medium text-slate-600 dark:text-white/65">{{ repeatLabel }}</span>
          <span v-if="repeatLabel" class="mx-1 text-slate-300 dark:text-white/25">·</span>
          <template v-if="completed">Completed{{ payload.date ? ` on ${payload.date}` : '' }}</template>
          <template v-else>Updated</template>
          <span v-if="payload.streak" class="ml-1 text-amber-300">🔥 {{ payload.streak }}-day streak</span>
        </p>
      </div>
    </div>
  </EchoEmbedContainer>
</template>
