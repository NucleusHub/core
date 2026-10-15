import { ref, computed } from 'vue'
import { startAppearance } from './useAppearance.js'

const THEME_KEY = 'nucleus-theme'

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

function setCookie(name, value) {
  document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; SameSite=Lax'
}

const sysDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
const theme = ref(getCookie(THEME_KEY) || 'system')

const isDark = computed(() =>
  theme.value === 'dark' || (theme.value === 'system' && sysDark.value)
)

function applyDarkClass() {
  document.documentElement.classList.toggle('dark', isDark.value)
}

applyDarkClass()

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  sysDark.value = e.matches
  if (theme.value === 'system') applyDarkClass()
})

function setTheme(val) {
  theme.value = val
  setCookie(THEME_KEY, val)
  applyDarkClass()
}

function setDefaultTheme(val) {
  if (getCookie(THEME_KEY) || theme.value === val) return
  theme.value = val
  applyDarkClass()
}

startAppearance({ theme: { fallback: setDefaultTheme, reset: setTheme } })

export function useTheme() {
  return { theme, isDark, setTheme }
}
