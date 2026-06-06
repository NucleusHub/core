import { ref, onMounted } from 'vue'

const apps = ref([])
const widgets = ref([])
const loading = ref(true)
const error = ref(null)

let fetched = false

async function fetchRegistry() {
  if (fetched) return
  fetched = true
  try {
    const [appsRes, widgetsRes] = await Promise.all([
      fetch('/api/registry/apps'),
      fetch('/api/registry/widgets'),
    ])
    apps.value = await appsRes.json()
    widgets.value = await widgetsRes.json()
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

export function useRegistry() {
  onMounted(fetchRegistry)
  return { apps, widgets, loading, error }
}
