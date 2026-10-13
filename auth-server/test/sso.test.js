import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { startDb, stopDb, makeApp, createProfile, loginAsNid } from './helpers.js'
import AuthSettings, { invalidateSettings, publicSettings, getSettings } from '../models/AuthSettings.js'
import Profile from '../models/Profile.js'
import Session from '../models/Session.js'
import { hashPassword } from '../lib/password.js'
import { setFetch, safeReturn } from '../lib/sso.js'
import { sign, fingerprint } from '../lib/serverCode.js'

const ORIGIN = 'https://home.example.org'
const PW = 'correct horse battery'
const CODE = 'nucleus' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6' + 'home'
const { privateKey: APPLE_KEY, publicKey: APPLE_PUB } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

let app
let calls
let provider

before(startDb)
after(async () => {
  setFetch(null)
  await stopDb()
})
beforeEach(async () => {
  await Promise.all([Profile.deleteMany({}), Session.deleteMany({}), AuthSettings.deleteMany({})])
  await settings({
    publicOrigin: ORIGIN,
    'sso.github': { clientId: 'ghid', clientSecret: 'ghsecret' },
    'sso.google': { clientId: 'gid', clientSecret: 'gsecret' },
    'sso.apple': { clientId: 'com.example.web', teamId: 'TEAM123', keyId: 'KEY123', privateKey: APPLE_KEY.export({ type: 'pkcs8', format: 'pem' }) },
  })
  calls = []
  provider = {
    github: { id: 4242, login: 'octocat', name: 'Octo Cat', emails: [{ email: 'Octo@Example.com', primary: true, verified: true }] },
    google: { sub: 'g-1', email: 'gina@example.com', email_verified: true, name: 'Gina G' },
    apple: { sub: 'a-1', email: 'anna@example.com', email_verified: 'true' },
  }
  setFetch(stubFetch)
  app = makeApp()
})

async function settings(patch) {
  await AuthSettings.updateOne({ _id: 'auth' }, { $set: patch }, { upsert: true })
  invalidateSettings()
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Stands in for every provider endpoint; the nonce is echoed back from the token request's flow.
let lastNonce = null
async function stubFetch(url, opts = {}) {
  const u = String(url)
  const body = opts.body ? Object.fromEntries(new URLSearchParams(String(opts.body))) : null
  calls.push({ url: u, body, headers: opts.headers })
  if (u === 'https://github.com/login/oauth/access_token') return json({ access_token: 'gho_x', token_type: 'bearer' })
  if (u === 'https://api.github.com/user') {
    const { id, login, name } = provider.github
    return json({ id, login, name })
  }
  if (u === 'https://api.github.com/user/emails') return json(provider.github.emails)
  if (u === 'https://oauth2.googleapis.com/token') {
    const p = provider.google
    return json({ access_token: 'ya29', id_token: jwt.sign({ iss: 'https://accounts.google.com', aud: 'gid', nonce: lastNonce, ...p }, 'unused', { expiresIn: 300 }) })
  }
  if (u === 'https://appleid.apple.com/auth/token') {
    const p = provider.apple
    return json({ access_token: 'a', id_token: jwt.sign({ iss: 'https://appleid.apple.com', aud: 'com.example.web', nonce: lastNonce, ...p }, 'unused', { expiresIn: 300 }) })
  }
  return json({ error: 'unexpected' }, 500)
}

const cookieNamed = (res, name) => (res.headers['set-cookie'] || []).find(c => c.startsWith(`${name}=`))
const pair = (c) => c?.split(';')[0]
const claimsOf = (res) => jwt.decode(decodeURIComponent(pair(cookieNamed(res, 'nucleus_token')).slice('nucleus_token='.length)))

async function start(name, query = {}, cookie) {
  let req = request(app).get(`/api/auth/nid/sso/${name}/start`).query(query)
  if (cookie) req = req.set('Cookie', cookie)
  const res = await req
  assert.equal(res.status, 302, JSON.stringify(res.body))
  const location = new URL(res.headers.location)
  lastNonce = location.searchParams.get('nonce')
  return { res, location, state: location.searchParams.get('state'), flow: pair(cookieNamed(res, 'nucleus_sso')) }
}

async function finish(name, flowStart, { extra = {}, cookie, state } = {}) {
  const params = { code: 'the-code', state: state ?? flowStart.state, ...extra }
  const cookies = [flowStart.flow, cookie].filter(Boolean).join('; ')
  if (name === 'apple')
    return request(app).post(`/api/auth/nid/sso/${name}/callback`).set('Cookie', cookies).type('form').send(params)
  return request(app).get(`/api/auth/nid/sso/${name}/callback`).query(params).set('Cookie', cookies)
}

const flow = async (name, opts = {}) => finish(name, await start(name, opts.query, opts.startCookie), opts)

async function accountProfile(fields = {}) {
  const { handle = 'alice', email = 'alice@example.com', verified = true, passwordHash = await hashPassword(PW), identities = [], ...rest } = fields
  return createProfile({
    name: 'Alice', role: 'user', ...rest,
    account: { handle, handleLower: handle, email, emailLower: email, emailVerifiedAt: verified ? new Date() : null, passwordHash, identities },
  })
}

test('disabled providers answer 404 provider_disabled, and public settings agree', async () => {
  await settings({ 'sso.github.clientSecret': null })
  let res = await request(app).get('/api/auth/nid/sso/github/start')
  assert.equal(res.status, 404)
  assert.equal(res.body.code, 'provider_disabled')
  assert.equal((await request(app).get('/api/auth/nid/sso/nope/start')).body.code, 'provider_disabled')

  // Keys alone are not enough: the redirect URI comes only from publicOrigin.
  await settings({ 'sso.github.clientSecret': 'ghsecret', publicOrigin: null })
  res = await request(app).get('/api/auth/nid/sso/github/start')
  assert.equal(res.status, 404)
  assert.equal(res.body.code, 'provider_disabled')
  assert.deepEqual(publicSettings(await getSettings()).sso, { apple: false, google: false, github: false })

  // Apple's cross-site form_post needs a SameSite=None cookie, so it needs https.
  await settings({ publicOrigin: 'http://home.lan' })
  assert.deepEqual(publicSettings(await getSettings()).sso, { apple: false, google: true, github: true })
  assert.equal((await request(app).get('/api/auth/nid/sso/apple/start')).status, 404)
  await settings({ publicOrigin: ORIGIN })
  assert.deepEqual(publicSettings(await getSettings()).sso, { apple: true, google: true, github: true })
})

test('start redirects with state and PKCE from publicOrigin, never the Host header', async () => {
  const res = await request(app).get('/api/auth/nid/sso/github/start').set('Host', 'evil.example').set('X-Forwarded-Host', 'evil.example')
  assert.equal(res.status, 302)
  const loc = new URL(res.headers.location)
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(loc.searchParams.get('client_id'), 'ghid')
  assert.equal(loc.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/nid/sso/github/callback`)
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256')
  assert.match(loc.searchParams.get('state'), /^[A-Za-z0-9_-]{40,}$/)
  assert.match(loc.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/)
  const cookie = cookieNamed(res, 'nucleus_sso')
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Lax/i)
  assert.match(cookie, /Path=\/api\/auth\/nid\/sso/)
  assert.equal(cookie.includes(loc.searchParams.get('state')), false)

  const g = new URL((await request(app).get('/api/auth/nid/sso/google/start')).headers.location)
  assert.equal(g.origin + g.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(g.searchParams.get('scope'), 'openid email profile')
  assert.ok(g.searchParams.get('nonce'))
  assert.equal(g.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/nid/sso/google/callback`)
})

test('callback with a wrong state, a missing cookie or another provider signs nobody in', async () => {
  const s = await start('github')
  let res = await finish('github', s, { state: 'not-the-state' })
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/?sso_error=state_mismatch')
  assert.equal(cookieNamed(res, 'nucleus_token'), undefined)

  res = await finish('github', { state: s.state, flow: null })
  assert.equal(res.headers.location, '/?sso_error=state_mismatch')

  res = await finish('google', s)
  assert.equal(res.headers.location, '/?sso_error=state_mismatch')

  res = await finish('github', s, { extra: { error: 'access_denied' } })
  assert.equal(res.headers.location, '/?sso_error=cancelled')
  assert.equal(await Profile.countDocuments(), 0)
  assert.equal(calls.length, 0)
})

test('new GitHub user gets an account: derived handle, verified email, no password, first is admin', async () => {
  const s = await start('github')
  const res = await finish('github', s)
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/?account=welcome')
  assert.equal(claimsOf(res).via, 'nid')
  assert.match(cookieNamed(res, 'nucleus_sso'), /Expires=Thu, 01 Jan 1970/)

  const tokenCall = calls.find(c => c.url.includes('access_token'))
  assert.equal(tokenCall.body.redirect_uri, `${ORIGIN}/api/auth/nid/sso/github/callback`)
  assert.equal(createHash('sha256').update(tokenCall.body.code_verifier).digest('base64url'), s.location.searchParams.get('code_challenge'))

  const p = await Profile.findOne({ 'account.handleLower': 'octocat' }).lean()
  assert.equal(p.name, 'Octo Cat')
  assert.equal(p.role, 'admin')
  assert.equal(p.account.email, 'octo@example.com')
  assert.ok(p.account.emailVerifiedAt)
  assert.equal(p.account.passwordHash, null)
  assert.equal(p.account.identities.length, 1)
  assert.equal(p.account.identities[0].provider, 'github')
  assert.equal(p.account.identities[0].subject, '4242')
  assert.equal(String(claimsOf(res).profileId), String(p._id))
})

test('new handles are sanitized and made unique', async () => {
  await accountProfile({ handle: 'octocat', email: 'other@example.com' })
  provider.github.login = 'Octo.Cat_'
  provider.github.id = 1
  const r1 = await flow('github')
  assert.equal(r1.headers.location, '/?account=welcome')
  provider.github = { id: 2, login: 'octocat', name: '', emails: [{ email: 'x@example.com', primary: true, verified: true }] }
  await flow('github')
  const handles = (await Profile.find().lean()).map(p => p.account.handle).sort()
  assert.deepEqual(handles, ['octo-cat', 'octocat', 'octocat-2'])
  assert.equal((await Profile.findOne({ 'account.handle': 'octocat-2' })).name, 'octocat-2')
})

test('a linked identity signs into its account and lands on the return path', async () => {
  await flow('github')
  const res = await flow('github', { query: { return: '/apps/notes?x=1' } })
  assert.equal(res.headers.location, '/apps/notes?x=1')
  assert.equal(await Profile.countDocuments(), 1)
  assert.equal(claimsOf(res).via, 'nid')
})

test('a provider-verified email links to the account with that verified email', async () => {
  const alice = await accountProfile()
  provider.google.email = 'Alice@Example.com'
  const res = await flow('google')
  assert.equal(res.headers.location, '/')
  assert.equal(String(claimsOf(res).profileId), String(alice._id))
  assert.equal(await Profile.countDocuments(), 1)
  const p = await Profile.findById(alice._id).lean()
  assert.deepEqual(p.account.identities.map(i => [i.provider, i.subject, i.email]), [['google', 'g-1', 'alice@example.com']])
})

test('unverified emails on either side never link (pre-hijack)', async () => {
  // Provider does not vouch for the address: no link, and no account on an unproven address.
  const alice = await accountProfile()
  provider.google.email = 'alice@example.com'
  provider.google.email_verified = false
  let res = await flow('google')
  assert.equal(res.headers.location, '/?sso_error=email_unverified')
  assert.equal((await Profile.findById(alice._id).lean()).account.identities.length, 0)
  assert.equal(await Profile.countDocuments(), 1)

  // The local claim is unproven: it is released and the provider's owner gets a fresh account.
  await Profile.deleteMany({})
  const squatter = await accountProfile({ verified: false })
  provider.google.email_verified = true
  res = await flow('google')
  assert.equal(res.headers.location, '/?account=welcome')
  assert.notEqual(String(claimsOf(res).profileId), String(squatter._id))
  assert.equal(await Profile.exists({ _id: squatter._id }), null)
  const fresh = await Profile.findOne({ 'account.emailLower': 'alice@example.com' }).lean()
  assert.equal(fresh.account.identities[0].subject, 'g-1')
})

test('link mode adds the identity to the signed-in account', async () => {
  const alice = await accountProfile()
  const cookie = await loginAsNid(alice)
  provider.github.emails = [{ email: 'elsewhere@example.com', primary: true, verified: true }]
  const res = await flow('github', { query: { mode: 'link', return: '/settings' }, startCookie: cookie, cookie })
  assert.equal(res.headers.location, '/settings?account=linked')
  const p = await Profile.findById(alice._id).lean()
  assert.equal(p.account.identities[0].subject, '4242')
  assert.equal(await Profile.countDocuments(), 1)

  const acct = await request(app).get('/api/auth/nid/account').set('Cookie', cookie)
  assert.deepEqual(acct.body.identities.map(i => i.provider), ['github'])

  // The same GitHub account cannot go to a second NucleusID.
  const bob = await accountProfile({ handle: 'bob', email: 'bob@example.com' })
  const bobCookie = await loginAsNid(bob)
  const taken = await flow('github', { query: { mode: 'link' }, startCookie: bobCookie, cookie: bobCookie })
  assert.equal(taken.headers.location, '/?sso_error=identity_taken')
  assert.equal((await Profile.findById(bob._id).lean()).account.identities.length, 0)

  // Linking needs someone signed in.
  const anon = await request(app).get('/api/auth/nid/sso/github/start').query({ mode: 'link' })
  assert.equal(anon.headers.location, '/?sso_error=signed_out')

  // Signing out and in as someone else mid-flow links nothing.
  const s = await start('google', { mode: 'link' }, cookie)
  const swapped = await finish('google', s, { cookie: bobCookie })
  assert.equal(swapped.headers.location, '/?sso_error=session_changed')
})

test('link mode works from a PIN session on a profile with an account', async () => {
  const alice = await accountProfile({ pin: '1234' })
  const login = await request(app).post('/api/auth/login').send({ profileId: String(alice._id), pin: '1234' })
  const cookie = pair(cookieNamed(login, 'nucleus_token'))
  const res = await flow('github', { query: { mode: 'link' }, startCookie: cookie, cookie })
  assert.equal(res.headers.location, '/?account=linked')

  const plain = await createProfile({ name: 'Plain', pin: '9999' })
  const l2 = await request(app).post('/api/auth/login').send({ profileId: String(plain._id), pin: '9999' })
  const c2 = pair(cookieNamed(l2, 'nucleus_token'))
  const r2 = await request(app).get('/api/auth/nid/sso/github/start').query({ mode: 'link' }).set('Cookie', c2)
  assert.equal(r2.headers.location, '/?sso_error=no_account')
})

test('return only accepts same-origin relative paths', async () => {
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/\t/evil.com', 'evil', '/%0a/x\n', '', null, '/.//evil.com'])
    assert.equal(safeReturn(bad), '/', String(bad))
  assert.equal(safeReturn('/apps/x?y=1#z'), '/apps/x?y=1#z')

  const res = await flow('github', { query: { return: '//evil.com/x' } })
  assert.equal(res.headers.location, '/?account=welcome')
})

test('closed sign-up refuses new accounts but still signs in known identities', async () => {
  await accountProfile({ role: 'admin' })
  await settings({ signupOpen: false })
  let res = await flow('github')
  assert.equal(res.headers.location, '/?sso_error=signup_closed')
  assert.equal(await Profile.countDocuments(), 1)

  await accountProfile({ handle: 'gh', email: 'gh@example.com', identities: [{ provider: 'github', subject: '4242' }] })
  res = await flow('github')
  assert.equal(res.headers.location, '/')
})

test('provider failures redirect with an error code', async () => {
  setFetch(async () => json({ error: 'bad_verification_code' }, 400))
  assert.equal((await flow('github')).headers.location, '/?sso_error=exchange_failed')
  setFetch(stubFetch)
  provider.github.emails = [{ email: 'x@example.com', primary: true, verified: false }]
  assert.equal((await flow('github')).headers.location, '/?sso_error=email_unverified')
})

test('google id_token claims are checked: audience and nonce', async () => {
  provider.google.aud = 'someone-else'
  assert.equal((await flow('google')).headers.location, '/?sso_error=bad_token')
  delete provider.google.aud
  provider.google.nonce = 'replayed'
  assert.equal((await flow('google')).headers.location, '/?sso_error=bad_token')
  assert.equal(await Profile.countDocuments(), 0)
})

test('apple: form_post callback, SameSite=None cookie, ES256 client secret, name from first login', async () => {
  const s = await start('apple')
  assert.equal(s.location.origin + s.location.pathname, 'https://appleid.apple.com/auth/authorize')
  assert.equal(s.location.searchParams.get('response_mode'), 'form_post')
  assert.equal(s.location.searchParams.get('scope'), 'name email')
  const cookie = cookieNamed(s.res, 'nucleus_sso')
  assert.match(cookie, /SameSite=None/i)
  assert.match(cookie, /Secure/i)

  const res = await finish('apple', s, { extra: { user: JSON.stringify({ name: { firstName: 'Anna', lastName: 'Apple' } }) } })
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/?account=welcome')
  const secret = calls.find(c => c.url === 'https://appleid.apple.com/auth/token').body.client_secret
  const claims = jwt.verify(secret, APPLE_PUB.export({ type: 'spki', format: 'pem' }), { algorithms: ['ES256'], audience: 'https://appleid.apple.com', issuer: 'TEAM123', subject: 'com.example.web' })
  assert.ok(claims.exp - claims.iat <= 600)
  assert.equal(jwt.decode(secret, { complete: true }).header.kid, 'KEY123')
  const p = await Profile.findOne({ 'account.identities.provider': 'apple' }).lean()
  assert.equal(p.name, 'Anna Apple')
  assert.equal(p.account.handle, 'anna-apple')
})

test('server key gate: start needs the pass, callback trusts the flow cookie and grants access', async () => {
  await settings({ serverCode: CODE })
  const blocked = await request(app).get('/api/auth/nid/sso/github/start')
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'server_code_required')

  const pass = `nucleus_server_code=${sign({ f: fingerprint(CODE) }, 3600)}`
  const s = await start('github', {}, pass)
  // The callback request itself carries no pass cookie (Apple's cross-site POST would not).
  const res = await finish('github', s)
  assert.equal(res.headers.location, '/?account=welcome')
  assert.equal((await Profile.findOne().lean()).account.serverAccess, true)

  // A flow started before a new key was set is worthless afterwards.
  const s2 = await start('github', {}, pass)
  await settings({ serverCode: 'nucleus' + 'Z'.repeat(32) + 'home' })
  assert.equal((await finish('github', s2)).headers.location, '/?sso_error=server_code_required')
})

test('unlink refuses to remove the last way in', async () => {
  await flow('github')
  const p = await Profile.findOne().lean()
  const cookie = await loginAsNid(p)
  let res = await request(app).delete('/api/auth/nid/sso/github').set('Cookie', cookie)
  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'last_credential')

  assert.equal((await request(app).delete('/api/auth/nid/sso/google').set('Cookie', cookie)).status, 404)

  await Profile.updateOne({ _id: p._id }, { $set: { 'account.passwordHash': await hashPassword(PW) } })
  res = await request(app).delete('/api/auth/nid/sso/github').set('Cookie', cookie)
  assert.equal(res.status, 204)
  assert.equal((await Profile.findById(p._id).lean()).account.identities.length, 0)

  const pin = await createProfile({ name: 'Pinny', pin: '1234' })
  const l = await request(app).post('/api/auth/login').send({ profileId: String(pin._id), pin: '1234' })
  assert.equal((await request(app).delete('/api/auth/nid/sso/github').set('Cookie', pair(cookieNamed(l, 'nucleus_token')))).status, 403)
})

test('SSO-only accounts confirm email change and deletion with their handle', async () => {
  await flow('github')
  const p = await Profile.findOne().lean()
  const cookie = await loginAsNid(p)
  let res = await request(app).patch('/api/auth/nid/account').set('Cookie', cookie).send({ email: 'new@example.com' })
  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'confirm_required')
  res = await request(app).patch('/api/auth/nid/account').set('Cookie', cookie).send({ email: 'new@example.com', confirm: 'octocat' })
  assert.equal(res.status, 200)
  assert.equal(res.body.email, 'new@example.com')

  // The sole admin can't delete; demote for the test.
  await Profile.updateOne({ _id: p._id }, { role: 'user' })
  assert.equal((await request(app).delete('/api/auth/nid/account').set('Cookie', cookie).send({ confirm: 'nope' })).status, 400)
  assert.equal((await request(app).delete('/api/auth/nid/account').set('Cookie', cookie).send({ confirm: 'octocat' })).status, 204)
})
