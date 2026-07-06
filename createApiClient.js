// Shared REST helper for Nucleus app clients. Every app was hand-rolling the
// same fetch + JSON + error-shaping boilerplate; this centralises it so an app's
// api module is just a thin map of endpoints:
//
//   import { createApiClient } from '@core/createApiClient.js'
//   const api = createApiClient('/api/echo')
//   api.get('/chats'); api.post('/chats', payload); api.del(`/chats/${id}`)
//
// Behaviour: always sends the session cookie (credentials: 'include'); JSON-
// encodes a body when given; throws Error(data.error || `HTTP <status>`) on a
// non-2xx, carrying `.status` and `.code` so callers can special-case (e.g. the
// 403 `APP_DISABLED` a disabled app's server returns). 204 → null; non-JSON
// responses come back as text.
export function createApiClient(base = '') {
  async function req(method, path, body, { headers } = {}) {
    const init = { method, credentials: 'include', headers: { ...(headers || {}) } }
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const res = await fetch(`${base}${path}`, init)
    if (!res.ok) {
      let data = {}
      try { data = await res.json() } catch { /* non-JSON error body */ }
      const err = new Error(data.error || `HTTP ${res.status}`)
      err.status = res.status
      err.code = data.code
      throw err
    }
    if (res.status === 204) return null
    const type = res.headers.get('content-type') || ''
    return type.includes('application/json') ? res.json() : res.text()
  }

  return {
    req,
    get: (path, opts) => req('GET', path, undefined, opts),
    post: (path, body, opts) => req('POST', path, body, opts),
    put: (path, body, opts) => req('PUT', path, body, opts),
    patch: (path, body, opts) => req('PATCH', path, body, opts),
    del: (path, opts) => req('DELETE', path, undefined, opts),
  }
}
