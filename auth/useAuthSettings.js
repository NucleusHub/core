import { ref, readonly } from 'vue'

const DEFAULTS = {
  userLogin: 'profiles',
  signupOpen: false,
  mailEnabled: false,
  sso: { apple: false, google: false, github: false },
  serverCodeRequired: false,
  hasAdmin: true,
}

const settings = ref({ ...DEFAULTS })
const serverCode = ref({ required: false, passed: true })
const loaded = ref(false)
let pending = null

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function load() {
  const [s, c] = await Promise.allSettled([
    getJson('/api/auth/settings/public'),
    getJson('/api/v1/auth/server-code'),
  ])
  if (s.status === 'fulfilled') settings.value = { ...DEFAULTS, ...s.value }
  if (c.status === 'fulfilled') serverCode.value = c.value
  loaded.value = true
}

function refresh() {
  pending = load().finally(() => { pending = null })
  return pending
}

function ensureLoaded() {
  if (loaded.value) return Promise.resolve()
  return pending || refresh()
}

// Resolves on 204; rejects with err.code from the v1 error shape.
async function submitServerCode(code) {
  const res = await fetch('/api/v1/auth/server-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code }),
  })
  if (res.status === 204) {
    serverCode.value = { ...serverCode.value, passed: true }
    return
  }
  const body = await res.json().catch(() => ({}))
  const err = new Error(body?.error?.message || `HTTP ${res.status}`)
  err.status = res.status
  err.code = body?.error?.code || (res.status === 429 ? 'rate_limited' : 'server_error')
  throw err
}

export function useAuthSettings() {
  return {
    settings: readonly(settings),
    serverCode: readonly(serverCode),
    loaded: readonly(loaded),
    ensureLoaded,
    refresh,
    submitServerCode,
  }
}
