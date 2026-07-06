import { ref, readonly, computed } from 'vue'

const profile = ref(null)
const checked = ref(false)

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

// Build the URL for a profile's uploaded avatar, or null when it has none.
// Accepts any profile-shaped object exposing `hasImage` + an id (`_id` or
// `profileId`). The imageUpdatedAt timestamp cache-busts the (immutable)
// avatar endpoint so a freshly changed photo shows without a hard reload.
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
    const err = new Error((await res.json()).error || 'Login failed')
    err.status = res.status
    throw err
  }
  const data = await res.json()
  updateRecentProfiles(profileId)
  // A temporary PIN doesn't grant a session yet — the caller must collect a new
  // PIN and call completeTempLogin. Don't mark the user authenticated.
  if (!data.pinTemporary) profile.value = data
  return data
}

// Finish a temporary-PIN login: re-prove the temp PIN and set a new one. Only on
// success is a session established and the user marked authenticated.
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

// Call from any composable when it receives a 401 to re-show the profile selector
function handleUnauthorized() {
  profile.value = null
  checked.value = true
}

// Fetch wrapper that auto-resets auth on 401
async function authFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options })
  if (res.status === 401) handleUnauthorized()
  return res
}

export function useAuth() {
  return {
    profile: readonly(profile),
    checked: readonly(checked),
    isAuthenticated: computed(() => !!profile.value),
    checkSession,
    login,
    completeTempLogin,
    logout,
    handleUnauthorized,
    authFetch,
  }
}
