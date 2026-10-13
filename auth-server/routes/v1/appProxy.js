import http from 'node:http'
import { Router } from 'express'
import { findAccessToken } from '../../lib/oauth.js'
import { serverForClient } from '../../lib/installedApps.js'
import { isHttps } from '../../lib/session.js'

const err = (res, status, code, message) => res.status(status).json({ error: { code, message } })

// The app a request belongs to: the path names it for /apps/:clientId, the bearer token otherwise.
async function targetClient(req) {
  const named = req.originalUrl.match(/^\/api\/v1\/apps\/([^/?]+)/i)
  if (named) return decodeURIComponent(named[1])
  const m = String(req.headers.authorization || '').match(/^Bearer[ ]+(\S+)[ ]*$/i)
  return m ? (await findAccessToken(m[1]))?.clientId ?? null : null
}

const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']
const UPSTREAM_IDLE_MS = 60_000

// Drops hop-by-hop headers (plus any the Connection header names) and the given extras.
function clean(headers, extra = []) {
  const drop = new Set([...HOP, ...extra])
  for (const t of String(headers.connection || '').split(',')) if (t.trim()) drop.add(t.trim().toLowerCase())
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !drop.has(k.toLowerCase())))
}

// Streams /api/v1 app-data traffic to the app server that owns it, without buffering bodies.
export function appProxyRouter() {
  const router = Router()
  router.use(async (req, res) => {
    let clientId
    try {
      clientId = await targetClient(req)
    } catch {
      return err(res, 500, 'server_error', 'Something went wrong.')
    }
    if (!clientId) {
      res.set('WWW-Authenticate', 'Bearer realm="nucleus", error="invalid_token"')
      return err(res, 401, 'unauthorized', 'A valid Nucleus ID access token is required.')
    }
    const server = await serverForClient(clientId)
    if (!server) return err(res, 404, 'app_not_installed', 'No installed app serves this client.')

    const headers = clean(req.headers, ['cookie'])
    for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith('x-forwarded-')) delete headers[k]
    headers['x-forwarded-for'] = req.ip
    headers['x-forwarded-proto'] = isHttps(req) ? 'https' : 'http'
    headers['x-forwarded-host'] = req.headers.host

    const upstream = http.request(
      { host: server.host, port: server.port, path: req.originalUrl, method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode, clean(up.headers, ['set-cookie']))
        up.pipe(res)
      },
    )
    upstream.setTimeout(UPSTREAM_IDLE_MS, () => {
      if (res.headersSent) return upstream.destroy()
      upstream.destroy()
      err(res, 504, 'upstream_timeout', 'The app server timed out.')
    })
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy()
      err(res, 502, 'app_unavailable', 'The app server did not answer.')
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  return router
}
