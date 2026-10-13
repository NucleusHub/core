import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import mongoose from 'mongoose'
import Profile from '../models/Profile.js'
import { jwtSecret } from './secret.js'

const FORMAT = /^nucleus[0-9A-Za-z]{32}home$/
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export const SERVER_CODE_COOKIE = 'nucleus_server_code'
export const SERVER_CODE_TTL_SEC = 30 * 86400

export const isServerCode = (value) => typeof value === 'string' && FORMAT.test(value)

export function generateServerCode() {
  let middle = ''
  for (let i = 0; i < 32; i++) middle += ALPHABET[randomInt(ALPHABET.length)]
  return `nucleus${middle}home`
}

export function sameCode(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

// The pass cookie carries this, so a new code makes old cookies worthless.
export const fingerprint = (code) => createHash('sha256').update(`server-code:${code}`).digest('base64url')

// Own key derived from the JWT secret, so a signed value can't double as a JWT or vice versa.
const key = () => createHash('sha256').update(`server-code-cookie:${jwtSecret()}`).digest()
const mac = (payload) => createHmac('sha256', key()).update(payload).digest('base64url')

export function sign(value, ttlSec) {
  const payload = Buffer.from(JSON.stringify({ ...value, exp: Date.now() + ttlSec * 1000 })).toString('base64url')
  return `${payload}.${mac(payload)}`
}

export function unsign(raw) {
  if (typeof raw !== 'string') return null
  const [payload, signature] = raw.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(mac(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof value?.exp === 'number' && value.exp > Date.now() ? value : null
  } catch {
    return null
  }
}

export const cookiePassed = (req, code) =>
  !!code && unsign(req.cookies?.[SERVER_CODE_COOKIE])?.f === fingerprint(code)

export const hasServerAccess = (profile) => profile?.account?.serverAccess === true

// Only NucleusID accounts keep access across key rotations; plain profiles have no account.
export async function grantServerAccess(profileId) {
  await Profile.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(profileId)), account: { $exists: true } },
    { $set: { 'account.serverAccess': true } },
  )
}
