import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import Session from '../models/Session.js'
import { jwtSecret } from './secret.js'

const TTL_MS = 30 * 24 * 60 * 60 * 1000

export const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https'

export async function issueSession(req, res, profile, via) {
  const sid = randomBytes(24).toString('base64url')
  const now = Date.now()
  await Session.create({
    _id: sid,
    profileId: profile._id,
    via,
    ua: req.get('user-agent')?.slice(0, 300) || null,
    ip: req.ip || null,
    createdAt: new Date(now),
    lastSeenAt: new Date(now),
    expiresAt: new Date(now + TTL_MS),
  })
  const token = jwt.sign(
    { profileId: profile._id, name: profile.name, role: profile.role, sid, via },
    jwtSecret(),
    { expiresIn: '30d' },
  )
  res.cookie('nucleus_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(req),
    maxAge: TTL_MS,
    path: '/',
  })
  return sid
}

export async function revokeSession(sid) {
  await Session.deleteOne({ _id: sid })
}

export async function revokeAllSessions(profileId, exceptSid) {
  const filter = { profileId }
  if (exceptSid) filter._id = { $ne: exceptSid }
  await Session.deleteMany(filter)
}
