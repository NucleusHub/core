<script setup>
import { useI18n } from '../../useI18n.js'

const { t } = useI18n()

// Deterministic fallback: shown when a message's type has no registered
// renderer (e.g. an app was uninstalled, or shipped a type but no renderer).
// Keeps the pipeline total — rendering never throws on unknown types.
const props = defineProps({
  type: { type: String, default: 'unknown' },
  payload: { type: Object, default: () => ({}) },
})
</script>

<template>
  <div class="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-white/15 dark:text-white/50">
    {{ t('core.echo.unsupportedType') }} <code class="text-slate-700 dark:text-white/70">{{ type }}</code>
  </div>
</template>
