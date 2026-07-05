// Shared SemVer helpers for Nucleus versioning.
//
// Dependency-free so any surface — hub, admin, pulse, the shared @core
// components — can import via `@core/version.js`. This is the foundation the
// future update/compatibility features (update checking, dependency
// resolution, compatibility validation, rollbacks) build on: keep it small,
// but keep the semantics correct.
//
// Supported form: MAJOR.MINOR.PATCH with an optional prerelease of
// `-alpha.N`, `-beta.N` or `-rc.N`. Build metadata and other identifiers are
// intentionally not accepted — Nucleus only issues the four channels above.

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/

// Ordering weight for the release channel: a prerelease is always "less than"
// its eventual stable release (1.0.0-rc.1 < 1.0.0).
const CHANNEL_RANK = { alpha: 1, beta: 2, rc: 3, stable: 4 }

const CHANNEL_LABELS = { stable: 'Stable', alpha: 'Alpha', beta: 'Beta', rc: 'RC' }

// parseVersion('0.9.0-beta.2') → { major, minor, patch, prerelease, prereleaseNum }
// Returns null for anything that isn't a supported SemVer string.
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

// Release channel derived from the SemVer suffix: 'stable' | 'alpha' | 'beta' | 'rc'.
// Returns null when the version can't be parsed.
export function channelOf(v) {
  const p = parseVersion(v)
  if (!p) return null
  return p.prerelease || 'stable'
}

// Friendly badge text (Stable / Alpha / Beta / RC), or null if unparseable.
export function channelLabel(v) {
  const c = channelOf(v)
  return c ? CHANNEL_LABELS[c] : null
}

// Canonical display form — always v-prefixed, e.g. "v0.9.0-beta.2".
// Falls back to the raw string (or '') so the UI never renders "undefined".
export function formatVersion(v) {
  if (isValidVersion(v)) return `v${String(v).trim()}`
  return v ? String(v) : ''
}

// Compare two SemVer strings. Returns -1, 0 or 1 (a<b, a==b, a>b).
// Unparseable inputs sort last so a bad version never masquerades as newest.
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

// Minimal range satisfier for compatibility checks. Supports a
// space-separated AND list of comparators — enough for the manifest form
// ">=0.8.0 <1.0.0". Operators: >=, >, <=, <, = (bare version implies =).
// This is deliberately conservative groundwork for install-time validation;
// it is NOT a full node-semver implementation (no ||, ^, ~, x-ranges).
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
