import express, { Router } from 'express'
import mongoose from 'mongoose'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { requireAuth } from './auth.js'
import { requireAppEnabled } from './appAccess.js'

// Mount with app.use(appDataRouter({ appId })); serves /api/v1/{app-data,files,views,apps,commands}.
// Port of nucleus-web's app-data, app-files and cross-app routes onto Mongo (no transactions, so
// writes are conditional updates; quota checks are best-effort under concurrency).

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CONTENT_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(\s*;[\x20-\x7E]*)?$/
const SHA256 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 500
const PAYLOAD_BYTES = 16 * 1024
const MAX_UNSETTLED = 500
const INBOX_LIMIT = 100

// Mirrors auth-server models/AuthSettings.js DEFAULT_LIMITS.
const DEFAULT_LIMITS = {
  dataValueBytes: 262144,
  dataQuotaBytes: 16777216,
  dataMaxKeys: 100,
  fileMaxBytes: 26214400,
  filesQuotaBytes: 262144000,
  filesMaxCount: 5000,
}
const LIMITS_TTL_MS = 5000
const limitsCache = new Map()

const db = () => mongoose.connection.db

async function limitsFor(appId) {
  const hit = limitsCache.get(appId)
  if (hit && Date.now() - hit.at < LIMITS_TTL_MS) return hit.value
  const doc = await db().collection('auth_settings').findOne({ _id: 'auth' }, { projection: { limits: 1, clientLimits: 1 } })
  const value = { ...DEFAULT_LIMITS, ...(doc?.limits || {}), ...(doc?.clientLimits?.[appId] || {}) }
  limitsCache.set(appId, { at: Date.now(), value })
  return value
}

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    if (details) this.details = details
  }
}
const badRequest = (message) => new HttpError(400, 'bad_request', message)
const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message)
const tooLarge = (message) => new HttpError(413, 'too_large', message)
const mismatch = (current) => new HttpError(412, 'version_mismatch', 'The value changed since you read it. Read it again and retry.', { version: current })

const etag = (v) => `"${v}"`
const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
}

// `"3"`, `W/"3"` or `3` gives 3; `*` gives '*'; anything else null.
function version(header) {
  if (!header) return null
  const value = header.trim()
  if (value === '*') return '*'
  const match = value.match(/^(?:W\/)?"?(\d+)"?$/)
  return match ? Number(match[1]) : null
}

function name(value, what) {
  if (typeof value !== 'string' || !KEY.test(value)) {
    throw badRequest(`A ${what} is 1–64 characters of letters, digits, dots, dashes and underscores.`)
  }
  return value
}

function ifMatchOf(req) {
  const ifMatch = version(req.get('if-match'))
  if (req.get('if-match') && (ifMatch === null || ifMatch === '*')) throw badRequest('If-Match takes the version you read, e.g. "3".')
  return ifMatch
}

function bodyValue(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !('value' in req.body)) {
    throw badRequest('Send the value as { "value": … }.')
  }
  return req.body.value
}

const indexed = new Map()
function ensureIndexes(appId) {
  if (!indexed.has(appId)) {
    const run = async () => {
      await db().collection(`${appId}_appdata`).createIndex({ '_id.account': 1 })
      await db().collection(`${appId}_files.files`).createIndex({ 'metadata.account': 1, 'metadata.id': 1 }, { unique: true })
      await db().collection('app_views').createIndex({ account: 1, clientId: 1, name: 1 }, { unique: true })
      await db().collection('app_commands').createIndex({ to: 1, account: 1, settledAt: 1, createdAt: 1 })
      await db().collection('app_commands').createIndex({ settledAt: 1 }, { expireAfterSeconds: 30 * 86400 })
    }
    indexed.set(appId, run().catch((err) => {
      indexed.delete(appId)
      throw err
    }))
  }
  return indexed.get(appId)
}

// Bearer tokens act as their own client; a cookie session is the first-party web app.
const clientOf = (req, appId) => (req.profile.via === 'oauth' ? req.profile.clientId : appId)

// Auth for a route: `scope` is a cross-app scope for foreign tokens, `own` allows any scope of the app's own token.
function gate(appId, { scope = null, own = false, webOk = true } = {}) {
  return [
    requireAuth,
    (req, res, next) => {
      const s = typeof scope === 'function' ? scope(req) : scope
      if (req.profile.via !== 'oauth') {
        if (webOk && !s) return next()
        return res.status(403).json({ error: { code: 'forbidden', message: 'This needs an app access token.' } })
      }
      // appAccess ignores foreign tokens without this scope; own-app tokens of any scope pass via 'profile'.
      req.crossAppScope = s || (own && req.profile.clientId === appId ? 'profile' : undefined)
      next()
    },
    requireAppEnabled(appId),
    noStore,
  ]
}

async function dataUsage(appId, account) {
  const [a] = await db().collection(`${appId}_appdata`).aggregate([
    { $match: { '_id.account': account } },
    { $group: { _id: null, bytes: { $sum: '$size' }, keys: { $sum: 1 } } },
  ]).toArray()
  const [v] = await db().collection('app_views').aggregate([
    { $match: { account, clientId: appId } },
    { $group: { _id: null, bytes: { $sum: '$size' } } },
  ]).toArray()
  return { dataBytes: a?.bytes || 0, keys: a?.keys || 0, viewBytes: v?.bytes || 0 }
}

async function fileUsage(appId, account) {
  const [f] = await db().collection(`${appId}_files.files`).aggregate([
    { $match: { 'metadata.account': account } },
    { $group: { _id: null, bytes: { $sum: '$length' }, count: { $sum: 1 } } },
  ]).toArray()
  return { bytes: f?.bytes || 0, count: f?.count || 0 }
}

const isDup = (err) => err?.code === 11000

export function appDataRouter({ appId }) {
  const router = Router()
  const col = () => db().collection(`${appId}_appdata`)
  const idOf = (account, key) => ({ account, key })
  const ready = (_req, _res, next) => ensureIndexes(appId).then(() => next(), next)
  const bucket = () => new mongoose.mongo.GridFSBucket(db(), { bucketName: `${appId}_files` })
  const filesCol = () => db().collection(`${appId}_files.files`)

  router.use(ready)

  // ── App data ──────────────────────────────────────────────────────────────

  const data = Router()
  data.use(gate(appId))

  data.get('/', async (req, res) => {
    const account = req.profile.profileId
    const [rows, usage, files, limits] = await Promise.all([
      col().find({ '_id.account': account }, { projection: { value: 0 } }).sort({ '_id.key': 1 }).toArray(),
      dataUsage(appId, account),
      fileUsage(appId, account),
      limitsFor(appId),
    ])
    res.json({
      keys: rows.map((r) => ({ key: r._id.key, size: r.size, version: r.version, updatedAt: r.updatedAt })),
      usage: {
        bytes: usage.dataBytes + usage.viewBytes,
        quotaBytes: limits.dataQuotaBytes,
        keys: usage.keys,
        maxKeys: limits.dataMaxKeys,
        files: { bytes: files.bytes, quotaBytes: limits.filesQuotaBytes, count: files.count },
      },
    })
  })

  data.get('/:key', async (req, res) => {
    const key = name(req.params.key, 'key')
    const row = await col().findOne({ _id: idOf(req.profile.profileId, key) })
    if (!row) throw notFound('Nothing stored under that key.')
    res.set('ETag', etag(row.version))
    if (version(req.get('if-none-match')) === row.version) return res.status(304).end()
    res.json({ key, value: row.value, size: row.size, version: row.version, updatedAt: row.updatedAt })
  })

  data.put('/:key', async (req, res, next) => {
    const limits = await limitsFor(appId)
    express.json({ limit: limits.dataValueBytes + 1024 })(req, res, next)
  }, async (req, res) => {
    const key = name(req.params.key, 'key')
    const value = bodyValue(req)
    const ifMatch = ifMatchOf(req)
    const createOnly = version(req.get('if-none-match')) === '*'
    const account = req.profile.profileId
    const _id = idOf(account, key)

    const json = JSON.stringify(value)
    const size = Buffer.byteLength(json, 'utf8')
    const limits = await limitsFor(appId)
    if (size > limits.dataValueBytes) throw tooLarge(`A value can be up to ${limits.dataValueBytes} bytes; this one is ${size}.`)

    const current = await col().findOne({ _id }, { projection: { version: 1, size: 1 } })
    if (createOnly && current) throw mismatch(current.version)
    if (ifMatch != null && current?.version !== ifMatch) throw mismatch(current?.version ?? null)

    const usage = await dataUsage(appId, account)
    if (!current && usage.keys >= limits.dataMaxKeys) throw tooLarge(`An app can keep up to ${limits.dataMaxKeys} keys per account. Delete one first.`)
    if (usage.dataBytes - (current?.size || 0) + usage.viewBytes + size > limits.dataQuotaBytes) {
      throw tooLarge(`This would take the app past its ${limits.dataQuotaBytes} bytes in this account.`)
    }

    const updatedAt = new Date()
    const set = { $set: { value, size, updatedAt }, $inc: { version: 1 } }
    let created = false
    let row
    try {
      if (createOnly || (!current && ifMatch == null)) {
        // Insert path: a racing creator loses with a duplicate key instead of overwriting.
        if (createOnly) {
          row = { _id, value, size, version: 1, updatedAt }
          await col().insertOne(row)
        } else {
          const r = await col().findOneAndUpdate({ _id }, set, { upsert: true, returnDocument: 'after', includeResultMetadata: true })
          row = r.value
          created = !r.lastErrorObject?.updatedExisting
        }
        created = created || createOnly
      } else {
        row = await col().findOneAndUpdate(ifMatch != null ? { _id, version: ifMatch } : { _id }, set, { returnDocument: 'after' })
        if (!row) {
          const now = await col().findOne({ _id }, { projection: { version: 1 } })
          throw mismatch(now?.version ?? null)
        }
      }
    } catch (err) {
      if (!isDup(err)) throw err
      const now = await col().findOne({ _id }, { projection: { version: 1 } })
      throw mismatch(now?.version ?? null)
    }
    res.set('ETag', etag(row.version))
    res.status(created ? 201 : 200).json({ key, size, version: row.version, updatedAt })
  })

  data.delete('/:key', async (req, res) => {
    const key = name(req.params.key, 'key')
    const ifMatch = version(req.get('if-match'))
    const _id = idOf(req.profile.profileId, key)
    const filter = typeof ifMatch === 'number' ? { _id, version: ifMatch } : { _id }
    const { deletedCount } = await col().deleteOne(filter)
    if (deletedCount) return res.status(204).end()
    const current = await col().findOne({ _id }, { projection: { version: 1 } })
    if (current) throw mismatch(current.version)
    throw notFound('Nothing stored under that key.')
  })

  router.use('/app-data', data)

  // ── Files ─────────────────────────────────────────────────────────────────

  const files = Router()
  files.use(gate(appId))

  const shapeFile = (f) => ({
    id: f.metadata.id,
    name: f.metadata.name,
    contentType: f.metadata.contentType,
    size: f.length,
    sha256: f.metadata.sha256,
    createdAt: f.uploadDate,
  })

  function fileName(header) {
    if (!header) return ''
    let n
    try {
      n = decodeURIComponent(header)
    } catch {
      throw badRequest('X-File-Name is URL-encoded, e.g. Trip%20photo.jpg.')
    }
    n = n.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    if (n.length > 255) throw badRequest('A file name is up to 255 characters.')
    return n
  }

  function notModified(header, sha256) {
    if (!header) return false
    return header.split(',').some((tag) => {
      const v = tag.trim()
      return v === '*' || v.replace(/^W\//, '') === etag(sha256)
    })
  }

  function fileHeaders(res, f) {
    res.set({
      'Content-Type': f.metadata.contentType,
      'Content-Length': String(f.length),
      ETag: etag(f.metadata.sha256),
      'X-Content-SHA256': f.metadata.sha256,
      'X-File-Name': encodeURIComponent(f.metadata.name),
      'Last-Modified': new Date(f.uploadDate).toUTCString(),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'attachment',
    })
  }

  const findFile = (account, id) => filesCol().findOne({ 'metadata.account': account, 'metadata.id': id })

  files.get('/', async (req, res) => {
    const account = req.profile.profileId
    const cursor = req.query.cursor == null || req.query.cursor === '' ? null : name(req.query.cursor, 'file id')
    const filter = { 'metadata.account': account, ...(cursor ? { 'metadata.id': { $gt: cursor } } : {}) }
    const [rows, usage, limits] = await Promise.all([
      filesCol().find(filter).sort({ 'metadata.id': 1 }).limit(PAGE + 1).toArray(),
      fileUsage(appId, account),
      limitsFor(appId),
    ])
    const page = rows.slice(0, PAGE)
    res.json({
      files: page.map(shapeFile),
      nextCursor: rows.length > PAGE ? page[page.length - 1].metadata.id : null,
      usage: { bytes: usage.bytes, quotaBytes: limits.filesQuotaBytes, files: usage.count, maxFiles: limits.filesMaxCount },
    })
  })

  files.head('/:id', async (req, res) => {
    const f = await findFile(req.profile.profileId, name(req.params.id, 'file id'))
    if (!f) throw notFound('No file with that id.')
    fileHeaders(res, f)
    res.status(notModified(req.get('if-none-match'), f.metadata.sha256) ? 304 : 200).end()
  })

  files.get('/:id', async (req, res, next) => {
    const f = await findFile(req.profile.profileId, name(req.params.id, 'file id'))
    if (!f) throw notFound('No file with that id.')
    fileHeaders(res, f)
    if (notModified(req.get('if-none-match'), f.metadata.sha256)) {
      res.removeHeader('Content-Length')
      return res.status(304).end()
    }
    bucket().openDownloadStream(f._id).on('error', next).pipe(res)
  })

  files.put('/:id', async (req, res, next) => {
    const limits = await limitsFor(appId)
    express.raw({ type: () => true, limit: limits.fileMaxBytes })(req, res, next)
  }, async (req, res) => {
    const id = name(req.params.id, 'file id')
    const account = req.profile.profileId
    const contentType = (req.get('content-type') ?? '').trim()
    if (!contentType) throw badRequest('Send the file with its Content-Type.')
    if (contentType.length > 255 || !CONTENT_TYPE.test(contentType)) throw badRequest('Content-Type is a media type, e.g. image/jpeg.')
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest("Send the file's bytes as the body.")

    const sha256 = createHash('sha256').update(req.body).digest('hex')
    const claimed = req.get('x-content-sha256')
    if (claimed != null) {
      const expected = claimed.trim().toLowerCase()
      if (!SHA256.test(expected)) throw badRequest('X-Content-SHA256 is a hex SHA-256 digest.')
      if (expected !== sha256) throw new HttpError(400, 'checksum_mismatch', 'The body does not match X-Content-SHA256. Upload it again.', { sha256 })
    }

    const settle = (existing) => {
      if (existing.metadata.sha256 !== sha256) {
        throw new HttpError(409, 'file_exists', 'A different file already has this id. Files cannot be replaced.', { sha256: existing.metadata.sha256 })
      }
      res.set('ETag', etag(sha256))
      res.status(200).json(shapeFile(existing))
    }

    const existing = await findFile(account, id)
    if (existing) return settle(existing)

    const limits = await limitsFor(appId)
    const usage = await fileUsage(appId, account)
    if (usage.count >= limits.filesMaxCount) throw tooLarge(`An app can keep up to ${limits.filesMaxCount} files per account. Delete one first.`)
    if (usage.bytes + req.body.length > limits.filesQuotaBytes) {
      throw tooLarge(`This would take the app past its ${limits.filesQuotaBytes} bytes of files in this account.`)
    }

    const meta = { account, id, name: fileName(req.get('x-file-name')), contentType, sha256 }
    const upload = bucket().openUploadStream(`${account}/${id}`, { metadata: meta })
    try {
      await new Promise((resolve, reject) => {
        upload.on('error', reject).on('finish', resolve)
        Readable.from([req.body]).pipe(upload)
      })
    } catch (err) {
      await db().collection(`${appId}_files.chunks`).deleteMany({ files_id: upload.id }).catch(() => {})
      if (!isDup(err)) throw err
      return settle(await findFile(account, id))
    }
    const stored = await filesCol().findOne({ _id: upload.id })
    res.set('ETag', etag(sha256))
    res.status(201).json(shapeFile(stored))
  })

  files.delete('/:id', async (req, res) => {
    const f = await findFile(req.profile.profileId, name(req.params.id, 'file id'))
    if (!f) throw notFound('No file with that id.')
    await bucket().delete(f._id)
    res.status(204).end()
  })

  router.use('/files', files)

  // ── Views, published by this app ─────────────────────────────────────────

  const views = () => db().collection('app_views')
  const viewsRouter = Router()
  viewsRouter.use(gate(appId))

  viewsRouter.put('/:name', async (req, res, next) => {
    const limits = await limitsFor(appId)
    express.json({ limit: limits.dataValueBytes + 1024 })(req, res, next)
  }, async (req, res) => {
    const view = name(req.params.name, 'view name')
    const value = bodyValue(req)
    const ifMatch = ifMatchOf(req)
    const account = req.profile.profileId
    const clientId = clientOf(req, appId)
    const key = { account, clientId, name: view }

    const json = JSON.stringify(value)
    const size = Buffer.byteLength(json, 'utf8')
    const limits = await limitsFor(appId)
    if (size > limits.dataValueBytes) throw tooLarge(`A view can be up to ${limits.dataValueBytes} bytes; this one is ${size}.`)

    const current = await views().findOne(key, { projection: { version: 1, size: 1 } })
    if (ifMatch != null && current?.version !== ifMatch) throw mismatch(current?.version ?? null)
    const usage = await dataUsage(appId, account)
    if (usage.dataBytes + usage.viewBytes - (current?.size || 0) + size > limits.dataQuotaBytes) {
      throw tooLarge(`This would take the app past its ${limits.dataQuotaBytes} bytes in this account.`)
    }

    const updatedAt = new Date()
    let row
    let created = false
    try {
      if (ifMatch != null) {
        row = await views().findOneAndUpdate({ ...key, version: ifMatch }, { $set: { value, size, updatedAt }, $inc: { version: 1 } }, { returnDocument: 'after' })
        if (!row) throw mismatch((await views().findOne(key, { projection: { version: 1 } }))?.version ?? null)
      } else {
        const r = await views().findOneAndUpdate(key, { $set: { value, size, updatedAt }, $inc: { version: 1 } }, { upsert: true, returnDocument: 'after', includeResultMetadata: true })
        row = r.value
        created = !r.lastErrorObject?.updatedExisting
      }
    } catch (err) {
      if (!isDup(err)) throw err
      throw mismatch((await views().findOne(key, { projection: { version: 1 } }))?.version ?? null)
    }
    res.set('ETag', etag(row.version))
    res.status(created ? 201 : 200).json({ name: view, size, version: row.version, updatedAt })
  })

  viewsRouter.delete('/:name', async (req, res) => {
    const { deletedCount } = await views().deleteOne({
      account: req.profile.profileId, clientId: clientOf(req, appId), name: name(req.params.name, 'view name'),
    })
    if (!deletedCount) throw notFound('No view by that name.')
    res.status(204).end()
  })

  router.use('/views', viewsRouter)

  // ── Another app reading this app's views / sending it commands ───────────

  const exposes = async (item) => !!(await db().collection('oauth_clients').findOne({ _id: appId, revokedAt: null, exposes: item }, { projection: { _id: 1 } }))
  const apps = Router()
  apps.use(express.json({ limit: '64kb' }))

  apps.get('/:clientId/views/:name', ...gate(appId, { scope: (req) => `read:${req.params.clientId}/${req.params.name}`, webOk: false }), async (req, res) => {
    if (req.params.clientId !== appId) throw notFound('That app has not published this view.')
    const view = name(req.params.name, 'view name')
    const row = await views().findOne({ account: req.profile.profileId, clientId: appId, name: view })
    if (!row || !(await exposes(`view:${view}`))) throw notFound('That app has not published this view.')
    res.set('ETag', etag(row.version))
    if (version(req.get('if-none-match')) === row.version) return res.status(304).end()
    res.json({ app: appId, name: view, value: row.value, version: row.version, updatedAt: row.updatedAt })
  })

  apps.post('/:clientId/commands', ...gate(appId, {
    scope: (req) => `send:${req.params.clientId}/${typeof req.body?.type === 'string' ? req.body.type : ''}`,
    webOk: false,
  }), async (req, res) => {
    if (req.params.clientId !== appId) throw notFound('No such app.')
    const type = name(req.body?.type, 'command type')
    const account = req.profile.profileId
    const payload = req.body.payload ?? null
    const size = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    if (size > PAYLOAD_BYTES) throw tooLarge(`A payload can be up to ${PAYLOAD_BYTES} bytes; this one is ${size}.`)
    if (!(await exposes(`command:${type}`))) throw notFound(`That app does not take "${type}" commands.`)

    const from = req.profile.clientId
    const open = await db().collection('app_commands').countDocuments({ from, to: appId, account, settledAt: null })
    if (open >= MAX_UNSETTLED) {
      throw new HttpError(429, 'too_many_commands', `Up to ${MAX_UNSETTLED} commands may wait for that app at once. Let it catch up first.`)
    }
    const doc = {
      _id: randomUUID(), account, from, to: appId, type, payload, status: 'pending',
      result: null, createdAt: new Date(), deliveredAt: null, settledAt: null,
    }
    await db().collection('app_commands').insertOne(doc)
    res.status(201).json(shapeCommand(doc))
  })

  router.use('/apps', apps)

  // ── Commands, from either end ────────────────────────────────────────────

  const commands = Router()
  const cmds = () => db().collection('app_commands')
  const gone = () => notFound('No such command.')

  commands.get('/inbox', ...gate(appId), async (req, res) => {
    const account = req.profile.profileId
    const rows = await cmds().find({ to: appId, account, settledAt: null }).sort({ createdAt: 1, _id: 1 }).limit(INBOX_LIMIT).toArray()
    const pending = rows.filter((r) => r.status === 'pending')
    if (pending.length) {
      const deliveredAt = new Date()
      await cmds().updateMany({ _id: { $in: pending.map((r) => r._id) }, status: 'pending' }, { $set: { status: 'delivered', deliveredAt } })
      for (const r of pending) Object.assign(r, { status: 'delivered', deliveredAt })
    }
    res.json({ commands: rows.map(shapeCommand) })
  })

  commands.post('/:id/settle', express.json({ limit: '64kb' }), ...gate(appId), async (req, res) => {
    const status = req.body?.status
    if (status !== 'applied' && status !== 'rejected') throw badRequest('status is "applied" or "rejected".')
    if (!UUID.test(req.params.id)) throw gone()
    const result = req.body.result === undefined ? null : req.body.result
    if (result !== null && Buffer.byteLength(JSON.stringify(result), 'utf8') > PAYLOAD_BYTES) {
      throw tooLarge(`A result can be up to ${PAYLOAD_BYTES} bytes.`)
    }
    const now = new Date()
    const filter = { _id: req.params.id, to: appId, account: req.profile.profileId }
    const row = await cmds().findOneAndUpdate(
      { ...filter, settledAt: null },
      [{ $set: { status, result, settledAt: now, deliveredAt: { $ifNull: ['$deliveredAt', now] } } }],
      { returnDocument: 'after' },
    )
    if (row) return res.json(shapeCommand(row))
    const existing = await cmds().findOne(filter)
    if (!existing) throw gone()
    throw new HttpError(409, 'already_settled', `The command is already ${existing.status}.`, { status: existing.status })
  })

  commands.get('/sent/:id', ...gate(appId, { own: true }), async (req, res) => {
    const row = UUID.test(req.params.id) && await cmds().findOne({ _id: req.params.id, from: clientOf(req, appId), account: req.profile.profileId })
    if (!row) throw gone()
    res.json(shapeCommand(row))
  })

  commands.delete('/sent/:id', ...gate(appId, { own: true }), async (req, res) => {
    if (!UUID.test(req.params.id)) throw gone()
    const filter = { _id: req.params.id, from: clientOf(req, appId), account: req.profile.profileId }
    const row = await cmds().findOneAndUpdate({ ...filter, status: 'pending' }, { $set: { status: 'cancelled', settledAt: new Date() } })
    if (row) return res.status(204).end()
    const existing = await cmds().findOne(filter)
    if (!existing) throw gone()
    throw new HttpError(409, 'not_pending', `The command is already ${existing.status}; it can no longer be cancelled.`, { status: existing.status })
  })

  router.use('/commands', commands)

  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } })
    }
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'The body is too large.' } })
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_request', message: 'The body is not valid JSON.' } })
    console.error(`[appData:${appId}]`, err)
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong.' } })
  })

  // Mounted at the API root: /app-data, /files, /views, /apps, /commands.
  const root = Router()
  root.use('/api/v1', router)
  return root
}

function shapeCommand(row) {
  return {
    id: row._id, from: row.from, to: row.to, type: row.type, payload: row.payload, status: row.status,
    result: row.result, createdAt: row.createdAt, deliveredAt: row.deliveredAt, settledAt: row.settledAt,
  }
}
