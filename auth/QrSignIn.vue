<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import QRCode from '../vendor/qrcode.js'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { qrCall } from './qrApi.js'
import { Icon } from '../icons'
import './nid.css'

const emit = defineEmits(['signed-in', 'cancel'])

const { t } = useI18n()
const { checkSession } = useAuth()

const POLL_MS = 2000
const image = ref(null)
const state = ref('loading')
const error = ref(null)
let timer = null
let current = null

function stop() {
  clearTimeout(timer)
  timer = null
  current = null
}

async function start() {
  stop()
  state.value = 'loading'
  error.value = null
  try {
    const created = await qrCall('POST', '/web')
    image.value = await QRCode.toDataURL(created.qr, { margin: 1, width: 224, errorCorrectionLevel: 'M' })
    current = created
    state.value = 'ready'
    schedule(created)
  } catch (err) {
    state.value = 'error'
    error.value = err.message
  }
}

function schedule(login) {
  timer = setTimeout(() => poll(login), POLL_MS)
}

async function poll(login) {
  if (current !== login) return
  try {
    const { status } = await qrCall('POST', `/${login.id}/poll`, { secret: login.secret })
    if (current !== login) return
    if (status === 'signed-in') {
      stop()
      await checkSession()
      return emit('signed-in')
    }
    if (status === 'expired') return start()
    if (status === 'denied') { stop(); state.value = 'denied'; return }
    state.value = status === 'scanned' ? 'scanned' : 'ready'
  } catch (err) {
    if (err.status === 404) return start()
    // 429 and network blips: keep polling.
  }
  if (current === login) schedule(login)
}

onMounted(start)
onBeforeUnmount(stop)
</script>

<template>
  <div class="nid-qr">
    <div class="nid-head__text">
      <h2 class="nid-title">{{ t('core.qr.signInTitle') }}</h2>
      <p class="nid-sub">{{ t('core.qr.signInBody') }}</p>
    </div>

    <div v-if="state === 'ready' || state === 'scanned'" class="nid-qr__box" :class="{ 'is-scanned': state === 'scanned' }">
      <img :src="image" width="224" height="224" :alt="t('core.qr.alt')">
    </div>
    <p v-if="state === 'scanned'" class="nid-alert" role="status">
      <Icon name="info" class="nid-alert__icon" :sw="1.8" /><span>{{ t('core.qr.scanned') }}</span>
    </p>
    <p v-else-if="state === 'loading'" class="nid-note" role="status">{{ t('core.profiles.loading') }}</p>
    <p v-else-if="state === 'denied'" class="nid-alert nid-alert--error" role="alert">
      <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ t('core.qr.denied') }}</span>
    </p>
    <p v-else-if="state === 'error'" class="nid-alert nid-alert--error" role="alert">
      <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ error }}</span>
    </p>

    <div class="nid-actions">
      <button v-if="state === 'denied' || state === 'error'" type="button" class="nid-btn nid-btn--primary nid-btn--block" @click="start">{{ t('core.qr.newCode') }}</button>
      <button type="button" class="nid-btn nid-btn--quiet nid-btn--block" @click="emit('cancel')">{{ t('core.nid.backToSignIn') }}</button>
    </div>
  </div>
</template>

<style scoped>
.nid-qr { display: flex; flex-direction: column; gap: 16px; }
.nid-qr__box {
  align-self: center;
  padding: 8px;
  border-radius: 12px;
  background: #fff;
  line-height: 0;
  transition: opacity 0.2s;
}
.nid-qr__box.is-scanned { opacity: 0.35; }
.nid-qr__box img { display: block; }
</style>
