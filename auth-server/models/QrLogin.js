import mongoose from 'mongoose'
import { TTL_MS, hashSecret, newId, newSecret } from '../lib/qr.js'

const { ObjectId } = mongoose.Schema.Types

const qrLoginSchema = new mongoose.Schema({
  _id:             { type: String },
  secretHash:      { type: String, required: true },
  kind:            { type: String, enum: ['web', 'app'], required: true },
  status:          { type: String, default: 'pending' },
  authorId:        { type: ObjectId, default: null },
  scannerClientId: { type: String, default: null },
  device:          { type: String, default: null },
  clientId:        { type: String, default: null },
  scopes:          { type: [String], default: [] },
  redirectUri:     { type: String, default: null },
  codeChallenge:   { type: String, default: null },
  expiresAt:       { type: Date, required: true },
  createdAt:       { type: Date, default: Date.now },
}, { versionKey: false, collection: 'qr_logins' })

// No sweep job: an hour is long past any request's two minutes.
qrLoginSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 })

const QrLogin = mongoose.model('QrLogin', qrLoginSchema)
export default QrLogin

export async function createLogin({ kind, authorId = null, device = null }) {
  // An app request gets its real secret when claimed; this one is never handed out.
  const secret = newSecret()
  const row = await QrLogin.create({
    _id: newId(), secretHash: hashSecret(secret), kind, authorId, device, expiresAt: new Date(Date.now() + TTL_MS),
  })
  return { row: row.toObject(), secret }
}

export const findLogin = (id) => QrLogin.findById(id).lean()

// `step(row)` may throw and returns { patch, result }; the write is compare-and-set on status (no transactions on Mongo 4.4).
export async function transition(id, step) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await findLogin(id)
    const { patch, result } = step(row)
    if (!patch || !Object.keys(patch).length) return { row, result }
    const updated = await QrLogin.findOneAndUpdate({ _id: id, status: row.status }, { $set: patch }, { returnDocument: 'after' }).lean()
    if (updated) return { row: updated, result }
  }
  throw new QrErrorBusy()
}

class QrErrorBusy extends Error {
  constructor() {
    super('Try again.')
    Object.assign(this, { status: 409, code: 'conflict' })
  }
}
