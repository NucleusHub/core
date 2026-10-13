import express, { Router } from 'express'
import Profile, { colorFromName } from '../models/Profile.js'
import { getSettings } from '../models/AuthSettings.js'
import { authenticate } from '../middleware/auth.js'
import { serverCodeGate } from '../middleware/serverCode.js'
import { issueSession, isHttps } from '../lib/session.js'
import { cookiePassed, fingerprint, grantServerAccess, sameCode, sign, unsign } from '../lib/serverCode.js'
import { rateLimiter } from '../lib/rateLimit.js'
import { SsoError, newFlowSecrets, provider as findProvider, safeReturn } from '../lib/sso.js'
import { claimBootstrap, releaseUnverified, requireNid } from './nid.js'

const FLOW_COOKIE = 'nucleus_sso'
const FLOW_TTL_SEC = 10 * 60
const WINDOW_MS = 15 * 60 * 1000

const fail = (res, status, code, error) => res.status(status).json({ error, code })
const failRedirect = (res, code) => res.redirect(302, `/?sso_error=${code}`)

function landing(ret, params = {}) {
  const url = new URL(safeReturn(ret), 'http://n.invalid')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return `${url.pathname}${url.search}${url.hash}`
}

// Apple returns with a cross-site POST, which only a SameSite=None cookie survives.
const flowCookieOptions = (req, id) => ({
  httpOnly: true,
  sameSite: id === 'apple' ? 'none' : 'lax',
  secure: id === 'apple' || isHttps(req),
  path: '/api/auth/nid/sso',
})

const hasAdmin = async () => !!(await Profile.exists({ role: 'admin', isGuest: false }))
const identityFilter = (id, subject) => ({ 'account.identities': { $elemMatch: { provider: id, subject } } })

async function signIn(req, res, profileId, grantAccess) {
  const profile = await Profile.findByIdAndUpdate(profileId, { lastLoginAt: new Date() }, { new: true }).lean()
  await issueSession(req, res, profile, 'nid')
  if (grantAccess) await grantServerAccess(profile._id)
}

// One identity per provider per account; the unique index keeps a subject on one account.
async function link(profileId, id, info) {
  try {
    const r = await Profile.updateOne(
      { _id: profileId, account: { $exists: true }, 'account.identities.provider': { $ne: id } },
      { $push: { 'account.identities': { provider: id, subject: info.subject, email: info.email, linkedAt: new Date() } } },
    )
    return r.modifiedCount === 1 ? null : 'provider_taken'
  } catch (err) {
    if (err?.code === 11000) return 'identity_taken'
    throw err
  }
}

async function createAccount(id, info, verified) {
  const identity = { provider: id, subject: info.subject, email: info.email, linkedAt: new Date() }
  for (let n = 1; n < 100; n++) {
    const h = n === 1 ? info.handle : `${info.handle.slice(0, 38 - String(n).length)}-${n}`
    if (await Profile.exists({ 'account.handleLower': h })) continue
    const name = info.name.trim().slice(0, 64) || h
    try {
      return await Profile.create({
        name, color: colorFromName(name), role: 'user', whatsNew: { lastSeenAt: new Date() },
        account: {
          handle: h, handleLower: h, email: info.email, emailLower: info.email,
          emailVerifiedAt: verified ? new Date() : null, passwordHash: null,
          appearance: null, serverAccess: false, identities: [identity], createdAt: new Date(),
        },
      })
    } catch (err) {
      if (err?.code !== 11000) throw err
      const key = Object.keys(err.keyPattern || {}).join()
      if (key.includes('identities')) throw new SsoError('identity_taken')
      if (key.includes('email')) throw new SsoError('email_taken')
    }
  }
  throw new SsoError('handle_unavailable')
}

export function ssoRouter() {
  const router = Router()
  const limit = (onLimit) => rateLimiter({ max: 30, windowMs: WINDOW_MS, onLimit })

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  router.get('/:provider/start',
    limit((res) => fail(res, 429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.')),
    async (req, res, next) => {
      // Disabled answers 404 before the gate, so probing a provider says nothing about the key.
      try {
        const settings = await getSettings()
        if (!findProvider(settings, req.params.provider)) return fail(res, 404, 'provider_disabled', 'This sign-in option is not set up on this server.')
        req.ssoSettings = settings
        next()
      } catch (err) {
        console.error('[sso]', err)
        res.status(500).json({ error: 'Server error' })
      }
    },
    serverCodeGate,
    async (req, res) => {
      try {
        const settings = req.ssoSettings
        const id = req.params.provider
        const mode = req.query.mode === 'link' ? 'link' : 'login'
        const claims = await authenticate(req)
        let pid = null
        if (mode === 'link') {
          if (!claims) return failRedirect(res, 'signed_out')
          if (!(await Profile.exists({ _id: claims.profileId, account: { $exists: true } }))) return failRedirect(res, 'no_account')
          pid = String(claims.profileId)
        }
        const secrets = newFlowSecrets()
        const passed = !!settings.serverCode && cookiePassed(req, settings.serverCode)
        const flow = {
          p: id, mode, pid, ret: safeReturn(req.query.return), ...secrets,
          // The callback can't see the gate (Apple's POST is cross-site), so the result travels in the signed flow.
          f: passed ? fingerprint(settings.serverCode) : null,
          sess: !!claims,
        }
        res.cookie(FLOW_COOKIE, sign(flow, FLOW_TTL_SEC), { ...flowCookieOptions(req, id), maxAge: FLOW_TTL_SEC * 1000 })
        res.redirect(302, findProvider(settings, id).authorizeUrl(settings, secrets))
      } catch (err) {
        console.error('[sso]', err)
        res.status(500).json({ error: 'Server error' })
      }
    })

  async function callback(req, res) {
    const id = req.params.provider
    const params = (req.method === 'POST' ? req.body : req.query) || {}
    const flow = unsign(req.cookies?.[FLOW_COOKIE])
    res.clearCookie(FLOW_COOKIE, flowCookieOptions(req, id))

    if (params.error) return failRedirect(res, ['access_denied', 'user_cancelled_authorize'].includes(params.error) ? 'cancelled' : 'provider_error')
    if (!flow || flow.p !== id || typeof params.state !== 'string' || !sameCode(params.state, flow.state))
      return failRedirect(res, 'state_mismatch')

    const settings = await getSettings()
    const prov = findProvider(settings, id)
    if (!prov) return failRedirect(res, 'provider_disabled')
    const keyOk = !!settings.serverCode && flow.f === fingerprint(settings.serverCode)
    if (settings.serverCode && !keyOk && !flow.sess) return failRedirect(res, 'server_code_required')
    if (typeof params.code !== 'string' || !params.code) return failRedirect(res, 'provider_error')

    let info
    try {
      info = await prov.exchange(settings, { code: params.code, verifier: flow.verifier, nonce: flow.nonce, form: params })
    } catch (err) {
      if (!(err instanceof SsoError)) console.error('[sso] exchange failed', err)
      return failRedirect(res, err instanceof SsoError ? err.code : 'provider_error')
    }
    const known = await Profile.findOne(identityFilter(id, info.subject)).select('_id').lean()

    if (flow.mode === 'link') {
      // Lax session cookies don't ride Apple's cross-site POST; there the signed flow vouches for the account.
      const claims = await authenticate(req)
      if (claims ? String(claims.profileId) !== flow.pid : req.method !== 'POST') return failRedirect(res, 'session_changed')
      if (known && String(known._id) !== flow.pid) return failRedirect(res, 'identity_taken')
      if (!known) {
        const err = await link(flow.pid, id, info)
        if (err) return failRedirect(res, err)
      }
      return res.redirect(302, landing(flow.ret, { account: 'linked' }))
    }

    if (known) {
      await signIn(req, res, known._id, keyOk)
      return res.redirect(302, landing(flow.ret))
    }

    // Linking or creating on an address the provider doesn't vouch for would let anyone claim it.
    if (!info.email || !info.emailVerified) return failRedirect(res, 'email_unverified')

    const owner = await Profile.findOne({ 'account.emailLower': info.email, 'account.emailVerifiedAt': { $ne: null } }).select('_id').lean()
    if (owner) {
      const err = await link(owner._id, id, info)
      if (err) return failRedirect(res, err)
      await signIn(req, res, owner._id, keyOk)
      return res.redirect(302, landing(flow.ret))
    }

    if (!settings.signupOpen && await hasAdmin()) return failRedirect(res, 'signup_closed')
    await releaseUnverified({ email: info.email })
    let profile
    try {
      profile = await createAccount(id, info, true)
    } catch (err) {
      if (err instanceof SsoError) return failRedirect(res, err.code)
      throw err
    }
    if (!(await hasAdmin()) && await claimBootstrap(profile._id))
      await Profile.updateOne({ _id: profile._id }, { role: 'admin' })
    await signIn(req, res, profile._id, keyOk)
    res.redirect(302, landing(flow.ret, { account: 'welcome' }))
  }

  const safe = (fn) => async (req, res) => {
    try {
      await fn(req, res)
    } catch (err) {
      console.error('[sso]', err)
      if (!res.headersSent) failRedirect(res, 'server_error')
    }
  }
  const callbackLimit = limit((res) => failRedirect(res, 'rate_limited'))
  router.get('/:provider/callback', callbackLimit, safe(callback))
  router.post('/:provider/callback', callbackLimit, express.urlencoded({ extended: false, limit: '16kb' }), safe(callback))

  router.delete('/:provider', requireNid, async (req, res) => {
    try {
      const id = req.params.provider
      const profile = await Profile.findById(req.profile.profileId).lean()
      if (!profile?.account) return fail(res, 404, 'no_account', 'This profile has no NucleusID.')
      if (!(profile.account.identities || []).some((i) => i.provider === id)) return fail(res, 404, 'not_linked', 'That sign-in option is not connected.')
      // Conditional pull: a concurrent unlink can't leave the account with no way in.
      const r = await Profile.updateOne(
        { _id: profile._id, $or: [{ 'account.passwordHash': { $nin: [null, ''] } }, { 'account.identities.1': { $exists: true } }] },
        { $pull: { 'account.identities': { provider: id } } },
      )
      if (r.modifiedCount !== 1)
        return fail(res, 409, 'last_credential', 'This is your only way to sign in. Set a password or connect another option first.')
      res.status(204).end()
    } catch (err) {
      console.error('[sso]', err)
      res.status(500).json({ error: 'Server error' })
    }
  })

  return router
}
