<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useI18n } from '../useI18n.js'
import { useAuth } from './useAuth.js'
import { useAuthSettings } from './useAuthSettings.js'
import NidLoginPanel from './NidLoginPanel.vue'
import ServerKeyGate from './ServerKeyGate.vue'
import NidCrest from './NidCrest.vue'
import AvatarCircle from './AvatarCircle.vue'
import { Icon } from '../icons'
import './nid.css'

// "Sign in with Nucleus ID" consent page; the protocol is in auth-server/routes/v1/oauth.js.
const props = defineProps({
  notice: { type: String, default: null },
})

const { t } = useI18n()
const { profile, via, checked, isAuthenticated, checkSession, logout } = useAuth()
const { serverCode, submitServerCode, refresh: refreshAuthSettings, ensureLoaded } = useAuthSettings()

// 'loading' | 'serverKey' | 'signIn' | 'consent' | 'redirecting' | 'error'
const state = ref('loading')
const request = ref(null)
const errorMessage = ref('')
const busy = ref(false)
const titleEl = ref(null)
// The decision the server key interrupted, replayed once the key is in.
let pendingDecision = null

watch(state, async () => {
  await nextTick()
  titleEl.value?.focus()
})

// Only OAuth's own parameters go to the API, nothing the hub adds to the URL.
const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method']
const params = Object.fromEntries(
  PARAMS.map(k => [k, new URLSearchParams(window.location.search).get(k)]).filter(([, v]) => typeof v === 'string'),
)

const appName = computed(() => request.value?.client.name ?? t('core.authorize.thisApp'))
const isNid = computed(() => isAuthenticated.value && via.value === 'nid')

// Re-asking for more shows only what is new.
const askedScopes = computed(() => {
  const { scopes = [], granted = [] } = request.value ?? {}
  const fresh = scopes.filter(s => !granted.includes(s))
  return fresh.length ? fresh : scopes
})

const STATIC_SCOPES = ['profile', 'email', 'data']
const describe = (scope) => request.value?.descriptions?.[scope]
  ?? (STATIC_SCOPES.includes(scope) ? t(`core.authorize.scope.${scope}`) : scope)

class ApiError extends Error {}

async function call(method, body) {
  const qs = method === 'GET' ? `?${new URLSearchParams(params)}` : ''
  const res = await fetch(`/api/v1/oauth/authorize${qs}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok) return data
  const err = new ApiError(data?.error?.message || `HTTP ${res.status}`)
  Object.assign(err, { status: res.status, code: data?.error?.code, details: data?.error?.details })
  throw err
}

function leave(url) {
  state.value = 'redirecting'
  window.location.assign(url)
}

function fail(err) {
  // Wrong in a way the app should hear about: back it goes.
  if (err.details?.redirect) return leave(err.details.redirect)
  errorMessage.value = err instanceof ApiError && err.status < 500 ? err.message : t('core.authorize.errorFallback')
  state.value = 'error'
}

const needsKey = () => serverCode.value.required && !serverCode.value.passed

function askToSignIn() {
  state.value = !isAuthenticated.value && needsKey() ? 'serverKey' : 'signIn'
}

async function decide(approve) {
  busy.value = true
  try {
    const { redirect } = await call('POST', { ...params, approve })
    leave(redirect)
  } catch (err) {
    busy.value = false
    if (err.status === 401) {
      await checkSession()
      return askToSignIn()
    }
    if (err.code === 'nid_required') return askToSignIn()
    if (err.code === 'server_code_required') {
      pendingDecision = approve
      await refreshAuthSettings()
      state.value = 'serverKey'
      return
    }
    fail(err)
  }
}

async function resolve() {
  state.value = 'loading'
  try {
    request.value = await call('GET')
  } catch (err) {
    return fail(err)
  }
  if (!isNid.value) return askToSignIn()
  if (request.value.skipConsent) return decide(true)
  state.value = 'consent'
}

async function switchAccount() {
  await logout()
  askToSignIn()
}

// However they sign in (password, SSO return, sign-up), pick up from the session.
watch(isNid, (now, before) => {
  if (now && !before && state.value === 'signIn') resolve()
})

// The key entered on ServerKeyGate (with a session, it also grants the account access).
watch(() => serverCode.value.passed, (passed) => {
  if (!passed || state.value !== 'serverKey') return
  if (pendingDecision === null || !isNid.value) return resolve()
  const approve = pendingDecision
  pendingDecision = null
  decide(approve)
})

onMounted(async () => {
  // Apps pass the server code in the fragment, which never reaches server logs.
  const code = new URLSearchParams(window.location.hash.slice(1)).get('server_code')
  if (code) {
    history.replaceState(history.state, '', window.location.pathname + window.location.search)
    await submitServerCode(code).catch(() => {})
  }
  await ensureLoaded()
  if (code) await refreshAuthSettings()
  if (!checked.value) await checkSession()
  resolve()
})
</script>

<template>
  <ServerKeyGate v-if="state === 'serverKey'" />
  <Teleport v-else to="body">
    <div class="nid nid-stage">
      <div class="nid-scrim" />
      <div class="nid-stage__body">
        <div class="nid-stage__center">
          <p class="az-eyebrow"><Icon name="shield" class="az-eyebrow__icon" :sw="1.8" />{{ t('core.authorize.eyebrow') }}</p>

          <div class="nid-card nid-rise az-card" :aria-busy="state === 'loading' || state === 'redirecting'">
            <div v-if="state === 'loading' || state === 'redirecting'" class="az-status" role="status">
              <span class="nid-spinner" aria-hidden="true" />
              {{ state === 'loading' ? t('core.authorize.loading') : t('core.authorize.redirecting') }}
            </div>

            <template v-else-if="state === 'signIn'">
              <p ref="titleEl" class="az-lead" tabindex="-1">
                {{ isAuthenticated ? t('core.authorize.nidRequired', { app: appName }) : t('core.authorize.signInBody', { app: appName }) }}
              </p>
              <NidLoginPanel :notice="props.notice" />
            </template>

            <template v-else-if="state === 'consent'">
              <div class="nid-head">
                <NidCrest />
                <div class="nid-head__text">
                  <h1 ref="titleEl" class="nid-title" tabindex="-1">{{ t('core.authorize.consentTitle', { app: appName }) }}</h1>
                </div>
              </div>

              <div class="az-who">
                <AvatarCircle :profile="profile" :size="32" />
                <div class="az-who__text">
                  <span class="az-who__label">{{ t('core.authorize.signedInAs') }}</span>
                  <span class="az-who__name">{{ profile?.name }}<span v-if="profile?.account" class="az-who__handle"> @{{ profile.account.handle }}</span></span>
                </div>
                <button type="button" class="nid-link" :disabled="busy" @click="switchAccount">{{ t('core.authorize.switch') }}</button>
              </div>

              <p class="az-label">{{ t('core.authorize.asks') }}</p>
              <ul class="az-scopes">
                <li v-for="scope in askedScopes" :key="scope" class="az-scope">
                  <span class="az-scope__mark"><Icon name="check" :sw="2.4" /></span>
                  <span>{{ describe(scope) }}</span>
                </li>
              </ul>

              <p class="nid-note az-fine">
                {{ request.redirectHost ? t('core.authorize.sendsToHost', { host: request.redirectHost }) : t('core.authorize.sendsToApp', { app: appName }) }}
                {{ t('core.authorize.revoke') }}
              </p>

              <div class="az-actions">
                <button type="button" class="nid-btn nid-btn--quiet" :disabled="busy" @click="decide(false)">{{ t('core.authorize.deny') }}</button>
                <button type="button" class="nid-btn nid-btn--primary" :disabled="busy" @click="decide(true)">
                  <span v-if="busy" class="nid-spinner" aria-hidden="true" />
                  {{ t('core.authorize.allow') }}
                </button>
              </div>
            </template>

            <template v-else>
              <div class="nid-head">
                <NidCrest />
                <div class="nid-head__text">
                  <h1 ref="titleEl" class="nid-title" tabindex="-1">{{ t('core.authorize.errorTitle') }}</h1>
                </div>
              </div>
              <p class="nid-alert nid-alert--error" role="alert">
                <Icon name="warning" class="nid-alert__icon" :sw="1.8" /><span>{{ errorMessage }}</span>
              </p>
              <a class="nid-btn nid-btn--quiet nid-btn--block az-home" href="/">{{ t('core.authorize.home') }}</a>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.az-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--nid-ink-3);
}
.az-eyebrow__icon { width: 15px; height: 15px; color: var(--nid-accent); }

.az-card { max-width: 26rem; }

.az-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 120px;
  font-size: 0.9rem;
  color: var(--nid-ink-2);
}

.az-lead {
  margin: 0 0 20px;
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--nid-accent-ink);
  background: var(--nid-accent-bg);
  box-shadow: inset 0 0 0 1px var(--nid-accent-line);
}
.az-lead:focus { outline: none; }

.az-who {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 20px;
  border-radius: 14px;
  background: var(--nid-raise);
  box-shadow: inset 0 0 0 1px var(--nid-line);
}
.az-who__text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.az-who__label { font-size: 0.75rem; color: var(--nid-ink-3); }
.az-who__name { overflow: hidden; font-size: 0.9rem; font-weight: 600; color: var(--nid-ink-hi); white-space: nowrap; text-overflow: ellipsis; }
.az-who__handle { font-weight: 500; color: var(--nid-ink-3); }

.az-label { margin: 0 0 10px; font-size: 0.8125rem; font-weight: 600; color: var(--nid-ink-2); }

.az-scopes { display: flex; flex-direction: column; gap: 10px; margin: 0 0 20px; padding: 0; list-style: none; }
.az-scope { display: flex; align-items: flex-start; gap: 10px; font-size: 0.9rem; line-height: 1.45; color: var(--nid-ink); }
.az-scope__mark {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border-radius: 7px;
  color: var(--nid-accent-ink);
  background: var(--nid-accent-bg);
  box-shadow: inset 0 0 0 1px var(--nid-accent-line);
}
.az-scope__mark svg { width: 12px; height: 12px; }

.az-fine { margin: 0 0 22px; }

.az-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.az-home { margin-top: 16px; text-decoration: none; }
</style>
