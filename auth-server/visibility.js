// ─────────────────────────────────────────────────────────────────────────────
// Group visibility ("Home" vs "Garaz") — self-contained, opt-in, visibility-only.
//
// Purpose: let two sets of people share one Nucleus server + DB without seeing
// each other in the profile picker, the admin profile manager, or Echo contacts.
// This is a *visibility* filter on the single `/api/auth/profiles` chokepoint —
// it hides people from each other; it does NOT harden individual data APIs.
//
// It reads ONE hand-edited JSON file and touches nothing else. Delete the file
// (or leave every list empty) and the whole thing is a no-op — everyone sees all.
//
//   state/visibility.json   (mounted at $STATE_DIR/visibility.json, hot-reloaded)
//   {
//     "ips": {           // used ONLY on the pre-login profile picker, where the
//       "Home":  [...],  // only thing identifying the device is its IP.
//       "Garaz": [...]   // Tailscale IPs are stable per device.
//     },
//     "profiles": {      // used everywhere after login; classifies each profile
//       "Home":  [...],  // by its Mongo _id (NOT name — names can collide).
//       "Garaz": [...]
//     }
//   }
//
// Rules (identical for both files, and symmetric for viewer and target):
//   • member of exactly ONE group  → confined to that group
//   • member of BOTH groups        → sees / is seen by everyone
//   • member of NO group (unlisted / unknown IP) → sees / is seen by everyone
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'

const FILE = path.join(process.env.STATE_DIR || '/srv/state', 'visibility.json')
const secret = () => process.env.JWT_SECRET || 'nucleus-jwt-secret'

const EMPTY = { ips: new Map(), profiles: new Map() }

// value → [groupName, ...]   (a value may legitimately appear in several groups)
function reverseIndex(section, normalize) {
  const out = new Map()
  if (!section || typeof section !== 'object') return out
  for (const [group, values] of Object.entries(section)) {
    if (!Array.isArray(values)) continue
    for (const raw of values) {
      const key = normalize(raw)
      if (!key) continue
      const groups = out.get(key) || []
      if (!groups.includes(group)) groups.push(group)
      out.set(key, groups)
    }
  }
  return out
}

const normIp = (v) => String(v ?? '').trim().replace(/^::ffff:/i, '')
const normId = (v) => String(v ?? '').trim()

// Loopback = the request came from the box itself (local dev). Group visibility
// is a Tailscale-IP feature, so it's meaningless — and just gets in the way —
// when developing on localhost. `normIp` has already stripped any ::ffff: prefix.
const isLoopback = (ip) => ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')

// mtime-cached load: edit the JSON and the change is picked up on the next
// request, no restart. A missing/broken file degrades to "no restriction".
let cache = { mtimeMs: -1, data: EMPTY }
function load() {
  try {
    const st = fs.statSync(FILE)
    if (st.mtimeMs !== cache.mtimeMs) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      cache = {
        mtimeMs: st.mtimeMs,
        data: {
          ips: reverseIndex(parsed.ips, normIp),
          profiles: reverseIndex(parsed.profiles, normId),
        },
      }
    }
  } catch {
    cache = { mtimeMs: -1, data: EMPTY }
  }
  return cache.data
}

const groupsOf = (index, key) => (key && index.get(key)) || []

// A member of no group, or of every group they could be in (>1), is
// unrestricted — sees all, and (as a target) is seen by all.
const unrestricted = (groups) => groups.length === 0 || groups.length >= 2

// Identify the viewer. Prefer the logged-in profile (authoritative, works
// everywhere after login); fall back to the request IP for the pre-login
// profile picker, which has no session yet. Never stored — read per request.
export function resolveViewer(req) {
  let profileId = null
  const token = req.cookies?.nucleus_token
  if (token) {
    try { profileId = jwt.verify(token, secret())?.profileId ?? null } catch { /* not logged in */ }
  }
  const ip = normIp(
    req.headers['x-real-ip'] ||
    String(req.headers['x-forwarded-for'] || '').split(',')[0] ||
    req.socket?.remoteAddress ||
    '',
  )
  return { profileId, ip }
}

// Filter a list of profile-shaped objects ({ _id, isGuest, ... }) to what
// `viewer` may see. `opts.picker` = this is a profile picker / account switcher
// (login screen, hub account widget) rather than an in-app people list; guests
// are allowed to see the list there so they can pick/switch accounts. Group
// (Home/Garaz) filtering still applies in picker mode.
export function filterProfiles(list, viewer, opts = {}) {
  const cfg = load()

  // Guests are a special case: they are "in no group" as a *target* (so everyone
  // can see them, per the no-group rule) but as a *viewer* in an app they see no
  // one but themselves — a guest gets no access to any other profile via Echo or
  // any other app. The profile picker (opts.picker) is exempt so guests can still
  // choose/switch accounts. isGuest isn't in the JWT, so read it off the viewer's
  // own entry in the list.
  if (!opts.picker) {
    const self = viewer.profileId
      ? list.find((p) => normId(p._id) === normId(viewer.profileId))
      : null
    if (self?.isGuest) return [self]
  }

  // Ignore group visibility entirely on localhost (local dev): a developer
  // hitting the stack over loopback has no Tailscale group IP and shouldn't be
  // filtered down to a single group. Guest handling above still applies.
  if (isLoopback(viewer.ip)) return list

  const viewerGroups = viewer.profileId
    ? groupsOf(cfg.profiles, normId(viewer.profileId))
    : groupsOf(cfg.ips, viewer.ip)

  if (unrestricted(viewerGroups)) return list // sees everyone
  const allowed = new Set(viewerGroups)       // confined to a single group

  return list.filter((p) => {
    const targetGroups = groupsOf(cfg.profiles, normId(p._id))
    if (unrestricted(targetGroups)) return true // global / unlisted profile
    return targetGroups.some((g) => allowed.has(g))
  })
}
