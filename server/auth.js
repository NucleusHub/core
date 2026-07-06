import jwt from 'jsonwebtoken'

// Shared server-side auth for every Nucleus app. Apps consume this via a
// `server/core` symlink + the `../core:/app/core:ro` container mount (mirrors
// how clients consume @core). It has no dependencies of its own — Node resolves
// `jsonwebtoken` up into the importing app's own node_modules.
const secret = () => process.env.JWT_SECRET || 'nucleus-jwt-secret'

// Verify a raw token, returning the decoded profile or throwing. Shared with
// Socket.IO handshakes (e.g. Echo's realtime layer) so REST and WS verify
// identically.
export function verifyToken(token) {
  return jwt.verify(token, secret())
}

// Read the nucleus_token cookie and return the decoded profile, or null when
// it's absent/invalid — never throws. For optional-auth middleware that wants
// to identify the caller without rejecting anonymous requests itself.
export function verifyProfile(req) {
  const token = req.cookies?.nucleus_token
  if (!token) return null
  try {
    return verifyToken(token)
  } catch {
    return null
  }
}

// Standard gate: require a valid session cookie, populate req.profile, else 401.
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
