import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import mongoose from 'mongoose'
import router from './routes/index.js'
import { runMigrations } from './utils/migration.js'

const app = express()
const PORT = process.env.PORT || 3005
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nucleus'

app.use(cors({ origin: true, credentials: true }))
// Bumped from the 100kb default to accommodate uploaded avatar data URLs
// (resized client-side to a small square, but base64 inflates them). See the
// hard cap enforced per-image in routes/index.js.
app.use(express.json({ limit: '4mb' }))
app.use(cookieParser())
app.get('/api/auth/health', (_, res) => res.json({ ok: true }))
app.use('/api/auth', router)

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB')
    await runMigrations()
    app.listen(PORT, () => console.log(`Auth server on :${PORT}`))
  })
  .catch(err => { console.error('MongoDB connection failed:', err); process.exit(1) })
