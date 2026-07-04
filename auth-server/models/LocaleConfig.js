import mongoose from 'mongoose'

// Instance-wide localization state. A single document (singleton) — created by
// runMigrations() if absent. See core/auth-server/routes/localization.js.
//
//  installedLanguages  languages activated in this Nucleus instance (BCP-47
//                      tags). Installing ≠ enabling; a language stays installed
//                      until an admin explicitly removes it. 'en-US' is the base
//                      and is always installed.
//  defaultLanguage     the fallback language used when a user has no assigned
//                      locale. Always 'en-US' unless an admin changes it.
//  enabled             per-scope map of enabled languages. Scope key is 'core'
//                      or an app id (e.g. 'orbit'). A language must be installed
//                      AND enabled for a scope to be offered there; runtime
//                      lookups always fall back to English regardless.
const localeConfigSchema = new mongoose.Schema({
  installedLanguages: { type: [String], default: ['en-US'] },
  defaultLanguage:    { type: String, default: 'en-US' },
  enabled:            { type: Map, of: [String], default: () => ({ core: ['en-US'] }) },
}, { timestamps: true })

export default mongoose.model('LocaleConfig', localeConfigSchema)
