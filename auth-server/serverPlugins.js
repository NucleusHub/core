import { readdirSync, readFileSync, existsSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { join } from 'path'

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
