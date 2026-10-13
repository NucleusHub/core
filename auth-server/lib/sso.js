import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'

let doFetch = null
// Tests swap in a stub; null restores the global fetch.
export function setFetch(fn) {
  doFetch = fn
}
const fetchJson = (url, opts = {}) => (doFetch || fetch)(url, { ...opts, signal: AbortSignal.timeout(10_000) })

export class SsoError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

const random = () => randomBytes(32).toString('base64url')
const challenge = (verifier) => createHash('sha256').update(verifier).digest('base64url')
export const newFlowSecrets = () => ({ state: random(), nonce: random(), verifier: random() })

// Only a path on this site; tabs/newlines are stripped by browsers, turning `/\t/x` into `//x`.
export function safeReturn(value) {
  if (typeof value !== 'string' || value.length > 2000) return '/'
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(value)) return '/'
  const url = new URL(value, 'http://n.invalid')
  if (url.origin !== 'http://n.invalid' || url.pathname.startsWith('//')) return '/'
  return value
}

export function suggestHandle(...candidates) {
  for (const c of candidates) {
    const h = String(c ?? '').toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 39).replace(/-+$/, '')
    if (h.length >= 2) return h
  }
  return 'user'
}

const redirectUri = (s, id) => `${s.publicOrigin}/api/auth/nid/sso/${id}/callback`

async function postForm(url, body) {
  const res = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.error) {
    console.error(`[sso] token exchange failed at ${url}`, res.status, payload?.error ?? '')
    throw new SsoError('exchange_failed')
  }
  return payload
}

// Received straight from the token endpoint over TLS, so the claims are checked but not the signature (OIDC Core 3.1.3.7).
function idTokenClaims(token, { issuer, audience, nonce }) {
  const c = typeof token === 'string' ? jwt.decode(token) : null
  const issOk = c && (Array.isArray(issuer) ? issuer.includes(c.iss) : c.iss === issuer)
  const audOk = c && (Array.isArray(c.aud) ? c.aud.includes(audience) : c.aud === audience)
  if (!issOk || !audOk || !c.sub || !(c.exp * 1000 > Date.now() - 30_000) || c.nonce !== nonce) {
    console.error('[sso] id token rejected')
    throw new SsoError('bad_token')
  }
  return c
}

const google = {
  configured: (s) => !!(s.sso?.google?.clientId && s.sso?.google?.clientSecret),
  authorizeUrl(s, { state, nonce, verifier }) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: s.sso.google.clientId,
      redirect_uri: redirectUri(s, 'google'),
      response_type: 'code',
      scope: 'openid email profile',
      state, nonce,
      code_challenge: challenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
    return url.toString()
  },
  async exchange(s, { code, verifier, nonce }) {
    const tokens = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: s.sso.google.clientId,
      client_secret: s.sso.google.clientSecret,
      redirect_uri: redirectUri(s, 'google'),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    })
    const c = idTokenClaims(tokens.id_token, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: s.sso.google.clientId, nonce })
    const email = typeof c.email === 'string' ? c.email.toLowerCase() : null
    return { subject: String(c.sub), email, emailVerified: c.email_verified === true, name: c.name || '', handle: suggestHandle(email?.split('@')[0], c.name) }
  },
}

async function githubApi(path, token) {
  const res = await fetchJson(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nucleus' },
  })
  if (!res.ok) throw new SsoError('exchange_failed')
  return res.json()
}

const github = {
  configured: (s) => !!(s.sso?.github?.clientId && s.sso?.github?.clientSecret),
  authorizeUrl(s, { state, verifier }) {
    const url = new URL('https://github.com/login/oauth/authorize')
    url.search = new URLSearchParams({
      client_id: s.sso.github.clientId,
      redirect_uri: redirectUri(s, 'github'),
      // user:email is the only way to see which addresses GitHub has verified.
      scope: 'read:user user:email',
      state,
      code_challenge: challenge(verifier),
      code_challenge_method: 'S256',
    })
    return url.toString()
  },
  async exchange(s, { code, verifier }) {
    const tokens = await postForm('https://github.com/login/oauth/access_token', {
      client_id: s.sso.github.clientId,
      client_secret: s.sso.github.clientSecret,
      code,
      redirect_uri: redirectUri(s, 'github'),
      code_verifier: verifier,
    })
    const [user, emails] = await Promise.all([githubApi('/user', tokens.access_token), githubApi('/user/emails', tokens.access_token)])
    if (user?.id == null) throw new SsoError('exchange_failed')
    const verified = (Array.isArray(emails) ? emails : []).filter((e) => e.verified)
    const chosen = verified.find((e) => e.primary) ?? verified[0]
    const fallback = (Array.isArray(emails) ? emails : []).find((e) => e.primary)
    const email = (chosen ?? fallback)?.email?.toLowerCase() ?? null
    return { subject: String(user.id), email, emailVerified: !!chosen, name: user.name || '', handle: suggestHandle(user.login, email?.split('@')[0]) }
  },
}

// Apple has no static secret: a short-lived ES256 JWT signed with the .p8 key stands in for one.
function appleClientSecret(s) {
  const { teamId, keyId, clientId, privateKey } = s.sso.apple
  return jwt.sign({}, privateKey, {
    algorithm: 'ES256', keyid: keyId, issuer: teamId, subject: clientId,
    audience: 'https://appleid.apple.com', expiresIn: '5m',
  })
}

const apple = {
  // SameSite=None (needed for Apple's cross-site form_post) requires Secure, so https only.
  configured: (s) => {
    const a = s.sso?.apple
    return !!(a?.clientId && a.teamId && a.keyId && a.privateKey) && /^https:\/\//.test(s.publicOrigin || '')
  },
  authorizeUrl(s, { state, nonce }) {
    const url = new URL('https://appleid.apple.com/auth/authorize')
    url.search = new URLSearchParams({
      client_id: s.sso.apple.clientId,
      redirect_uri: redirectUri(s, 'apple'),
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state, nonce,
    })
    return url.toString()
  },
  async exchange(s, { code, nonce, form = {} }) {
    const tokens = await postForm('https://appleid.apple.com/auth/token', {
      client_id: s.sso.apple.clientId,
      client_secret: appleClientSecret(s),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(s, 'apple'),
    })
    const c = idTokenClaims(tokens.id_token, { issuer: 'https://appleid.apple.com', audience: s.sso.apple.clientId, nonce })
    // Apple sends the name once, on the first sign-in, in the form body rather than the token.
    let name = ''
    try {
      const user = typeof form.user === 'string' ? JSON.parse(form.user) : null
      name = [user?.name?.firstName, user?.name?.lastName].filter((v) => typeof v === 'string' && v).join(' ')
    } catch { /* only costs the name */ }
    const email = typeof c.email === 'string' ? c.email.toLowerCase() : null
    const priv = c.is_private_email === true || c.is_private_email === 'true'
    return {
      subject: String(c.sub), email,
      emailVerified: c.email_verified === true || c.email_verified === 'true',
      name, handle: suggestHandle(name, priv ? '' : email?.split('@')[0]),
    }
  },
}

const PROVIDERS = { apple, google, github }

// The redirect URI comes only from publicOrigin, so without it no provider is usable.
export function provider(settings, id) {
  if (!Object.hasOwn(PROVIDERS, id) || !settings?.publicOrigin) return null
  return PROVIDERS[id].configured(settings) ? PROVIDERS[id] : null
}

export const ssoEnabled = (settings) => Object.fromEntries(Object.keys(PROVIDERS).map((id) => [id, !!provider(settings, id)]))
