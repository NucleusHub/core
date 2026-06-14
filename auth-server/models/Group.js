import mongoose from 'mongoose'

// A group bundles users and applies its own app/widget rules to every member.
// Resolution hierarchy is Global > group > user, and multiple groups AND
// together (an item is off if ANY of the user's groups disables it) — see
// GroupOverride and the /effective-overrides route.
//
// `sharedOrbit` toggles a shared, immutable "Group - {name}" directory in Orbit
// that every member can open (Orbit reads this same collection directly).
const groupSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  memberIds:   { type: [String], default: [] }, // Profile ids
  sharedOrbit: { type: Boolean, default: false },
}, { timestamps: true })

export default mongoose.model('Group', groupSchema)
