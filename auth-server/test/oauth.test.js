import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import request from 'supertest'
import { startDb, stopDb, makeApp, createProfile, loginAs, loginAsNid } from './helpers.js'
import AuthSettings, { invalidateSettings } from '../models/AuthSettings.js'
import Profile from '../models/Profile.js'
import Session from '../models/Session.js'
import { OAuthClient, OAuthGrant, OAuthCode, OAuthToken } from '../models/OAuth.js'
import { seedClients, refresh } from '../lib/oauth.js'
import { hashPassword } from '../lib/password.js'
import { sign, fingerprint } from '../lib/serverCode.js'

const CODE = 'nucleus' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6' + 'home'
const REDIRECT = 'com.nucleushome.todo:/oauth'
const PW = 'correct horse battery'

let app

before(startDb)
after(stopDb)
beforeEach(async () => {
  await Promise.all([
    Profile.deleteMany({}), Session.deleteMany({}), AuthSettings.deleteMany({}),
    OAuthClient.deleteMany({}), OAuthGrant.deleteMany({}), OAuthCode.deleteMany({}), OAuthToken.deleteMany({}),
  ])
  invalidateSettings()
  await seedClients()
  app = makeApp()
})

async function settings(patch) {
  await AuthSettings.updateOne({ _id: 'auth' }, { $set: patch }, { upsert: true })
  invalidateSettings()
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function nidUser(attrs = {}) {
  const handle = attrs.handle || `u${Math.random().toString(36).slice(2, 8)}`
  const email = `${handle}@example.org`
  const profile = await createProfile({
    name: attrs.name || 'Jana Nováková',
    role: attrs.role || 'user',
    account: {
      handle, handleLower: handle, email, emailLower: email, emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(PW), serverAccess: !!attrs.serverAccess, identities: [],
    },
  })
  return { profile, cookie: await loginAsNid(profile) }
}

const query = (over = {}) => ({
  response_type: 'code', client_id: 'todo', redirect_uri: REDIRECT, scope: 'profile data',
  state: 'st4te', code_challenge_method: 'S256', ...over,
})

async function authorize(cookie, over = {}) {
  const { verifier, challenge } = pkce()
  const q = query({ code_challenge: challenge, ...over })
  const res = await request(app).post('/api/v1/oauth/authorize').set('Cookie', cookie).send({ ...q, approve: true })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const url = new URL(res.body.redirect)
  return { code: url.searchParams.get('code'), state: url.searchParams.get('state'), verifier, redirect: res.body.redirect }
}

const token = (body) => request(app).post('/api/v1/oauth/token').type('form').send(body)

async function signIn(cookie, over = {}) {
  const { code, verifier } = await authorize(cookie, over)
  const res = await token({ grant_type: 'authorization_code', code, client_id: over.client_id || 'todo', redirect_uri: over.redirect_uri || REDIRECT, code_verifier: verifier })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return res.body
}

const userinfo = (access) => request(app).get('/api/v1/oauth/userinfo').set('Authorization', `Bearer ${access}`)

// ── Metadata ────────────────────────────────────────────────────────────────

test('metadata reflects the host the client connected to', async () => {
  const res = await request(app).get('/api/v1/oauth/metadata').set('Host', 'nas.local').set('X-Forwarded-Proto', 'https')
  assert.equal(res.status, 200)
  assert.equal(res.body.issuer, 'https://nas.local')
  assert.equal(res.body.authorization_endpoint, 'https://nas.local/authorize')
  assert.equal(res.body.token_endpoint, 'https://nas.local/api/v1/oauth/token')
  assert.equal(res.body.revocation_endpoint, 'https://nas.local/api/v1/oauth/revoke')
  assert.equal(res.body.userinfo_endpoint, 'https://nas.local/api/v1/oauth/userinfo')
  assert.deepEqual(res.body.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(res.body.scopes_supported, ['profile', 'email', 'data'])
  assert.equal(res.body.server_code_required, undefined)

  const fwd = await request(app).get('/api/v1/oauth/metadata').set('Host', 'auth-server:3005').set('X-Forwarded-Host', 'home.example.org:8443')
  assert.equal(fwd.body.issuer, 'http://home.example.org:8443')

  await settings({ serverCode: CODE, publicOrigin: 'https://other.example.org' })
  const coded = await request(app).get('/api/v1/oauth/metadata').set('Host', '192.168.1.5')
  assert.equal(coded.body.issuer, 'http://192.168.1.5')
  assert.equal(coded.body.server_code_required, true)
})

test('metadata refuses a malformed host', async () => {
  const res = await request(app).get('/api/v1/oauth/metadata').set('Host', 'evil.com/x?')
  assert.equal(res.status, 400)
})

// ── Clients ─────────────────────────────────────────────────────────────────

test('seeding is idempotent and keeps an admin’s trusted choice', async () => {
  const todo = await OAuthClient.findById('todo').lean()
  assert.equal(todo.name, 'Todo')
  assert.equal(todo.trusted, true)
  assert.deepEqual(todo.redirectUris, [REDIRECT])
  assert.deepEqual(todo.exposes, ['view:lists', 'command:setDone', 'command:addTask'])
  assert.equal(todo.exposeLabels['view:lists'], 'See your Todo lists')
  assert.deepEqual((await OAuthClient.findById('watchlist').lean()).exposes, ['view:library', 'command:markWatched', 'command:unmarkWatched'])
  assert.deepEqual((await OAuthClient.findById('notes').lean()).redirectUris, ['com.nucleushome.notes:/oauth'])

  await OAuthClient.updateOne({ _id: 'todo' }, { trusted: false })
  await seedClients()
  assert.equal((await OAuthClient.findById('todo').lean()).trusted, false)
  assert.equal(await OAuthClient.countDocuments(), 3)
})

// ── Consent page: GET ───────────────────────────────────────────────────────

test('GET authorize describes a sound request', async () => {
  const { challenge } = pkce()
  const res = await request(app).get('/api/v1/oauth/authorize').query(query({ code_challenge: challenge }))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.client, { id: 'todo', name: 'Todo', trusted: true })
  assert.deepEqual(res.body.scopes, ['profile', 'data'])
  assert.deepEqual(res.body.granted, [])
  assert.equal(res.body.redirectHost, null)
  assert.equal(res.body.skipConsent, true)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('GET authorize: unknown client and unregistered redirect are shown, never redirected', async () => {
  const { challenge } = pkce()
  const a = await request(app).get('/api/v1/oauth/authorize').query(query({ client_id: 'nope', code_challenge: challenge }))
  assert.equal(a.status, 400)
  assert.equal(a.body.error.code, 'unknown_client')
  const b = await request(app).get('/api/v1/oauth/authorize').query(query({ redirect_uri: 'https://evil.example/cb', code_challenge: challenge }))
  assert.equal(b.status, 400)
  assert.equal(b.body.error.code, 'bad_redirect_uri')
  assert.equal(b.body.error.details, undefined)
})

test('GET authorize: later problems go back to the app', async () => {
  const noPkce = await request(app).get('/api/v1/oauth/authorize').query(query())
  assert.equal(noPkce.status, 400)
  assert.equal(noPkce.body.error.code, 'redirect')
  const url = new URL(noPkce.body.error.details.redirect)
  assert.equal(url.protocol, 'com.nucleushome.todo:')
  assert.equal(url.searchParams.get('error'), 'invalid_request')
  assert.equal(url.searchParams.get('state'), 'st4te')

  const { challenge } = pkce()
  const type = await request(app).get('/api/v1/oauth/authorize').query(query({ response_type: 'token', code_challenge: challenge }))
  assert.equal(new URL(type.body.error.details.redirect).searchParams.get('error'), 'unsupported_response_type')
  const scope = await request(app).get('/api/v1/oauth/authorize').query(query({ scope: 'profile admin', code_challenge: challenge }))
  assert.equal(new URL(scope.body.error.details.redirect).searchParams.get('error'), 'invalid_scope')
})

test('cross-app scopes count only while the target exposes them', async () => {
  const { challenge } = pkce()
  const ok = await request(app).get('/api/v1/oauth/authorize')
    .query(query({ scope: 'profile send:watchlist/markWatched read:watchlist/library', code_challenge: challenge }))
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body.scopes, ['profile', 'read:watchlist/library', 'send:watchlist/markWatched'])
  assert.equal(ok.body.descriptions['read:watchlist/library'], 'See your Watchlist library')
  assert.equal(ok.body.descriptions['send:watchlist/markWatched'], 'Mark things watched in Watchlist')

  const bad = await request(app).get('/api/v1/oauth/authorize').query(query({ scope: 'read:watchlist/secrets', code_challenge: challenge }))
  assert.equal(new URL(bad.body.error.details.redirect).searchParams.get('error'), 'invalid_scope')
  const many = Array.from({ length: 51 }, (_, i) => `read:todo/v${i}`).join(' ')
  const tooMany = await request(app).get('/api/v1/oauth/authorize').query(query({ scope: many, code_challenge: challenge }))
  assert.equal(new URL(tooMany.body.error.details.redirect).searchParams.get('error'), 'invalid_scope')
})

// ── Consent page: POST ──────────────────────────────────────────────────────

test('POST authorize needs a NucleusID session', async () => {
  const { challenge } = pkce()
  const out = await request(app).post('/api/v1/oauth/authorize').send({ ...query({ code_challenge: challenge }), approve: true })
  assert.equal(out.status, 401)
  assert.equal(out.body.error.code, 'unauthorized')

  const pin = await createProfile({ name: 'Pinny', pin: '1234' })
  const agent = request.agent(app)
  await loginAs(agent, pin, '1234')
  const viaPin = await agent.post('/api/v1/oauth/authorize').send({ ...query({ code_challenge: challenge }), approve: true })
  assert.equal(viaPin.status, 403)
  assert.equal(viaPin.body.error.code, 'nid_required')
})

test('POST authorize: approve issues a code, deny redirects with access_denied', async () => {
  const { profile, cookie } = await nidUser()
  const { code, state, redirect } = await authorize(cookie)
  assert.match(code, /^nac_/)
  assert.equal(state, 'st4te')
  assert.ok(redirect.startsWith(`${REDIRECT}?`))
  const grant = await OAuthGrant.findOne({ clientId: 'todo', profileId: profile._id }).lean()
  assert.deepEqual(grant.scopes, ['data', 'profile'])
  const stored = await OAuthCode.findOne({}).lean()
  assert.notEqual(stored._id, code)

  const { challenge } = pkce()
  const deny = await request(app).post('/api/v1/oauth/authorize').set('Cookie', cookie).send({ ...query({ code_challenge: challenge }), approve: false })
  const url = new URL(deny.body.redirect)
  assert.equal(url.searchParams.get('error'), 'access_denied')
  assert.equal(url.searchParams.get('state'), 'st4te')
  assert.equal(url.searchParams.get('code'), null)
})

test('asking for more adds to the grant; consent shows only what is new', async () => {
  await OAuthClient.updateOne({ _id: 'notes' }, { trusted: false })
  const { cookie } = await nidUser()
  await authorize(cookie, { client_id: 'notes', redirect_uri: 'com.nucleushome.notes:/oauth', scope: 'profile' })
  const { challenge } = pkce()
  const res = await request(app).get('/api/v1/oauth/authorize').set('Cookie', cookie)
    .query(query({ client_id: 'notes', redirect_uri: 'com.nucleushome.notes:/oauth', scope: 'profile email', code_challenge: challenge }))
  assert.deepEqual(res.body.granted, ['profile'])
  assert.equal(res.body.skipConsent, false)
  const again = await request(app).get('/api/v1/oauth/authorize').set('Cookie', cookie)
    .query(query({ client_id: 'notes', redirect_uri: 'com.nucleushome.notes:/oauth', scope: 'profile', code_challenge: challenge }))
  assert.equal(again.body.skipConsent, true)
})

test('server key gates POST authorize: a session alone is not enough', async () => {
  await settings({ serverCode: CODE })
  const { profile, cookie } = await nidUser()
  const { challenge } = pkce()
  const body = { ...query({ code_challenge: challenge }), approve: true }
  const blocked = await request(app).post('/api/v1/oauth/authorize').set('Cookie', cookie).send(body)
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.error.code, 'server_code_required')

  const pass = `nucleus_server_code=${sign({ f: fingerprint(CODE) }, 3600, 'sc')}`
  const ok = await request(app).post('/api/v1/oauth/authorize').set('Cookie', `${cookie}; ${pass}`).send(body)
  assert.equal(ok.status, 200)
  assert.equal((await Profile.findById(profile._id).lean()).account.serverAccess, true)

  // Access sticks to the account: no cookie needed any more.
  const later = await request(app).post('/api/v1/oauth/authorize').set('Cookie', cookie).send(body)
  assert.equal(later.status, 200)
})

// ── Token endpoint ──────────────────────────────────────────────────────────

test('full PKCE flow: code → tokens → userinfo', async () => {
  const { profile, cookie } = await nidUser({ handle: 'jana' })
  const { code, verifier } = await authorize(cookie)
  const res = await token({ grant_type: 'authorization_code', code, client_id: 'todo', redirect_uri: REDIRECT, code_verifier: verifier })
  assert.equal(res.status, 200)
  assert.match(res.body.access_token, /^nat_/)
  assert.match(res.body.refresh_token, /^nrt_/)
  assert.equal(res.body.token_type, 'Bearer')
  assert.equal(res.body.expires_in, 3600)
  assert.equal(res.body.scope, 'profile data')
  assert.equal(res.headers['cache-control'], 'no-store')
  // Only hashes at rest.
  assert.equal(await OAuthToken.countDocuments({ _id: res.body.access_token }), 0)

  const me = await userinfo(res.body.access_token)
  assert.equal(me.status, 200)
  assert.deepEqual(me.body, { sub: String(profile._id), preferred_username: 'jana', name: 'Jana Nováková', appearance: null })
})

test('the code works once, for its client, redirect and verifier', async () => {
  const { cookie } = await nidUser()
  const first = await authorize(cookie)
  const ok = await token({ grant_type: 'authorization_code', code: first.code, client_id: 'todo', redirect_uri: REDIRECT, code_verifier: first.verifier })
  assert.equal(ok.status, 200)
  const again = await token({ grant_type: 'authorization_code', code: first.code, client_id: 'todo', redirect_uri: REDIRECT, code_verifier: first.verifier })
  assert.equal(again.status, 400)
  assert.equal(again.body.error, 'invalid_grant')
  assert.ok(again.body.error_description)

  const wrongVerifier = await authorize(cookie)
  const r1 = await token({ grant_type: 'authorization_code', code: wrongVerifier.code, client_id: 'todo', redirect_uri: REDIRECT, code_verifier: pkce().verifier })
  assert.equal(r1.body.error, 'invalid_grant')
  // A failed attempt burns the code too.
  const r1b = await token({ grant_type: 'authorization_code', code: wrongVerifier.code, client_id: 'todo', redirect_uri: REDIRECT, code_verifier: wrongVerifier.verifier })
  assert.equal(r1b.body.error, 'invalid_grant')

  const wrongRedirect = await authorize(cookie)
  const r2 = await token({ grant_type: 'authorization_code', code: wrongRedirect.code, client_id: 'todo', redirect_uri: 'com.nucleushome.todo:/other', code_verifier: wrongRedirect.verifier })
  assert.equal(r2.body.error, 'invalid_grant')

  const otherClient = await authorize(cookie)
  const r3 = await token({ grant_type: 'authorization_code', code: otherClient.code, client_id: 'notes', redirect_uri: REDIRECT, code_verifier: otherClient.verifier })
  assert.equal(r3.body.error, 'invalid_grant')

  const expired = await authorize(cookie)
  await OAuthCode.updateMany({}, { expiresAt: new Date(Date.now() - 1000) })
  const r4 = await token({ grant_type: 'authorization_code', code: expired.code, client_id: 'todo', redirect_uri: REDIRECT, code_verifier: expired.verifier })
  assert.equal(r4.body.error, 'invalid_grant')
})

test('two redemptions of one code at once: exactly one wins', async () => {
  const { cookie } = await nidUser()
  const { code, verifier } = await authorize(cookie)
  const body = { grant_type: 'authorization_code', code, client_id: 'todo', redirect_uri: REDIRECT, code_verifier: verifier }
  const results = await Promise.all([token(body), token(body), token(body)])
  assert.equal(results.filter(r => r.status === 200).length, 1)
})

test('token endpoint: client errors and grant types', async () => {
  const unknown = await token({ grant_type: 'authorization_code', code: 'nac_x', client_id: 'nope' })
  assert.equal(unknown.status, 401)
  assert.equal(unknown.body.error, 'invalid_client')
  assert.equal(unknown.headers['www-authenticate'], 'Basic realm="nucleus"')

  const secret = await token({ grant_type: 'authorization_code', code: 'nac_x', client_id: 'todo', client_secret: 'ncs_guess' })
  assert.equal(secret.status, 401)

  const basic = await request(app).post('/api/v1/oauth/token').set('Authorization', `Basic ${Buffer.from('todo:').toString('base64')}`)
    .type('form').send({ grant_type: 'password' })
  assert.equal(basic.status, 400)
  assert.equal(basic.body.error, 'unsupported_grant_type')

  const malformed = await request(app).post('/api/v1/oauth/token').set('Authorization', `Basic ${Buffer.from('%E0%A4%A:x').toString('base64')}`)
    .type('form').send({ grant_type: 'password' })
  assert.equal(malformed.status, 400)
})

test('token endpoint accepts JSON too', async () => {
  const { cookie } = await nidUser()
  const { code, verifier } = await authorize(cookie)
  const res = await request(app).post('/api/v1/oauth/token')
    .send({ grant_type: 'authorization_code', code, client_id: 'todo', redirect_uri: REDIRECT, code_verifier: verifier })
  assert.equal(res.status, 200)
})

// ── Refresh ─────────────────────────────────────────────────────────────────

test('refresh rotates; a retired token inside the race window just fails', async () => {
  const { cookie } = await nidUser()
  const first = await signIn(cookie)
  const next = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'todo' })
  assert.equal(next.status, 200)
  assert.notEqual(next.body.refresh_token, first.refresh_token)
  assert.equal(next.body.scope, 'profile data')

  const reuse = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'todo' })
  assert.equal(reuse.status, 400)
  assert.equal(reuse.body.error, 'invalid_grant')
  // Both the new pair and the old access token still work.
  assert.equal((await userinfo(next.body.access_token)).status, 200)
  assert.equal((await userinfo(first.access_token)).status, 200)
  const again = await token({ grant_type: 'refresh_token', refresh_token: next.body.refresh_token, client_id: 'todo' })
  assert.equal(again.status, 200)
})

test('reusing a refresh token after the race window revokes the whole grant', async () => {
  const { cookie } = await nidUser()
  const first = await signIn(cookie)
  const next = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'todo' })
  await OAuthToken.updateMany({ usedAt: { $ne: null } }, { usedAt: new Date(Date.now() - 31_000) })

  const reuse = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'todo' })
  assert.equal(reuse.body.error, 'invalid_grant')
  assert.equal((await userinfo(next.body.access_token)).status, 401)
  const stolen = await token({ grant_type: 'refresh_token', refresh_token: next.body.refresh_token, client_id: 'todo' })
  assert.equal(stolen.body.error, 'invalid_grant')
})

test('two refreshes at once: exactly one wins', async () => {
  const { cookie } = await nidUser()
  const first = await signIn(cookie)
  const body = { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'todo' }
  const results = await Promise.all([token(body), token(body), token(body)])
  assert.equal(results.filter(r => r.status === 200).length, 1)
})

test('parallel refreshes in one process: the usedAt compare-and-set lets one through', async () => {
  const { cookie } = await nidUser()
  const first = await signIn(cookie)
  const results = await Promise.all(Array.from({ length: 5 }, () => refresh({ refreshToken: first.refresh_token, clientId: 'todo' })))
  assert.equal(results.filter(r => typeof r !== 'string').length, 1)
  assert.equal(await OAuthToken.countDocuments({ kind: 'refresh' }), 2)
})

test('refresh token of another client or expired is refused', async () => {
  const { cookie } = await nidUser()
  const first = await signIn(cookie)
  const other = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'notes' })
  assert.equal(other.body.error, 'invalid_grant')
  // Refusing for the wrong client must not retire it.
  const ok = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'todo' })
  assert.equal(ok.status, 200)

  await OAuthToken.updateMany({ kind: 'refresh' }, { expiresAt: new Date(Date.now() - 1000) })
  const expired = await token({ grant_type: 'refresh_token', refresh_token: ok.body.refresh_token, client_id: 'todo' })
  assert.equal(expired.body.error, 'invalid_grant')
})

test('refresh tokens live 90 days, access tokens an hour', async () => {
  const { cookie } = await nidUser()
  await signIn(cookie)
  const access = await OAuthToken.findOne({ kind: 'access' }).lean()
  const refresh = await OAuthToken.findOne({ kind: 'refresh' }).lean()
  const day = 86400_000
  assert.ok(Math.abs(access.expiresAt - Date.now() - 3600_000) < 5000)
  assert.ok(Math.abs(refresh.expiresAt - Date.now() - 90 * day) < 5000)
})

// ── Revoke, userinfo, appearance ────────────────────────────────────────────

test('revoke is always 200; revoking the refresh token signs the device out', async () => {
  const { cookie } = await nidUser()
  const s = await signIn(cookie)
  const unknown = await request(app).post('/api/v1/oauth/revoke').type('form').send({ token: 'nrt_nothing', client_id: 'todo' })
  assert.equal(unknown.status, 200)
  const wrongClient = await request(app).post('/api/v1/oauth/revoke').type('form').send({ token: s.refresh_token, client_id: 'notes' })
  assert.equal(wrongClient.status, 200)
  assert.equal((await userinfo(s.access_token)).status, 200)

  const res = await request(app).post('/api/v1/oauth/revoke').type('form').send({ token: s.refresh_token, client_id: 'todo' })
  assert.equal(res.status, 200)
  assert.equal((await userinfo(s.access_token)).status, 401)
  const r = await token({ grant_type: 'refresh_token', refresh_token: s.refresh_token, client_id: 'todo' })
  assert.equal(r.body.error, 'invalid_grant')
})

test('userinfo: bearer errors and the email scope', async () => {
  const none = await request(app).get('/api/v1/oauth/userinfo')
  assert.equal(none.status, 401)
  assert.equal(none.headers['www-authenticate'], 'Bearer realm="nucleus"')
  const bad = await userinfo('nat_bogus')
  assert.equal(bad.status, 401)
  assert.equal(bad.headers['www-authenticate'], 'Bearer realm="nucleus", error="invalid_token"')

  const { profile, cookie } = await nidUser({ handle: 'mail' })
  const s = await signIn(cookie, { scope: 'profile email data' })
  const me = await userinfo(s.access_token)
  assert.equal(me.body.email, 'mail@example.org')
  assert.equal(me.body.email_verified, true)
  assert.equal(me.body.sub, String(profile._id))

  await OAuthToken.updateMany({ kind: 'access' }, { expiresAt: new Date(Date.now() - 1000) })
  assert.equal((await userinfo(s.access_token)).status, 401)
})

test('a deleted profile’s token stops working', async () => {
  const { profile, cookie } = await nidUser()
  const s = await signIn(cookie)
  await Profile.deleteOne({ _id: profile._id })
  assert.equal((await userinfo(s.access_token)).status, 401)
})

test('PUT appearance sets the account theme', async () => {
  const { profile, cookie } = await nidUser()
  const s = await signIn(cookie)
  const put = (body) => request(app).put('/api/v1/oauth/appearance').set('Authorization', `Bearer ${s.access_token}`).send(body)

  const res = await put({ appearance: { accent: 'custom', customAccent: '#3366ff' }, applyToApps: true })
  assert.equal(res.status, 200)
  assert.equal(res.body.appearance.accent, 'custom')
  assert.equal(res.body.appearance.customAccent, '#3366FF')
  assert.ok(res.body.appearance.appliedAt)
  const stored = (await Profile.findById(profile._id).lean()).account.appearance
  assert.equal(stored.accent, 'custom')

  const keep = await put({ appearance: { accent: 'ember' } })
  assert.equal(keep.body.appearance.accent, 'ember')
  assert.equal(keep.body.appearance.customAccent, undefined)
  assert.equal(keep.body.appearance.appliedAt, res.body.appearance.appliedAt)

  const bad = await put({ appearance: { accent: 'pink' } })
  assert.equal(bad.status, 422)
  assert.equal(bad.body.error.code, 'invalid')

  const reset = await put({ appearance: null })
  assert.equal(reset.body.appearance, null)
  assert.equal((await userinfo(s.access_token)).body.appearance, null)

  const anon = await request(app).put('/api/v1/oauth/appearance').send({ appearance: null })
  assert.equal(anon.status, 401)
})

// ── Account: connected apps, logout-all, delete ─────────────────────────────

test('connected apps: list and disconnect', async () => {
  const { cookie } = await nidUser()
  const s = await signIn(cookie)
  const list = await request(app).get('/api/auth/nid/apps').set('Cookie', cookie)
  assert.equal(list.status, 200)
  assert.equal(list.body.apps.length, 1)
  assert.equal(list.body.apps[0].clientId, 'todo')
  assert.equal(list.body.apps[0].name, 'Todo')
  assert.deepEqual(list.body.apps[0].scopes, ['data', 'profile'])
  assert.ok(list.body.apps[0].lastUsedAt)

  const del = await request(app).delete('/api/auth/nid/apps/todo').set('Cookie', cookie)
  assert.equal(del.status, 204)
  assert.equal((await userinfo(s.access_token)).status, 401)
  assert.equal(await OAuthGrant.countDocuments(), 0)
  assert.equal(await OAuthToken.countDocuments(), 0)
  const missing = await request(app).delete('/api/auth/nid/apps/todo').set('Cookie', cookie)
  assert.equal(missing.status, 404)
  assert.equal((await request(app).get('/api/auth/nid/apps')).status, 401)
})

test('logout-all signs every app out too', async () => {
  const { cookie } = await nidUser()
  const s = await signIn(cookie)
  const res = await request(app).post('/api/auth/nid/logout-all').set('Cookie', cookie)
  assert.equal(res.status, 204)
  assert.equal((await userinfo(s.access_token)).status, 401)
  assert.equal(await OAuthGrant.countDocuments(), 0)
})

test('deleting the account revokes its app tokens', async () => {
  await createProfile({ name: 'Admin', role: 'admin' })
  const { cookie } = await nidUser()
  const s = await signIn(cookie)
  const res = await request(app).delete('/api/auth/nid/account').set('Cookie', cookie).send({ password: PW })
  assert.equal(res.status, 204)
  assert.equal((await userinfo(s.access_token)).status, 401)
  assert.equal(await OAuthToken.countDocuments(), 0)
  assert.equal(await OAuthGrant.countDocuments(), 0)
})

// ── Admin ───────────────────────────────────────────────────────────────────

test('admin lists clients and toggles trusted', async () => {
  const { cookie: admin } = await nidUser({ role: 'admin' })
  const { cookie: user } = await nidUser()
  await signIn(user)

  assert.equal((await request(app).get('/api/auth/settings/clients').set('Cookie', user)).status, 403)
  const list = await request(app).get('/api/auth/settings/clients').set('Cookie', admin)
  assert.equal(list.status, 200)
  const todo = list.body.find(c => c.id === 'todo')
  assert.equal(todo.name, 'Todo')
  assert.deepEqual(todo.redirectUris, [REDIRECT])
  assert.equal(todo.trusted, true)
  assert.equal(todo.connectedAccounts, 1)
  assert.deepEqual(todo.exposes, ['view:lists', 'command:setDone', 'command:addTask'])
  assert.equal(list.body.find(c => c.id === 'notes').connectedAccounts, 0)

  const patched = await request(app).patch('/api/auth/settings/clients/todo').set('Cookie', admin).send({ trusted: false })
  assert.equal(patched.status, 200)
  assert.equal(patched.body.trusted, false)
  assert.equal((await OAuthClient.findById('todo').lean()).trusted, false)
  assert.equal((await request(app).patch('/api/auth/settings/clients/todo').set('Cookie', admin).send({ trusted: 'yes' })).status, 400)
  assert.equal((await request(app).patch('/api/auth/settings/clients/nope').set('Cookie', admin).send({ trusted: true })).status, 404)
})
