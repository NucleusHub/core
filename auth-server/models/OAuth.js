import mongoose from 'mongoose'

const { ObjectId, Mixed } = mongoose.Schema.Types

const clientSchema = new mongoose.Schema({
  _id:          { type: String },
  name:         { type: String, required: true },
  redirectUris: { type: [String], default: [] },
  // Public clients have none; PKCE protects them.
  secretHash:   { type: String, default: null },
  trusted:      { type: Boolean, default: false },
  exposes:      { type: [String], default: [] },
  exposeLabels: { type: Mixed, default: () => ({}) },
  createdAt:    { type: Date, default: Date.now },
  revokedAt:    { type: Date, default: null },
}, { versionKey: false, minimize: false, collection: 'oauth_clients' })

const grantSchema = new mongoose.Schema({
  clientId:   { type: String, required: true },
  profileId:  { type: ObjectId, required: true, index: true },
  scopes:     { type: [String], default: [] },
  createdAt:  { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now },
}, { versionKey: false, collection: 'oauth_grants' })
grantSchema.index({ clientId: 1, profileId: 1 }, { unique: true })

// _id is the sha256 of the secret, so a lookup is a primary-key read and nothing usable is stored.
const codeSchema = new mongoose.Schema({
  _id:           { type: String },
  grantId:       { type: ObjectId, required: true, index: true },
  clientId:      { type: String, required: true },
  profileId:     { type: ObjectId, required: true, index: true },
  redirectUri:   { type: String, required: true },
  scopes:        { type: [String], default: [] },
  codeChallenge: { type: String, required: true },
  expiresAt:     { type: Date, required: true },
}, { versionKey: false, collection: 'oauth_codes' })
codeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const tokenSchema = new mongoose.Schema({
  _id:       { type: String },
  kind:      { type: String, enum: ['access', 'refresh'], required: true },
  grantId:   { type: ObjectId, required: true, index: true },
  clientId:  { type: String, required: true },
  profileId: { type: ObjectId, required: true, index: true },
  scopes:    { type: [String], default: [] },
  // Retired refresh tokens stay until they expire: reuse detection reads them.
  usedAt:    { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, { versionKey: false, collection: 'oauth_tokens' })
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const OAuthClient = mongoose.model('OAuthClient', clientSchema)
export const OAuthGrant = mongoose.model('OAuthGrant', grantSchema)
export const OAuthCode = mongoose.model('OAuthCode', codeSchema)
export const OAuthToken = mongoose.model('OAuthToken', tokenSchema)
