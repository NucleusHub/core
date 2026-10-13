import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import router from './routes/index.js'

export function createApp() {
  const app = express()
  app.use(cors({ origin: true, credentials: true }))
  // Raised limit for base64 avatar data URLs (per-image cap in routes/index.js).
  app.use(express.json({ limit: '4mb' }))
  app.use(cookieParser())
  app.get('/api/auth/health', (_, res) => res.json({ ok: true }))
  app.use('/api/auth', router)
  return app
}
