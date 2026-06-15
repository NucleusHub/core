<script setup>
import { computed } from 'vue'
import EchoCardRenderer from './EchoCardRenderer.vue'
import AvatarCircle from '../auth/AvatarCircle.vue'

// Wraps a single message. System messages render bare (centred); everything else
// gets a bubble aligned left/right by ownership. The bubble itself is dumb — the
// message *content* comes from the deterministic EchoCardRenderer, so any app
// type (text, orbit.file, goal.update, …) renders correctly here with no bubble
// changes.
const props = defineProps({
  message: { type: Object, required: true },
  registry: { type: Object, default: () => ({ messageTypes: {} }) },
  currentUserId: { type: String, default: null },
  // Optional { name, color, emoji } of the message's sender — shown as an avatar
  // next to incoming messages. The host resolves it from its profile list.
  sender: { type: Object, default: null },
})

const isSystem = computed(() => props.message.type === 'system')
const isMine = computed(() => props.message.senderId && props.message.senderId === props.currentUserId)
// App-typed embeds render edge-to-edge (no text padding/colour) inside the bubble.
const isEmbed = computed(() => !!props.message.sourceApp)

const time = computed(() => {
  const d = props.message.createdAt ? new Date(props.message.createdAt) : null
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
})
</script>

<template>
  <div v-if="isSystem" class="my-2 flex">
    <EchoCardRenderer :message="message" :registry="registry" />
  </div>

  <div v-else class="flex w-full items-end gap-2" :class="isMine ? 'justify-end' : 'justify-start'">
    <AvatarCircle
      v-if="!isMine"
      :name="sender?.name || '?'"
      :color="sender?.color || '#64748b'"
      :emoji="sender?.emoji || null"
      :size="28"
      class="mb-4 shrink-0"
    />
    <div class="max-w-[78%]">
      <div
        :class="[
          'rounded-2xl',
          isEmbed ? 'bg-transparent p-0' : 'px-3.5 py-2',
          !isEmbed && isMine ? 'bg-indigo-500 text-white' : '',
          !isEmbed && !isMine ? 'bg-slate-100 text-slate-800 backdrop-blur-md dark:bg-white/8 dark:text-white/90' : '',
        ]"
      >
        <EchoCardRenderer :message="message" :registry="registry" />
      </div>
      <div class="mt-0.5 px-1 text-[0.65rem] text-slate-400 dark:text-white/35" :class="isMine ? 'text-right' : 'text-left'">
        {{ time }}
      </div>
    </div>
  </div>
</template>
