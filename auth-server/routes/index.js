import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import mongoose from 'mongoose'
import Profile, { colorFromName } from '../models/Profile.js'
import RegistryOverride from '../models/RegistryOverride.js'
import UserOverride from '../models/UserOverride.js'
import Group from '../models/Group.js'
import GroupOverride from '../models/GroupOverride.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { resolveViewer, filterProfiles } from '../visibility.js'
import { mountPluginRoutes } from '../serverPlugins.js'

const router = Router()

await mountPluginRoutes(router)

const secret = () => process.env.JWT_SECRET || 'nucleus-jwt-secret'
const COOKIE = {
  httpOnly: true,
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
}

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

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id)
}

const PIN_RE = /^[0-9A-F]{4}$/

function isValidPin(pin) {
  return PIN_RE.test(String(pin).toUpperCase())
}

// ~3MB base64 cap, kept under the express.json limit.
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i
const MAX_IMAGE_LEN = 3_000_000

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl))
  if (!m) return null
  try {
    return { mime: m[1], buffer: Buffer.from(m[2], 'base64') }
  } catch {
    return null
  }
}

function randomPin() {
  const chars = '0123456789ABCDEF'
  let s = ''
  for (let i = 0; i < 4; i++) s += chars[randomInt(16)]
  return s
}

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
    // Debug header exposes the IP the server sees, for filling visibility.json.ips.
    const viewer = resolveViewer(req)
    res.set('X-Nucleus-Viewer-Ip', viewer.ip || '')
    const picker = req.query.picker === '1' || req.query.picker === 'true'
    res.json(filterProfiles(mapped, viewer, { picker }))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Allowed without auth only for first-run bootstrap (no admin yet).
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
      // Re-check role in DB: tokens live 30 days, so a demoted admin's token must not authorize this.
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
    const safeRole = adminCount === 0 ? 'admin' : (role === 'admin' ? 'admin' : 'user')
    // A PIN-less admin would allow an unauthenticated takeover via the picker.
    if (safeRole === 'admin' && (pin === undefined || pin === null || pin === '')) {
      return res.status(400).json({ error: 'Admin profiles require a PIN' })
    }
    const pinHash = pin ? await bcrypt.hash(String(pin).toUpperCase(), 10) : null
    const isTemp = !!pinHash && !!pinTemporary
    const profile = await Profile.create({
      name: name.trim().slice(0, 64),
      role: safeRole,
      pin: pinHash,
      pinTemporary: isTemp,
      pinTempPlain: isTemp ? String(pin).toUpperCase() : null,
      emoji: emoji ? String(emoji).slice(0, 8) : null,
      color: color || colorFromName(name),
      locale: locale ? String(locale).slice(0, 20) : null,
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
    if (locale !== undefined) update.locale = locale ? String(locale).slice(0, 20) : null
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

    if (update.role === 'user') {
      const target = await Profile.findById(req.params.id).select('role').lean()
      if (target?.role === 'admin') {
        const admins = await Profile.countDocuments({ role: 'admin', isGuest: false })
        if (admins <= 1) return res.status(400).json({ error: 'Can’t remove the last admin' })
      }
    }

    // Never promote a PIN-less profile: admins must always have a PIN.
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

// Public so the picker can render it pre-login; cache-busted via ?v=, so immutable.
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
    if (target.isGuest) return res.status(400).json({ error: 'Guest profiles cannot have a PIN' })

    // Re-prove the current PIN so a walk-up on an unlocked session can't lock the user out.
    if (isOwn && target.pin) {
      const ok = await bcrypt.compare(String(currentPin || '').toUpperCase(), target.pin)
      if (!ok) return res.status(401).json({ error: 'Wrong current PIN' })
    }

    const pinHash = pin ? await bcrypt.hash(String(pin).toUpperCase(), 10) : null
    // Admins must keep a PIN; PIN-less means credential-free picker login.
    if (!pinHash && target.role === 'admin') {
      return res.status(400).json({ error: 'Admins must keep a PIN' })
    }
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

// Pre-flight and delete both require the acting admin's PIN.
async function authorizeProfileDeletion(req) {
  if (!isValidId(req.params.id)) return { status: 400, error: 'Invalid profile ID' }
  const target = await Profile.findById(req.params.id)
  if (!target) return { status: 404, error: 'Not found' }
  if (target.isGuest) return { status: 400, error: 'Cannot delete Guest' }
  if (String(req.profile.profileId) === String(target._id)) {
    return { status: 400, error: "You can't delete your own profile" }
  }
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
    await Group.updateMany({ memberIds: id }, { $pull: { memberIds: id } })
    await UserOverride.deleteMany({ profileId: id })
    await r.target.deleteOne()
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

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

    // Legacy guard: a PIN-less admin must never get a credential-free session.
    if (profile.role === 'admin' && !profile.pin) {
      return res.status(403).json({ error: 'This admin profile has no PIN. Ask another admin to reset it.' })
    }

    if (profile.pin) {
      if (!pin) return res.status(401).json({ error: 'PIN required' })
      const valid = await bcrypt.compare(String(pin).toUpperCase(), profile.pin)
      if (!valid) return res.status(401).json({ error: 'Wrong PIN' })
    }

    resetLoginRate(ip)

    // A temporary PIN grants no session until /login/set-pin.
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

router.post('/logout', requireAuth, (req, res) => {
  res.clearCookie('nucleus_token', { path: '/' })
  res.json({ ok: true })
})

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

// Levels can only disable, so the effective set is global ∪ user's groups ∪ user.
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

// Plugins are bind-mounted at /app/plugins.
const PLUGINS_DIR = process.env.PLUGINS_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins')

// `id` is validated to a safe slug first (no path traversal).
function pluginTarget(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null
  try {
    return JSON.parse(readFileSync(join(PLUGINS_DIR, id, 'nucleus.plugin.json'), 'utf8')).target ?? null
  } catch {
    return null
  }
}
const isCorePlugin = (target) =>
  target === 'core' || (Array.isArray(target) && target.includes('core'))

async function lockedPluginIds(pid) {
  const groups = await Group.find({ memberIds: pid }).select('_id').lean()
  const groupIds = groups.map(g => String(g._id))
  const [globalOv, groupOv] = await Promise.all([
    RegistryOverride.find({ kind: 'plugin', disabled: true }).lean(),
    groupIds.length
      ? GroupOverride.find({ groupId: { $in: groupIds }, kind: 'plugin', disabled: true }).lean()
      : [],
  ])
  return new Set([...globalOv.map(o => o.itemId), ...groupOv.map(o => o.itemId)])
}

router.get('/me/plugin-overrides', requireAuth, async (req, res) => {
  try {
    const pid = String(req.profile.profileId)
    const [userOv, locked] = await Promise.all([
      UserOverride.find({ profileId: pid, kind: 'plugin', disabled: true }).lean(),
      lockedPluginIds(pid),
    ])
    res.json({ userDisabled: userOv.map(o => o.itemId), locked: [...locked] })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.patch('/me/overrides/plugin/:itemId', requireAuth, async (req, res) => {
  try {
    const pid = String(req.profile.profileId)
    const { itemId } = req.params
    const disabled = !!req.body.disabled
    const target = pluginTarget(itemId)
    if (target == null) return res.status(404).json({ error: 'Plugin not found' })
    if (isCorePlugin(target)) return res.status(403).json({ error: 'Core plugins can’t be changed per-user' })
    // An admin/group disable wins — allow turning further off, never on.
    if (!disabled && (await lockedPluginIds(pid)).has(itemId)) {
      return res.status(409).json({ error: 'This plugin is turned off by an administrator' })
    }
    await UserOverride.findOneAndUpdate(
      { profileId: pid, kind: 'plugin', itemId },
      { profileId: pid, kind: 'plugin', itemId, disabled },
      { upsert: true, new: true },
    )
    res.json({ itemId, disabled })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

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

function normalizeSharing({ sharedOrbit, sharedPrism, prismAlbumJoint }) {
  const so = !!sharedOrbit
  const sp = !!sharedPrism
  return { sharedOrbit: so, sharedPrism: sp, prismAlbumJoint: sp && so && !!prismAlbumJoint }
}

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

router.get('/groups', requireAdmin, async (_req, res) => {
  try {
    const groups = await Group.find().sort({ name: 1 }).lean()
    res.json(groups.map(serializeGroup))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

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
