<script setup>
import { computed } from 'vue'
import { avatarUrl } from './useAuth.js'

// The one avatar component. Prefer passing a whole `profile` object — the
// name/colour/emoji/uploaded-photo/admin badge are all derived from it, so
// call sites never repeat that wiring or build the avatar URL themselves. The
// individual props remain for the cases that have no profile object (a group
// avatar, a live-edit preview, a "new user" form) and override the profile.
const props = defineProps({
  profile: { type: Object, default: null },
  name:  { type: String, default: '' },
  color: { type: String, default: '' },
  emoji: { type: String, default: null },
  // Explicit uploaded-avatar src URL. Usually left unset — it's resolved from
  // `profile` automatically.
  image: { type: String, default: null },
  size:  { type: Number, default: 72 },
  admin: { type: Boolean, default: false },
})

const dName  = computed(() => props.name || props.profile?.name || '?')
const dColor = computed(() => props.color || props.profile?.color || '#6366f1')
const dEmoji = computed(() => props.emoji ?? props.profile?.emoji ?? null)
const dImage = computed(() => props.image || avatarUrl(props.profile))
const dAdmin = computed(() => props.admin || props.profile?.role === 'admin')

const initials = (name) => {
  const parts = (name || '?').trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : (name || '?').slice(0, 2).toUpperCase()
}
</script>

<template>
  <div class="avatar-wrap" :style="{ width: size + 'px', height: size + 'px' }">
    <div
      class="avatar-circle"
      :style="{ background: dColor, width: size + 'px', height: size + 'px', fontSize: (size * 0.38) + 'px' }"
    >
      <img v-if="dImage" :src="dImage" alt="" class="avatar-img" draggable="false" />
      <span v-else-if="dEmoji" class="avatar-emoji" :style="{ fontSize: (size * 0.52) + 'px' }">{{ dEmoji }}</span>
      <span v-else class="avatar-initials">{{ initials(dName) }}</span>
    </div>
    <div v-if="dAdmin" class="admin-badge" :style="{ width: (size * 0.32) + 'px', height: (size * 0.32) + 'px' }">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width: 100%; height: 100%;">
        <path d="M12 2L3 6v6c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V6l-9-4z"/>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.avatar-circle {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #fff;
  user-select: none;
  letter-spacing: -0.02em;
  overflow: hidden;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-emoji {
  line-height: 1;
}

.avatar-initials {
  line-height: 1;
}

.admin-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  color: #facc15;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));
}
</style>
