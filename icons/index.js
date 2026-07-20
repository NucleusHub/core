// Shared icon system for Nucleus. Import the renderer + registry from here:
//   import { Icon, Spinner, ICONS } from '@core/icons'
//   <Icon name="close" class="w-5 h-5" />
//
// See icons.js for the registry (and how to add a glyph) and Icon.vue for the
// rendering contract (currentColor, class-driven sizing, :fill / :sw props).
export { default as Icon } from './Icon.vue'
export { default as Spinner } from './Spinner.vue'
export { ICONS, FILL_ICONS } from './icons.js'
