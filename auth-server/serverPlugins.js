import { readdirSync, readFileSync, existsSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { join } from 'path'

// Server-side contributions of installed plugins hosted by the auth-server.
// Plugins are bind-mounted at /app/plugins (./plugins from here). A plugin is
// hosted here when its nucleus.plugin.json either targets "core" or declares
// `extensions.authRoute`; it may then ship:
//
//   server/route.js    default export: an express Router, mounted under
//                      /api/auth at `extensions.authRoute` (e.g. "/i18n"),
//                      defaulting to /<id>. `authRoute: false` opts out.
//   server/migrate.js  default export: async () => void, run once per boot
//                      after the DB connects (idempotent seeding/upgrades).
//
// A non-core plugin opts in via authRoute — e.g. in-common, whose cross-app
// lookup needs the shared identity data this server owns. Nothing is named
// here, so adding a plugin needs no core change and a missing plugins dir
// hosts nothing. A plugin that fails to load is logged and skipped — it never
// takes the auth-server down.
const PLUGINS_DIR = fileURLToPath(new URL('./plugins', import.meta.url))

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'nucleus.plugin.json'), 'utf8'))
  } catch {
    return null
  }
}

function mountPath(manifest) {
  const declared = manifest.extensions?.authRoute
  if (declared === false) return null
  if (typeof declared === 'string') return '/' + declared.replace(/^\/+/, '')
  const targets = Array.isArray(manifest.target) ? manifest.target : [manifest.target]
  return targets.includes('core') || declared === true ? `/${manifest.id}` : null
}

// Installed plugins hosted here, sorted by dir name for a stable mount order.
function hostedPlugins() {
  let names
  try {
    names = readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const dir = join(PLUGINS_DIR, name)
    const manifest = readManifest(dir)
    const path = manifest && mountPath(manifest)
    return path ? [{ id: manifest.id || name, dir, path }] : []
  })
}

async function importDefault(file) {
  return (await import(pathToFileURL(file).href)).default
}

export async function mountPluginRoutes(router) {
  const plugins = hostedPlugins()
  if (!plugins.length) console.log('[plugins] none installed')
  for (const p of plugins) {
    const file = join(p.dir, 'server', 'route.js')
    if (!existsSync(file)) continue
    try {
      router.use(p.path, await importDefault(file))
      console.log(`[plugins] ${p.id} mounted at /api/auth${p.path}`)
    } catch (err) {
      console.error(`[plugins] ${p.id} failed to load — skipped:`, err)
    }
  }
}

export async function runPluginMigrations() {
  for (const p of hostedPlugins()) {
    const file = join(p.dir, 'server', 'migrate.js')
    if (!existsSync(file)) continue
    try {
      await (await importDefault(file))()
    } catch (err) {
      console.error(`[plugins] ${p.id} migration failed — skipped:`, err)
    }
  }
}
