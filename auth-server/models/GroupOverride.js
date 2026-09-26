import mongoose from 'mongoose'

const groupOverrideSchema = new mongoose.Schema({
  groupId:  { type: String, required: true, index: true },
  kind:     { type: String, enum: ['app', 'widget'], required: true },
  itemId:   { type: String, required: true },
  disabled: { type: Boolean, default: false },
}, { timestamps: true })

groupOverrideSchema.index({ groupId: 1, kind: 1, itemId: 1 }, { unique: true })

export default mongoose.model('GroupOverride', groupOverrideSchema)
