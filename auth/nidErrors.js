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

export function ssoError(t, code) {
  const key = String(code || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  return SSO_ERRORS.includes(code) ? t(`core.nid.sso.err.${key}`) : t('core.nid.sso.err.generic')
}

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}$/
export const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/
export const MIN_PASSWORD = 10
