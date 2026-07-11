import { ref } from 'vue'

// Client accessor for the plugin registry, served by the plugin-runtime service
// via nginx at /api/plugins. Discovery + metadata only — there is nothing to
// enable, disable or execute yet, so this is intentionally lighter than
// useRegistry (no override/cascade logic).
//
// Unlike useRegistry (a module-level singleton shared app-wide), this returns a
// fresh state per call and exposes `load()` so a view can refresh on demand.
export function usePlugins() {
  const plugins = ref([])
  const apiVersion = ref(null)   // plugin API version the runtime implements
  const nucleus = ref(null)      // platform version
  const loading = ref(true)
  const error = ref(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/plugins')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      plugins.value = Array.isArray(data.plugins) ? data.plugins : []
      apiVersion.value = data.apiVersion ?? null
      nucleus.value = data.nucleus ?? null
    } catch (e) {
      error.value = e.message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  return { plugins, apiVersion, nucleus, loading, error, load }
}
