const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/

const CHANNEL_RANK = { alpha: 1, beta: 2, rc: 3, stable: 4 }

const CHANNEL_LABELS = { stable: 'Stable', alpha: 'Alpha', beta: 'Beta', rc: 'RC' }

export function parseVersion(v) {
  const m = typeof v === 'string' ? v.trim().match(SEMVER_RE) : null
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || null,
    prereleaseNum: m[5] != null ? Number(m[5]) : null,
  }
}

export function isValidVersion(v) {
  return parseVersion(v) !== null
}

export function channelOf(v) {
  const p = parseVersion(v)
  if (!p) return null
  return p.prerelease || 'stable'
}

export function channelLabel(v) {
  const c = channelOf(v)
  return c ? CHANNEL_LABELS[c] : null
}

export function formatVersion(v) {
  if (isValidVersion(v)) return `v${String(v).trim()}`
  return v ? String(v) : ''
}

// Unparseable inputs sort last so a bad version never looks newest.
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1
  }
  const ra = CHANNEL_RANK[pa.prerelease || 'stable']
  const rb = CHANNEL_RANK[pb.prerelease || 'stable']
  if (ra !== rb) return ra < rb ? -1 : 1
  const na = pa.prereleaseNum ?? 0
  const nb = pb.prereleaseNum ?? 0
  if (na !== nb) return na < nb ? -1 : 1
  return 0
}

// Minimal range check: space-separated AND comparators only (no ||, ^, ~, x-ranges).
export function satisfies(version, range) {
  if (!isValidVersion(version)) return false
  if (!range || typeof range !== 'string' || range === '*') return true
  return range
    .trim()
    .split(/\s+/)
    .every(part => {
      const m = part.match(/^(>=|<=|>|<|=)?\s*(.+)$/)
      if (!m) return false
      const op = m[1] || '='
      if (!isValidVersion(m[2])) return false
      const cmp = compareVersions(version, m[2])
      switch (op) {
        case '>=': return cmp >= 0
        case '<=': return cmp <= 0
        case '>':  return cmp > 0
        case '<':  return cmp < 0
        case '=':  return cmp === 0
        default:   return false
      }
    })
}
