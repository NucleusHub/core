import { Router } from 'express'
import Profile, { accountSummary, colorFromName } from '../models/Profile.js'
import Group from '../models/Group.js'
import UserOverride from '../models/UserOverride.js'
import { getSettings } from '../models/AuthSettings.js'
import { consumeEmailToken, issueEmailToken, recentlyIssued, revokeEmailTokens } from '../models/EmailToken.js'
import { requireAuth } from '../middleware/auth.js'
import { serverCodeGate } from '../middleware/serverCode.js'
import { issueSession, isHttps, revokeAllSessions, revokeSession } from '../lib/session.js'
import { cookiePassed, grantServerAccess } from '../lib/serverCode.js'
import { checkPasswordStrength, hashPassword, needsRehash, verifyPassword } from '../lib/password.js'
import { mailEnabled, sendPasswordReset, sendVerification } from '../lib/mailer.js'
import { rateLimiter } from '../lib/rateLimit.js'

const HANDLE = /^[a-z0-9][a-z0-9-]{1,38}$/
// No list or comment syntax around the @: a mail library would read those as several addresses.
const EMAIL = /^[^@\s,;<>()"[\]\\]+@[^@\s.,;<>()"[\]\\]+(\.[^@\s.,;<>()"[\]\\]+)+$/
const ACCENTS = ['nucleus', 'midnight', 'arctic', 'ember', 'forest', 'custom']
const HEX = /^#[0-9A-Fa-f]{6}$/
const WINDOW_MS = 15 * 60 * 1000

// Unknown accounts cost the same scrypt time as wrong passwords, so timing can't reveal which emails exist.
const DECOY_HASH = await hashPassword(`decoy:${Math.random()}`)

const fail = (res, status, code, error, extra) => res.status(status).json({ error, code, ...extra })
const invalid = (res, fields) => fail(res, 400, 'invalid', Object.values(fields)[0] || 'Some fields need fixing.', { fields })
const tokenInvalid = (res) => fail(res, 400, 'token_invalid', 'That link has expired or was already used. Ask for a new one.')
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next)
  } catch (err) {
    console.error('[nid]', err)
    if (!res.headersSent) res.status(500).json({ error: 'Server error' })
  }
}

function requireNid(req, res, next) {
  return requireAuth(req, res, () => req.profile.via === 'nid'
    ? next()
    : fail(res, 403, 'nid_required', 'Sign in with NucleusID to do this.'))
}

function checkHandle(h) {
  return HANDLE.test(h) ? null : 'Lowercase letters, numbers and dashes, 2–39 characters, not starting with a dash.'
}
function checkEmail(e) {
  return e.length <= 200 && EMAIL.test(e) ? null : 'That does not look like an email address.'
}
function checkDisplayName(d) {
  return d && d.length <= 80 ? null : 'Enter a name of up to 80 characters.'
}

function parseAccount(body, { displayName }) {
  const b = body && typeof body === 'object' ? body : {}
  const values = { handle: norm(b.handle), email: norm(b.email), password: b.password }
  const fields = {}
  const h = checkHandle(values.handle)
  if (h) fields.handle = h
  const e = checkEmail(values.email)
  if (e) fields.email = e
  const p = checkPasswordStrength(values.password)
  if (p) fields.password = p
  if (displayName) {
    values.displayName = typeof b.displayName === 'string' ? b.displayName.trim() : ''
    const d = checkDisplayName(values.displayName)
    if (d) fields.displayName = d
  }
  return { values, fields: Object.keys(fields).length ? fields : null }
}

function parseAppearance(value) {
  if (value === null) return { value: null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Send an object, or null to reset it.' }
  if (!ACCENTS.includes(value.accent)) return { error: `Accent must be one of ${ACCENTS.join(', ')}.` }
  const stamp = new Date().toISOString()
  if (value.accent !== 'custom') return { value: { accent: value.accent, updatedAt: stamp } }
  if (typeof value.customAccent !== 'string' || !HEX.test(value.customAccent)) return { error: 'customAccent must be a colour as #RRGGBB.' }
  return { value: { accent: 'custom', customAccent: value.customAccent.toUpperCase(), updatedAt: stamp } }
}

const duplicateField = (err) => {
  if (err?.code !== 11000) return null
  const key = Object.keys(err.keyPattern || err.keyValue || {}).join()
  return key.includes('handle') ? 'handle' : key.includes('email') ? 'email' : null
}
const conflict = (res, field) => field === 'handle'
  ? fail(res, 409, 'handle_taken', 'That handle is taken.', { fields: { handle: 'Taken.' } })
  : fail(res, 409, 'email_taken', 'That email already has an account.', { fields: { email: 'Already registered.' } })

function newAccount({ handle: h, email }, passwordHash, verified) {
  return {
    handle: h, handleLower: h, email, emailLower: email,
    emailVerifiedAt: verified ? new Date() : null,
    passwordHash, appearance: null, serverAccess: false, identities: [], createdAt: new Date(),
  }
}

// An unconfirmed claim owns neither address nor handle, so a typo or squatter can't block the real owner.
async function releaseUnverified({ handle: h, email }, exceptId) {
  const or = []
  if (email) or.push({ 'account.emailLower': email })
  if (h) or.push({ 'account.handleLower': h })
  const filter = { account: { $exists: true }, 'account.emailVerifiedAt': null, $or: or }
  if (exceptId) filter._id = { $ne: exceptId }
  for (const p of await Profile.find(filter).select('_id pin lastLoginAt').lean()) {
    await revokeEmailTokens(p._id)
    // Never-used sign-ups go entirely; an upgraded profile just loses its unconfirmed account.
    if (!p.pin && !p.lastLoginAt) await Profile.deleteOne({ _id: p._id, 'account.emailVerifiedAt': null })
    else await Profile.updateOne({ _id: p._id, 'account.emailVerifiedAt': null }, { $unset: { account: '' } })
  }
}

function origin(req) {
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim()
  return `${isHttps(req) ? 'https' : 'http'}://${host}`
}

async function mailVerification(req, settings, profile) {
  const token = await issueEmailToken(profile._id, 'verify', profile.account.emailLower)
  await sendVerification(settings, { to: profile.account.email, url: `${origin(req)}/?verify=${token}` })
}

const profileView = (p) => ({
  _id: p._id, profileId: p._id, name: p.name, role: p.role, emoji: p.emoji, color: p.color,
  pinTemporary: false, hasImage: !!p.image, imageUpdatedAt: p.imageUpdatedAt, account: accountSummary(p),
})

const accountView = (p) => ({
  ...accountSummary(p),
  displayName: p.name,
  serverAccess: !!p.account.serverAccess,
  identities: (p.account.identities || []).map(({ provider, email, linkedAt }) => ({ provider, email, linkedAt })),
  createdAt: p.account.createdAt,
})

async function signIn(req, res, profileId, settings) {
  const profile = await Profile.findByIdAndUpdate(profileId, { lastLoginAt: new Date() }, { new: true }).lean()
  await issueSession(req, res, profile, 'nid')
  // Came through the gate with the pass cookie: the account keeps access after key rotations.
  if (settings.serverCode && cookiePassed(req, settings.serverCode)) await grantServerAccess(profile._id)
  return profile
}

const hasAdmin = async () => !!(await Profile.exists({ role: 'admin', isGuest: false }))

export function nidRouter() {
  const router = Router()

  const limit = (name) => rateLimiter({
    max: 10,
    windowMs: WINDOW_MS,
    key: (req) => `${name}|${req.ip}|${norm(req.body?.email ?? req.body?.handle) || req.profile?.profileId || ''}`,
    onLimit: (res) => fail(res, 429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.'),
  })

  router.post('/register', serverCodeGate, limit('register'), handle(async (req, res) => {
    const { values, fields } = parseAccount(req.body, { displayName: true })
    if (fields) return invalid(res, fields)
    const settings = await getSettings()
    if (!settings.signupOpen && await hasAdmin())
      return fail(res, 403, 'signup_closed', 'Sign-up is closed on this server. Ask its admin for an account.')

    const passwordHash = await hashPassword(values.password)
    const verified = !mailEnabled(settings)
    await releaseUnverified(values)
    let profile
    try {
      profile = await Profile.create({
        name: values.displayName.slice(0, 64),
        color: colorFromName(values.displayName),
        role: (await hasAdmin()) ? 'user' : 'admin',
        whatsNew: { lastSeenAt: new Date() },
        account: newAccount(values, passwordHash, verified),
      })
    } catch (err) {
      const field = duplicateField(err)
      if (field) return conflict(res, field)
      throw err
    }

    if (!verified) {
      try {
        await mailVerification(req, settings, profile)
      } catch (err) {
        console.error('[nid] verification mail failed', err)
        return fail(res, 503, 'mail_failed', 'We could not send the confirmation email. Try again in a minute.')
      }
      return res.status(201).json({ pending: true, email: profile.account.email })
    }
    res.status(201).json({ profile: profileView(await signIn(req, res, profile._id, settings)) })
  }))

  router.post('/verify', serverCodeGate, handle(async (req, res) => {
    const row = await consumeEmailToken(req.body?.token, 'verify')
    if (!row) return tokenInvalid(res)
    const ok = await Profile.updateOne(
      { _id: row.profileId, 'account.emailLower': row.email },
      { $set: { 'account.emailVerifiedAt': new Date() } },
    )
    if (!ok.matchedCount) return tokenInvalid(res)
    const settings = await getSettings()
    res.json({ profile: profileView(await signIn(req, res, row.profileId, settings)) })
  }))

  router.post('/login', serverCodeGate, limit('login'), handle(async (req, res) => {
    const id = norm(req.body?.email ?? req.body?.handle)
    const password = req.body?.password
    if (!id) return invalid(res, { email: 'Enter your email or handle.' })
    if (typeof password !== 'string' || !password) return invalid(res, { password: 'Enter your password.' })

    const filter = id.includes('@') ? { 'account.emailLower': id } : { 'account.handleLower': id }
    const profile = await Profile.findOne(filter).lean()
    const ok = await verifyPassword(password, profile?.account?.passwordHash ?? DECOY_HASH)
    if (!profile || !ok) return fail(res, 401, 'invalid_credentials', 'That email and password do not match.')

    const settings = await getSettings()
    if (mailEnabled(settings) && !profile.account.emailVerifiedAt) {
      if (!(await recentlyIssued(profile._id, 'verify')))
        await mailVerification(req, settings, profile).catch((err) => console.error('[nid] verification mail failed', err))
      return fail(res, 403, 'email_unverified', `Confirm your email first. We sent a link to ${profile.account.email}.`)
    }
    if (needsRehash(profile.account.passwordHash))
      await Profile.updateOne({ _id: profile._id }, { $set: { 'account.passwordHash': await hashPassword(password) } })
    res.json({ profile: profileView(await signIn(req, res, profile._id, settings)) })
  }))

  router.post('/upgrade', requireAuth, limit('upgrade'), handle(async (req, res) => {
    const { values, fields } = parseAccount(req.body, { displayName: false })
    if (fields) return invalid(res, fields)
    const current = await Profile.findById(req.profile.profileId).lean()
    if (!current) return fail(res, 401, 'unauthenticated', 'Profile not found')
    if (current.isGuest) return fail(res, 403, 'guest_profile', 'Guest profiles cannot have a NucleusID.')
    if (current.account) return fail(res, 409, 'account_exists', 'This profile already has a NucleusID.')

    const settings = await getSettings()
    const verified = !mailEnabled(settings)
    const passwordHash = await hashPassword(values.password)
    await releaseUnverified(values, current._id)
    let profile
    try {
      profile = await Profile.findOneAndUpdate(
        { _id: current._id, account: { $exists: false } },
        { $set: { account: newAccount(values, passwordHash, verified) } },
        { new: true },
      ).lean()
    } catch (err) {
      const field = duplicateField(err)
      if (field) return conflict(res, field)
      throw err
    }
    if (!profile) return fail(res, 409, 'account_exists', 'This profile already has a NucleusID.')

    if (!verified) {
      try {
        await mailVerification(req, settings, profile)
      } catch (err) {
        console.error('[nid] verification mail failed', err)
        // Unbind so a retry isn't stuck on account_exists.
        await Profile.updateOne({ _id: profile._id }, { $unset: { account: '' } })
        return fail(res, 503, 'mail_failed', 'We could not send the confirmation email. Try again in a minute.')
      }
      return res.status(201).json({ pending: true, email: profile.account.email })
    }
    await revokeSession(req.profile.sid)
    res.json({ profile: profileView(await signIn(req, res, profile._id, settings)) })
  }))

  router.post('/password', requireNid, limit('password'), handle(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {}
    const weak = checkPasswordStrength(newPassword)
    if (weak) return invalid(res, { newPassword: weak })
    const profile = await Profile.findById(req.profile.profileId).lean()
    if (!profile?.account) return fail(res, 404, 'no_account', 'This profile has no NucleusID.')
    if (!profile.account.passwordHash)
      return fail(res, 400, 'no_password', 'This account has no password yet. Use “Forgot password” to set one.')
    if (!(await verifyPassword(currentPassword, profile.account.passwordHash)))
      return fail(res, 400, 'wrong_password', 'That is not your current password.', { fields: { currentPassword: 'Wrong password.' } })

    await Profile.updateOne({ _id: profile._id }, { $set: { 'account.passwordHash': await hashPassword(newPassword) } })
    // A reset link requested before the change would undo it.
    await revokeEmailTokens(profile._id, 'reset')
    await revokeAllSessions(profile._id, req.profile.sid)
    res.status(204).end()
  }))

  router.post('/forgot', serverCodeGate, limit('forgot'), handle(async (req, res) => {
    const email = norm(req.body?.email)
    const base = origin(req)
    // Answer first, send later: neither the reply nor its timing says whether the address has an account.
    res.status(204).end()
    if (!email) return
    setImmediate(async () => {
      try {
        const settings = await getSettings()
        if (!mailEnabled(settings)) return
        const profile = await Profile.findOne({ 'account.emailLower': email }).lean()
        if (!profile || await recentlyIssued(profile._id, 'reset')) return
        const token = await issueEmailToken(profile._id, 'reset', email)
        await sendPasswordReset(settings, { to: profile.account.email, url: `${base}/?reset=${token}` })
      } catch (err) {
        console.error('[nid] reset mail failed', err)
      }
    })
  }))

  router.post('/reset', serverCodeGate, handle(async (req, res) => {
    const weak = checkPasswordStrength(req.body?.password)
    if (weak) return invalid(res, { password: weak })
    const row = await consumeEmailToken(req.body?.token, 'reset')
    if (!row) return tokenInvalid(res)
    const profile = await Profile.findOne({ _id: row.profileId, 'account.emailLower': row.email }).lean()
    if (!profile) return tokenInvalid(res)

    // The link reached the inbox, so the address is proven too.
    await Profile.updateOne({ _id: profile._id }, {
      $set: {
        'account.passwordHash': await hashPassword(req.body.password),
        'account.emailVerifiedAt': profile.account.emailVerifiedAt || new Date(),
      },
    })
    await revokeEmailTokens(profile._id, 'reset')
    await revokeAllSessions(profile._id)
    const settings = await getSettings()
    res.json({ profile: profileView(await signIn(req, res, profile._id, settings)) })
  }))

  router.post('/logout-all', requireAuth, handle(async (req, res) => {
    await revokeAllSessions(req.profile.profileId)
    res.clearCookie('nucleus_token', { path: '/' })
    res.status(204).end()
  }))

  router.get('/account', requireAuth, handle(async (req, res) => {
    const profile = await Profile.findById(req.profile.profileId).lean()
    if (!profile?.account) return fail(res, 404, 'no_account', 'This profile has no NucleusID.')
    res.set('Cache-Control', 'no-store').json(accountView(profile))
  }))

  router.patch('/account', requireNid, handle(async (req, res) => {
    const profile = await Profile.findById(req.profile.profileId).lean()
    if (!profile?.account) return fail(res, 404, 'no_account', 'This profile has no NucleusID.')
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const fields = {}
    const $set = {}
    let newEmail = null

    if ('displayName' in body) {
      const d = typeof body.displayName === 'string' ? body.displayName.trim() : ''
      const e = checkDisplayName(d)
      if (e) fields.displayName = e
      else $set.name = d.slice(0, 64)
    }
    if ('handle' in body) {
      const h = norm(body.handle)
      const e = checkHandle(h)
      if (e) fields.handle = e
      else if (h !== profile.account.handleLower) Object.assign($set, { 'account.handle': h, 'account.handleLower': h })
    }
    if ('email' in body) {
      const m = norm(body.email)
      const e = checkEmail(m)
      if (e) fields.email = e
      else if (m !== profile.account.emailLower) {
        newEmail = m
        Object.assign($set, { 'account.email': m, 'account.emailLower': m })
      }
    }
    if ('appearance' in body) {
      const a = parseAppearance(body.appearance)
      if (a.error) fields.appearance = a.error
      else $set['account.appearance'] = a.value
    }
    if (Object.keys(fields).length) return invalid(res, fields)

    const settings = await getSettings()
    const mustVerify = !!newEmail && mailEnabled(settings)
    if (mustVerify) $set['account.emailVerifiedAt'] = null
    await releaseUnverified({ handle: $set['account.handleLower'], email: newEmail }, profile._id)
    try {
      if (Object.keys($set).length) await Profile.updateOne({ _id: profile._id }, { $set })
    } catch (err) {
      const field = duplicateField(err)
      if (field) return conflict(res, field)
      throw err
    }
    const updated = await Profile.findById(profile._id).lean()
    if (mustVerify) {
      await revokeEmailTokens(profile._id, 'verify')
      await mailVerification(req, settings, updated).catch((err) => console.error('[nid] verification mail failed', err))
    }
    res.json(accountView(updated))
  }))

  router.delete('/account', requireAuth, limit('delete'), handle(async (req, res) => {
    const profile = await Profile.findById(req.profile.profileId).lean()
    if (!profile?.account) return fail(res, 404, 'no_account', 'This profile has no NucleusID.')
    if (profile.account.passwordHash) {
      if (!(await verifyPassword(req.body?.password, profile.account.passwordHash)))
        return fail(res, 400, 'wrong_password', 'That is not your password.', { fields: { password: 'Wrong password.' } })
    } else if (norm(req.body?.handle).replace(/^@/, '') !== profile.account.handleLower) {
      return invalid(res, { handle: 'Type your handle exactly as it is shown.' })
    }
    if (profile.role === 'admin' && (await Profile.countDocuments({ role: 'admin', isGuest: false })) <= 1)
      return fail(res, 400, 'last_admin', 'You are the only admin. Make someone else an admin first.')

    const id = String(profile._id)
    await Group.updateMany({ memberIds: id }, { $pull: { memberIds: id } })
    await UserOverride.deleteMany({ profileId: id })
    await revokeEmailTokens(profile._id)
    await Profile.deleteOne({ _id: profile._id })
    await revokeAllSessions(profile._id)
    res.clearCookie('nucleus_token', { path: '/' })
    res.status(204).end()
  }))

  return router
}
