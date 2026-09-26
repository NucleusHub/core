import TextMessage from './TextMessage.vue'
import SystemMessage from './SystemMessage.vue'
import UnknownMessage from './UnknownMessage.vue'

const BUILTINS = {
  text: TextMessage,
  system: SystemMessage,
}

export function resolveRenderer(type, appRenderers = {}) {
  return BUILTINS[type] || appRenderers[type] || UnknownMessage
}
