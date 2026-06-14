import mongoose from 'mongoose'

// Per-group app/widget enable/disable, set by an admin in the Groups → Config
// panel. Default is enabled; a row marks an item disabled for the group.
//
// Effective access (see /effective-overrides) is the union of disabled sets:
// global ∪ (every group the user belongs to) ∪ per-user. Because groups AND
// together, an item is off if ANY of the user's groups disables it; it's only
// on if all of them leave it enabled. Global always wins over group, group over
// user — which a disabled-set union enforces automatically.
const groupOverrideSchema = new mongoose.Schema({
  groupId:  { type: String, required: true, index: true },
  kind:     { type: String, enum: ['app', 'widget'], required: true },
  itemId:   { type: String, required: true },
  disabled: { type: Boolean, default: false },
}, { timestamps: true })

groupOverrideSchema.index({ groupId: 1, kind: 1, itemId: 1 }, { unique: true })

export default mongoose.model('GroupOverride', groupOverrideSchema)
