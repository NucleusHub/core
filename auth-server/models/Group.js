import mongoose from 'mongoose'

// A group bundles users and applies its own app/widget rules to every member.
// Resolution hierarchy is Global > group > user, and multiple groups AND
// together (an item is off if ANY of the user's groups disables it) — see
// GroupOverride and the /effective-overrides route.
//
// `sharedOrbit` toggles a shared, immutable "Group - {name}" directory in Orbit
// that every member can open (Orbit reads this same collection directly).
//
// `sharedPrism` gives the group a shared album in Prism. `prismAlbumJoint`
// chooses its flavour: when true the album mirrors the group's shared Orbit
// folder (read-only, requires sharedOrbit + Orbit installed); when false it's a
// standalone Prism album members add photos to directly (works without Orbit).
// Prism reads these same fields from this collection.
//
// `sharedDex` gives the group a shared Dex binder every member can contribute
// to — the binder equivalent of the shared Orbit directory. It is read by the
// dex-shared-binders plugin (which owns Dex's permission model); with that
// plugin absent the flag is simply inert and every Dex binder stays personal.
const groupSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  memberIds:       { type: [String], default: [] }, // Profile ids
  sharedOrbit:     { type: Boolean, default: false },
  sharedPrism:     { type: Boolean, default: false },
  prismAlbumJoint: { type: Boolean, default: false },
  sharedDex:       { type: Boolean, default: false },
}, { timestamps: true })

export default mongoose.model('Group', groupSchema)
