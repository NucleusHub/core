<script setup>
import { computed, provide } from 'vue'
import EchoCardRenderer from './EchoCardRenderer.vue'
import AvatarCircle from '../auth/AvatarCircle.vue'

// Wraps a single message. System messages render bare (centred); everything else
// gets a bubble aligned left/right by ownership. The bubble itself is dumb — the
// message *content* comes from the deterministic EchoCardRenderer, so any app
// type (text, orbit.file, prism.media, …) renders correctly here with no bubble
// changes.
//
// Consecutive messages from one sender form a visual CLUSTER: they hug together,
// the avatar shows once (on the last), and the bubbles' inner corners flatten so
// the run reads as a single unit — the calm, grouped look of a good chat app.
const props = defineProps({
  message: { type: Object, required: true },
  currentUserId: { type: String, default: null },
  // Optional { name, color, emoji } of the message's sender — shown as an avatar
  // beside the last message of an incoming run. The host resolves it.
  sender: { type: Object, default: null },
  // Show the timestamp under this message. The host sets this on the last message
  // of a consecutive same-sender run, so a burst shares one time label.
  showTime: { type: Boolean, default: true },
  // Cluster position within a same-sender run. Both default true so a message
  // rendered on its own (e.g. the dashboard widget) looks like a standalone bubble.
  firstInGroup: { type: Boolean, default: true },
  lastInGroup: { type: Boolean, default: true },
  // Briefly pulse-highlight this message (e.g. when deep-linked to from the
  // dashboard widget's attachment link).
  highlight: { type: Boolean, default: false },
})

const isSystem = computed(() => props.message.type === 'system')
const isMine = computed(() => props.message.senderId && props.message.senderId === props.currentUserId)
// App-typed embeds render edge-to-edge (no text padding/colour) inside the bubble.
const isEmbed = computed(() => !!props.message.sourceApp)

// Tell descendant renderers (e.g. links in TextMessage) when they sit on the
// accent (own-message) bubble, so they can pick a contrasting colour.
provide('echoOnAccent', computed(() => isMine.value && !isEmbed.value))

// Flatten the corners on the sender's side that face into the cluster, so a run
// of bubbles nests into one shape. A lone message keeps all corners fully round.
const clusterRadius = computed(() => {
  if (isEmbed.value) return 'rounded-2xl'
  const round = 'rounded-[1.35rem]'
  if (isMine.value) {
    return [round, props.firstInGroup ? '' : 'rounded-tr-md', props.lastInGroup ? '' : 'rounded-br-md']
  }
  return [round, props.firstInGroup ? '' : 'rounded-tl-md', props.lastInGroup ? '' : 'rounded-bl-md']
})

const time = computed(() => {
  const d = props.message.createdAt ? new Date(props.message.createdAt) : null
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
})
</script>

<template>
  <div v-if="isSystem" :id="`echo-msg-${message.id}`" class="my-3 flex" :class="{ 'echo-hl': highlight }">
    <EchoCardRenderer :message="message" />
  </div>

  <div
    v-else
    :id="`echo-msg-${message.id}`"
    class="flex w-full items-end gap-2"
    :class="[isMine ? 'justify-end' : 'justify-start', showTime ? 'mb-2.5' : 'mb-0.5']"
  >
    <!-- Avatar rail (incoming only): the avatar appears once, on the last message
         of the run; earlier rows reserve the space so the cluster stays aligned. -->
    <div v-if="!isMine" class="w-7 shrink-0 self-end">
      <AvatarCircle
        v-if="lastInGroup"
        :profile="sender"
        :color="sender?.color || '#64748b'"
        :size="28"
      />
    </div>

    <div class="flex w-fit max-w-[80%] flex-col" :class="[isMine ? 'items-end' : 'items-start', { 'echo-hl': highlight }]">
      <div
        :class="[
          'w-fit max-w-full',
          clusterRadius,
          isEmbed ? 'bg-transparent p-0' : 'px-3.5 py-2',
          !isEmbed && isMine ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm shadow-indigo-500/20' : '',
          !isEmbed && !isMine ? 'bg-white text-slate-800 ring-1 ring-slate-900/[0.06] shadow-sm shadow-slate-900/[0.03] dark:bg-white/[0.07] dark:text-white/90 dark:ring-white/[0.06] dark:shadow-none' : '',
        ]"
      >
        <EchoCardRenderer :message="message" />
      </div>
      <div v-if="showTime" class="mt-1 px-1.5 text-[0.65rem] tabular-nums text-slate-400 dark:text-white/35">
        {{ time }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Transient pulse when a message is deep-linked to. */
.echo-hl {
  border-radius: 1.35rem;
  animation: echo-hl 2.6s ease-out;
}
@keyframes echo-hl {
  0%   { box-shadow: 0 0 0 2px rgb(129 140 248 / 0.9);  background: rgb(129 140 248 / 0.16); }
  40%  { box-shadow: 0 0 0 2px rgb(129 140 248 / 0.6);  background: rgb(129 140 248 / 0.10); }
  100% { box-shadow: 0 0 0 0 transparent;               background: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .echo-hl { animation: none; }
}
</style>
