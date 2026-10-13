// Calls to /api/v1/auth/qr; errors carry the v1 `{ error: { code, message } }` fields.
export async function qrCall(method, path, body) {
  const res = await fetch(`/api/v1/auth/qr${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = res.status === 204 ? null : await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`)
    err.status = res.status
    err.code = data?.error?.code
    throw err
  }
  return data
}
