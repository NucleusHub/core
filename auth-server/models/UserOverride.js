import mongoose from 'mongoose'

// Per-user app/widget enable/disable, set by an admin in the Users → Config
// panel. A global override (RegistryOverride) always wins — if something is
// disabled globally it's off for everyone regardless of this.
const userOverrideSchema = new mongoose.Schema({
  profileId: { type: String, required: true, index: true },
  kind:      { type: String, enum: ['app', 'widget'], required: true },
  itemId:    { type: String, required: true },
  disabled:  { type: Boolean, default: false },
}, { timestamps: true })

userOverrideSchema.index({ profileId: 1, kind: 1, itemId: 1 }, { unique: true })

export default mongoose.model('UserOverride', userOverrideSchema)
