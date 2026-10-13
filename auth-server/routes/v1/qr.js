import { Router } from 'express'
import Profile from '../../models/Profile.js'
import { getSettings } from '../../models/AuthSettings.js'
import { createLogin, findLogin, transition } from '../../models/QrLogin.js'
import { optionalAuth, requireAccessToken, requireAuth } from '../../middleware/auth.js'
import { serverCodeGate } from '../../middleware/serverCode.js'
import { cookiePassed, grantServerAccess, hasServerAccess } from '../../lib/serverCode.js'
import { issueSession } from '../../lib/session.js'
import { approve, findClient, findAccessToken } from '../../lib/oauth.js'
import { rateLimiter } from '../../lib/rateLimit.js'
import {
  ID, QrError, appPayload, claim, cleanDevice, decide, describeBrowser, gone, hashSecret, newSecret,
  pickup, scan, watch, webPayload,
} from '../../lib/qr.js'
import { V1Error, checkRequest, requestOrigin } from './oauth.js'

// Port of nucleus-web routes/qr-login.js (rules in lib/qr.js):
//   POST /web (201 {id,secret,expiresAt,qr}), POST /app (session), GET /:id (session),
//   POST /:id/scan (Bearer), /claim, /approve (Bearer or session), /poll ({secret}).

const body = (res, status, code, message) => res.status(status).json({ error: { code, message } })

const h = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (err) {
    if (err instanceof QrError) return body(res, err.status, err.code, err.message)
    if (err instanceof V1Error) return body(res, err.status, err.code, err.message)
    if (err?.status && err?.code) return body(res, err.status, err.code, err.message)
    console.error('[qr]', err)
    body(res, 500, 'server_error', 'Something went wrong.')
  }
}

const limit = (name, max) => rateLimiter({
  max, windowMs: 60_000, key: (req) => `${name}|${req.ip}`,
  onLimit: (res) => body(res, 429, 'rate_limited', 'Too many requests. Give it a minute.'),
})

// Signed-in website, NucleusID accounts only.
const nidOnly = (req, res, next) => {
  if (req.profile.via !== 'nid') return body(res, 403, 'nid_required', 'Sign in with NucleusID to use this.')
  next()
}

async function payloadOrigin(req) {
  const origin = (await getSettings()).publicOrigin || requestOrigin(req)
  if (!origin) throw new V1Error(400, 'bad_host', 'The Host header is not a host name.')
  return origin
}

export function qrRouter() {
  const router = Router()
  const create = limit('create', 20)
  const general = limit('qr', 60)
  const polling = limit('poll', 120)
  const watching = limit('watch', 120)

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.param('id', (_req, res, next, id) => (ID.test(id) ? next() : body(res, 404, 'not_found', gone().message)))

  router.post('/web', serverCodeGate, create, h(async (req, res) => {
    const { row, secret } = await createLogin({ kind: 'web', device: describeBrowser(req.get('user-agent')) })
    res.status(201).json({
      id: row._id, secret, expiresAt: row.expiresAt, qr: webPayload({ id: row._id, origin: await payloadOrigin(req) }),
    })
  }))

  router.post('/app', create, requireAuth, nidOnly, h(async (req, res) => {
    const settings = await getSettings()
    const profile = await Profile.findById(req.profile.profileId).lean()
    if (settings.serverCode && !hasServerAccess(profile) && !cookiePassed(req, settings.serverCode))
      return body(res, 403, 'server_code_required', 'Using apps on this server needs its code.')
    const { row } = await createLogin({ kind: 'app', authorId: profile._id })
    res.status(201).json({
      id: row._id, expiresAt: row.expiresAt,
      qr: appPayload({ id: row._id, origin: await payloadOrigin(req), code: settings.serverCode }),
    })
  }))

  router.post('/:id/scan', general, requireAccessToken(), h(async (req, res) => {
    const client = await findClient(req.grant.clientId)
    const { row } = await transition(req.params.id, (row) => ({
      patch: scan(row, { authorId: req.grant.profile._id, client, now: new Date() }),
    }))
    res.json({ device: row.device, createdAt: row.createdAt })
  }))

  router.post('/:id/claim', general, h(async (req, res) => {
    const input = req.body ?? {}
    let request
    try {
      request = await checkRequest({ ...input, response_type: 'code' })
    } catch (err) {
      // /authorize redirects these to the app; here the app is the one asking.
      if (err instanceof V1Error && err.code === 'redirect') throw new V1Error(400, 'bad_request', err.message)
      throw err
    }
    const secret = newSecret()
    const device = cleanDevice(input.device, request.client.name)
    const { row } = await transition(req.params.id, (row) => ({
      patch: {
        ...claim(row, { client: request.client, now: new Date() }),
        secretHash: hashSecret(secret), clientId: request.client._id, scopes: request.scopes,
        redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, device,
      },
    }))
    res.json({ secret, expiresAt: row.expiresAt })
  }))

  router.get('/:id', watching, requireAuth, nidOnly, h(async (req, res) => {
    const row = await findLogin(req.params.id)
    const status = watch(row, { authorId: req.profile.profileId, now: new Date() })
    const client = row.clientId ? await findClient(row.clientId) : null
    res.json({ status, client: client ? { id: client._id, name: client.name } : null, device: row.device })
  }))

  // Bearer for an app approving a web request, the session for the website approving an app's.
  async function approver(req) {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ')
    if (scheme?.toLowerCase() === 'bearer') {
      const grant = await findAccessToken(token)
      if (!grant) throw new QrError(401, 'unauthorized', 'A valid Nucleus ID access token is required.')
      return { via: 'bearer', authorId: grant.profile._id, client: await findClient(grant.clientId) }
    }
    if (req.profile?.via === 'nid') return { via: 'session', authorId: req.profile.profileId }
    throw new QrError(401, 'unauthorized', 'Sign in to continue.')
  }

  router.post('/:id/approve', general, optionalAuth, h(async (req, res) => {
    if (typeof req.body?.approve !== 'boolean') throw new QrError(400, 'bad_request', 'Send { approve: true } or { approve: false }.')
    const who = await approver(req)
    await transition(req.params.id, (row) => ({ patch: decide(row, { ...who, approve: req.body.approve, now: new Date() }) }))
    res.status(204).end()
  }))

  router.post('/:id/poll', polling, h(async (req, res) => {
    const { row, result } = await transition(req.params.id, (row) => {
      const { patch, status } = pickup(row, { secret: req.body?.secret, now: new Date() })
      return { patch, result: status }
    })
    if (result !== 'signed-in') return res.json({ status: result })

    if (row.kind === 'web') {
      const profile = await Profile.findByIdAndUpdate(row.authorId, { lastLoginAt: new Date() }, { returnDocument: 'after' }).lean()
      if (!profile) throw gone()
      await issueSession(req, res, profile, 'nid')
      const { serverCode } = await getSettings()
      if (serverCode && cookiePassed(req, serverCode)) await grantServerAccess(profile._id)
      return res.json({ status: result })
    }
    const code = await approve({
      clientId: row.clientId, profileId: row.authorId, scopes: row.scopes,
      redirectUri: row.redirectUri, codeChallenge: row.codeChallenge,
    })
    res.json({ status: result, code, redirect_uri: row.redirectUri })
  }))

  return router
}
