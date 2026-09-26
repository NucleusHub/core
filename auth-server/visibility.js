import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'

const FILE = path.join(process.env.STATE_DIR || '/srv/state', 'visibility.json')
const secret = () => process.env.JWT_SECRET || 'nucleus-jwt-secret'

const EMPTY = { ips: new Map(), profiles: new Map() }

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

const isLoopback = (ip) => ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')

// mtime-cached; a missing or broken file means no restriction.
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

// No group or more than one group = unrestricted.
const unrestricted = (groups) => groups.length === 0 || groups.length >= 2

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

// opts.picker: login screen / account switcher, where guests may see the list.
export function filterProfiles(list, viewer, opts = {}) {
  const cfg = load()

  // Outside the picker guests see only themselves; isGuest isn't in the JWT, so read it from the list.
  if (!opts.picker) {
    const self = viewer.profileId
      ? list.find((p) => normId(p._id) === normId(viewer.profileId))
      : null
    if (self?.isGuest) return [self]
  }

  // Group visibility is Tailscale-IP based; skip it on loopback (local dev).
  if (isLoopback(viewer.ip)) return list

  const viewerGroups = viewer.profileId
    ? groupsOf(cfg.profiles, normId(viewer.profileId))
    : groupsOf(cfg.ips, viewer.ip)

  if (unrestricted(viewerGroups)) return list
  const allowed = new Set(viewerGroups)

  return list.filter((p) => {
    const targetGroups = groupsOf(cfg.profiles, normId(p._id))
    if (unrestricted(targetGroups)) return true
    return targetGroups.some((g) => allowed.has(g))
  })
}
