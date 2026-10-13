import express, { Router } from 'express'
import mongoose from 'mongoose'
import Profile from '../../models/Profile.js'
import { getSettings } from '../../models/AuthSettings.js'
import { optionalAuth, requireAccessToken } from '../../middleware/auth.js'
import { isHttps } from '../../lib/session.js'
import { cookiePassed, grantServerAccess, hasServerAccess } from '../../lib/serverCode.js'
import { rateLimiter } from '../../lib/rateLimit.js'
import {
  CHALLENGE, SCOPES, approve, clientSecretMatches, describeScopes, findClient, findGrant, parseScopes,
  redeemCode, refresh, revokeToken,
} from '../../lib/oauth.js'

// Port of nucleus-web routes/nucleus-id.js. Consent-page routes answer in the v1 error shape;
// the app routes (token, revoke) in OAuth's own `{ error, error_description }`.

const ACCENTS = ['nucleus', 'midnight', 'arctic', 'ember', 'forest', 'custom']
const HEX = /^#[0-9A-Fa-f]{6}$/
const HOST = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/

class V1Error extends Error {
  constructor(status, code, message, details) {
    super(message)
    Object.assign(this, { status, code, details })
  }
}

class OAuthError extends Error {
  constructor(error, description, status = 400) {
    super(description)
    Object.assign(this, { error, status })
  }
}

const v1 = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (err) {
    if (!(err instanceof V1Error)) {
      console.error('[oauth]', err)
      return res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong.' } })
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } })
  }
}

const oauth = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (err) {
    if (!(err instanceof OAuthError)) {
      console.error('[oauth]', err)
      return res.status(500).json({ error: 'server_error', error_description: 'Something went wrong.' })
    }
    if (err.status === 401) res.set('WWW-Authenticate', 'Basic realm="nucleus"')
    res.status(err.status).json({ error: err.error, error_description: err.message })
  }
}

// iOS checks the issuer against the address the user typed, so it comes from this request, not publicOrigin.
export function requestOrigin(req) {
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim()
  return HOST.test(host) ? `${isHttps(req) ? 'https' : 'http'}://${host.toLowerCase()}` : null
}

function callbackUrl(redirectUri, params) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value)
  return url.href
}

// RFC 6749 §4.1.2.1: a bad client or redirect URI is shown, never redirected to (no open redirect).
async function checkRequest(params) {
  const client = await findClient(params.client_id)
  if (!client) throw new V1Error(400, 'unknown_client', 'This app is not registered with Nucleus ID.')
  const redirectUri = typeof params.redirect_uri === 'string' ? params.redirect_uri : ''
  if (!client.redirectUris.includes(redirectUri))
    throw new V1Error(400, 'bad_redirect_uri', 'This app asked to send you somewhere it has not registered.')

  const state = typeof params.state === 'string' ? params.state.slice(0, 500) : ''
  const toApp = (error, description) =>
    new V1Error(400, 'redirect', description, { redirect: callbackUrl(redirectUri, { error, error_description: description, state }) })

  if (params.response_type !== 'code') throw toApp('unsupported_response_type', 'Only response_type=code is supported.')
  if (params.code_challenge_method !== 'S256' || !CHALLENGE.test(String(params.code_challenge ?? '')))
    throw toApp('invalid_request', 'PKCE is required: code_challenge with code_challenge_method=S256.')
  const scopes = await parseScopes(params.scope)
  if (!scopes)
    throw toApp('invalid_scope', `Known scopes: ${SCOPES.join(' ')}, and read:<client>/<view> or send:<client>/<type> for what another app exposes.`)
  return { client, redirectUri, state, scopes, codeChallenge: params.code_challenge }
}

async function authenticateClient(req) {
  let id = req.body?.client_id
  let secret = req.body?.client_secret
  const [scheme, encoded] = (req.get('authorization') ?? '').split(' ')
  if (scheme?.toLowerCase() === 'basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon < 1) throw new OAuthError('invalid_request', 'Malformed client credentials.')
    try {
      id = decodeURIComponent(decoded.slice(0, colon))
      secret = decodeURIComponent(decoded.slice(colon + 1))
    } catch {
      throw new OAuthError('invalid_request', 'Malformed client credentials.')
    }
    // Two different identities in one request: refuse rather than pick one.
    if (req.body?.client_id !== undefined && req.body.client_id !== id)
      throw new OAuthError('invalid_request', 'client_id in the body does not match the Authorization header.')
  }
  const client = await findClient(id)
  if (!client || !clientSecretMatches(client, secret))
    throw new OAuthError('invalid_client', 'Unknown client, or wrong or missing client secret.', 401)
  return client
}

function parseAppearance(value) {
  const invalid = (fields) => new V1Error(422, 'invalid', 'Some fields need fixing.', { fields })
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid({ appearance: 'Send an object, or null to reset it.' })
  if (!ACCENTS.includes(value.accent)) throw invalid({ accent: `One of ${ACCENTS.join(', ')}.` })
  if (value.accent !== 'custom') return { accent: value.accent }
  if (typeof value.customAccent !== 'string' || !HEX.test(value.customAccent)) throw invalid({ customAccent: 'A colour as #RRGGBB.' })
  return { accent: 'custom', customAccent: value.customAccent.toUpperCase() }
}

// One pipeline update, so two saves at once cannot lose an appliedAt.
async function setAppearance(profileId, appearance, applyToApps) {
  const now = new Date().toISOString()
  const value = appearance === null ? null : {
    $mergeObjects: [
      { $literal: appearance },
      { updatedAt: now, appliedAt: applyToApps ? now : { $ifNull: ['$account.appearance.appliedAt', null] } },
    ],
  }
  const doc = await Profile.collection.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(String(profileId)), account: { $exists: true } },
    [{ $set: { 'account.appearance': value } }],
    { returnDocument: 'after', projection: { 'account.appearance': 1 } },
  )
  return doc?.account?.appearance ?? null
}

export function oauthRouter() {
  const router = Router()

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('Pragma', 'no-cache')
    next()
  })

  const writeLimit = rateLimiter({
    max: 60, windowMs: 60_000, key: (req) => `write|${req.ip}`,
    onLimit: (res) => res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Give it a minute.' } }),
  })
  // Generous: an app backend exchanges for all its users from one address.
  const tokenLimit = rateLimiter({
    max: 300, windowMs: 60_000, key: (req) => `token|${req.ip}`,
    onLimit: (res) => res.status(429).json({ error: 'rate_limited', error_description: 'Too many requests. Give it a minute.' }),
  })
  const form = express.urlencoded({ extended: false, limit: '8kb' })

  // ── The consent page's two calls ──────────────────────────────────────────

  router.get('/authorize', optionalAuth, v1(async (req, res) => {
    const request = await checkRequest(req.query)
    const grant = req.profile?.via === 'nid' ? await findGrant(request.client._id, req.profile.profileId) : null
    const granted = grant ? request.scopes.filter(s => grant.scopes.includes(s)) : []
    res.json({
      client: { id: request.client._id, name: request.client.name, trusted: request.client.trusted },
      scopes: request.scopes,
      granted,
      descriptions: await describeScopes(request.scopes),
      // Null for a native app's own scheme: the page says "back to the app" instead.
      redirectHost: new URL(request.redirectUri).host || null,
      skipConsent: request.client.trusted || granted.length === request.scopes.length,
    })
  }))

  router.post('/authorize', writeLimit, optionalAuth, v1(async (req, res) => {
    const settings = await getSettings()
    const profile = req.profile ? await Profile.findById(req.profile.profileId).lean() : null
    // A session alone isn't server access here: approving is how an app gets onto this server.
    const viaCookie = !!settings.serverCode && !hasServerAccess(profile)
    if (viaCookie && !cookiePassed(req, settings.serverCode))
      throw new V1Error(403, 'server_code_required', 'Using apps on this server needs its code.')
    if (!req.profile || !profile) throw new V1Error(401, 'unauthorized', 'Sign in to continue.')
    if (req.profile.via !== 'nid' || !profile.account)
      throw new V1Error(403, 'nid_required', 'Sign in with NucleusID to let an app in.')
    if (viaCookie) await grantServerAccess(profile._id)

    const request = await checkRequest(req.body ?? {})
    if (req.body?.approve !== true) {
      return res.json({
        redirect: callbackUrl(request.redirectUri, { error: 'access_denied', error_description: 'The person declined.', state: request.state }),
      })
    }
    const code = await approve({
      clientId: request.client._id, profileId: profile._id, scopes: request.scopes,
      redirectUri: request.redirectUri, codeChallenge: request.codeChallenge,
    })
    res.json({ redirect: callbackUrl(request.redirectUri, { code, state: request.state }) })
  }))

  // ── The app's calls ───────────────────────────────────────────────────────

  router.post('/token', tokenLimit, form, oauth(async (req, res) => {
    const client = await authenticateClient(req)
    const grantType = req.body?.grant_type
    let result
    if (grantType === 'authorization_code') {
      result = await redeemCode({ code: req.body.code, clientId: client._id, redirectUri: req.body.redirect_uri, verifier: req.body.code_verifier })
    } else if (grantType === 'refresh_token') {
      result = await refresh({ refreshToken: req.body.refresh_token, clientId: client._id })
    } else {
      throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.')
    }
    if (typeof result === 'string') throw new OAuthError('invalid_grant', result)
    res.json({
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scopes.join(' '),
    })
  }))

  // RFC 7009: 200 whether or not the token existed.
  router.post('/revoke', tokenLimit, form, oauth(async (req, res) => {
    const client = await authenticateClient(req)
    await revokeToken({ token: req.body?.token, clientId: client._id })
    res.status(200).end()
  }))

  // OIDC claim names; `sub` is the profile id, permanent unlike handle or email.
  router.get('/userinfo', requireAccessToken(), (req, res) => {
    const { profile, scopes } = req.grant
    res.json({
      sub: String(profile._id),
      preferred_username: profile.account.handle,
      name: profile.name,
      ...(scopes.includes('email') ? { email: profile.account.email, email_verified: !!profile.account.emailVerifiedAt } : {}),
      ...(scopes.includes('profile') ? { appearance: profile.account.appearance ?? null } : {}),
    })
  })

  router.put('/appearance', writeLimit, requireAccessToken('profile'), v1(async (req, res) => {
    const appearance = await setAppearance(req.grant.profile._id, parseAppearance(req.body?.appearance), req.body?.applyToApps === true)
    res.json({ appearance })
  }))

  // no-store, not nucleus-web's max-age: issuer follows the request host and the server key can change.
  router.get('/metadata', v1(async (req, res) => {
    const origin = requestOrigin(req)
    if (!origin) throw new V1Error(400, 'bad_host', 'The Host header is not a host name.')
    const { serverCode } = await getSettings()
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/api/v1/oauth/token`,
      revocation_endpoint: `${origin}/api/v1/oauth/revoke`,
      userinfo_endpoint: `${origin}/api/v1/oauth/userinfo`,
      scopes_supported: SCOPES,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      ...(serverCode ? { server_code_required: true } : {}),
    })
  }))

  return router
}
