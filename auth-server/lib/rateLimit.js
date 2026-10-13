// In-memory fixed window; one instance per mounted router so each createApp() starts fresh.
export function rateLimiter({ max, windowMs, key = (req) => req.ip || 'unknown', onLimit }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    for (const [k, e] of hits) if (now > e.resetAt) hits.delete(k)
    const k = key(req)
    let entry = hits.get(k)
    if (!entry) entry = { count: 0, resetAt: now + windowMs }
    entry.count++
    hits.set(k, entry)
    if (entry.count > max) return onLimit(res)
    next()
  }
}
