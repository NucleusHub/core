import { Router } from 'express'
import { getSettings } from '../../models/AuthSettings.js'
import { optionalAuth } from '../../middleware/auth.js'
import { isHttps } from '../../lib/session.js'
import {
  SERVER_CODE_COOKIE, SERVER_CODE_TTL_SEC, cookiePassed, fingerprint, grantServerAccess,
  isServerCode, sameCode, sign,
} from '../../lib/serverCode.js'

const WINDOW_MS = 15 * 60 * 1000
const MAX_TRIES = 10

const v1Error = (res, status, code, message) => res.status(status).json({ error: { code, message } })

// Per-app state so each createApp() (and each test) starts with a fresh window.
function rateLimiter() {
  const hits = new Map()
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const now = Date.now()
    for (const [key, e] of hits) if (now > e.resetAt) hits.delete(key)
    let entry = hits.get(ip)
    if (!entry) entry = { count: 0, resetAt: now + WINDOW_MS }
    entry.count++
    hits.set(ip, entry)
    if (entry.count > MAX_TRIES) return v1Error(res, 429, 'rate_limited', 'Too many requests. Give it a minute.')
    next()
  }
}

const serverError = (res) => v1Error(res, 500, 'server_error', 'Something went wrong.')

export function serverCodeRouter() {
  const router = Router()

  router.get('/', optionalAuth, async (req, res) => {
    try {
      const { serverCode } = await getSettings()
      const passed = !serverCode || !!req.profile || cookiePassed(req, serverCode)
      res.set('Cache-Control', 'no-store').json({ required: !!serverCode, passed })
    } catch {
      serverError(res)
    }
  })

  router.post('/', rateLimiter(), optionalAuth, async (req, res) => {
    const given = req.body?.code
    if (!isServerCode(given)) return v1Error(res, 403, 'server_code_invalid', "This isn't a Nucleus server code.")
    try {
      const { serverCode } = await getSettings()
      if (!serverCode || !sameCode(given, serverCode))
        return v1Error(res, 403, 'server_code_rejected', "The server didn't accept this code.")
      res.cookie(SERVER_CODE_COOKIE, sign({ f: fingerprint(serverCode) }, SERVER_CODE_TTL_SEC), {
        httpOnly: true, sameSite: 'lax', secure: isHttps(req), maxAge: SERVER_CODE_TTL_SEC * 1000, path: '/',
      })
      if (req.profile) await grantServerAccess(req.profile.profileId)
      res.status(204).end()
    } catch {
      serverError(res)
    }
  })

  return router
}
