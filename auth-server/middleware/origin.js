import { getSettings } from '../models/AuthSettings.js'

// Port of nucleus-web middleware/security.js (sameOrigin) and its app.js CORS policy.

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const DEFAULT_PORT = { 'http:': '80', 'https:': '443' }
// Bearer-only routes carry no ambient cookie, and Apple's form_post callback is cross-site by design.
const EXEMPT = new Set([
  'POST /api/v1/oauth/token',
  'POST /api/v1/oauth/revoke',
  'PUT /api/v1/oauth/appearance',
  'POST /api/auth/nid/sso/apple/callback',
])
const OPEN_CORS = /^\/api\/v1\/oauth\/(metadata|token|revoke|userinfo|appearance)$/

// Express routing ignores case and trailing slashes, so the checks do too.
const norm = (path) => path.toLowerCase().replace(/\/+$/, '')
const guarded = (path) => /^\/api\/(auth|v1)(\/|$)/.test(path)

function parse(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

// Host and port must match; the scheme only when nginx told us which one the browser used.
export function sameOriginAs(req, origin) {
  const o = parse(origin)
  if (!o || !DEFAULT_PORT[o.protocol]) return false
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim()
  const h = parse(`http://${host}`)
  if (!h || h.hostname !== o.hostname) return false
  // `proxy_set_header Host $host` drops the port, so a bare host means the browser's default port.
  const hostPort = host.match(/:(\d+)$/)?.[1] ?? DEFAULT_PORT[o.protocol]
  if ((o.port || DEFAULT_PORT[o.protocol]) !== hostPort) return false
  const proto = req.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  return !proto || `${proto}:` === o.protocol
}

const reject = (req, res) => (norm(req.path).startsWith('/api/v1')
  ? res.status(403).json({ error: { code: 'cross_origin', message: 'Request came from an origin this server does not serve.' } })
  : res.status(403).json({ error: 'Request came from an origin this server does not serve.', code: 'cross_origin' }))

// The session cookie is SameSite=Lax, which still rides along from sibling ports and subdomains.
export async function sameOrigin(req, res, next) {
  if (!WRITES.has(req.method)) return next()
  const path = norm(req.path)
  if (!guarded(path) || EXEMPT.has(`${req.method} ${path}`)) return next()
  const origin = req.get('origin')
  if (!origin) {
    // No Origin: curl or a native app pass; a browser that admits to being elsewhere does not.
    return ['cross-site', 'same-site'].includes(req.get('sec-fetch-site')) ? reject(req, res) : next()
  }
  if (sameOriginAs(req, origin)) return next()
  try {
    const { publicOrigin } = await getSettings()
    if (publicOrigin && parse(origin)?.origin === parse(publicOrigin)?.origin) return next()
  } catch {
    return res.status(500).json({ error: 'Server error' })
  }
  reject(req, res)
}

// Only the bearer-token routes are cross-origin, and never with credentials; everything else is same-origin.
export function corsPolicy(req, res, next) {
  const path = norm(req.path)
  const open = OPEN_CORS.test(path) || (path === '/api/v1/auth/server-code' && (req.method === 'GET' || req.method === 'HEAD'))
  if (!open) return next()
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.set('Access-Control-Expose-Headers', 'WWW-Authenticate')
  res.set('Access-Control-Max-Age', '600')
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
}
