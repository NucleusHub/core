import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import Profile, { colorFromName } from '../models/Profile.js'
import LocaleConfig from '../models/LocaleConfig.js'

export async function runMigrations() {
  const db = mongoose.connection.db
  const migrations = db.collection('_migrations')

  // Ensure Guest profile always exists
  const guest = await Profile.findOne({ isGuest: true })
  if (!guest) {
    await Profile.create({ name: 'Guest', role: 'user', isGuest: true, color: '#6b7280' })
    console.log('[migration] Guest profile created')
  }

  // Ensure the singleton localization config exists (base language installed
  // and enabled for core). See core/auth-server/routes/localization.js.
  const localeConfig = await LocaleConfig.findOne()
  if (!localeConfig) {
    await LocaleConfig.create({
      installedLanguages: ['en-US'],
      defaultLanguage: 'en-US',
      enabled: { core: ['en-US'] },
    })
    console.log('[migration] LocaleConfig created')
  }

  // Assign legacy data (docs without profileId) to Honzyk
  if (await migrations.findOne({ name: 'assign-legacy-to-honzyk' })) return

  const legacyCollections = ['dashboards', 'watchlistitems', 'goals', 'orbitfiles', 'orbitfolders']
  const hasLegacy = (await Promise.all(
    legacyCollections.map(c => db.collection(c).findOne({ profileId: { $exists: false } }))
  )).some(Boolean)

  if (!hasLegacy) {
    await migrations.insertOne({ name: 'assign-legacy-to-honzyk', ranAt: new Date(), skipped: true })
    return
  }

  let honzyk = await Profile.findOne({ name: 'Honzyk', role: 'admin' })
  if (!honzyk) {
    const pinHash = await bcrypt.hash('1339', 10)
    honzyk = await Profile.create({
      name: 'Honzyk',
      role: 'admin',
      pin: pinHash,
      color: colorFromName('Honzyk'),
    })
    console.log('[migration] Honzyk profile created')
  }

  const profileId = honzyk._id
  await Promise.all(legacyCollections.map(c =>
    db.collection(c).updateMany({ profileId: { $exists: false } }, { $set: { profileId } })
  ))

  await migrations.insertOne({ name: 'assign-legacy-to-honzyk', ranAt: new Date() })
  console.log('[migration] Legacy data assigned to Honzyk')
}
