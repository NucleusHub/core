import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import Profile, { colorFromName } from '../models/Profile.js'
import LocaleConfig from '../models/LocaleConfig.js'
import MaintenancePreset from '../models/MaintenancePreset.js'

// Shipped maintenance-banner presets, mirroring the wording of the legacy
// infra/maintenance CLI, translated to the languages that ship on disk. Seeded
// once (builtin) so the Admin Console always has a working default set; admins
// can edit them and add their own. {eta} is filled when the banner is raised.
const BUILTIN_PRESETS = [
  {
    key: 'update', order: 1,
    title: { 'en-US': 'Nucleus is being updated', 'cs-CZ': 'Probíhá aktualizace Nucleus' },
    message: {
      'en-US': 'Nucleus is being updated to a new version — expect brief unresponsiveness for {eta}. File uploads and any changes may not be saved right now.',
      'cs-CZ': 'Nucleus se aktualizuje na novou verzi — počítejte s krátkou nedostupností po dobu {eta}. Nahrávání souborů a jakékoli změny se nyní nemusí uložit.',
    },
  },
  {
    key: 'rebuild', order: 2,
    title: { 'en-US': 'Nucleus is being rebuilt', 'cs-CZ': 'Přestavba Nucleus' },
    message: {
      'en-US': 'Containers are being rebuilt — Nucleus will be unavailable for {eta}. Please hold off on uploads or saving changes until this clears.',
      'cs-CZ': 'Kontejnery se přestavují — Nucleus bude nedostupný po dobu {eta}. Zdržte se prosím nahrávání nebo ukládání změn, dokud to neskončí.',
    },
  },
  {
    key: 'db', order: 3,
    title: { 'en-US': 'Database maintenance', 'cs-CZ': 'Údržba databáze' },
    message: {
      'en-US': 'Database maintenance in progress ({eta}). Any changes you make may not be saved until this finishes.',
      'cs-CZ': 'Probíhá údržba databáze ({eta}). Jakékoli změny se nemusí uložit, dokud údržba neskončí.',
    },
  },
  {
    key: 'quick', order: 4,
    title: { 'en-US': 'Quick restart', 'cs-CZ': 'Rychlý restart' },
    message: {
      'en-US': 'Quick restart in progress — back in {eta}.',
      'cs-CZ': 'Probíhá rychlý restart — vrátíme se za {eta}.',
    },
  },
]

export async function runMigrations() {
  const db = mongoose.connection.db
  const migrations = db.collection('_migrations')

  // Ensure Guest profile always exists
  const guest = await Profile.findOne({ isGuest: true })
  if (!guest) {
    await Profile.create({ name: 'Guest', role: 'user', isGuest: true, color: '#6b7280', whatsNew: { lastSeenAt: new Date() } })
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

  // Seed the built-in maintenance presets once. Upsert by key so re-runs are
  // idempotent and never clobber an admin's edits (only fills missing ones).
  for (const p of BUILTIN_PRESETS) {
    const exists = await MaintenancePreset.findOne({ key: p.key })
    if (!exists) {
      await MaintenancePreset.create({ ...p, builtin: true, level: 'warning' })
      console.log(`[migration] MaintenancePreset '${p.key}' seeded`)
    }
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
