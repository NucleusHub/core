import mongoose from 'mongoose'

const registryOverrideSchema = new mongoose.Schema({
  kind:     { type: String, enum: ['app', 'widget', 'plugin'], required: true },
  itemId:   { type: String, required: true },
  disabled: { type: Boolean, default: false },
}, { timestamps: true })

registryOverrideSchema.index({ kind: 1, itemId: 1 }, { unique: true })

export default mongoose.model('RegistryOverride', registryOverrideSchema)
