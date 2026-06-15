<script setup>
import { computed } from 'vue'
import EchoEmbedContainer from '../EchoEmbedContainer.vue'
import EchoAddButton from '../EchoAddButton.vue'

// Renderer for "orbit.file" messages, declared by apps/orbit/echo/manifest.echo.json.
// payload = { fileId, name, mimeType, size, url, folderId }.
// Orbit contributes only this metadata + the renderer *name*; the component
// itself is core-owned, so Orbit can't inject arbitrary UI into Echo.
const props = defineProps({
  payload: { type: Object, required: true },
})

// "Save" → copy the shared file into the caller's own Orbit drive (the Orbit
// app's API copies the underlying object and records the new file).
async function saveToDrive() {
  const res = await fetch(`/api/orbit/files/${props.payload.fileId}/save`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to save')
}

const prettySize = computed(() => {
  const b = Number(props.payload.size || 0)
  if (!b) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = b
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
})

const isImage = computed(() => /^image\//.test(props.payload.mimeType || ''))
</script>

<template>
  <EchoEmbedContainer app="orbit" label="Orbit" accent="#38bdf8">
    <template #actions>
      <EchoAddButton :handler="saveToDrive" label="Save" done-label="Saved" />
    </template>
    <a :href="payload.url" target="_blank" rel="noopener" class="flex items-center gap-3 no-underline">
      <img
        v-if="isImage"
        :src="payload.url"
        :alt="payload.name"
        class="h-12 w-12 shrink-0 rounded-lg object-cover"
      />
      <span
        v-else
        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-sky-400/15 text-sky-300"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/></svg>
      </span>
      <span class="min-w-0">
        <span class="block truncate font-medium text-slate-900 dark:text-white">{{ payload.name }}</span>
        <span class="block text-xs text-slate-500 dark:text-white/50">{{ prettySize }}</span>
      </span>
    </a>
  </EchoEmbedContainer>
</template>
