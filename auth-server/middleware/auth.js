import jwt from 'jsonwebtoken'
import Profile from '../models/Profile.js'

const secret = () => process.env.JWT_SECRET || 'nucleus-jwt-secret'

export function requireAuth(req, res, next) {
  const token = req.cookies?.nucleus_token
  if (!token) return res.status(401).json({ error: 'Unauthenticated' })
  try {
    req.profile = jwt.verify(token, secret())
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// Re-checks role in DB so demotions take effect immediately without waiting for token expiry.
export function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      const profile = await Profile.findById(req.profile.profileId).select('role').lean()
      if (!profile || profile.role !== 'admin')
        return res.status(403).json({ error: 'Admin required' })
      next()
    } catch {
      res.status(403).json({ error: 'Admin required' })
    }
  })
}
