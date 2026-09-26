import mongoose from 'mongoose'

const userOverrideSchema = new mongoose.Schema({
  profileId: { type: String, required: true, index: true },
  kind:      { type: String, enum: ['app', 'widget', 'plugin'], required: true },
  itemId:    { type: String, required: true },
  disabled:  { type: Boolean, default: false },
}, { timestamps: true })

userOverrideSchema.index({ profileId: 1, kind: 1, itemId: 1 }, { unique: true })

export default mongoose.model('UserOverride', userOverrideSchema)
