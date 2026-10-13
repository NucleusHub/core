const RESEND_URL = 'https://api.resend.com/emails'

async function resend({ key, message }) {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

let transport = resend

// Tests swap the HTTP call out; null restores Resend.
export function setTransport(fn) {
  transport = fn || resend
}

export const mailEnabled = (settings) => !!(settings?.mail?.resendKey && settings?.mail?.from && settings?.publicOrigin)

const link = (settings, kind, token) => `${settings.publicOrigin}/?${kind}=${encodeURIComponent(token)}`

const escape = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

async function send(settings, { to, subject, lines, action }) {
  const text = [...lines, '', `${action.label}: ${action.url}`, '', '— Nucleus'].join('\n')
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1523">
${lines.map((line) => `<p>${escape(line)}</p>`).join('\n')}
<p><a href="${escape(action.url)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#a855f7;color:#fff;text-decoration:none">${escape(action.label)}</a></p>
<p style="color:#6b6478;font-size:13px">Or paste this into your browser:<br>${escape(action.url)}</p>
</body></html>`
  await transport({ key: settings.mail.resendKey, message: { from: settings.mail.from, to, subject, text, html } })
}

// No name in the greeting: it is whatever the sign-up form said, not necessarily the inbox owner.
export function sendVerification(settings, { to, token }) {
  return send(settings, {
    to,
    subject: 'Confirm your Nucleus account',
    lines: [
      'Hi,',
      'Confirm this address for your NucleusID. You will be asked for your password. The link works once and expires in 24 hours.',
      'If you did not sign up, ignore this email.',
    ],
    action: { label: 'Confirm my email', url: link(settings, 'verify', token) },
  })
}

export function sendPasswordReset(settings, { to, token }) {
  return send(settings, {
    to,
    subject: 'Reset your Nucleus password',
    lines: [
      'Hi,',
      'Someone, hopefully you, asked to set a new password for your NucleusID. The link works once and expires in an hour.',
      'If it was not you, ignore this email. Your password has not changed.',
    ],
    action: { label: 'Choose a new password', url: link(settings, 'reset', token) },
  })
}
