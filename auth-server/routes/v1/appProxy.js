import http from 'node:http'
import { Router } from 'express'
import { findAccessToken } from '../../lib/oauth.js'
import { serverForClient } from '../../lib/installedApps.js'

const err = (res, status, code, message) => res.status(status).json({ error: { code, message } })

// The app a request belongs to: the path names it for /apps/:clientId, the bearer token otherwise.
async function targetClient(req) {
  const named = req.originalUrl.match(/^\/api\/v1\/apps\/([^/?]+)/i)
  if (named) return decodeURIComponent(named[1])
  const m = String(req.headers.authorization || '').match(/^Bearer[ ]+(\S+)[ ]*$/i)
  return m ? (await findAccessToken(m[1]))?.clientId ?? null : null
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

    const upstream = http.request(
      { host: server.host, port: server.port, path: req.originalUrl, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy()
      err(res, 502, 'app_unavailable', 'The app server did not answer.')
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  return router
}
