<script setup>
import { computed, provide } from 'vue'
import EchoCardRenderer from './EchoCardRenderer.vue'
import AvatarCircle from '../auth/AvatarCircle.vue'

const props = defineProps({
  message: { type: Object, required: true },
  currentUserId: { type: String, default: null },
  sender: { type: Object, default: null },
  showTime: { type: Boolean, default: true },
  firstInGroup: { type: Boolean, default: true },
  lastInGroup: { type: Boolean, default: true },
  highlight: { type: Boolean, default: false },
})

const isSystem = computed(() => props.message.type === 'system')
const isMine = computed(() => props.message.senderId && props.message.senderId === props.currentUserId)
const isEmbed = computed(() => !!props.message.sourceApp)

provide('echoOnAccent', computed(() => isMine.value && !isEmbed.value))

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
