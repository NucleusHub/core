import { ref, readonly, computed } from 'vue'

const profile = ref(null)
const checked = ref(false)
// Which account dialog AuthGuard shows: { kind: 'manage', tab } | { kind: 'upgrade' } | null.
const accountPanel = ref(null)

// 401s that mean "wrong secret", not "session gone".
const CREDENTIAL_CODES = new Set(['invalid_credentials', 'wrong_pin'])

function updateRecentProfiles(id) {
  try {
    const stored = JSON.parse(localStorage.getItem('nucleus_recent_profiles') || '[]')
    const updated = [id, ...stored.filter(x => x !== id)].slice(0, 5)
    localStorage.setItem('nucleus_recent_profiles', JSON.stringify(updated))
  } catch {}
}

export function getRecentProfileIds() {
  try {
    return JSON.parse(localStorage.getItem('nucleus_recent_profiles') || '[]')
  } catch { return [] }
}

export function avatarUrl(p) {
  if (!p || !p.hasImage) return null
  const id = p._id || p.profileId
  if (!id) return null
  const v = p.imageUpdatedAt ? new Date(p.imageUpdatedAt).getTime() : ''
  return `/api/auth/profiles/${id}/avatar${v ? `?v=${v}` : ''}`
}

async function checkSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' })
    profile.value = res.ok ? await res.json() : null
  } catch {
    profile.value = null
  } finally {
    checked.value = true
  }
}

async function login(profileId, pin = null) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ profileId, pin: pin || undefined }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.error || 'Login failed')
    err.status = res.status
    err.code = body.code
    throw err
  }
  const data = await res.json()
  updateRecentProfiles(profileId)
  // A temporary PIN grants no session until completeTempLogin succeeds.
  if (!data.pinTemporary) profile.value = data
  return data
}

async function completeTempLogin(profileId, currentPin, newPin) {
  const res = await fetch('/api/auth/login/set-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ profileId, currentPin, newPin }),
  })
  if (!res.ok) {
    const err = new Error((await res.json()).error || 'Could not set PIN')
    err.status = res.status
    throw err
  }
  profile.value = await res.json()
  updateRecentProfiles(profileId)
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  profile.value = null
  checked.value = true
}

async function nidPost(path, body) {
  const res = await fetch(`/api/auth/nid/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body ?? {}),
  })
  const data = res.status === 204 ? null : await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.status = res.status
    err.code = data?.code
    err.fields = data?.fields || null
    throw err
  }
  return data
}

// Also refreshes after a pending upgrade: the profile now carries an unconfirmed account.
async function signedIn(data) {
  if (data?.profile) updateRecentProfiles(data.profile._id)
  await checkSession()
  return data
}

async function nidLogin(email, password) {
  return signedIn(await nidPost('login', { email, password }))
}

// The picker already knows which profile; the server never tells it the handle or email.
async function nidProfileLogin(profileId, password) {
  return signedIn(await nidPost('login', { profileId, password }))
}

// Resolves to { pending, email } when a confirmation mail went out, else { profile } with a live session.
async function nidRegister({ handle, displayName, email, password }) {
  return signedIn(await nidPost('register', { handle, displayName, email, password }))
}

async function upgrade({ handle, email, password, pin }) {
  return signedIn(await nidPost('upgrade', { handle, email, password, pin }))
}

async function logoutAll() {
  await nidPost('logout-all')
  profile.value = null
  checked.value = true
}

function openAccountPanel(kind, tab = 'profile') {
  accountPanel.value = kind ? { kind, tab } : null
}

function handleUnauthorized() {
  profile.value = null
  checked.value = true
}

async function authFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options })
  if (res.status === 401 && !(await isCredentialError(res))) handleUnauthorized()
  return res
}

async function isCredentialError(res) {
  try {
    return CREDENTIAL_CODES.has((await res.clone().json()).code)
  } catch {
    return false
  }
}

export function useAuth() {
  return {
    profile: readonly(profile),
    checked: readonly(checked),
    isAuthenticated: computed(() => !!profile.value),
    via: computed(() => profile.value?.via ?? null),
    account: computed(() => profile.value?.account ?? null),
    accountPanel: readonly(accountPanel),
    checkSession,
    login,
    completeTempLogin,
    logout,
    nidLogin,
    nidProfileLogin,
    nidRegister,
    nidPost,
    upgrade,
    logoutAll,
    openAccountPanel,
    handleUnauthorized,
    authFetch,
  }
}
