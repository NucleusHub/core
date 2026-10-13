import mongoose from 'mongoose'
import { createApp } from './app.js'
import { loadJwtSecret } from './lib/secret.js'
import { runMigrations } from './utils/migration.js'
import { runPluginMigrations } from './serverPlugins.js'

const PORT = process.env.PORT || 3005
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nucleus'

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB')
    await loadJwtSecret(mongoose.connection.db)
    await runMigrations()
    await runPluginMigrations()
    createApp().listen(PORT, () => console.log(`Auth server on :${PORT}`))
  })
  .catch(err => { console.error('MongoDB connection failed:', err); process.exit(1) })
