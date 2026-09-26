import { ref, onMounted } from 'vue'

const apps = ref([])
const allApps = ref([])
const widgets = ref([])
const disabledWidgetIds = ref(new Set())
const disabledAppIds = ref(new Set())
const disabledPluginIds = ref(new Set())
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
      fetch('/api/auth/effective-overrides', { credentials: 'include' })
        .then(r => r.ok ? r.json() : { apps: [], widgets: [], plugins: [] })
        .catch(() => ({ apps: [], widgets: [], plugins: [] })),
    ])
    const rawApps = await appsRes.json()
    const rawWidgets = await widgetsRes.json()
    const offApps = new Set(overrides.apps ?? [])
    const offWidgets = new Set(overrides.widgets ?? [])
    disabledPluginIds.value = new Set(overrides.plugins ?? [])
    // Cascade: a widget whose dependsOn provider is disabled is also off.
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

async function refresh() {
  fetched = false
  await fetchRegistry()
}

export function useRegistry() {
  onMounted(fetchRegistry)
  const hasApp = (id) => apps.value.some(a => a.id === id)
  const isPluginEnabled = (id) => !disabledPluginIds.value.has(id)
  return { apps, allApps, widgets, disabledWidgetIds, disabledAppIds, disabledPluginIds, loading, error, hasApp, isPluginEnabled, refresh }
}
