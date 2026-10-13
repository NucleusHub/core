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

const identitySchema = new mongoose.Schema({
  provider: { type: String, required: true },
  subject:  { type: String, required: true },
  email:    { type: String, default: null },
  linkedAt: { type: Date, default: Date.now },
}, { _id: false })

// Display name lives in profile.name; handle/email are stored lowercased, *Lower kept for the unique indexes.
const accountSchema = new mongoose.Schema({
  handle:          { type: String, required: true },
  handleLower:     { type: String, required: true },
  email:           { type: String, required: true },
  emailLower:      { type: String, required: true },
  emailVerifiedAt: { type: Date, default: null },
  passwordHash:    { type: String, default: null },
  appearance:      { type: mongoose.Schema.Types.Mixed, default: null },
  serverAccess:    { type: Boolean, default: false },
  identities:      { type: [identitySchema], default: [] },
  createdAt:       { type: Date, default: Date.now },
}, { _id: false })

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
  // Absent on plain profiles: grantServerAccess and the sparse indexes rely on that.
  account:     { type: accountSchema, default: undefined },
}, { timestamps: true })

profileSchema.index({ 'account.handleLower': 1 }, { unique: true, sparse: true })
profileSchema.index({ 'account.emailLower': 1 }, { unique: true, sparse: true })

export const accountSummary = (profile) => profile?.account
  ? {
      handle: profile.account.handle,
      email: profile.account.email,
      emailVerified: !!profile.account.emailVerifiedAt,
      appearance: profile.account.appearance ?? null,
    }
  : null

export default mongoose.model('Profile', profileSchema)
