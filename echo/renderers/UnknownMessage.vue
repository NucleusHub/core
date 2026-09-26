<script setup>
import { useI18n } from '../../useI18n.js'

const { t } = useI18n()

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
