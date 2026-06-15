// The renderer component map — the single resolution point for the deterministic
// rendering pipeline. Apps DO NOT mount their own components into Echo; their
// manifest only declares a renderer *name* (e.g. "OrbitFileCard"), and that name
// is looked up here. Every component Echo can render must live in /core and be
// registered in this map, which keeps the UI entirely under core's control.
//
// Built-ins (text/system) plus the components contributed-by-name from app
// manifests. To support a new app renderer, add its component to /core/echo and
// register it here; the app side only references it by string.
import TextMessage from './TextMessage.vue'
import SystemMessage from './SystemMessage.vue'
import UnknownMessage from './UnknownMessage.vue'
import OrbitFileCard from './OrbitFileCard.vue'
import GoalUpdateCard from './GoalUpdateCard.vue'
import WatchlistCard from './WatchlistCard.vue'

export const RENDERERS = {
  // built-in
  TextMessage,
  SystemMessage,
  // app-contributed (referenced by name from manifest.echo.json)
  OrbitFileCard,
  GoalUpdateCard,
  WatchlistCard,
}

// Built-in type -> renderer name. App types are resolved from the registry's
// renderer mapping instead (see resolveRenderer).
const BUILTIN_BY_TYPE = {
  text: 'TextMessage',
  system: 'SystemMessage',
}

// Resolve the Vue component for a message, given the unified registry snapshot.
// Resolution order:
//   1. built-in type (text/system)
//   2. app-declared renderer name from the registry's messageTypes map
//   3. fall back to UnknownMessage (never throws — deterministic)
export function resolveRenderer(type, registry) {
  const builtin = BUILTIN_BY_TYPE[type]
  if (builtin) return RENDERERS[builtin]

  const name = registry?.messageTypes?.[type]?.renderer
  if (name && RENDERERS[name]) return RENDERERS[name]

  return UnknownMessage
}
