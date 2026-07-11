import mongoose from 'mongoose'

// Admin-controlled GLOBAL overrides for apps/widgets/plugins — applies to every
// user, independent of any per-user Pulse dashboard state. Currently just a
// global "disabled" switch (hides the app/widget for everyone, or disables a
// plugin — hiding its contributed admin tabs — for everyone).
const registryOverrideSchema = new mongoose.Schema({
  kind:     { type: String, enum: ['app', 'widget', 'plugin'], required: true },
  itemId:   { type: String, required: true },
  disabled: { type: Boolean, default: false },
}, { timestamps: true })

registryOverrideSchema.index({ kind: 1, itemId: 1 }, { unique: true })

export default mongoose.model('RegistryOverride', registryOverrideSchema)
