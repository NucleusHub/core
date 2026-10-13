import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

// Stored as scrypt$N$r$p$salt$hash so raising the cost later keeps old hashes verifiable.
const PARAMS = { N: 32768, r: 8, p: 1 }
const KEY_LENGTH = 64
// 128·N·r is ~32MB, exactly the default cap, so scrypt needs headroom.
const MAX_MEM = 96 * 1024 * 1024

export const MIN_LENGTH = 10
const MAX_LENGTH = 200

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM })
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$')
}

// Malformed hashes read as a wrong password, never a 500 that reveals the account exists.
export async function verifyPassword(password, stored) {
  try {
    if (typeof password !== 'string') return false
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    if (!salt.length || !expected.length) return false
    const actual = await scrypt(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: MAX_MEM })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function needsRehash(stored) {
  const [scheme, N, r, p] = String(stored).split('$')
  return scheme !== 'scrypt' || Number(N) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p
}

export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || !password) return 'Enter a password.'
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`
  if (password.length > MAX_LENGTH) return `Keep it under ${MAX_LENGTH} characters.`
  return null
}
