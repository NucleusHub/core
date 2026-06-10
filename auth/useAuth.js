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
    logout,
    handleUnauthorized,
    authFetch,
  }
}
