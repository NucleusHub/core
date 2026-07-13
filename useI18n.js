import { ref, watch } from 'vue'
import { useAuth } from './auth/useAuth.js'
// Bundled English base for the 'core' scope — the static fallback used when the
// localization plugin is absent or disabled. This file lives in core/, so the
// import is core/locales/en-US.json and travels in every app bundle.
import coreFallbackEn from './locales/en-US.json'

// Core localization runtime. Mirrors the module-singleton shape of useTheme.js /
// useRegistry.js: one shared reactive state, exposed through useI18n().
//
// Localization is now an optional plugin (plugins/localization). Two modes:
//
//   • Dynamic (plugin installed & enabled) — the auth-server resolves the full
//     catalog (core + this app, English fallback, admin overrides, per-app
//     enable matrix) and the client fetches it, with runtime language switching.
//
//   • Static (plugin absent or disabled) — no API, no switching: the app renders
//     in its manifest default language (en-US) from a locale file bundled at
//     build time. Core strings come from coreFallbackEn above; each app registers
//     its own scope's strings via registerFallback() from its entry (main.js).

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
// Whether the localization plugin is active (multi-language). false → the app is
// in static single-language mode; UI that offers a language picker should hide.
const active = ref(true)

// App-scope static fallback, registered by the app entry (see registerFallback).
let appFallback = {}

// Compose the static catalog: core base + this app's scope. Used whenever the
// localization plugin isn't active.
function applyFallback() {
  messages.value = { ...coreFallbackEn, ...appFallback }
}

// Called once from an app's entry (main.js) with its manifest-default locale
// file, so the app still shows its own strings when localization is disabled or
// not installed. Safe to call before or after initI18n().
export function registerFallback(msgs) {
  appFallback = msgs || {}
  if (!active.value || !started) applyFallback()
}

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
  if (!l || !active.value) return // no-op in static single-language mode
  locale.value = l
  hydrateFromCache(scope, l)
  await fetchCatalog(scope, l)
}

// Decide whether the localization plugin is active. Installed → the auth-server
// mounts /api/auth/i18n (so /config responds); absent → the route 404s / fails.
// Disabled → the plugin is present but turned off in Admin (we can only read the
// disabled set once authenticated). Either not-installed or disabled → static.
async function resolveActive() {
  let cfg
  try {
    const res = await fetch(`${API}/config`, { credentials: 'include' })
    if (!res.ok) return { active: false }
    cfg = await res.json()
  } catch {
    return { active: false } // route not mounted → plugin not installed
  }
  // Installed. Honor the Admin disable toggle when we can read it; pre-auth the
  // overrides endpoint 401s, so we optimistically stay dynamic until login.
  try {
    const r = await fetch('/api/auth/overrides', { credentials: 'include' })
    if (r.ok) {
      const disabled = (await r.json()).plugins || []
      if (disabled.includes('localization')) return { active: false }
    }
  } catch {}
  return { active: true, defaultLanguage: cfg.defaultLanguage || FALLBACK }
}

// Begin tracking the active locale. Called once from AuthGuard (shared by every
// app) so no per-app wiring is needed. Idempotent.
async function start(appId) {
  if (appId) scope = appId
  if (started) return
  started = true

  // Paint immediately with the bundled static fallback. It's the final state in
  // static mode, and a safe seed in dynamic mode until the catalog arrives.
  applyFallback()

  const status = await resolveActive()
  active.value = status.active

  if (!status.active) {
    // Static single-language mode: manifest default (en-US), no switching.
    applyFallback()
    ready.value = true
    return
  }

  // ── Dynamic mode (localization plugin active) ──
  const { profile } = useAuth()

  // The user's admin-assigned locale wins whenever it's known.
  watch(profile, (p) => {
    if (p?.locale && p.locale !== locale.value) load(p.locale)
  }, { immediate: true })

  // Paint with the cookie/fallback locale, then align to the instance default if
  // the user has no assigned locale (e.g. the login screen).
  load(locale.value)
  if (!profile.value?.locale && status.defaultLanguage && status.defaultLanguage !== locale.value) {
    load(status.defaultLanguage)
  }
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
  return { t, locale, messages, ready, active, initI18n: start, setLocale: load, registerFallback }
}

export { t }
