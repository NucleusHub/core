// Core-level client extension points contributed by installed plugins. A plugin
// whose manifest `target` includes `core` may ship `client/core.js`, whose
// default export describes what it adds to the shared chrome every app renders:
//
//   export default {
//     // Mounted once by core/auth/AuthGuard.vue in every app. auth: true →
//     // only for signed-in viewers (inside the app); false → every auth state.
//     mounts: [{ component: () => import('./Banner.vue'), auth: false }],
//     // Buttons surfaced in AppSidebar + ProfileSelector for signed-in viewers.
//     launchers: [{ labelKey: 'core.foo.launch', icon, iconOutline, open }],
//     // Rows in Profile settings → Plugins → Preferences. The component gets
//     // the edited `profile` and may emit `updated` after saving.
//     preferences: [{ component: () => import('./Pref.vue') }],
//   }
//
// Only that fixed filename is globbed (so unrelated plugin client code never
// enters an app bundle), which also means a missing plugin — or a missing
// /plugins dir altogether — simply contributes nothing. Hosts gate every entry
// on isPluginEnabled(pluginId). Mirrors the app-level extension points (e.g.
// apps/watchlist/client/src/utils/pluginIndicators.js).
import { defineAsyncComponent } from 'vue'

const manifests = import.meta.glob('../plugins/*/nucleus.plugin.json', { eager: true, import: 'default' })
const modules = import.meta.glob('../plugins/*/client/core.js', { eager: true, import: 'default' })

const dirOf = (file) => file.match(/\/plugins\/([^/]+)\//)?.[1]

function build() {
  const manifestByDir = {}
  for (const [file, m] of Object.entries(manifests)) manifestByDir[dirOf(file)] = m

  const mounts = []
  const launchers = []
  const preferences = []
  for (const [file, ext] of Object.entries(modules)) {
    const dir = dirOf(file)
    const manifest = manifestByDir[dir]
    const targets = Array.isArray(manifest?.target) ? manifest.target : [manifest?.target]
    if (!targets.includes('core') || !ext) continue
    const pluginId = manifest?.id || dir
    for (const m of ext.mounts ?? []) {
      mounts.push({ pluginId, auth: !!m.auth, component: defineAsyncComponent(m.component) })
    }
    for (const l of ext.launchers ?? []) {
      launchers.push({ pluginId, ...l })
    }
    for (const p of ext.preferences ?? []) {
      preferences.push({ pluginId, component: defineAsyncComponent(p.component) })
    }
  }
  return { mounts, launchers, preferences }
}

// Resolved at load; the plugin set is fixed for a given bundle.
export const { mounts: coreMounts, launchers: coreLaunchers, preferences: corePreferences } = build()
