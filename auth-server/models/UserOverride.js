import mongoose from 'mongoose'

// Per-user enable/disable. Apps/widgets are set by an admin in the Users →
// Config panel; `plugin` rows are additionally self-service — a user can toggle
// their own NON-CORE plugins from Profile settings (see /me/overrides/plugin).
// A global override (RegistryOverride) or group override always wins — if
// something is disabled there it's off regardless of this.
const userOverrideSchema = new mongoose.Schema({
  profileId: { type: String, required: true, index: true },
  kind:      { type: String, enum: ['app', 'widget', 'plugin'], required: true },
  itemId:    { type: String, required: true },
  disabled:  { type: Boolean, default: false },
}, { timestamps: true })

userOverrideSchema.index({ profileId: 1, kind: 1, itemId: 1 }, { unique: true })

export default mongoose.model('UserOverride', userOverrideSchema)
