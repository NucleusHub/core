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

export const { mounts: coreMounts, launchers: coreLaunchers, preferences: corePreferences } = build()
