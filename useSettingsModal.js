import { ref } from 'vue'

// Shared open/close state for an app's Settings modal (module-level ref = the
// app-wide "store"), so any component — a header gear, an empty-state CTA —
// can open it without threading props/events. Each app client gets its own
// singleton because the module is bundled per app.
const open = ref(false)

export function useSettingsModal() {
  return {
    open,
    openSettings: () => { open.value = true },
    closeSettings: () => { open.value = false },
  }
}
