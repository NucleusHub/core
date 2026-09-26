import mongoose from 'mongoose'

const groupSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  memberIds:       { type: [String], default: [] },
  sharedOrbit:     { type: Boolean, default: false },
  sharedPrism:     { type: Boolean, default: false },
  prismAlbumJoint: { type: Boolean, default: false },
  sharedDex:       { type: Boolean, default: false },
}, { timestamps: true })

export default mongoose.model('Group', groupSchema)
