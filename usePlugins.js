import { ref } from 'vue'

export function usePlugins() {
  const plugins = ref([])
  const apiVersion = ref(null)
  const nucleus = ref(null)
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
