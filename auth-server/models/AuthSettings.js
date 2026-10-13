import mongoose from 'mongoose'

export const DEFAULT_LIMITS = {
  dataValueBytes: 262144,
  dataQuotaBytes: 16777216,
  dataMaxKeys: 100,
  fileMaxBytes: 26214400,
  filesQuotaBytes: 262144000,
  filesMaxCount: 5000,
}

const str = { type: String, default: null }

const limitsSchema = new mongoose.Schema(
  Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([k, v]) => [k, { type: Number, default: v }])),
  { _id: false },
)

const authSettingsSchema = new mongoose.Schema({
  _id:             { type: String, default: 'auth' },
  userLogin:       { type: String, enum: ['profiles', 'both', 'nid'], default: 'profiles' },
  signupOpen:      { type: Boolean, default: true },
  pinAfterUpgrade: { type: Boolean, default: true },
  serverCode:      str,
  mail: { resendKey: str, from: str },
  sso: {
    apple:  { clientId: str, teamId: str, keyId: str, privateKey: str },
    google: { clientId: str, clientSecret: str },
    github: { clientId: str, clientSecret: str },
  },
  limits:       { type: limitsSchema, default: () => ({}) },
  clientLimits: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { versionKey: false, minimize: false, collection: 'auth_settings' })

const AuthSettings = mongoose.model('AuthSettings', authSettingsSchema)
export default AuthSettings

const TTL_MS = 5000
let cached = null

export async function getSettings() {
  if (cached && cached.at > Date.now() - TTL_MS) return cached.value
  const value = await AuthSettings.findOneAndUpdate(
    { _id: 'auth' },
    { $setOnInsert: { _id: 'auth' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean()
  // Docs written by partial updates may lack defaults; hydrate so readers always see full shape.
  const full = new AuthSettings(value).toObject()
  cached = { at: Date.now(), value: full }
  return full
}

export function invalidateSettings() {
  cached = null
}

const filled = (o) => !!o && Object.values(o).length > 0 && Object.values(o).every(Boolean)

export function publicSettings(s) {
  return {
    userLogin: s.userLogin,
    signupOpen: s.signupOpen,
    pinAfterUpgrade: s.pinAfterUpgrade,
    mailEnabled: filled(s.mail),
    sso: {
      apple: filled(s.sso?.apple),
      google: filled(s.sso?.google),
      github: filled(s.sso?.github),
    },
  }
}
