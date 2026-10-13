import { createHash, randomBytes } from 'node:crypto'
import mongoose from 'mongoose'

const emailTokenSchema = new mongoose.Schema({
  _id:       { type: String },
  profileId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  purpose:   { type: String, enum: ['verify', 'reset', 'email-change'], required: true },
  email:     { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, { versionKey: false, collection: 'email_tokens' })

emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const EmailToken = mongoose.model('EmailToken', emailTokenSchema)
export default EmailToken

const LIFETIME_MS = { verify: 24 * 3600 * 1000, 'email-change': 24 * 3600 * 1000, reset: 3600 * 1000 }
const hash = (token) => createHash('sha256').update(token, 'utf8').digest('hex')

// Replaces earlier tokens of the same purpose: only the newest link in the inbox works.
export async function issueEmailToken(profileId, purpose, email) {
  const token = randomBytes(32).toString('base64url')
  await EmailToken.deleteMany({ profileId, purpose })
  await EmailToken.create({ _id: hash(token), profileId, purpose, email, expiresAt: new Date(Date.now() + LIFETIME_MS[purpose]) })
  return token
}

// Find-and-delete in one statement, so two racing clicks can't both spend it.
export async function consumeEmailToken(token, purpose) {
  if (typeof token !== 'string' || !token || token.length > 200) return null
  const row = await EmailToken.findOneAndDelete({ _id: hash(token), purpose }).lean()
  return row && row.expiresAt > new Date() ? row : null
}

// Look without spending, so a mistyped password doesn't burn the link.
export async function peekEmailToken(token, purposes) {
  if (typeof token !== 'string' || !token || token.length > 200) return null
  return EmailToken.findOne({ _id: hash(token), purpose: { $in: purposes }, expiresAt: { $gt: new Date() } }).lean()
}

export async function revokeEmailTokens(profileId, purpose) {
  const filter = { profileId }
  if (purpose) filter.purpose = purpose
  await EmailToken.deleteMany(filter)
}

export async function recentlyIssued(profileId, purpose) {
  return !!(await EmailToken.exists({ profileId, purpose, createdAt: { $gt: new Date(Date.now() - 60000) } }))
}
