import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

const LEGACY_SECRET = 'nucleus-jwt-secret'
const SESSION_CACHE_MS = 10_000
const sessionCache = new Map()
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

export async function verifyProfile(req) {
  const token = req.cookies?.nucleus_token
  if (!token) return null
  try {
    return await verifyToken(token)
  } catch {
    return null
  }
}

export async function requireAuth(req, res, next) {
  const token = req.cookies?.nucleus_token
  if (!token) return res.status(401).json({ error: 'Unauthenticated' })
  try {
    req.profile = await verifyToken(token)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  next()
}
