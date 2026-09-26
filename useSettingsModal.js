import { ref } from 'vue'

const open = ref(false)

export function useSettingsModal() {
  return {
    open,
    openSettings: () => { open.value = true },
    closeSettings: () => { open.value = false },
  }
}
