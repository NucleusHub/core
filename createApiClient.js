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
