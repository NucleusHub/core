import mongoose from 'mongoose'

const sessionSchema = new mongoose.Schema({
  _id:        { type: String },
  profileId:  { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  via:        { type: String, required: true },
  ua:         { type: String, default: null },
  ip:         { type: String, default: null },
  createdAt:  { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt:  { type: Date, required: true },
}, { versionKey: false })

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('Session', sessionSchema)
