import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import request from 'supertest'
import { startDb, stopDb, makeApp, createProfile, loginAsNid } from './helpers.js'
import AuthSettings, { invalidateSettings } from '../models/AuthSettings.js'
import Profile from '../models/Profile.js'
import Session from '../models/Session.js'
import { OAuthClient, OAuthGrant, OAuthCode, OAuthToken } from '../models/OAuth.js'
import { seedClients } from '../lib/oauth.js'

const REDIRECT = 'com.nucleushome.todo:/oauth'

let app
let cookie

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
  const profile = await createProfile({
    name: 'Origin Test',
    account: { handle: 'orig', handleLower: 'orig', email: 'o@example.org', emailLower: 'o@example.org', emailVerifiedAt: new Date(), identities: [] },
  })
  cookie = await loginAsNid(profile)
})

function body() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return {
    response_type: 'code', client_id: 'todo', redirect_uri: REDIRECT, scope: 'profile data', state: 's',
    code_challenge: challenge, code_challenge_method: 'S256', approve: true,
  }
}

const authorize = (headers) => {
  let r = request(app).post('/api/v1/oauth/authorize').set('Cookie', cookie).set('Host', 'nas.local')
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v)
  return r.send(body())
}

// ── Same-origin guard ───────────────────────────────────────────────────────

test('a cross-origin page cannot mint a code with the session', async () => {
  for (const origin of ['https://evil.example', 'http://nas.local:8888', 'http://sub.nas.local', 'http://192.168.1.9']) {
    const res = await authorize({ Origin: origin })
    assert.equal(res.status, 403, origin)
    assert.equal(res.body.error.code, 'cross_origin')
    assert.equal(res.body.redirect, undefined)
  }
  assert.equal(await OAuthCode.countDocuments(), 0)
})

test('an opaque origin (sandboxed frame, file://) cannot write', async () => {
  const res = await authorize({ Origin: 'null' })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'cross_origin')
  assert.equal(await OAuthCode.countDocuments(), 0)
})

test('same-origin writes pass, with or without a known scheme', async () => {
  assert.equal((await authorize({ Origin: 'http://nas.local' })).status, 200)
  // nginx doesn't always say which scheme the browser used; host and port still have to match.
  assert.equal((await authorize({ Origin: 'https://nas.local' })).status, 200)
  assert.equal((await authorize({ Origin: 'https://nas.local', 'X-Forwarded-Proto': 'https' })).status, 200)
  assert.equal((await authorize({ Origin: 'http://nas.local', 'X-Forwarded-Proto': 'https' })).status, 403)
  assert.equal((await authorize({ Origin: 'http://nas.local:8080', 'X-Forwarded-Host': 'nas.local:8080' })).status, 200)
  assert.equal((await authorize({})).status, 200)
})

test('the configured public origin is accepted too', async () => {
  await AuthSettings.updateOne({ _id: 'auth' }, { $set: { publicOrigin: 'https://home.example.org' } }, { upsert: true })
  invalidateSettings()
  assert.equal((await authorize({ Origin: 'https://home.example.org' })).status, 200)
})

test('without Origin, Sec-Fetch-Site decides', async () => {
  assert.equal((await authorize({ 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await authorize({ 'Sec-Fetch-Site': 'same-site' })).status, 403)
  assert.equal((await authorize({ 'Sec-Fetch-Site': 'same-origin' })).status, 200)
  assert.equal((await authorize({ 'Sec-Fetch-Site': 'none' })).status, 200)
})

test('/api/auth writes are guarded in their own error shape; reads are not', async () => {
  const res = await request(app).post('/api/auth/nid/login').set('Host', 'nas.local').set('Origin', 'http://nas.local:8888')
    .send({ email: 'o@example.org', password: 'x' })
  assert.equal(res.status, 403)
  assert.equal(res.body.code, 'cross_origin')
  assert.equal(typeof res.body.error, 'string')

  const read = await request(app).get('/api/auth/settings/public').set('Host', 'nas.local').set('Origin', 'https://evil.example')
  assert.equal(read.status, 200)
})

test('native app and provider endpoints are exempt', async () => {
  const token = await request(app).post('/api/v1/oauth/token').set('Origin', 'https://evil.example').type('form')
    .send({ grant_type: 'refresh_token', refresh_token: 'nrt_x', client_id: 'todo' })
  assert.equal(token.status, 400)
  assert.equal(token.body.error, 'invalid_grant')
  const native = await request(app).post('/api/v1/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: 'nrt_x', client_id: 'todo' })
  assert.equal(native.body.error, 'invalid_grant')
  const revoke = await request(app).post('/api/v1/oauth/revoke').set('Sec-Fetch-Site', 'cross-site').type('form').send({ token: 'x', client_id: 'todo' })
  assert.equal(revoke.status, 200)
  const apple = await request(app).post('/api/auth/nid/sso/apple/callback').set('Origin', 'https://appleid.apple.com')
    .set('Sec-Fetch-Site', 'cross-site').type('form').send({ state: 'x', code: 'y' })
  assert.notEqual(apple.status, 403)
})

// ── CORS ────────────────────────────────────────────────────────────────────

test('app endpoints answer any origin without credentials', async () => {
  for (const path of ['/api/v1/oauth/metadata', '/api/v1/oauth/userinfo', '/api/v1/auth/server-code']) {
    const res = await request(app).get(path).set('Origin', 'https://web.example')
    assert.equal(res.headers['access-control-allow-origin'], '*', path)
    assert.equal(res.headers['access-control-allow-credentials'], undefined, path)
  }
  const pre = await request(app).options('/api/v1/oauth/token').set('Origin', 'https://web.example').set('Access-Control-Request-Method', 'POST')
  assert.equal(pre.status, 204)
  assert.equal(pre.headers['access-control-allow-origin'], '*')
  assert.match(pre.headers['access-control-allow-methods'], /POST/)
  const revoke = await request(app).post('/api/v1/oauth/revoke').set('Origin', 'https://web.example').type('form').send({ token: 'x', client_id: 'todo' })
  assert.equal(revoke.headers['access-control-allow-origin'], '*')
})

test('everything else gets no CORS headers', async () => {
  for (const path of ['/api/auth/me', '/api/auth/settings/public', '/api/v1/oauth/authorize']) {
    const res = await request(app).get(path).set('Origin', 'https://evil.example').set('Cookie', cookie)
    assert.equal(res.headers['access-control-allow-origin'], undefined, path)
    assert.equal(res.headers['access-control-allow-credentials'], undefined, path)
  }
  const post = await request(app).post('/api/v1/auth/server-code').set('Origin', 'https://evil.example').send({ code: 'x' })
  assert.equal(post.headers['access-control-allow-origin'], undefined)
})
