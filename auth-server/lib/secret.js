import { randomBytes } from 'node:crypto'

const LEGACY_SECRET = 'nucleus-jwt-secret'
let cached = null

export async function loadJwtSecret(db) {
  const env = process.env.JWT_SECRET
  if (env && env !== LEGACY_SECRET) return (cached = env)
  const secrets = db.collection('nucleus_secrets')
  try {
    await secrets.updateOne(
      { _id: 'jwt' },
      { $setOnInsert: { value: randomBytes(48).toString('base64url') } },
      { upsert: true },
    )
  } catch (err) {
    // Lost a concurrent-upsert race; the winner's value is read below.
    if (err.code !== 11000) throw err
  }
  const doc = await secrets.findOne({ _id: 'jwt' })
  return (cached = doc.value)
}

export function jwtSecret() {
  if (!cached) throw new Error('JWT secret not loaded')
  return cached
}
