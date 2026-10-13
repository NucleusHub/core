import { getSettings } from '../models/AuthSettings.js'
import { cookiePassed } from '../lib/serverCode.js'
import { authenticate } from './auth.js'

// Logged-out auth needs the server key (pass cookie) once one is set; live sessions are unaffected.
export async function serverCodeGate(req, res, next) {
  try {
    const { serverCode } = await getSettings()
    if (!serverCode || cookiePassed(req, serverCode)) return next()
    const claims = req.profile || await authenticate(req)
    if (claims) return next()
  } catch {
    return res.status(500).json({ error: 'Server error' })
  }
  if (req.originalUrl.toLowerCase().startsWith('/api/v1/'))
    return res.status(403).json({ error: { code: 'server_code_required', message: 'Using this server needs its key.' } })
  res.status(403).json({ error: 'Server key required', code: 'server_code_required' })
}
