<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuthSettings } from './useAuthSettings.js'
import { shake } from './nidErrors.js'
import { Icon } from '../icons'
import NidCrest from './NidCrest.vue'
import NidField from './NidField.vue'
import './nid.css'

const { t } = useI18n()
const { submitServerCode } = useAuthSettings()

const FORMAT = /^nucleus[0-9A-Za-z]{32}home$/
const ERRORS = {
  server_code_invalid: 'core.serverKey.invalid',
  server_code_rejected: 'core.serverKey.rejected',
  rate_limited: 'core.serverKey.rateLimited',
}

const code = ref('')
const busy = ref(false)
const error = ref(null)
const card = ref(null)
const field = ref(null)
const trimmed = computed(() => code.value.trim())

onMounted(() => field.value?.focus())

function fail(key) {
  error.value = t(key)
  shake(card.value)
}

async function submit() {
  if (busy.value || !trimmed.value) return
  error.value = null
  if (!FORMAT.test(trimmed.value)) return fail('core.serverKey.invalid')
  busy.value = true
  try {
    await submitServerCode(trimmed.value)
  } catch (err) {
    fail(ERRORS[err.code] || (err instanceof TypeError ? 'core.serverKey.offline' : 'core.serverKey.failed'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="nid nid-stage">
      <div class="nid-scrim" />
      <div class="nid-stage__body">
        <div class="nid-stage__center">
          <form ref="card" class="nid-card nid-rise" novalidate :aria-busy="busy" @submit.prevent="submit">
            <div class="nid-head">
              <NidCrest />
              <div class="nid-head__text">
                <h1 class="nid-title">{{ t('core.serverKey.title') }}</h1>
              </div>
            </div>
            <div class="nid-form">
              <p class="nid-body-text">{{ t('core.serverKey.body') }}</p>
              <NidField ref="field" v-model="code" :label="t('core.serverKey.label')" code
                :placeholder="t('core.serverKey.placeholder')" :error="error"
                autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" />
              <button type="submit" class="nid-btn nid-btn--primary nid-btn--block" :disabled="busy || !trimmed">
                <span v-if="busy" class="nid-spinner" aria-hidden="true" />
                {{ busy ? t('core.serverKey.checking') : t('core.serverKey.continue') }}
              </button>
              <p class="nid-note nid-key-hint">
                <Icon name="info" class="nid-key-hint__icon" :sw="1.8" />
                <span>{{ t('core.serverKey.hint') }}</span>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nid-key-hint { display: flex; gap: 8px; align-items: flex-start; }
.nid-key-hint__icon { flex: none; width: 15px; height: 15px; margin-top: 2px; }
</style>
