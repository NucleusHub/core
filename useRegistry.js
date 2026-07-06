import { ref, onMounted } from 'vue'

const apps = ref([])
// Every installed app, INCLUDING ones disabled for this user — `apps` above has
// those filtered out. Consumers that must reason about a disabled app (e.g. the
// AuthGuard mapping the current route to its app id to block access) read this.
const allApps = ref([])
const widgets = ref([])
// Globally-disabled widget ids (incl. cascade). Exposed so renderers that don't
// read the filtered `widgets` list (e.g. the orbit system nodes) can honour it.
const disabledWidgetIds = ref(new Set())
// Globally-disabled app ids — e.g. disabling "pulse" turns off the whole
// widget/dashboard system (button, overlay, widgets), leaving only core hub UI.
const disabledAppIds = ref(new Set())
const loading = ref(true)
const error = ref(null)

let fetched = false

async function fetchRegistry() {
  if (fetched) return
  fetched = true
  try {
    const [appsRes, widgetsRes, overrides] = await Promise.all([
      fetch('/api/registry/apps'),
      fetch('/api/registry/widgets'),
      // Effective overrides for the current user (global ∪ per-user) — hides
      // anything an admin disabled globally or just for this user.
      fetch('/api/auth/effective-overrides', { credentials: 'include' })
        .then(r => r.ok ? r.json() : { apps: [], widgets: [] })
        .catch(() => ({ apps: [], widgets: [] })),
    ])
    const rawApps = await appsRes.json()
    const rawWidgets = await widgetsRes.json()
    const offApps = new Set(overrides.apps ?? [])
    const offWidgets = new Set(overrides.widgets ?? [])
    // Cascade: a widget whose data provider (dependsOn) is disabled is also off
    // — e.g. disabling "sysinfo" turns off System Load / Storage / Network / Temps.
    for (const w of rawWidgets) {
      if (w.dependsOn && offWidgets.has(w.dependsOn)) offWidgets.add(w.id)
    }
    disabledWidgetIds.value = offWidgets
    disabledAppIds.value = offApps
    allApps.value = rawApps
    apps.value = rawApps.filter(a => !offApps.has(a.id))
    widgets.value = rawWidgets.filter(w => !offWidgets.has(w.id))
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

export function useRegistry() {
  onMounted(fetchRegistry)
  // Is an app present AND enabled for the current user? `apps` is already
  // filtered by the global/per-user overrides, so this is the single check any
  // cross-app UI should use before surfacing a button/link/menu that points at
  // another app — never assume a sibling app is installed.
  const hasApp = (id) => apps.value.some(a => a.id === id)
  return { apps, allApps, widgets, disabledWidgetIds, disabledAppIds, loading, error, hasApp }
}
