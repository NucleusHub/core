import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

const LEGACY_SECRET = 'nucleus-jwt-secret'
const SESSION_CACHE_MS = 10_000
const sessionCache = new Map()
const tokenCache = new Map()
const roleCache = new Map()
let secretPromise = null

// Mirrors auth-server lib/secret.js; app containers don't mount the auth-server source.
export async function loadJwtSecret(db) {
  const env = process.env.JWT_SECRET
  if (env && env !== LEGACY_SECRET) return env
  const secrets = db.collection('nucleus_secrets')
  try {
    await secrets.updateOne(
      { _id: 'jwt' },
      { $setOnInsert: { value: randomBytes(48).toString('base64url') } },
      { upsert: true },
    )
  } catch (err) {
    if (err.code !== 11000) throw err
  }
  return (await secrets.findOne({ _id: 'jwt' })).value
}

function secret() {
  // Reset on failure so a request before the DB connects doesn't poison the cache.
  secretPromise ??= loadJwtSecret(mongoose.connection.db).catch((err) => {
    secretPromise = null
    throw err
  })
  return secretPromise
}

async function sessionActive(sid) {
  const now = Date.now()
  const hit = sessionCache.get(sid)
  if (hit && now - hit.at < SESSION_CACHE_MS) return hit.ok
  const doc = await mongoose.connection.db.collection('sessions')
    .findOne({ _id: sid }, { projection: { expiresAt: 1 } })
  const ok = !!doc && doc.expiresAt > new Date()
  if (sessionCache.size > 10_000) sessionCache.clear()
  sessionCache.set(sid, { at: now, ok })
  return ok
}

export async function verifyToken(token) {
  const claims = jwt.verify(token, await secret())
  if (typeof claims.sid !== 'string' || !(await sessionActive(claims.sid))) {
    throw new Error('Session expired or revoked')
  }
  return claims
}

// Mirrors auth-server lib/oauth.js findAccessToken: token, grant, client and account must all be live.
async function verifyAccessToken(token) {
  if (typeof token !== 'string' || !token.startsWith('nat_')) return null
  const id = createHash('sha256').update(token, 'utf8').digest('hex')
  const now = Date.now()
  const hit = tokenCache.get(id)
  if (hit && now < hit.until) return hit.profile
  const db = mongoose.connection.db
  const row = await db.collection('oauth_tokens').findOne({ _id: id, kind: 'access', expiresAt: { $gt: new Date(now) } })
  if (!row) return null
  const [grant, client, profile] = await Promise.all([
    db.collection('oauth_grants').findOne({ _id: row.grantId }, { projection: { _id: 1 } }),
    db.collection('oauth_clients').findOne({ _id: row.clientId, revokedAt: null }, { projection: { _id: 1 } }),
    db.collection('profiles').findOne({ _id: row.profileId, account: { $exists: true } }, { projection: { name: 1, role: 1 } }),
  ])
  if (!grant || !client || !profile) return null
  const result = {
    profileId: String(profile._id), name: profile.name, role: profile.role || 'user',
    via: 'oauth', clientId: row.clientId, scopes: row.scopes || [],
  }
  // Negatives aren't cached; positives never outlive the token itself.
  if (tokenCache.size > 10_000) tokenCache.clear()
  tokenCache.set(id, { until: Math.min(now + SESSION_CACHE_MS, row.expiresAt.getTime()), profile: result })
  return result
}

// The Authorization bearer value ('' when the scheme has no token), or null without a bearer header.
function bearerToken(req) {
  const [scheme, token] = (req.headers?.authorization ?? '').split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token ?? '' : null
}

// Admin checks read the role here, not from the JWT, so a demotion applies within the cache window.
export async function profileRole(profileId) {
  const pid = String(profileId)
  const now = Date.now()
  const hit = roleCache.get(pid)
  if (hit && now - hit.at < SESSION_CACHE_MS) return hit.role
  if (!mongoose.isValidObjectId(pid)) return null
  const doc = await mongoose.connection.db.collection('profiles')
    .findOne({ _id: new mongoose.Types.ObjectId(pid) }, { projection: { role: 1 } })
  const role = doc ? doc.role || 'user' : null
  if (roleCache.size > 10_000) roleCache.clear()
  roleCache.set(pid, { at: now, role })
  return role
}

// A bearer header wins over the cookie: an app that sends one means it.
export async function verifyProfile(req) {
  const bearer = bearerToken(req)
  if (bearer !== null) {
    try {
      return await verifyAccessToken(bearer)
    } catch {
      return null
    }
  }
  const token = req.cookies?.nucleus_token
  if (!token) return null
  try {
    return await verifyToken(token)
  } catch {
    return null
  }
}

export async function requireAuth(req, res, next) {
  const bearer = bearerToken(req)
  if (bearer !== null) {
    let profile = null
    try {
      profile = await verifyAccessToken(bearer)
    } catch {
      return res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong.' } })
    }
    if (!profile) {
      res.set('WWW-Authenticate', 'Bearer realm="nucleus", error="invalid_token"')
      return res.status(401).json({ error: { code: 'unauthorized', message: 'A valid Nucleus ID access token is required.' } })
    }
    req.profile = profile
    return next()
  }
  const token = req.cookies?.nucleus_token
  if (!token) {
    res.set('WWW-Authenticate', 'Bearer realm="nucleus"')
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  try {
    req.profile = await verifyToken(token)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  next()
}

// After requireAuth. Cookie sessions are the first-party web and carry no scopes.
export function requireScope(scope) {
  return (req, res, next) => {
    if (req.profile?.via !== 'oauth' || req.profile.scopes.includes(scope)) return next()
    res.set('WWW-Authenticate', `Bearer realm="nucleus", error="insufficient_scope", scope="${scope}"`)
    res.status(403).json({ error: { code: 'forbidden', message: `This needs the "${scope}" scope. Sign in again asking for it.` } })
  }
}
