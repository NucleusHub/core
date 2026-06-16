<script setup>
import { computed, provide } from 'vue'
import EchoCardRenderer from './EchoCardRenderer.vue'
import AvatarCircle from '../auth/AvatarCircle.vue'

// Wraps a single message. System messages render bare (centred); everything else
// gets a bubble aligned left/right by ownership. The bubble itself is dumb — the
// message *content* comes from the deterministic EchoCardRenderer, so any app
// type (text, orbit.file, goal.update, …) renders correctly here with no bubble
// changes.
const props = defineProps({
  message: { type: Object, required: true },
  currentUserId: { type: String, default: null },
  // Optional { name, color, emoji } of the message's sender — shown as an avatar
  // next to incoming messages. The host resolves it from its profile list.
  sender: { type: Object, default: null },
  // Show the timestamp under this message. The host sets this only on the last
  // message of a consecutive same-sender run, so a burst shares one time label.
  showTime: { type: Boolean, default: true },
  // Briefly pulse-highlight this message (e.g. when deep-linked to from the
  // dashboard widget's attachment link).
  highlight: { type: Boolean, default: false },
})

const isSystem = computed(() => props.message.type === 'system')
const isMine = computed(() => props.message.senderId && props.message.senderId === props.currentUserId)
// App-typed embeds render edge-to-edge (no text padding/colour) inside the bubble.
const isEmbed = computed(() => !!props.message.sourceApp)

// Tell descendant renderers (e.g. links in TextMessage) when they sit on the
// accent (own-message, indigo) bubble, so they can pick a contrasting colour
// instead of the default sky which is invisible on indigo.
provide('echoOnAccent', computed(() => isMine.value && !isEmbed.value))

const time = computed(() => {
  const d = props.message.createdAt ? new Date(props.message.createdAt) : null
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
})
</script>

<template>
  <div v-if="isSystem" :id="`echo-msg-${message.id}`" class="my-2 flex" :class="{ 'echo-hl': highlight }">
    <EchoCardRenderer :message="message" />
  </div>

  <div v-else :id="`echo-msg-${message.id}`" class="flex w-full items-end gap-2" :class="[isMine ? 'justify-end' : 'justify-start', showTime ? 'mb-2' : '']">
    <AvatarCircle
      v-if="!isMine"
      :name="sender?.name || '?'"
      :color="sender?.color || '#64748b'"
      :emoji="sender?.emoji || null"
      :size="28"
      class="mb-4 shrink-0"
    />
    <div class="flex w-fit max-w-[78%] flex-col" :class="[isMine ? 'items-end' : 'items-start', { 'echo-hl': highlight }]">
      <div
        :class="[
          'w-fit max-w-full rounded-2xl',
          isEmbed ? 'bg-transparent p-0' : 'px-3.5 py-2',
          !isEmbed && isMine ? 'bg-indigo-500 text-white' : '',
          !isEmbed && !isMine ? 'bg-slate-100 text-slate-800 backdrop-blur-md dark:bg-white/8 dark:text-white/90' : '',
        ]"
      >
        <EchoCardRenderer :message="message" />
      </div>
      <div v-if="showTime" class="mt-0.5 px-1 text-[0.65rem] text-slate-400 dark:text-white/35">
        {{ time }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Transient pulse when a message is deep-linked to. */
.echo-hl {
  border-radius: 1rem;
  animation: echo-hl 2.6s ease-out;
}
@keyframes echo-hl {
  0%   { box-shadow: 0 0 0 2px rgb(56 189 248 / 0.9);  background: rgb(56 189 248 / 0.16); }
  40%  { box-shadow: 0 0 0 2px rgb(56 189 248 / 0.6);  background: rgb(56 189 248 / 0.12); }
  100% { box-shadow: 0 0 0 0 transparent;              background: transparent; }
}
</style>
