import express from 'express'
import cookieParser from 'cookie-parser'
import { corsPolicy, sameOrigin } from './middleware/origin.js'
import router from './routes/index.js'
import settingsRouter from './routes/settings.js'
import { serverCodeRouter } from './routes/v1/serverCode.js'
import { oauthRouter } from './routes/v1/oauth.js'
import { qrRouter } from './routes/v1/qr.js'
import { appProxyRouter } from './routes/v1/appProxy.js'
import { nidRouter } from './routes/nid.js'
import { ssoRouter } from './routes/sso.js'

export function createApp() {
  const app = express()
  // One proxy hop (nginx) in front; without this every client shares the nginx IP for rate limits.
  // Skip every private hop (stack nginx, edge, tunnel) to reach the real client address.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal')
  app.use(corsPolicy)
  app.use(sameOrigin)
  // Before the body parser: bodies are streamed through untouched.
  app.use(['/api/v1/app-data', '/api/v1/files', '/api/v1/views', '/api/v1/commands', '/api/v1/apps'], appProxyRouter())
  // Raised limit for base64 avatar data URLs (per-image cap in routes/index.js).
  app.use(express.json({ limit: '4mb' }))
  app.use(cookieParser())
  app.get('/api/auth/health', (_, res) => res.json({ ok: true }))
  app.use('/api/v1/auth/server-code', serverCodeRouter())
  app.use('/api/v1/oauth', oauthRouter())
  app.use('/api/v1/auth/qr', qrRouter())
  app.use('/api/auth/settings', settingsRouter)
  app.use('/api/auth/nid/sso', ssoRouter())
  app.use('/api/auth/nid', nidRouter())
  app.use('/api/auth', router)
  return app
}
