// Server codes → translated messages; unknown codes fall back to the server's English text.
const CODES = {
  invalid_credentials: 'core.nid.err.invalidCredentials',
  email_unverified: 'core.nid.err.emailUnverified',
  rate_limited: 'core.nid.err.rateLimited',
  signup_closed: 'core.nid.err.signupClosed',
  handle_taken: 'core.nid.err.handleTaken',
  email_taken: 'core.nid.err.emailTaken',
  mail_failed: 'core.nid.err.mailFailed',
  token_invalid: 'core.nid.err.tokenInvalid',
  server_code_required: 'core.nid.err.serverCodeRequired',
  wrong_pin: 'core.nid.err.wrongPin',
  pin_required: 'core.nid.err.pinRequired',
  wrong_password: 'core.nid.err.wrongPassword',
  confirm_required: 'core.nid.err.confirmRequired',
  no_password: 'core.nid.err.noPassword',
  nid_required: 'core.nid.err.nidRequired',
  nid_only: 'core.nid.err.nidRequired',
  last_credential: 'core.nid.err.lastCredential',
  last_admin: 'core.nid.err.lastAdmin',
  account_exists: 'core.nid.err.accountExists',
  guest_profile: 'core.nid.err.guestProfile',
  no_account: 'core.nid.err.noAccount',
  not_linked: 'core.nid.err.notLinked',
  invalid: 'core.nid.err.invalid',
}

// Server field messages are English; these replace them per field (the code wins for conflicts).
const FIELD_BY_CODE = {
  handle_taken: 'core.nid.err.handleTaken',
  email_taken: 'core.nid.err.emailTaken',
  wrong_password: 'core.nid.err.wrongPassword',
  confirm_required: 'core.nid.err.confirmRequired',
}
const FIELD_KEYS = {
  displayName: 'core.nid.field.displayNameInvalid',
  handle: 'core.nid.field.handleInvalid',
  email: 'core.nid.field.emailInvalid',
  password: 'core.nid.field.passwordShort',
  newPassword: 'core.nid.field.passwordShort',
  currentPassword: 'core.nid.err.wrongPassword',
  confirm: 'core.nid.err.confirmRequired',
  token: 'core.nid.err.tokenInvalid',
  pin: 'core.nid.field.pinRequired',
}

export const SSO_ERRORS = [
  'cancelled', 'provider_error', 'state_mismatch', 'provider_disabled', 'server_code_required',
  'identity_taken', 'provider_taken', 'email_taken', 'handle_unavailable', 'email_unverified',
  'signup_closed', 'session_changed', 'signed_out', 'nid_required', 'no_account', 'rate_limited',
]

export function nidError(t, err) {
  if (!err) return null
  if (CODES[err.code]) return t(CODES[err.code])
  if (err.status === 429) return t('core.nid.err.rateLimited')
  if (err instanceof TypeError) return t('core.nid.err.offline')
  return err.message || t('core.nid.err.generic')
}

export function fieldErrors(t, err) {
  const out = {}
  for (const name of Object.keys(err?.fields || {})) {
    const key = FIELD_BY_CODE[err.code] || FIELD_KEYS[name] || 'core.nid.err.invalid'
    out[name] = t(key, { min: MIN_PASSWORD })
  }
  return out
}

export function ssoError(t, code) {
  const key = String(code || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  return SSO_ERRORS.includes(code) ? t(`core.nid.sso.err.${key}`) : t('core.nid.sso.err.generic')
}

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}$/
export const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/
export const MIN_PASSWORD = 10

// Web Animations, not a class: swapping the animation property would replay the card's entrance.
export function shake(el) {
  if (!el?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  el.animate([0, -7, 7, -4, 4, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration: 350, easing: 'ease' })
}
