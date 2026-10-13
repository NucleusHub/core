import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import router from './routes/index.js'
import settingsRouter from './routes/settings.js'
import { serverCodeRouter } from './routes/v1/serverCode.js'
import { nidRouter } from './routes/nid.js'

export function createApp() {
  const app = express()
  // One proxy hop (nginx) in front; without this every client shares the nginx IP for rate limits.
  app.set('trust proxy', 1)
  app.use(cors({ origin: true, credentials: true }))
  // Raised limit for base64 avatar data URLs (per-image cap in routes/index.js).
  app.use(express.json({ limit: '4mb' }))
  app.use(cookieParser())
  app.get('/api/auth/health', (_, res) => res.json({ ok: true }))
  app.use('/api/v1/auth/server-code', serverCodeRouter())
  app.use('/api/auth/settings', settingsRouter)
  app.use('/api/auth/nid', nidRouter())
  app.use('/api/auth', router)
  return app
}
