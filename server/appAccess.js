import mongoose from 'mongoose'
import { verifyProfile } from './auth.js'

// Server-side enforcement of the admin registry overrides — the authoritative
// counterpart to the client's registry gating (core/useRegistry.js). An app
// server mounts `requireAppEnabled('<its id>')` on its API router; a user for
// whom the app has been disabled (globally, by a group, or per-user) is then
// refused with 403 no matter how they reach the endpoint.
//
// "Not installed" needs no check here: an app with no manifest has no running
// server and nginx has no upstream for it. This only enforces the *disabled*
// state.
//
// The disabled set is the SAME union the auth-server's /effective-overrides
// computes: global (registryoverrides) ∪ the user's groups (groupoverrides) ∪
// per-user (useroverrides), for kind 'app'. We read those collections directly
// off the app's own Mongo connection (mongoose here resolves to the importing
// app's instance), so there's no extra network hop and no model duplication.

const TTL_MS = 10_000
const cache = new Map() // profileId -> { at: number, ids: Set<string> }

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
    // Identify the caller. If unauthenticated, don't 403 here — let the route's
    // own requireAuth issue the 401. Admins bypass entirely so management
    // actions (e.g. per-app teardown during user deletion) keep working even
    // for an app the admin has disabled.
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
