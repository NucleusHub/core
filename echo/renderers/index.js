// Built-in, app-agnostic renderers — the only message renderers Echo core owns.
// App message types (orbit.file, goal.update, …) are rendered by components the
// apps themselves ship, auto-discovered host-side and passed in as `appRenderers`
// (see apps/echo/client/src/echo-integrations.js). Core names no app.
import TextMessage from './TextMessage.vue'
import SystemMessage from './SystemMessage.vue'
import UnknownMessage from './UnknownMessage.vue'

const BUILTINS = {
  text: TextMessage,
  system: SystemMessage,
}

// Resolve the Vue component for a message type. Resolution order:
//   1. built-in type (text/system)
//   2. app-contributed renderer (type -> component, from the integrations map)
//   3. UnknownMessage fallback (never throws — deterministic)
export function resolveRenderer(type, appRenderers = {}) {
  return BUILTINS[type] || appRenderers[type] || UnknownMessage
}
