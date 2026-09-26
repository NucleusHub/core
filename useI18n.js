import { ref, watch } from 'vue'
import { useAuth } from './auth/useAuth.js'
import coreFallbackEn from './locales/en-US.json'

const API = '/api/auth/i18n'
const FALLBACK = 'en-US'

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

function deriveScope() {
  const b = (import.meta.env.BASE_URL || '/').replace(/^\/+|\/+$/g, '')
  return b || 'hub'
}

let scope = deriveScope()
let started = false

const locale = ref(getCookie('nucleus-locale') || FALLBACK)
const messages = ref({})
const ready = ref(false)
const active = ref(true)

let appFallback = {}

function applyFallback() {
  messages.value = { ...coreFallbackEn, ...appFallback }
}

export function registerFallback(msgs) {
  appFallback = msgs || {}
  if (!active.value || !started) applyFallback()
}

const cacheKey = (s, l) => `nucleus:i18n:${s}:${l}`

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
    // Keep cached/fallback messages; never block UI.
  } finally {
    ready.value = true
  }
}

async function load(l) {
  if (!l || !active.value) return
  locale.value = l
  hydrateFromCache(scope, l)
  await fetchCatalog(scope, l)
}

async function resolveActive() {
  let cfg
  try {
    const res = await fetch(`${API}/config`, { credentials: 'include' })
    if (!res.ok) return { active: false }
    cfg = await res.json()
  } catch {
    return { active: false }
  }
  // Pre-auth the overrides endpoint 401s, so stay dynamic until login.
  try {
    const r = await fetch('/api/auth/overrides', { credentials: 'include' })
    if (r.ok) {
      const disabled = (await r.json()).plugins || []
      if (disabled.includes('localization')) return { active: false }
    }
  } catch {}
  return { active: true, defaultLanguage: cfg.defaultLanguage || FALLBACK }
}

async function start(appId) {
  if (appId) scope = appId
  if (started) return
  started = true

  applyFallback()

  const status = await resolveActive()
  active.value = status.active

  if (!status.active) {
    applyFallback()
    ready.value = true
    return
  }

  const { profile } = useAuth()

  watch(profile, (p) => {
    if (p?.locale && p.locale !== locale.value) load(p.locale)
  }, { immediate: true })

  load(locale.value)
  if (!profile.value?.locale && status.defaultLanguage && status.defaultLanguage !== locale.value) {
    load(status.defaultLanguage)
  }
}

function interpolate(str, params) {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
}

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
