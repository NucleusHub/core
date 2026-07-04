import { ref, watch } from 'vue'
import { useAuth } from './auth/useAuth.js'

// Core localization runtime. Mirrors the module-singleton shape of useTheme.js /
// useRegistry.js: one shared reactive state, exposed through useI18n(). The
// auth-server resolves the full catalog (core + this app, English fallback,
// admin overrides applied), so the client just looks keys up in a flat map.

const API = '/api/auth/i18n'
const FALLBACK = 'en-US'

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

// The app scope is derived from the Vite base path baked into the bundle:
// '/orbit/' → 'orbit', '/' (hub) → 'hub'. Overridable via initI18n(appId).
function deriveScope() {
  const b = (import.meta.env.BASE_URL || '/').replace(/^\/+|\/+$/g, '')
  return b || 'hub'
}

let scope = deriveScope()
let started = false

const locale = ref(getCookie('nucleus-locale') || FALLBACK)
const messages = ref({})
const ready = ref(false)

const cacheKey = (s, l) => `nucleus:i18n:${s}:${l}`

// Instant first paint: seed messages from the last cached catalog for this
// scope+lang, if any. The network fetch then refreshes it.
function hydrateFromCache(s, l) {
  try {
    const raw = localStorage.getItem(cacheKey(s, l))
    if (raw) {
      const data = JSON.parse(raw)
      if (data?.messages) { messages.value = data.messages; return true }
    }
  } catch {}
  return false
}

async function fetchCatalog(s, l) {
  try {
    const res = await fetch(`${API}/catalog?app=${encodeURIComponent(s)}&lang=${encodeURIComponent(l)}`, { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json()
    if (l !== locale.value) return // a newer switch won the race
    messages.value = data.messages || {}
    try { localStorage.setItem(cacheKey(s, l), JSON.stringify({ version: data.version, messages: data.messages })) } catch {}
  } catch {
    // Network/parse failure — keep the cached/fallback messages; never block UI.
  } finally {
    ready.value = true
  }
}

async function load(l) {
  if (!l) return
  locale.value = l
  hydrateFromCache(scope, l)
  await fetchCatalog(scope, l)
}

async function fetchDefaultLocale() {
  try {
    const res = await fetch(`${API}/config`, { credentials: 'include' })
    if (res.ok) return (await res.json()).defaultLanguage || FALLBACK
  } catch {}
  return FALLBACK
}

// Begin tracking the active locale. Called once from AuthGuard (shared by every
// app) so no per-app wiring is needed. Idempotent.
function start(appId) {
  if (appId) scope = appId
  if (started) return
  started = true

  const { profile } = useAuth()

  // The user's admin-assigned locale wins whenever it's known.
  watch(profile, (p) => {
    if (p?.locale && p.locale !== locale.value) load(p.locale)
  }, { immediate: true })

  // Paint immediately with the cookie/fallback, then align to the instance
  // default if the user has no assigned locale (e.g. the login screen).
  load(locale.value)
  ;(async () => {
    if (!profile.value?.locale) {
      const def = await fetchDefaultLocale()
      if (!profile.value?.locale && def !== locale.value) load(def)
    }
  })()
}

function interpolate(str, params) {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
}

// The single lookup API: t('core.button.save'), t('photos.deleted', { count: 12 }).
// Missing keys return the key itself so the UI never crashes or blanks out.
function t(key, params) {
  const msg = messages.value[key]
  return msg == null ? key : interpolate(msg, params)
}

export function initI18n(appId) { start(appId) }

export function useI18n(appId) {
  if (appId && !started) scope = appId
  return { t, locale, messages, ready, initI18n: start, setLocale: load }
}

export { t }
