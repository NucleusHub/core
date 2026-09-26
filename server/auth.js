import jwt from 'jsonwebtoken'

const secret = () => process.env.JWT_SECRET || 'nucleus-jwt-secret'

export function verifyToken(token) {
  return jwt.verify(token, secret())
}

export function verifyProfile(req) {
  const token = req.cookies?.nucleus_token
  if (!token) return null
  try {
    return verifyToken(token)
  } catch {
    return null
  }
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.nucleus_token
  if (!token) return res.status(401).json({ error: 'Unauthenticated' })
  try {
    req.profile = verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
