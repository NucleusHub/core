// QR sign-in rules as pure functions over a row and the time (port of nucleus-web lib/qr-login.js).
// pending -> scanned (scan | claim) -> approved | denied (decide) -> used (pickup).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const TTL_MS = 2 * 60_000
export const ID = /^[A-Za-z0-9_-]{22,64}$/

export const newId = () => randomBytes(16).toString('base64url')
export const newSecret = () => randomBytes(32).toString('base64url')
export const hashSecret = (secret) => createHash('sha256').update(String(secret), 'utf8').digest('hex')

export class QrError extends Error {
  constructor(status, code, message) {
    super(message)
    Object.assign(this, { status, code })
  }
}

export const gone = () => new QrError(404, 'not_found', 'This sign-in code has expired. Show a new one.')
const taken = () => new QrError(409, 'conflict', 'This sign-in code has already been used.')
const unauthorized = (message) => new QrError(401, 'unauthorized', message)
// Any other token holder could otherwise mint a web session or a code for itself.
const untrusted = () => new QrError(403, 'untrusted_client', 'Only Nucleus apps can sign in by QR code.')

const LIVE = new Set(['pending', 'scanned', 'approved'])

// A live request past its time is `expired`.
export function statusAt(row, now) {
  return LIVE.has(row.status) && now >= new Date(row.expiresAt) ? 'expired' : row.status
}

// Unknown and expired look the same.
function live(row, kind, now) {
  if (!row || row.kind !== kind) throw gone()
  const status = statusAt(row, now)
  if (status === 'expired') throw gone()
  return status
}

export function scan(row, { authorId, client, now }) {
  if (!client?.trusted) throw untrusted()
  if (live(row, 'web', now) !== 'pending') throw taken()
  return { status: 'scanned', authorId, scannerClientId: client._id }
}

export function claim(row, { client, now }) {
  if (!client?.trusted) throw untrusted()
  if (live(row, 'app', now) !== 'pending') throw taken()
  return { status: 'scanned' }
}

// The signed-in side answers: an app (`bearer`) for a web request, the website (`session`) for an app's.
export function decide(row, { authorId, via, client, approve, now }) {
  if (!row) throw gone()
  if (via !== (row.kind === 'web' ? 'bearer' : 'session')) {
    throw unauthorized(row.kind === 'web' ? 'Approve this in the app that scanned it.' : 'Approve this on the website.')
  }
  if (via === 'bearer' && !client?.trusted) throw untrusted()
  const status = live(row, row.kind, now)
  if (row.authorId && String(row.authorId) !== String(authorId)) throw gone()
  if (via === 'bearer' && row.scannerClientId && row.scannerClientId !== client._id) throw gone()
  if (status !== 'scanned') throw taken()
  return { status: approve ? 'approved' : 'denied' }
}

// What the website sees while it waits on an app it is signing in.
export function watch(row, { authorId, now }) {
  if (!row || row.kind !== 'app' || String(row.authorId) !== String(authorId)) throw gone()
  return statusAt(row, now)
}

export function secretMatches(row, secret) {
  if (typeof secret !== 'string' || !secret || typeof row?.secretHash !== 'string') return false
  const a = Buffer.from(hashSecret(secret))
  const b = Buffer.from(row.secretHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

// approved -> used happens here, once.
export function pickup(row, { secret, now }) {
  if (!row || !secretMatches(row, secret)) throw gone()
  const status = statusAt(row, now)
  if (status === 'approved') return { patch: { status: 'used' }, status: 'signed-in' }
  // Already picked up: whoever asks again starts over.
  if (status === 'used') return { status: 'expired' }
  return { status }
}

const DEVICE = /^[\p{L}\p{N} .,()\-'’]+$/u

export function cleanDevice(value, fallback) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 60).trim() : ''
  return DEVICE.test(text) ? text : fallback
}

const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const SYSTEMS = [
  [/iPad/, 'iPadOS'],
  [/iPhone|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
]

export function describeBrowser(userAgent = '') {
  const ua = String(userAgent)
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1]
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1]
  if (browser && system) return `${browser} on ${system}`
  return browser ?? (system ? `A browser on ${system}` : 'A web browser')
}

// Same fields as a .nucleusserver setup file.
function server(origin) {
  const url = new URL(origin)
  return { scheme: url.protocol.slice(0, -1), host: url.hostname, ...(url.port ? { port: Number(url.port) } : {}) }
}

// Never the server code: anyone can see this one.
export const webPayload = ({ id, origin }) => JSON.stringify({ login: id, kind: 'web', ...server(origin) })

// Shown only to a signed-in member, so it carries the full setup for a signed-out app.
export const appPayload = ({ id, origin, code }) =>
  JSON.stringify({ login: id, kind: 'app', ...server(origin), ...(code ? { code } : {}) })
