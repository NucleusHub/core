import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const TTL_MS = 5000
let cache = null

// Installed apps are the dirs under APPS_DIR that ship a nucleus.app.json.
export async function installedApps() {
  const dir = process.env.APPS_DIR || '/apps'
  if (cache && cache.dir === dir && Date.now() - cache.at < TTL_MS) return cache.apps
  const apps = []
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch { /* no apps dir: nothing installed */ }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    try {
      const m = JSON.parse(await readFile(path.join(dir, e.name, 'nucleus.app.json'), 'utf8'))
      apps.push({ dir: e.name, id: m.id || e.name, clientId: m.nucleusId?.clientId || null, server: m.server || null })
    } catch { /* not an app or unreadable manifest */ }
  }
  cache = { at: Date.now(), dir, apps }
  return apps
}

export async function serverForClient(clientId) {
  const app = (await installedApps()).find(a => a.clientId === clientId)
  return app?.server?.service && app.server.port ? { host: app.server.service, port: app.server.port } : null
}
