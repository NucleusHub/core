import mongoose from 'mongoose'
import { verifyProfile } from './auth.js'

const TTL_MS = 10_000
const cache = new Map()

export async function disabledAppIdsForProfile(profileId) {
  const pid = String(profileId)
  const hit = cache.get(pid)
  const now = Date.now()
  if (hit && now - hit.at < TTL_MS) return hit.ids

  const db = mongoose.connection?.db
  if (!db) throw new Error('no active mongo connection')

  const groups = await db.collection('groups')
    .find({ memberIds: pid }, { projection: { _id: 1 } })
    .toArray()
  const groupIds = groups.map(g => String(g._id))

  const [globalOv, groupOv, userOv] = await Promise.all([
    db.collection('registryoverrides').find({ kind: 'app', disabled: true }).toArray(),
    groupIds.length
      ? db.collection('groupoverrides').find({ groupId: { $in: groupIds }, kind: 'app', disabled: true }).toArray()
      : [],
    db.collection('useroverrides').find({ profileId: pid, kind: 'app', disabled: true }).toArray(),
  ])

  const ids = new Set([...globalOv, ...groupOv, ...userOv].map(o => o.itemId))
  cache.set(pid, { at: now, ids })
  return ids
}

export function requireAppEnabled(appId) {
  return async (req, res, next) => {
    // Unauthenticated falls through to requireAuth (401); admins bypass.
    const profile = req.profile || verifyProfile(req)
    if (!profile || profile.role === 'admin') return next()
    try {
      const disabled = await disabledAppIdsForProfile(profile.profileId)
      if (disabled.has(appId)) {
        return res.status(403).json({ error: 'This app is disabled for your account', code: 'APP_DISABLED', app: appId })
      }
    } catch (e) {
      // Fail-open: a transient DB error must not lock users out of enabled apps.
      console.warn(`[core] app-access check failed for '${appId}':`, e.message)
    }
    next()
  }
}
