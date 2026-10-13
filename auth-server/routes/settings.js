import { Router } from 'express'
import AuthSettings, { DEFAULT_LIMITS, getSettings, invalidateSettings, publicSettings } from '../models/AuthSettings.js'
import Profile from '../models/Profile.js'
import { requireNidAdmin } from '../middleware/auth.js'
import { generateServerCode } from '../lib/serverCode.js'
import { isHttps, revokeAllSessions } from '../lib/session.js'
import { hashPassword } from '../lib/password.js'
import { revokeEmailTokens } from '../models/EmailToken.js'
import { randomBytes } from 'node:crypto'
import mongoose from 'mongoose'

const router = Router()

const MASK = '••••'
const SECRETS = ['mail.resendKey', 'sso.apple.privateKey', 'sso.google.clientSecret', 'sso.github.clientSecret']
const STRING_FIELDS = {
  mail: ['resendKey', 'from'],
  'sso.apple': ['clientId', 'teamId', 'keyId', 'privateKey'],
  'sso.google': ['clientId', 'clientSecret'],
  'sso.github': ['clientId', 'clientSecret'],
}
const APPS = ['todo', 'notes', 'watchlist']
const DISCOVERY_PATH = '/api/v1/oauth/metadata'
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)

function masked(settings) {
  const out = structuredClone(settings)
  for (const path of SECRETS) {
    const keys = path.split('.')
    const parent = get(out, keys.slice(0, -1).join('.'))
    const value = parent?.[keys.at(-1)]
    if (value) parent[keys.at(-1)] = MASK + String(value).slice(-4)
  }
  return out
}

class BadRequest extends Error {}

function validLimits(limits, partial) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new BadRequest('limits must be an object')
  const out = {}
  for (const [k, v] of Object.entries(limits)) {
    if (!(k in DEFAULT_LIMITS)) continue
    if (!Number.isInteger(v) || v <= 0) throw new BadRequest(`limits.${k} must be a positive integer`)
    out[k] = v
  }
  if (!partial && !Object.keys(out).length) throw new BadRequest('limits is empty')
  return out
}

// PATCH body → $set/$unset; masked secrets are echoes of what we sent, so they're skipped.
function toUpdate(body) {
  const $set = {}
  const $unset = {}
  if ('userLogin' in body) {
    if (!['profiles', 'both', 'nid'].includes(body.userLogin)) throw new BadRequest('Invalid userLogin')
    $set.userLogin = body.userLogin
  }
  for (const flag of ['signupOpen', 'pinAfterUpgrade']) {
    if (!(flag in body)) continue
    if (typeof body[flag] !== 'boolean') throw new BadRequest(`${flag} must be a boolean`)
    $set[flag] = body[flag]
  }
  for (const [group, fields] of Object.entries(STRING_FIELDS)) {
    const value = get(body, group)
    if (value === undefined) continue
    if (!value || typeof value !== 'object') throw new BadRequest(`${group} must be an object`)
    for (const field of fields) {
      if (!(field in value)) continue
      const v = value[field]
      if (v !== null && typeof v !== 'string') throw new BadRequest(`${group}.${field} must be a string`)
      if (typeof v === 'string' && v.startsWith(MASK)) continue
      $set[`${group}.${field}`] = v?.trim() || null
    }
  }
  if ('limits' in body) {
    for (const [k, v] of Object.entries(validLimits(body.limits, true))) $set[`limits.${k}`] = v
  }
  if ('clientLimits' in body) {
    const cl = body.clientLimits
    if (!cl || typeof cl !== 'object' || Array.isArray(cl)) throw new BadRequest('clientLimits must be an object')
    for (const [clientId, limits] of Object.entries(cl)) {
      if (!CLIENT_ID_RE.test(clientId)) throw new BadRequest('Invalid client id')
      if (limits === null) $unset[`clientLimits.${clientId}`] = ''
      else $set[`clientLimits.${clientId}`] = validLimits(limits, false)
    }
  }
  const update = {}
  if (Object.keys($set).length) update.$set = $set
  if (Object.keys($unset).length) update.$unset = $unset
  return update
}

function setupFor(req, code) {
  const scheme = isHttps(req) ? 'https' : 'http'
  const rawHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim()
  // URL drops the port when it's the scheme default, which is what the apps expect.
  const url = new URL(`${scheme}://${rawHost}`)
  const file = { scheme, host: url.hostname, ...(url.port ? { port: Number(url.port) } : {}), path: DISCOVERY_PATH, code }
  const query = new URLSearchParams(Object.entries(file).map(([k, v]) => [k, String(v)]))
  const links = Object.fromEntries(APPS.map(app => [app, `com.nucleushome.${app}://server?${query}`]))
  return { code, links, file }
}

router.get('/public', async (_req, res) => {
  try {
    const settings = await getSettings()
    const hasAdmin = (await Profile.countDocuments({ role: 'admin', isGuest: false })) > 0
    res.set('Cache-Control', 'no-store').json({ ...publicSettings(settings), serverCodeRequired: !!settings.serverCode, hasAdmin })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/', requireNidAdmin, async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(masked(await getSettings()))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.patch('/', requireNidAdmin, async (req, res) => {
  let update
  try {
    update = toUpdate(req.body || {})
  } catch (err) {
    if (err instanceof BadRequest) return res.status(400).json({ error: err.message })
    throw err
  }
  try {
    await getSettings()
    if (Object.keys(update).length) await AuthSettings.updateOne({ _id: 'auth' }, update)
    invalidateSettings()
    res.json(masked(await getSettings()))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/server-code', requireNidAdmin, async (req, res) => {
  const action = req.body?.action
  if (action !== 'rotate' && action !== 'clear') return res.status(400).json({ error: 'action must be rotate or clear' })
  try {
    const code = action === 'rotate' ? generateServerCode() : null
    let setup = { code: null, links: null, file: null }
    // Build links before saving so a bad Host header can't leave a code nobody was shown.
    if (code) setup = setupFor(req, code)
    await AuthSettings.updateOne({ _id: 'auth' }, { $set: { serverCode: code } }, { upsert: true, setDefaultsOnInsert: true })
    invalidateSettings()
    res.json(setup)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/accounts', requireNidAdmin, async (_req, res) => {
  try {
    const rows = await Profile.find({ account: { $exists: true } })
      .select('name role lastLoginAt account.handle account.email account.emailVerifiedAt account.createdAt')
      .sort({ 'account.handleLower': 1 }).lean()
    res.set('Cache-Control', 'no-store').json(rows.map(p => ({
      _id: p._id, name: p.name, handle: p.account.handle, email: p.account.email,
      verified: !!p.account.emailVerifiedAt, role: p.role, lastLoginAt: p.lastLoginAt, createdAt: p.account.createdAt,
    })))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// For servers without mail: the admin hands the password over in person, which also vouches for the address.
router.post('/accounts/:id/reset-password', requireNidAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
    const profile = await Profile.findOne({ _id: req.params.id, account: { $exists: true } }).select('account.emailVerifiedAt').lean()
    if (!profile) return res.status(404).json({ error: 'Not found' })
    const temporaryPassword = randomBytes(12).toString('base64url')
    await Profile.updateOne({ _id: profile._id }, {
      $set: {
        'account.passwordHash': await hashPassword(temporaryPassword),
        'account.emailVerifiedAt': profile.account.emailVerifiedAt || new Date(),
      },
    })
    await revokeEmailTokens(profile._id, 'reset')
    await revokeAllSessions(profile._id)
    res.json({ temporaryPassword })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
