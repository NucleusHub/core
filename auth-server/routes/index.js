import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'
import mongoose from 'mongoose'
import Profile, { colorFromName } from '../models/Profile.js'
import RegistryOverride from '../models/RegistryOverride.js'
import UserOverride from '../models/UserOverride.js'
import Group from '../models/Group.js'
import GroupOverride from '../models/GroupOverride.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { resolveViewer, filterProfiles } from '../visibility.js'
import localizationRouter from './localization.js'
import maintenanceRouter from '../plugins/maintenance/server/route.js'
import whatsNewRouter from '../plugins/whats-new/server/route.js'

const router = Router()

// Core localization service (catalogs, config, admin management) at
// /api/auth/i18n/* — see routes/localization.js.
router.use('/i18n', localizationRouter)

// Maintenance-banner control (presets + on/off) at /api/auth/maintenance/* —
// see plugins/maintenance/server/route.js.
router.use('/maintenance', maintenanceRouter)

// "What's New" changelog (feed + per-user seen state + admin CRUD) at
// /api/auth/whats-new/* — see plugins/whats-new/server/route.js.
router.use('/whats-new', whatsNewRouter)
const secret = () => process.env.JWT_SECRET || 'nucleus-jwt-secret'
const COOKIE = {
  httpOnly: true,
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
}

// ── Brute-force guard on /login ──────────────────────────────────────────────
// 10 attempts per IP per 15 minutes, reset on success.

const loginAttempts = new Map()
const RATE_WINDOW_MS = 15 * 60 * 1000
const RATE_MAX = 10

function checkLoginRate(ip) {
  const now = Date.now()
  let entry = loginAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS }
  }
  entry.count++
  loginAttempts.set(ip, entry)
  return entry.count <= RATE_MAX
}

function resetLoginRate(ip) {
  loginAttempts.delete(ip)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id)
}

const PIN_RE = /^[0-9A-F]{4}$/

function isValidPin(pin) {
  return PIN_RE.test(String(pin).toUpperCase())
}

// Accepted avatar image data URLs, and a hard byte cap (~3MB of base64) that
// still leaves headroom under the express.json limit. Images are resized
// client-side, so a well-behaved upload is far smaller than this.
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i
const MAX_IMAGE_LEN = 3_000_000

// Split a data URL into its mime type and decoded bytes, or null if malformed.
function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl))
  if (!m) return null
  try {
    return { mime: m[1], buffer: Buffer.from(m[2], 'base64') }
  } catch {
    return null
  }
}

// Generate a random 4-character hex one-time PIN (0–9, A–F).
function randomPin() {
  const chars = '0123456789ABCDEF'
  let s = ''
  for (let i = 0; i < 4; i++) s += chars[randomInt(16)]
  return s
}

// ── Profile list ────────────────────────────────────────────────────────────

router.get('/profiles', async (req, res) => {
  try {
    const all = await Profile.find().lean()
    const guests = all.filter(p => p.isGuest)
    const regular = all
      .filter(p => !p.isGuest)
      .sort((a, b) => {
        if (!a.lastLoginAt && !b.lastLoginAt) return 0
        if (!a.lastLoginAt) return 1
        if (!b.lastLoginAt) return -1
        return new Date(b.lastLoginAt) - new Date(a.lastLoginAt)
      })
    const mapped = [...regular, ...guests].map(p => ({
      _id: p._id,
      name: p.name,
      role: p.role,
      emoji: p.emoji,
      color: p.color,
      hasPin: !!p.pin,
      pinTemporary: !!p.pinTemporary,
      isGuest: p.isGuest,
      locale: p.locale,
      hasImage: !!p.image,
      imageUpdatedAt: p.imageUpdatedAt,
    }))
    // Group-visibility filter (Home/Garaz) — self-contained, see ../visibility.js.
    // No-op unless state/visibility.json lists groups. The debug header echoes the
    // IP the server sees for this device, so you can fill visibility.json.ips.
    const viewer = resolveViewer(req)
    res.set('X-Nucleus-Viewer-Ip', viewer.ip || '')
    // ?picker=1 → profile picker / account switcher: guests may see the list.
    const picker = req.query.picker === '1' || req.query.picker === 'true'
    res.json(filterProfiles(mapped, viewer, { picker }))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Create profile ──────────────────────────────────────────────────────────
// Allowed without auth only when no admin exists yet (first-run bootstrap).

router.post('/profiles', async (req, res) => {
  try {
    const adminCount = await Profile.countDocuments({ role: 'admin', isGuest: false })
    if (adminCount > 0) {
      const token = req.cookies?.nucleus_token
      if (!token) return res.status(401).json({ error: 'Must be logged in as admin' })
      let claim
      try {
        claim = jwt.verify(token, secret())
      } catch {
        return res.status(401).json({ error: 'Invalid token' })
      }
      // Re-check the role against the DB rather than trusting the token's `role`
      // claim: tokens live 30 days, so a since-demoted admin's stale token must
      // not still authorize creating profiles (including new admins).
      const actor = await Profile.findById(claim.profileId).select('role').lean()
      if (!actor || actor.role !== 'admin') return res.status(403).json({ error: 'Admin required' })
    }

    const { name, role = 'user', pin, emoji, color, pinTemporary, locale } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
    if (pin !== undefined && pin !== null && pin !== '') {
      if (!isValidPin(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 characters (0–9, A–F)' })
    }
    if (color !== undefined && color !== null && color !== '' && !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
      return res.status(400).json({ error: 'Invalid color' })
    }
    // New profiles are regular users. The exception is first-run bootstrap:
    // the very first profile (no admin yet) becomes admin so there's always
    // an initial admin to manage the rest.
    const safeRole = adminCount === 0 ? 'admin' : (role === 'admin' ? 'admin' : 'user')
    // Admins must always have a PIN: a PIN-less profile is logged into from the
    // picker with zero credentials, so a PIN-less admin = unauthenticated takeover.
    if (safeRole === 'admin' && (pin === undefined || pin === null || pin === '')) {
      return res.status(400).json({ error: 'Admin profiles require a PIN' })
    }
    const pinHash = pin ? await bcrypt.hash(String(pin).toUpperCase(), 10) : null
    const isTemp = !!pinHash && !!pinTemporary
    const profile = await Profile.create({
      name: name.trim().slice(0, 64),
      role: safeRole,
      pin: pinHash,
      // Temporary only makes sense alongside an actual PIN to log in with first.
      pinTemporary: isTemp,
      // Keep the plaintext of a one-time PIN so an admin can read it back later.
      pinTempPlain: isTemp ? String(pin).toUpperCase() : null,
      emoji: emoji ? String(emoji).slice(0, 8) : null,
      color: color || colorFromName(name),
      locale: locale ? String(locale).slice(0, 20) : null,
      // Start caught up: a brand-new profile never gets the What's New modal on
      // first login, only announcements published after they joined.
      whatsNew: { lastSeenAt: new Date() },
    })
    res.status(201).json({
      _id: profile._id, name: profile.name, role: profile.role,
      emoji: profile.emoji, color: profile.color, hasPin: !!profile.pin,
      pinTemporary: !!profile.pinTemporary, isGuest: false,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ── Update profile (name / emoji / color / role) ────────────────────────────

router.patch('/profiles/:id', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
    const isOwn = String(req.profile.profileId) === req.params.id
    if (!isOwn && req.profile.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

    const { name, emoji, color, role, locale, image } = req.body
    const update = {}
    if (name !== undefined) update.name = String(name).trim().slice(0, 64)
    if (emoji !== undefined) update.emoji = emoji ? String(emoji).slice(0, 8) : null
    if (color !== undefined) update.color = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : undefined
    if (role !== undefined && req.profile.role === 'admin') update.role = role === 'admin' ? 'admin' : 'user'
    // Admin-assigned UI language. `null`/'' clears it (fall back to the default).
    if (locale !== undefined) update.locale = locale ? String(locale).slice(0, 20) : null
    // Uploaded avatar: null/'' clears it (back to emoji/initials); otherwise a
    // validated, size-capped image data URL. imageUpdatedAt drives client-side
    // cache-busting of the avatar endpoint.
    if (image !== undefined) {
      if (image === null || image === '') {
        update.image = null
        update.imageUpdatedAt = null
      } else if (typeof image === 'string' && IMAGE_DATA_URL_RE.test(image)) {
        if (image.length > MAX_IMAGE_LEN) return res.status(413).json({ error: 'Image too large' })
        update.image = image
        update.imageUpdatedAt = new Date()
      } else {
        return res.status(400).json({ error: 'Invalid image' })
      }
    }

    if (update.color === undefined) delete update.color

    // Guard the last admin: demoting the only remaining admin would lock everyone
    // out of administration, so it's refused.
    if (update.role === 'user') {
      const target = await Profile.findById(req.params.id).select('role').lean()
      if (target?.role === 'admin') {
        const admins = await Profile.countDocuments({ role: 'admin', isGuest: false })
        if (admins <= 1) return res.status(400).json({ error: 'Can’t remove the last admin' })
      }
    }

    // Don't create a credential-free admin: a profile must already have a PIN
    // before it can be promoted (admins are logged into via PIN, never PIN-less).
    if (update.role === 'admin') {
      const target = await Profile.findById(req.params.id).select('pin').lean()
      if (target && !target.pin) {
        return res.status(400).json({ error: 'Set a PIN on this profile before making it an admin' })
      }
    }

    const profile = await Profile.findByIdAndUpdate(req.params.id, update, { new: true })
      .select('-pin -pinTempPlain -image').lean()
    if (!profile) return res.status(404).json({ error: 'Not found' })
    res.json({ ...profile, hasImage: !!profile.imageUpdatedAt })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Avatar image ──────────────────────────────────────────────────────────────
// Serves a profile's uploaded avatar as raw image bytes. Public (no auth) so it
// renders on the profile picker before sign-in — consistent with the picker,
// which already exposes names/colors/emoji. Clients cache-bust with ?v=<ts>
// from imageUpdatedAt, so the response is safely long-lived + immutable.

router.get('/profiles/:id/avatar', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
    const profile = await Profile.findById(req.params.id).select('image').lean()
    if (!profile?.image) return res.status(404).json({ error: 'No avatar' })
    const parsed = parseDataUrl(profile.image)
    if (!parsed) return res.status(404).json({ error: 'No avatar' })
    res.set('Content-Type', parsed.mime)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(parsed.buffer)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Change PIN ──────────────────────────────────────────────────────────────

router.patch('/profiles/:id/pin', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
    const isOwn = String(req.profile.profileId) === req.params.id
    if (!isOwn && req.profile.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

    const { pin, currentPin, temporary } = req.body
    if (pin !== undefined && pin !== null && pin !== '') {
      if (!isValidPin(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 characters (0–9, A–F)' })
    }

    const target = await Profile.findById(req.params.id).select('role pin isGuest')
    if (!target) return res.status(404).json({ error: 'Not found' })
    // Guests have no credentials — a PIN would be meaningless.
    if (target.isGuest) return res.status(400).json({ error: 'Guest profiles cannot have a PIN' })

    // Self-service change: re-prove the current PIN before replacing it, so a
    // walk-up on an already-unlocked session can't silently lock a user out.
    // (Admins reset other users' PINs via the one-time-PIN endpoint instead.)
    if (isOwn && target.pin) {
      const ok = await bcrypt.compare(String(currentPin || '').toUpperCase(), target.pin)
      if (!ok) return res.status(401).json({ error: 'Wrong current PIN' })
    }

    const pinHash = pin ? await bcrypt.hash(String(pin).toUpperCase(), 10) : null
    // Admins must keep a PIN — clearing it would make the account loginable from
    // the picker with no credentials. Block removing an admin's PIN.
    if (!pinHash && target.role === 'admin') {
      return res.status(400).json({ error: 'Admins must keep a PIN' })
    }
    // This path is the user choosing their own PIN (or clearing it): the PIN
    // becomes permanent and any one-time PIN plaintext is wiped. Admins issue
    // one-time PINs through the dedicated reset endpoint below, not here.
    await Profile.findByIdAndUpdate(req.params.id, {
      pin: pinHash,
      pinTemporary: !!pinHash && !!temporary,
      pinTempPlain: null,
    })
    res.json({ ok: true, hasPin: !!pinHash })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Reset PIN (admin-issued one-time PIN) ────────────────────────────────────
// Generates a fresh one-time PIN, returns its plaintext so the admin can relay
// it, and forces the user to choose their own on next sign-in. The plaintext is
// kept (pinTempPlain) so the admin can read it back until the user changes it.

router.post('/profiles/:id/pin/reset', requireAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
    const profile = await Profile.findById(req.params.id)
    if (!profile) return res.status(404).json({ error: 'Not found' })
    if (profile.isGuest) return res.status(400).json({ error: 'Guest profiles cannot have a PIN' })

    const pin = randomPin()
    profile.pin = await bcrypt.hash(pin, 10)
    profile.pinTemporary = true
    profile.pinTempPlain = pin
    await profile.save()
    res.json({ pin, pinTemporary: true, hasPin: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Admin-only: read back the active one-time PIN (plaintext) for a profile, so the
// config modal can keep showing it until the user replaces it. Returns null pin
// when there is no active one-time PIN.
router.get('/profiles/:id/pin-temp', requireAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
    const profile = await Profile.findById(req.params.id).select('pin pinTemporary pinTempPlain').lean()
    if (!profile) return res.status(404).json({ error: 'Not found' })
    res.json({
      hasPin: !!profile.pin,
      pinTemporary: !!profile.pinTemporary,
      pin: profile.pinTemporary ? (profile.pinTempPlain || null) : null,
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Delete profile ──────────────────────────────────────────────────────────
// Destructive: the admin client first tears down the user's data in every app
// (Orbit/Echo/Goals/Watchlist/Pulse), then calls DELETE here to drop group
// membership, per-user overrides and the profile itself. Both the pre-flight
// check and the delete require the acting admin to re-enter their own PIN, so
// the irreversible teardown only runs once the PIN is confirmed.

// Verify the acting admin's PIN and that the target profile may be deleted.
// Returns { status, error } on failure, or { target } on success.
async function authorizeProfileDeletion(req) {
  if (!isValidId(req.params.id)) return { status: 400, error: 'Invalid profile ID' }
  const target = await Profile.findById(req.params.id)
  if (!target) return { status: 404, error: 'Not found' }
  if (target.isGuest) return { status: 400, error: 'Cannot delete Guest' }
  if (String(req.profile.profileId) === String(target._id)) {
    return { status: 400, error: "You can't delete your own profile" }
  }
  // Admins must be demoted to a regular user before they can be deleted.
  if (target.role === 'admin') {
    return { status: 400, error: 'Demote this admin to a user before deleting' }
  }
  const admin = await Profile.findById(req.profile.profileId)
  if (!admin) return { status: 401, error: 'Session profile not found' }
  if (admin.pin) {
    const { pin } = req.body || {}
    if (!pin) return { status: 401, error: 'PIN required' }
    const ok = await bcrypt.compare(String(pin).toUpperCase(), admin.pin)
    if (!ok) return { status: 401, error: 'Wrong PIN' }
  }
  return { target }
}

// Pre-flight: confirm the admin's PIN before the client runs the data teardown.
router.post('/profiles/:id/confirm-delete', requireAdmin, async (req, res) => {
  try {
    const r = await authorizeProfileDeletion(req)
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/profiles/:id', requireAdmin, async (req, res) => {
  try {
    const r = await authorizeProfileDeletion(req)
    if (r.error) return res.status(r.status).json({ error: r.error })
    const id = String(req.params.id)
    // Drop the user from any groups they belonged to, plus their override rows.
    await Group.updateMany({ memberIds: id }, { $pull: { memberIds: id } })
    await UserOverride.deleteMany({ profileId: id })
    await r.target.deleteOne()
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Login ───────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  if (!checkLoginRate(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
  }

  try {
    const { profileId, pin } = req.body
    if (!isValidId(profileId)) return res.status(400).json({ error: 'Invalid profile ID' })

    const profile = await Profile.findById(profileId)
    if (!profile) return res.status(404).json({ error: 'Profile not found' })

    // Defense-in-depth for legacy data: an admin with no PIN must never get a
    // credential-free session. New admins are required to have a PIN; this
    // catches any pre-existing PIN-less admin (recoverable via another admin's
    // reset). Regular profiles may still be PIN-less by design (picker login).
    if (profile.role === 'admin' && !profile.pin) {
      return res.status(403).json({ error: 'This admin profile has no PIN. Ask another admin to reset it.' })
    }

    if (profile.pin) {
      if (!pin) return res.status(401).json({ error: 'PIN required' })
      const valid = await bcrypt.compare(String(pin).toUpperCase(), profile.pin)
      if (!valid) return res.status(401).json({ error: 'Wrong PIN' })
    }

    resetLoginRate(ip)

    // A temporary (one-time) PIN does NOT establish a session: the user must
    // choose their own PIN first (see /login/set-pin). Until they do, the
    // temporary PIN stays valid, so backing out or reloading just returns them
    // to the profile selector.
    if (profile.pinTemporary) {
      return res.json({
        pinTemporary: true,
        profileId: profile._id, name: profile.name, role: profile.role,
        emoji: profile.emoji, color: profile.color,
      })
    }

    profile.lastLoginAt = new Date()
    await profile.save()

    const token = jwt.sign(
      { profileId: profile._id, name: profile.name, role: profile.role },
      secret(),
      { expiresIn: '30d' }
    )
    res.cookie('nucleus_token', token, COOKIE)
    res.json({
      _id: profile._id, profileId: profile._id, name: profile.name, role: profile.role,
      emoji: profile.emoji, color: profile.color, pinTemporary: false,
      hasImage: !!profile.image, imageUpdatedAt: profile.imageUpdatedAt,
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Complete a temporary-PIN login ───────────────────────────────────────────
// The user re-proves the temporary PIN and sets their own. Only on success is a
// session established. If they never call this, the temporary PIN is untouched.

router.post('/login/set-pin', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  if (!checkLoginRate(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
  }

  try {
    const { profileId, currentPin, newPin } = req.body
    if (!isValidId(profileId)) return res.status(400).json({ error: 'Invalid profile ID' })
    if (!isValidPin(newPin)) return res.status(400).json({ error: 'PIN must be exactly 4 characters (0–9, A–F)' })

    const profile = await Profile.findById(profileId)
    if (!profile) return res.status(404).json({ error: 'Profile not found' })
    if (!profile.pinTemporary || !profile.pin) {
      return res.status(400).json({ error: 'No temporary PIN to replace' })
    }

    const valid = await bcrypt.compare(String(currentPin || '').toUpperCase(), profile.pin)
    if (!valid) return res.status(401).json({ error: 'Wrong PIN' })

    resetLoginRate(ip)

    profile.pin = await bcrypt.hash(String(newPin).toUpperCase(), 10)
    profile.pinTemporary = false
    profile.pinTempPlain = null
    profile.lastLoginAt = new Date()
    await profile.save()

    const token = jwt.sign(
      { profileId: profile._id, name: profile.name, role: profile.role },
      secret(),
      { expiresIn: '30d' }
    )
    res.cookie('nucleus_token', token, COOKIE)
    res.json({
      _id: profile._id, profileId: profile._id, name: profile.name, role: profile.role,
      emoji: profile.emoji, color: profile.color, pinTemporary: false,
      hasImage: !!profile.image, imageUpdatedAt: profile.imageUpdatedAt,
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Logout ──────────────────────────────────────────────────────────────────

router.post('/logout', requireAuth, (req, res) => {
  res.clearCookie('nucleus_token', { path: '/' })
  res.json({ ok: true })
})

// ── Me ──────────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await Profile.findById(req.profile.profileId).lean()
    if (!profile) {
      res.clearCookie('nucleus_token', { path: '/' })
      return res.status(401).json({ error: 'Profile not found' })
    }
    const { pin: _pin, pinTempPlain: _tmp, image: _img, ...safeProfile } = profile
    res.json({ ...safeProfile, hasPin: !!profile.pin, pinTemporary: !!profile.pinTemporary, hasImage: !!profile.image })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Global app/widget overrides (admin-controlled, affects all users) ────────

// Lists of globally-DISABLED ids. Any authenticated client reads this to hide
// disabled apps/widgets for everyone.
router.get('/overrides', requireAuth, async (_req, res) => {
  try {
    const all = await RegistryOverride.find({ disabled: true }).lean()
    res.json({
      apps:    all.filter(o => o.kind === 'app').map(o => o.itemId),
      widgets: all.filter(o => o.kind === 'widget').map(o => o.itemId),
      plugins: all.filter(o => o.kind === 'plugin').map(o => o.itemId),
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Admin-only: globally enable/disable an app, widget or plugin for ALL users.
router.patch('/overrides/:kind/:id', requireAdmin, async (req, res) => {
  try {
    const { kind, id } = req.params
    if (kind !== 'app' && kind !== 'widget' && kind !== 'plugin') return res.status(400).json({ error: 'Invalid kind' })
    const disabled = !!req.body.disabled
    await RegistryOverride.findOneAndUpdate(
      { kind, itemId: id },
      { kind, itemId: id, disabled },
      { upsert: true, new: true },
    )
    res.json({ kind, itemId: id, disabled })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Per-user overrides (admin-managed; global overrides always win) ──────────

// Effective disabled set for the CURRENT user, resolving Global > group > user.
// Because every level can only DISABLE (default is enabled) and groups AND
// together, the result is simply the union of disabled ids across all levels:
//   global ∪ (every group the user belongs to) ∪ this user's overrides.
// Clients (useRegistry) filter apps/widgets by this.
router.get('/effective-overrides', requireAuth, async (req, res) => {
  try {
    const pid = String(req.profile.profileId)
    const groups = await Group.find({ memberIds: pid }).select('_id').lean()
    const groupIds = groups.map(g => String(g._id))
    const [globalOv, groupOv, userOv] = await Promise.all([
      RegistryOverride.find({ disabled: true }).lean(),
      groupIds.length
        ? GroupOverride.find({ groupId: { $in: groupIds }, disabled: true }).lean()
        : [],
      UserOverride.find({ profileId: pid, disabled: true }).lean(),
    ])
    const ids = (kind) => [
      ...globalOv.filter(o => o.kind === kind).map(o => o.itemId),
      ...groupOv.filter(o => o.kind === kind).map(o => o.itemId),
      ...userOv.filter(o => o.kind === kind).map(o => o.itemId),
    ]
    res.json({ apps: [...new Set(ids('app'))], widgets: [...new Set(ids('widget'))], plugins: [...new Set(ids('plugin'))] })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Admin: a specific user's per-user disabled set.
router.get('/users/:id/overrides', requireAdmin, async (req, res) => {
  try {
    const all = await UserOverride.find({ profileId: req.params.id, disabled: true }).lean()
    res.json({
      apps:    all.filter(o => o.kind === 'app').map(o => o.itemId),
      widgets: all.filter(o => o.kind === 'widget').map(o => o.itemId),
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Admin: enable/disable an app or widget for one user.
router.patch('/users/:id/overrides/:kind/:itemId', requireAdmin, async (req, res) => {
  try {
    const { id, kind, itemId } = req.params
    if (kind !== 'app' && kind !== 'widget') return res.status(400).json({ error: 'Invalid kind' })
    const disabled = !!req.body.disabled
    await UserOverride.findOneAndUpdate(
      { profileId: id, kind, itemId },
      { profileId: id, kind, itemId, disabled },
      { upsert: true, new: true },
    )
    res.json({ profileId: id, kind, itemId, disabled })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Groups ───────────────────────────────────────────────────────────────────
// A group bundles users and applies its own app/widget rules (GroupOverride) to
// every member, plus an optional shared Orbit directory. See /effective-overrides
// for how group rules combine with global/per-user ones.

function serializeGroup(g) {
  return {
    _id: String(g._id),
    name: g.name,
    memberIds: (g.memberIds ?? []).map(String),
    sharedOrbit: !!g.sharedOrbit,
    sharedPrism: !!g.sharedPrism,
    prismAlbumJoint: !!g.prismAlbumJoint,
    createdAt: g.createdAt,
  }
}

// Normalize the sharing flags: a joint Prism album mirrors the Orbit shared
// folder, so it only makes sense when shared storage is on and an album exists.
function normalizeSharing({ sharedOrbit, sharedPrism, prismAlbumJoint }) {
  const so = !!sharedOrbit
  const sp = !!sharedPrism
  return { sharedOrbit: so, sharedPrism: sp, prismAlbumJoint: sp && so && !!prismAlbumJoint }
}

// Groups the CURRENT user belongs to (used by Orbit + the hub). Includes the
// sharing flags so Orbit/Prism know which shared directories/albums to surface.
router.get('/my-groups', requireAuth, async (req, res) => {
  try {
    const groups = await Group.find({ memberIds: String(req.profile.profileId) })
      .sort({ name: 1 }).lean()
    res.json(groups.map(g => ({
      _id: String(g._id), name: g.name,
      sharedOrbit: !!g.sharedOrbit, sharedPrism: !!g.sharedPrism, prismAlbumJoint: !!g.prismAlbumJoint,
    })))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Admin: list every group (with members + sharedOrbit).
router.get('/groups', requireAdmin, async (_req, res) => {
  try {
    const groups = await Group.find().sort({ name: 1 }).lean()
    res.json(groups.map(serializeGroup))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Admin: create a group.
router.post('/groups', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name ?? '').trim()
    if (!name) return res.status(400).json({ error: 'Name required' })
    const group = await Group.create({
      name,
      memberIds: Array.isArray(req.body.memberIds) ? req.body.memberIds.map(String) : [],
      ...normalizeSharing(req.body),
    })
    res.status(201).json(serializeGroup(group))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: update a group's name / members / sharedOrbit toggle.
router.patch('/groups/:id', requireAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const update = {}
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim()
      if (!name) return res.status(400).json({ error: 'Name required' })
      update.name = name
    }
    if (req.body.memberIds !== undefined) {
      if (!Array.isArray(req.body.memberIds)) return res.status(400).json({ error: 'memberIds must be an array' })
      update.memberIds = req.body.memberIds.map(String)
    }
    // Sharing flags interact (a joint Prism album needs shared storage), so
    // resolve them against the current values as one coherent set.
    const touchesSharing = ['sharedOrbit', 'sharedPrism', 'prismAlbumJoint'].some((k) => req.body[k] !== undefined)
    if (touchesSharing) {
      const current = await Group.findById(req.params.id).select('sharedOrbit sharedPrism prismAlbumJoint').lean()
      if (!current) return res.status(404).json({ error: 'Not found' })
      Object.assign(update, normalizeSharing({
        sharedOrbit: req.body.sharedOrbit ?? current.sharedOrbit,
        sharedPrism: req.body.sharedPrism ?? current.sharedPrism,
        prismAlbumJoint: req.body.prismAlbumJoint ?? current.prismAlbumJoint,
      }))
    }
    const group = await Group.findByIdAndUpdate(req.params.id, update, { new: true })
    if (!group) return res.status(404).json({ error: 'Not found' })
    res.json(serializeGroup(group))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: delete a group (and its override rows). Any shared Orbit files are
// handled separately by the admin client via Orbit's teardown endpoint before
// this is called.
router.delete('/groups/:id', requireAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const group = await Group.findByIdAndDelete(req.params.id)
    if (!group) return res.status(404).json({ error: 'Not found' })
    await GroupOverride.deleteMany({ groupId: req.params.id })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: a group's app/widget disabled set.
router.get('/groups/:id/overrides', requireAdmin, async (req, res) => {
  try {
    const all = await GroupOverride.find({ groupId: req.params.id, disabled: true }).lean()
    res.json({
      apps:    all.filter(o => o.kind === 'app').map(o => o.itemId),
      widgets: all.filter(o => o.kind === 'widget').map(o => o.itemId),
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Admin: enable/disable an app or widget for one group.
router.patch('/groups/:id/overrides/:kind/:itemId', requireAdmin, async (req, res) => {
  try {
    const { id, kind, itemId } = req.params
    if (kind !== 'app' && kind !== 'widget') return res.status(400).json({ error: 'Invalid kind' })
    const disabled = !!req.body.disabled
    await GroupOverride.findOneAndUpdate(
      { groupId: id, kind, itemId },
      { groupId: id, kind, itemId, disabled },
      { upsert: true, new: true },
    )
    res.json({ groupId: id, kind, itemId, disabled })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
