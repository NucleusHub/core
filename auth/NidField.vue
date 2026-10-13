<script setup>
import { ref, computed, useId } from 'vue'
import { useI18n } from '../useI18n.js'
import EyeIcon from '@core/assets/icons/eye.svg?component'
import EyeOffIcon from '@core/assets/icons/eye-off.svg?component'

// Label, control and one line of hint or error (an error replaces the hint).
const props = defineProps({
  label: { type: String, required: true },
  type: { type: String, default: 'text' },
  error: { type: String, default: null },
  hint: { type: String, default: null },
  prefix: { type: String, default: null },
  code: { type: Boolean, default: false },
  hideLabel: { type: Boolean, default: false },
})
const model = defineModel({ type: String, default: '' })
defineOptions({ inheritAttrs: false })

const { t } = useI18n()
// Layout attrs (class/style) belong on the field; everything else goes to the input.
const inputAttrs = ({ class: _c, style: _s, ...rest }) => rest
const id = useId()
const input = ref(null)
const revealed = ref(false)
const isPassword = computed(() => props.type === 'password')
const shell = computed(() => isPassword.value || !!props.prefix)
const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type))
const describedBy = computed(() => (props.error || props.hint ? `${id}-note` : undefined))

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div class="nid-field" :class="$attrs.class" :style="$attrs.style">
    <div class="nid-label-row" :class="{ 'nid-sr': hideLabel }">
      <label class="nid-label" :for="id">{{ label }}</label>
      <slot name="aside" />
    </div>
    <div v-if="shell" class="nid-shell" :class="{ 'is-invalid': !!error, 'is-disabled': $attrs.disabled }" @click="input?.focus()">
      <span v-if="prefix" class="nid-shell__prefix">{{ prefix }}</span>
      <input :id="id" ref="input" v-model="model" v-bind="inputAttrs($attrs)" :type="inputType" class="nid-shell__bare"
        :class="{ 'nid-input--code': code }" :aria-invalid="!!error || undefined" :aria-describedby="describedBy" />
      <button v-if="isPassword" type="button" class="nid-reveal" :aria-pressed="revealed"
        :aria-label="revealed ? t('core.nid.hidePassword') : t('core.nid.showPassword')"
        :title="revealed ? t('core.nid.hidePassword') : t('core.nid.showPassword')"
        @click.stop="revealed = !revealed">
        <EyeOffIcon v-if="revealed" width="18" height="18" />
        <EyeIcon v-else width="18" height="18" />
      </button>
    </div>
    <input v-else :id="id" ref="input" v-model="model" v-bind="inputAttrs($attrs)" :type="inputType" class="nid-input"
      :class="{ 'is-invalid': !!error, 'nid-input--code': code }" :aria-invalid="!!error || undefined" :aria-describedby="describedBy" />
    <p v-if="error" :id="`${id}-note`" class="nid-note nid-note--error">{{ error }}</p>
    <p v-else-if="hint" :id="`${id}-note`" class="nid-note">{{ hint }}</p>
  </div>
</template>
