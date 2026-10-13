import jwt from 'jsonwebtoken'
import Profile from '../models/Profile.js'
import Session from '../models/Session.js'
import { jwtSecret } from '../lib/secret.js'
import { findAccessToken } from '../lib/oauth.js'

// Claims of a valid cookie backed by a live session, else null.
export async function authenticate(req) {
  const token = req.cookies?.nucleus_token
  if (!token) return null
  let claims
  try {
    claims = jwt.verify(token, jwtSecret())
  } catch {
    return null
  }
  if (typeof claims.sid !== 'string') return null
  const live = await Session.exists({ _id: claims.sid, expiresAt: { $gt: new Date() } })
  return live ? claims : null
}

export async function requireAuth(req, res, next) {
  if (!req.cookies?.nucleus_token) return res.status(401).json({ error: 'Unauthenticated' })
  let claims
  try {
    claims = await authenticate(req)
  } catch {
    return res.status(500).json({ error: 'Server error' })
  }
  if (!claims) return res.status(401).json({ error: 'Invalid or expired token' })
  req.profile = claims
  next()
}

export async function optionalAuth(req, _res, next) {
  try {
    const claims = await authenticate(req)
    if (claims) req.profile = claims
  } catch { /* treated as logged out */ }
  next()
}

// Re-checks role in DB so demotions take effect immediately without waiting for token expiry.
export function requireAdmin(req, res, next) {
  return requireAuth(req, res, async () => {
    try {
      const profile = await Profile.findById(req.profile.profileId).select('role').lean()
      if (!profile || profile.role !== 'admin')
        return res.status(403).json({ error: 'Admin required' })
      next()
    } catch {
      res.status(403).json({ error: 'Admin required' })
    }
  })
}

export function requireNidAdmin(req, res, next) {
  return requireAdmin(req, res, () => {
    if (req.profile.via !== 'nid')
      return res.status(403).json({ error: 'Sign in with NucleusID to manage this server', code: 'nid_required' })
    next()
  })
}

// Bearer access token from an app (RFC 6750 headers); sets req.grant, never req.profile.
export function requireAccessToken(scope) {
  return async (req, res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ')
    let found = null
    try {
      found = scheme?.toLowerCase() === 'bearer' ? await findAccessToken(token) : null
    } catch {
      return res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong.' } })
    }
    if (!found) {
      res.set('WWW-Authenticate', token ? 'Bearer realm="nucleus", error="invalid_token"' : 'Bearer realm="nucleus"')
      return res.status(401).json({ error: { code: 'unauthorized', message: 'A valid Nucleus ID access token is required.' } })
    }
    if (scope && !found.scopes.includes(scope)) {
      res.set('WWW-Authenticate', `Bearer realm="nucleus", error="insufficient_scope", scope="${scope}"`)
      return res.status(403).json({ error: { code: 'forbidden', message: `This needs the "${scope}" scope. Sign in again asking for it.` } })
    }
    req.grant = found
    next()
  }
}
