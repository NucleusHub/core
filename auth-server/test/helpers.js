import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createApp } from '../app.js'
import { loadJwtSecret } from '../lib/secret.js'
import Profile, { colorFromName } from '../models/Profile.js'

let mongod = null

export async function startDb() {
  delete process.env.JWT_SECRET
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  await loadJwtSecret(mongoose.connection.db)
}

export async function stopDb() {
  await mongoose.disconnect()
  await mongod?.stop()
  mongod = null
}

export function makeApp() {
  return createApp()
}

export async function createProfile(attrs = {}) {
  const { pin, ...rest } = attrs
  const name = rest.name || `user-${Math.random().toString(36).slice(2, 8)}`
  return Profile.create({
    color: colorFromName(name),
    ...rest,
    name,
    pin: pin ? await bcrypt.hash(String(pin).toUpperCase(), 4) : null,
  })
}

export function loginAs(agent, profile, pin) {
  return agent.post('/api/auth/login').send({ profileId: String(profile._id), pin })
}
