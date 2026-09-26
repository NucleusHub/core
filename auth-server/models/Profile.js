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
  pinTemporary: { type: Boolean, default: false },
  // Admin-only readback of the active one-time PIN; never expose via public/self endpoints.
  pinTempPlain: { type: String, default: null },
  emoji:       { type: String, default: null },
  image:       { type: String, default: null },
  imageUpdatedAt: { type: Date, default: null },
  color:       { type: String, required: true },
  lastLoginAt: { type: Date, default: null },
  isGuest:     { type: Boolean, default: false },
  locale:      { type: String, default: null },
  whatsNew: {
    lastSeenAt: { type: Date, default: null },
    optOut:     { type: Boolean, default: false },
  },
}, { timestamps: true })

export default mongoose.model('Profile', profileSchema)
