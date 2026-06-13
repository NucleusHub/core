import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import Profile, { colorFromName } from '../models/Profile.js'
import RegistryOverride from '../models/RegistryOverride.js'
import UserOverride from '../models/UserOverride.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()
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
    res.json([...regular, ...guests].map(p => ({
      _id: p._id,
      name: p.name,
      role: p.role,
      emoji: p.emoji,
      color: p.color,
      hasPin: !!p.pin,
      isGuest: p.isGuest,
    })))
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
      try {
        const p = jwt.verify(token, secret())
        if (p.role !== 'admin') return res.status(403).json({ error: 'Admin required' })
      } catch {
        return res.status(401).json({ error: 'Invalid token' })
      }
    }

    const { name, role = 'user', pin, emoji, color } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
    if (pin !== undefined && pin !== null && pin !== '') {
      if (!isValidPin(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 characters (0–9, A–F)' })
    }
    // New profiles are regular users. The exception is first-run bootstrap:
    // the very first profile (no admin yet) becomes admin so there's always
    // an initial admin to manage the rest.
    const safeRole = adminCount === 0 ? 'admin' : (role === 'admin' ? 'admin' : 'user')
    const pinHash = pin ? await bcrypt.hash(String(pin).toUpperCase(), 10) : null
    const profile = await Profile.create({
      name: name.trim().slice(0, 64),
      role: safeRole,
      pin: pinHash,
      emoji: emoji ? String(emoji).slice(0, 8) : null,
      color: color || colorFromName(name),
    })
    res.status(201).json({
      _id: profile._id, name: profile.name, role: profile.role,
      emoji: profile.emoji, color: profile.color, hasPin: !!profile.pin, isGuest: false,
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

    const { name, emoji, color, role } = req.body
    const update = {}
    if (name !== undefined) update.name = String(name).trim().slice(0, 64)
    if (emoji !== undefined) update.emoji = emoji ? String(emoji).slice(0, 8) : null
    if (color !== undefined) update.color = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : undefined
    if (role !== undefined && req.profile.role === 'admin') update.role = role === 'admin' ? 'admin' : 'user'

    if (update.color === undefined) delete update.color

    const profile = await Profile.findByIdAndUpdate(req.params.id, update, { new: true }).select('-pin')
    if (!profile) return res.status(404).json({ error: 'Not found' })
    res.json(profile)
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

    const { pin } = req.body
    if (pin !== undefined && pin !== null && pin !== '') {
      if (!isValidPin(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 characters (0–9, A–F)' })
    }
    const pinHash = pin ? await bcrypt.hash(String(pin).toUpperCase(), 10) : null
    await Profile.findByIdAndUpdate(req.params.id, { pin: pinHash })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Delete profile ──────────────────────────────────────────────────────────

router.delete('/profiles/:id', requireAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
    const profile = await Profile.findById(req.params.id)
    if (!profile) return res.status(404).json({ error: 'Not found' })
    if (profile.isGuest) return res.status(400).json({ error: 'Cannot delete Guest' })
    await profile.deleteOne()
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

    if (profile.pin) {
      if (!pin) return res.status(401).json({ error: 'PIN required' })
      const valid = await bcrypt.compare(String(pin).toUpperCase(), profile.pin)
      if (!valid) return res.status(401).json({ error: 'Wrong PIN' })
    }

    resetLoginRate(ip)

    profile.lastLoginAt = new Date()
    await profile.save()

    const token = jwt.sign(
      { profileId: profile._id, name: profile.name, role: profile.role },
      secret(),
      { expiresIn: '30d' }
    )
    res.cookie('nucleus_token', token, COOKIE)
    res.json({
      profileId: profile._id, name: profile.name, role: profile.role,
      emoji: profile.emoji, color: profile.color,
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
    const { pin: _pin, ...safeProfile } = profile
    res.json({ ...safeProfile, hasPin: !!profile.pin })
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
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

// Admin-only: globally enable/disable an app or widget for ALL users.
router.patch('/overrides/:kind/:id', requireAdmin, async (req, res) => {
  try {
    const { kind, id } = req.params
    if (kind !== 'app' && kind !== 'widget') return res.status(400).json({ error: 'Invalid kind' })
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

// Effective disabled set for the CURRENT user = global ∪ this user's overrides.
// Clients (useRegistry) filter apps/widgets by this.
router.get('/effective-overrides', requireAuth, async (req, res) => {
  try {
    const [globalOv, userOv] = await Promise.all([
      RegistryOverride.find({ disabled: true }).lean(),
      UserOverride.find({ profileId: String(req.profile.profileId), disabled: true }).lean(),
    ])
    const ids = (kind) => [
      ...globalOv.filter(o => o.kind === kind).map(o => o.itemId),
      ...userOv.filter(o => o.kind === kind).map(o => o.itemId),
    ]
    res.json({ apps: [...new Set(ids('app'))], widgets: [...new Set(ids('widget'))] })
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

export default router
