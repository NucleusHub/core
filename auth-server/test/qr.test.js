import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import request from 'supertest'
import {
  ID, TTL_MS, appPayload, claim, cleanDevice, decide, describeBrowser, hashSecret, newId, newSecret,
  pickup, scan, statusAt, watch, webPayload,
} from '../lib/qr.js'
import { startDb, stopDb, makeApp, createProfile, loginAsNid } from './helpers.js'
import AuthSettings, { invalidateSettings } from '../models/AuthSettings.js'
import Profile from '../models/Profile.js'
import Session from '../models/Session.js'
import QrLogin from '../models/QrLogin.js'
import { OAuthClient, OAuthGrant, OAuthCode, OAuthToken } from '../models/OAuth.js'
import { seedClients, approve, redeemCode } from '../lib/oauth.js'
import { hashPassword } from '../lib/password.js'

const T0 = new Date('2026-10-12T10:00:00Z')
const at = (ms) => new Date(T0.getTime() + ms)
const ALICE = 'alice'
const BOB = 'bob'
const SECRET = 'the-secret'
const TODO = { _id: 'todo', trusted: true }
const NOTES = { _id: 'notes', trusted: true }
const OTHER = { _id: 'other', trusted: false }

const row = (fields = {}) => ({
  id: newId(),
  kind: 'web',
  status: 'pending',
  authorId: null,
  secretHash: hashSecret(SECRET),
  device: 'Safari on macOS',
  createdAt: T0,
  expiresAt: at(TTL_MS),
  ...fields,
})
const apply = (r, patch) => ({ ...r, ...patch })
const throwsStatus = (fn, status) => assert.throws(fn, (error) => error.status === status)

test('ids and secrets are long, random and url-safe', () => {
  assert.match(newId(), ID)
  assert.ok(newId().length >= 22)
  assert.notEqual(newSecret(), newSecret())
  assert.match(hashSecret('x'), /^[0-9a-f]{64}$/)
})

test('web: scan → approve → pickup signs in once', () => {
  let r = row()
  r = apply(r, scan(r, { authorId: ALICE, client: TODO, now: at(1000) }))
  assert.equal(r.status, 'scanned')
  assert.equal(r.authorId, ALICE)
  assert.deepEqual(pickup(r, { secret: SECRET, now: at(2000) }), { status: 'scanned' })

  r = apply(r, decide(r, { authorId: ALICE, via: 'bearer', client: TODO, approve: true, now: at(3000) }))
  assert.equal(r.status, 'approved')

  const first = pickup(r, { secret: SECRET, now: at(4000) })
  assert.deepEqual(first, { patch: { status: 'used' }, status: 'signed-in' })
  r = apply(r, first.patch)
  assert.deepEqual(pickup(r, { secret: SECRET, now: at(5000) }), { status: 'expired' })
})

test('web: pending and denied are what the browser sees', () => {
  let r = row()
  assert.deepEqual(pickup(r, { secret: SECRET, now: at(0) }), { status: 'pending' })
  r = apply(r, scan(r, { authorId: ALICE, client: TODO, now: at(0) }))
  r = apply(r, decide(r, { authorId: ALICE, via: 'bearer', client: TODO, approve: false, now: at(0) }))
  assert.equal(r.status, 'denied')
  assert.deepEqual(pickup(r, { secret: SECRET, now: at(0) }), { status: 'denied' })
  throwsStatus(() => decide(r, { authorId: ALICE, via: 'bearer', client: TODO, approve: true, now: at(0) }), 409)
})

test('web: a second scan is refused', () => {
  let r = row()
  r = apply(r, scan(r, { authorId: ALICE, client: TODO, now: at(0) }))
  throwsStatus(() => scan(r, { authorId: BOB, client: TODO, now: at(0) }), 409)
  throwsStatus(() => scan(r, { authorId: ALICE, client: TODO, now: at(0) }), 409)
})

test('web: approve before scan, by another account, or by the website is refused', () => {
  const pending = row()
  throwsStatus(() => decide(pending, { authorId: ALICE, via: 'bearer', client: TODO, approve: true, now: at(0) }), 409)
  const scanned = apply(pending, scan(pending, { authorId: ALICE, client: TODO, now: at(0) }))
  throwsStatus(() => decide(scanned, { authorId: BOB, via: 'bearer', client: TODO, approve: true, now: at(0) }), 404)
  throwsStatus(() => decide(scanned, { authorId: ALICE, via: 'session', approve: true, now: at(0) }), 401)
})

test('web: a wrong or missing secret looks like an unknown request', () => {
  const r = apply(row(), { status: 'approved', authorId: ALICE })
  for (const secret of ['nope', '', undefined, 42]) throwsStatus(() => pickup(r, { secret, now: at(0) }), 404)
  throwsStatus(() => pickup(null, { secret: SECRET, now: at(0) }), 404)
})

test('nothing works after expiry, and an approved request expires too', () => {
  const late = at(TTL_MS)
  const pending = row()
  throwsStatus(() => scan(pending, { authorId: ALICE, client: TODO, now: late }), 404)
  const scanned = apply(pending, { status: 'scanned', authorId: ALICE })
  throwsStatus(() => decide(scanned, { authorId: ALICE, via: 'bearer', client: TODO, approve: true, now: late }), 404)
  const approved = apply(scanned, { status: 'approved' })
  assert.deepEqual(pickup(approved, { secret: SECRET, now: late }), { status: 'expired' })
  assert.deepEqual(pickup(pending, { secret: SECRET, now: late }), { status: 'expired' })
  assert.equal(statusAt(approved, at(TTL_MS - 1)), 'approved')
  assert.equal(statusAt(apply(pending, { status: 'denied' }), late), 'denied')
})

test('kinds do not mix', () => {
  throwsStatus(() => scan(row({ kind: 'app', authorId: ALICE }), { authorId: ALICE, client: TODO, now: at(0) }), 404)
  throwsStatus(() => claim(row(), { client: TODO, now: at(0) }), 404)
  throwsStatus(() => watch(row({ authorId: ALICE }), { authorId: ALICE, now: at(0) }), 404)
})

test('app: claim → approve on the website → pickup', () => {
  let r = row({ kind: 'app', authorId: ALICE, secretHash: hashSecret('never-handed-out') })
  assert.equal(watch(r, { authorId: ALICE, now: at(0) }), 'pending')
  throwsStatus(() => pickup(r, { secret: SECRET, now: at(0) }), 404)

  r = apply(r, { ...claim(r, { client: TODO, now: at(1000) }), secretHash: hashSecret(SECRET) })
  assert.equal(r.status, 'scanned')
  assert.equal(watch(r, { authorId: ALICE, now: at(1000) }), 'scanned')
  assert.deepEqual(pickup(r, { secret: SECRET, now: at(1000) }), { status: 'scanned' })

  r = apply(r, decide(r, { authorId: ALICE, via: 'session', approve: true, now: at(2000) }))
  const first = pickup(r, { secret: SECRET, now: at(3000) })
  assert.equal(first.status, 'signed-in')
  r = apply(r, first.patch)
  assert.equal(watch(r, { authorId: ALICE, now: at(3000) }), 'used')
  assert.deepEqual(pickup(r, { secret: SECRET, now: at(3000) }), { status: 'expired' })
})

test('app: a second claim, another account, an app token, or approving before the claim is refused', () => {
  const pending = row({ kind: 'app', authorId: ALICE })
  throwsStatus(() => decide(pending, { authorId: ALICE, via: 'session', approve: true, now: at(0) }), 409)
  const claimed = apply(pending, claim(pending, { client: TODO, now: at(0) }))
  throwsStatus(() => claim(claimed, { client: TODO, now: at(0) }), 409)
  throwsStatus(() => decide(claimed, { authorId: BOB, via: 'session', approve: true, now: at(0) }), 404)
  throwsStatus(() => decide(claimed, { authorId: ALICE, via: 'bearer', client: TODO, approve: true, now: at(0) }), 401)
  throwsStatus(() => watch(claimed, { authorId: BOB, now: at(0) }), 404)
  throwsStatus(() => claim(pending, { client: TODO, now: at(TTL_MS) }), 404)
})

test('the web payload carries the server but never its code', () => {
  const id = newId()
  assert.deepEqual(JSON.parse(webPayload({ id, origin: 'https://id.example.com' })), {
    login: id, kind: 'web', scheme: 'https', host: 'id.example.com',
  })
  assert.deepEqual(JSON.parse(webPayload({ id, origin: 'http://192.168.1.5:8443' })), {
    login: id, kind: 'web', scheme: 'http', host: '192.168.1.5', port: 8443,
  })
  assert.ok(!('code' in JSON.parse(webPayload({ id, origin: 'https://a.b' }))))
})

test('the app payload carries the code when there is one', () => {
  const id = newId()
  const code = 'nucleus' + 'a'.repeat(32) + 'home'
  assert.deepEqual(JSON.parse(appPayload({ id, origin: 'https://id.example.com:8443', code })), {
    login: id, kind: 'app', scheme: 'https', host: 'id.example.com', port: 8443, code,
  })
  assert.deepEqual(JSON.parse(appPayload({ id, origin: 'https://id.example.com', code: null })), {
    login: id, kind: 'app', scheme: 'https', host: 'id.example.com',
  })
})

test('browsers are described for the approve prompt', () => {
  const cases = [
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0', 'Edge on Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1', 'Chrome on iOS'],
    ['curl/8.4.0', 'A web browser'],
    ['', 'A web browser'],
  ]
  for (const [ua, expected] of cases) assert.equal(describeBrowser(ua), expected, ua)
})

test('only trusted apps may scan, claim or approve with a token', () => {
  const pending = row()
  throwsStatus(() => scan(pending, { authorId: ALICE, client: OTHER, now: at(0) }), 403)
  throwsStatus(() => scan(pending, { authorId: ALICE, client: null, now: at(0) }), 403)
  assert.throws(() => scan(pending, { authorId: ALICE, client: OTHER, now: at(0) }), (e) => e.code === 'untrusted_client')
  throwsStatus(() => claim(row({ kind: 'app', authorId: ALICE }), { client: OTHER, now: at(0) }), 403)

  const scanned = apply(pending, scan(pending, { authorId: ALICE, client: TODO, now: at(0) }))
  assert.equal(scanned.scannerClientId, 'todo')
  throwsStatus(() => decide(scanned, { authorId: ALICE, via: 'bearer', client: OTHER, approve: true, now: at(0) }), 403)
})

test('only the app that scanned may approve', () => {
  const pending = row()
  const scanned = apply(pending, scan(pending, { authorId: ALICE, client: TODO, now: at(0) }))
  throwsStatus(() => decide(scanned, { authorId: ALICE, via: 'bearer', client: NOTES, approve: true, now: at(0) }), 404)
  assert.deepEqual(decide(scanned, { authorId: ALICE, via: 'bearer', client: TODO, approve: true, now: at(0) }), { status: 'approved' })
})

test('device names are plain text, or the app name', () => {
  assert.equal(cleanDevice('  iPhone   16\tPro ', 'Todo'), 'iPhone 16 Pro')
  assert.equal(cleanDevice('Honza’s iPad (2)', 'Todo'), 'Honza’s iPad (2)')
  assert.equal(cleanDevice('Žluťoučký telefon', 'Todo'), 'Žluťoučký telefon')
  assert.equal(cleanDevice('a'.repeat(80), 'Todo'), 'a'.repeat(60))
  for (const bad of ['<script>', 'Approve: yes!', 'x\u202Ey', '', '   ', undefined, 42, 'https://evil'])
    assert.equal(cleanDevice(bad, 'Todo'), 'Todo', String(bad))
})

// ── HTTP: the whole protocol against a real app ──────────────────────────────

const REDIRECT = 'com.nucleushome.todo:/oauth'
const CODE = 'nucleus' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6' + 'home'
let app

before(startDb)
after(stopDb)
beforeEach(async () => {
  await Promise.all([
    Profile.deleteMany({}), Session.deleteMany({}), AuthSettings.deleteMany({}), QrLogin.deleteMany({}),
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

async function nidUser(serverAccess = false) {
  const handle = `u${Math.random().toString(36).slice(2, 8)}`
  const email = `${handle}@example.org`
  const profile = await createProfile({
    name: 'Jana', role: 'user',
    account: { handle, handleLower: handle, email, emailLower: email, emailVerifiedAt: new Date(), passwordHash: await hashPassword('correct horse battery'), serverAccess, identities: [] },
  })
  return { profile, cookie: await loginAsNid(profile) }
}

const pkce = () => createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url')

async function bearerFor(profile, clientId = 'todo') {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const code = await approve({ clientId, profileId: profile._id, scopes: ['profile'], redirectUri: REDIRECT, codeChallenge: challenge })
  const tokens = await redeemCode({ code, clientId, redirectUri: REDIRECT, verifier })
  return `Bearer ${tokens.accessToken}`
}

const claimBody = (over = {}) => ({
  client_id: 'todo', redirect_uri: REDIRECT, scope: 'profile data', code_challenge: pkce(), code_challenge_method: 'S256', device: 'iPhone 16', ...over,
})

test('http web: create → scan → approve → poll signs the browser in once', async () => {
  const { profile } = await nidUser()
  const bearer = await bearerFor(profile)
  const created = await request(app).post('/api/v1/auth/qr/web').set('Host', 'id.example.com').set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/18 Safari/605')
  assert.equal(created.status, 201)
  const { id, secret, qr } = created.body
  assert.match(id, ID)
  assert.deepEqual(JSON.parse(qr), { login: id, kind: 'web', scheme: 'http', host: 'id.example.com' })
  const base = `/api/v1/auth/qr/${id}`

  assert.deepEqual((await request(app).post(`${base}/poll`).send({ secret })).body, { status: 'pending' })
  const scanned = await request(app).post(`${base}/scan`).set('Authorization', bearer)
  assert.equal(scanned.status, 200)
  assert.equal(scanned.body.device, 'Safari on macOS')
  assert.equal((await request(app).post(`${base}/scan`).set('Authorization', bearer)).status, 409)
  assert.equal((await request(app).post(`${base}/approve`).set('Authorization', bearer).send({ approve: true })).status, 204)

  const polled = await request(app).post(`${base}/poll`).send({ secret })
  assert.deepEqual(polled.body, { status: 'signed-in' })
  const cookie = polled.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ')
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200)
  assert.deepEqual((await request(app).post(`${base}/poll`).send({ secret })).body, { status: 'expired' })
})

test('http web: wrong secret, bad id, missing token, untrusted client', async () => {
  const { profile } = await nidUser()
  const { body } = await request(app).post('/api/v1/auth/qr/web')
  const base = `/api/v1/auth/qr/${body.id}`
  assert.equal((await request(app).post(`${base}/poll`).send({ secret: 'nope' })).status, 404)
  assert.equal((await request(app).post('/api/v1/auth/qr/short/poll').send({ secret: 'x' })).status, 404)
  assert.equal((await request(app).post(`${base}/scan`)).status, 401)
  await OAuthClient.updateOne({ _id: 'todo' }, { $set: { trusted: false } })
  const res = await request(app).post(`${base}/scan`).set('Authorization', await bearerFor(profile))
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'untrusted_client')
})

test('http web: expired requests are 404', async () => {
  const { profile } = await nidUser()
  const { body } = await request(app).post('/api/v1/auth/qr/web')
  await QrLogin.updateOne({ _id: body.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
  const res = await request(app).post(`/api/v1/auth/qr/${body.id}/scan`).set('Authorization', await bearerFor(profile))
  assert.equal(res.status, 404)
  assert.deepEqual((await request(app).post(`/api/v1/auth/qr/${body.id}/poll`).send({ secret: body.secret })).body, { status: 'expired' })
})

test('http web: denied is what the browser sees', async () => {
  const { profile } = await nidUser()
  const bearer = await bearerFor(profile)
  const { body } = await request(app).post('/api/v1/auth/qr/web')
  const base = `/api/v1/auth/qr/${body.id}`
  await request(app).post(`${base}/scan`).set('Authorization', bearer)
  assert.equal((await request(app).post(`${base}/approve`).set('Authorization', bearer).send({ approve: false })).status, 204)
  assert.deepEqual((await request(app).post(`${base}/poll`).send({ secret: body.secret })).body, { status: 'denied' })
  assert.equal((await request(app).post(`${base}/approve`).set('Authorization', bearer).send({ approve: 'yes' })).status, 400)
})

test('http app: create → claim → watch → approve → poll returns a redeemable code', async () => {
  const { profile, cookie } = await nidUser()
  await settings({ serverCode: CODE })
  await AuthSettings.updateOne({ _id: 'auth' }, {})
  await Profile.updateOne({ _id: profile._id }, { $set: { 'account.serverAccess': true } })
  const created = await request(app).post('/api/v1/auth/qr/app').set('Cookie', cookie)
  assert.equal(created.status, 201)
  const { id, qr } = created.body
  assert.equal(JSON.parse(qr).kind, 'app')
  assert.equal(JSON.parse(qr).code, CODE)
  const base = `/api/v1/auth/qr/${id}`

  assert.equal((await request(app).get(base).set('Cookie', cookie)).body.status, 'pending')
  const challenge = pkce()
  const claimed = await request(app).post(`${base}/claim`).send(claimBody({ code_challenge: challenge }))
  assert.equal(claimed.status, 200)
  assert.equal((await request(app).post(`${base}/claim`).send(claimBody())).status, 409)

  const watched = await request(app).get(base).set('Cookie', cookie)
  assert.deepEqual(watched.body, { status: 'scanned', client: { id: 'todo', name: 'Todo' }, device: 'iPhone 16' })
  assert.deepEqual((await request(app).post(`${base}/poll`).send({ secret: claimed.body.secret })).body, { status: 'scanned' })
  assert.equal((await request(app).post(`${base}/approve`).set('Cookie', cookie).send({ approve: true })).status, 204)

  const polled = await request(app).post(`${base}/poll`).send({ secret: claimed.body.secret })
  assert.equal(polled.body.status, 'signed-in')
  assert.equal(polled.body.redirect_uri, REDIRECT)
  assert.match(polled.body.code, /^nac_/)
  assert.equal((await request(app).post(`${base}/poll`).send({ secret: claimed.body.secret })).body.status, 'expired')
})

test('http app: needs a NucleusID session and server access; payload has no code when none is set', async () => {
  assert.equal((await request(app).post('/api/v1/auth/qr/app')).status, 401)
  const { cookie } = await nidUser()
  const open = await request(app).post('/api/v1/auth/qr/app').set('Cookie', cookie)
  assert.equal(open.status, 201)
  assert.ok(!('code' in JSON.parse(open.body.qr)))
  await settings({ serverCode: CODE })
  const res = await request(app).post('/api/v1/auth/qr/app').set('Cookie', cookie)
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'server_code_required')
})

test('http app: the website cannot be watched or approved by another account, or by an app token', async () => {
  const alice = await nidUser()
  const bob = await nidUser()
  const { body } = await request(app).post('/api/v1/auth/qr/app').set('Cookie', alice.cookie)
  const base = `/api/v1/auth/qr/${body.id}`
  assert.equal((await request(app).get(base).set('Cookie', bob.cookie)).status, 404)
  await request(app).post(`${base}/claim`).send(claimBody())
  assert.equal((await request(app).post(`${base}/approve`).set('Cookie', bob.cookie).send({ approve: true })).status, 404)
  assert.equal((await request(app).post(`${base}/approve`).set('Authorization', await bearerFor(alice.profile)).send({ approve: true })).status, 401)
})

test('http: claim validates the client and redirect', async () => {
  const { cookie } = await nidUser()
  const { body } = await request(app).post('/api/v1/auth/qr/app').set('Cookie', cookie)
  const base = `/api/v1/auth/qr/${body.id}`
  assert.equal((await request(app).post(`${base}/claim`).send(claimBody({ client_id: 'nope' }))).status, 400)
  assert.equal((await request(app).post(`${base}/claim`).send(claimBody({ redirect_uri: 'evil:/x' }))).status, 400)
  assert.equal((await request(app).post(`${base}/claim`).send(claimBody({ code_challenge: 'short' }))).status, 400)
})

test('http web: the payload host comes from publicOrigin when set', async () => {
  await settings({ publicOrigin: 'https://id.example.org:8443' })
  const { body } = await request(app).post('/api/v1/auth/qr/web').set('Host', 'evil.test')
  assert.deepEqual(JSON.parse(body.qr), { login: body.id, kind: 'web', scheme: 'https', host: 'id.example.org', port: 8443 })
})

test('http web: gated by the server code when one is set', async () => {
  await settings({ serverCode: CODE })
  const res = await request(app).post('/api/v1/auth/qr/web')
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'server_code_required')
})
