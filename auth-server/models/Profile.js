import mongoose from 'mongoose'

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#06b6d4',
  '#a855f7', '#f43f5e',
]

export function colorFromName(name) {
  let h = 0
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return COLORS[Math.abs(h) % COLORS.length]
}

const profileSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  role:        { type: String, enum: ['admin', 'user'], default: 'user' },
  pin:         { type: String, default: null },
  // When true, `pin` is a one-time PIN: the user is forced to choose their own
  // PIN on first login, after which this clears. See auth-server/routes/index.js.
  pinTemporary: { type: Boolean, default: false },
  // Plaintext of the active one-time PIN, kept only so an admin can read it back
  // and relay it to the user. Cleared the moment the user sets their own PIN.
  // Never exposed by public/self endpoints — admin-only.
  pinTempPlain: { type: String, default: null },
  emoji:       { type: String, default: null },
  // Optional uploaded avatar, stored as a small square data URL
  // (data:image/…;base64,…). Resized client-side before upload. When set it
  // takes precedence over the emoji/initials avatar. Served as raw bytes via
  // GET /profiles/:id/avatar; never returned inline in list/self responses.
  image:       { type: String, default: null },
  imageUpdatedAt: { type: Date, default: null },
  color:       { type: String, required: true },
  lastLoginAt: { type: Date, default: null },
  isGuest:     { type: Boolean, default: false },
  // Admin-assigned UI language (BCP-47 tag, e.g. 'cs-CZ'). null = fall back to
  // the instance default language. See core/auth-server/routes/localization.js.
  locale:      { type: String, default: null },
}, { timestamps: true })

export default mongoose.model('Profile', profileSchema)
