import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import mongoose from 'mongoose'
import { startDb, stopDb, makeApp, createProfile, loginAs } from './helpers.js'
import { isServerCode, generateServerCode, sameCode, fingerprint, sign, unsign } from '../lib/serverCode.js'
import AuthSettings, { invalidateSettings } from '../models/AuthSettings.js'
import Profile from '../models/Profile.js'

const GOOD = 'nucleus' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6' + 'home'
const COOKIE = 'nucleus_server_code'

let app

before(async () => {
  await startDb()
  app = makeApp()
})
after(stopDb)
beforeEach(() => setCode(null))

async function setCode(code) {
  await AuthSettings.updateOne({ _id: 'auth' }, { $set: { serverCode: code } }, { upsert: true })
  invalidateSettings()
}

const passCookie = (res) => (res.headers['set-cookie'] || []).find(c => c.startsWith(`${COOKIE}=`))
const sessionCookie = (res) => (res.headers['set-cookie'] || []).find(c => c.startsWith('nucleus_token='))?.split(';')[0]

test('code format, generation, comparison and fingerprint', () => {
  assert.equal(isServerCode(GOOD), true)
  for (const bad of [undefined, null, 42, '', GOOD.replace('nucleus', 'Nucleus'), 'nucleus' + 'a'.repeat(33) + 'home', ` ${GOOD}`])
    assert.equal(isServerCode(bad), false, String(bad))
  const a = generateServerCode()
  assert.equal(isServerCode(a), true)
  assert.notEqual(a, generateServerCode())
  assert.equal(sameCode(GOOD, GOOD), true)
  assert.equal(sameCode(GOOD, 'short'), false)
  assert.notEqual(fingerprint(GOOD), fingerprint(a))
  assert.equal(fingerprint(GOOD).includes(GOOD), false)
})

test('signed values round-trip, reject tampering and expire', () => {
  const s = sign({ f: 'x' }, 60)
  assert.equal(unsign(s).f, 'x')
  const [payload, mac] = s.split('.')
  const forged = Buffer.from(JSON.stringify({ f: 'y', exp: Date.now() + 60000 })).toString('base64url')
  assert.equal(unsign(`${forged}.${mac}`), null)
  assert.equal(unsign(`${payload}.x${mac.slice(1)}`), null)
  assert.equal(unsign(sign({ f: 'x' }, -1)), null)
  assert.equal(unsign(undefined), null)
})

test('no code: nothing is gated and status says passed', async () => {
  await createProfile({ name: 'open-user' })
  assert.equal((await request(app).get('/api/auth/profiles')).status, 200)
  const res = await request(app).get('/api/v1/auth/server-code')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { required: false, passed: true })
})

test('code set: logged-out profile list, login and set-pin need the key', async () => {
  const profile = await createProfile({ name: 'gated' })
  await setCode(generateServerCode())
  for (const res of [
    await request(app).get('/api/auth/profiles'),
    await loginAs(request(app), profile),
    await request(app).post('/api/auth/login/set-pin').send({ profileId: String(profile._id), currentPin: '0000', newPin: '1111' }),
    await request(app).get(`/api/auth/profiles/${profile._id}/avatar`),
  ]) {
    assert.equal(res.status, 403)
    assert.deepEqual(res.body, { error: 'Server key required', code: 'server_code_required' })
  }
  assert.deepEqual((await request(app).get('/api/v1/auth/server-code')).body, { required: true, passed: false })
})

test('entering the key sets a pass cookie that opens the gate', async () => {
  const code = generateServerCode()
  const profile = await createProfile({ name: 'passer' })
  await setCode(code)
  const ok = await request(app).post('/api/v1/auth/server-code').send({ code })
  assert.equal(ok.status, 204)
  const cookie = passCookie(ok)
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Lax/i)
  assert.match(cookie, /Max-Age=2592000/)
  const jar = cookie.split(';')[0]
  assert.deepEqual((await request(app).get('/api/v1/auth/server-code').set('Cookie', jar)).body, { required: true, passed: true })
  assert.equal((await request(app).get('/api/auth/profiles').set('Cookie', jar)).status, 200)
  assert.equal((await loginAs(request(app), profile).set('Cookie', jar)).status, 200)
})

test('wrong format and wrong key are distinct v1 errors', async () => {
  await setCode(generateServerCode())
  for (const body of [{}, { code: 42 }, { code: 'nope' }]) {
    const res = await request(app).post('/api/v1/auth/server-code').send(body)
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'server_code_invalid')
  }
  const res = await request(app).post('/api/v1/auth/server-code').send({ code: generateServerCode() })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'server_code_rejected')
  assert.equal(passCookie(res), undefined)
})

test('a correct-format key is rejected when no key is set', async () => {
  const res = await request(app).post('/api/v1/auth/server-code').send({ code: GOOD })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'server_code_rejected')
})

test('rotating the key invalidates old pass cookies', async () => {
  const old = generateServerCode()
  await setCode(old)
  const jar = passCookie(await request(app).post('/api/v1/auth/server-code').send({ code: old })).split(';')[0]
  assert.equal((await request(app).get('/api/auth/profiles').set('Cookie', jar)).status, 200)
  await setCode(generateServerCode())
  const res = await request(app).get('/api/auth/profiles').set('Cookie', jar)
  assert.equal(res.status, 403)
  assert.equal(res.body.code, 'server_code_required')
})

test('a forged pass cookie does not open the gate', async () => {
  const code = generateServerCode()
  await setCode(code)
  const payload = Buffer.from(JSON.stringify({ f: fingerprint(code), exp: Date.now() + 60000 })).toString('base64url')
  const res = await request(app).get('/api/auth/profiles').set('Cookie', `${COOKIE}=${payload}.AAAA`)
  assert.equal(res.status, 403)
})

test('already logged-in sessions are unaffected by a new key', async () => {
  const profile = await createProfile({ name: 'insider' })
  const session = sessionCookie(await loginAs(request(app), profile))
  await setCode(generateServerCode())
  assert.equal((await request(app).get('/api/auth/profiles').set('Cookie', session)).status, 200)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', session)).status, 200)
  assert.deepEqual((await request(app).get('/api/v1/auth/server-code').set('Cookie', session)).body, { required: true, passed: true })
})

test('entering the key while signed in grants account.serverAccess only to accounts', async () => {
  const code = generateServerCode()
  const plain = await createProfile({ name: 'plain' })
  const withAccount = await createProfile({ name: 'acct' })
  await mongoose.connection.db.collection('profiles').updateOne({ _id: withAccount._id }, { $set: { account: { handle: 'acct' } } })
  const plainSession = sessionCookie(await loginAs(request(app), plain))
  const acctSession = sessionCookie(await loginAs(request(app), withAccount))
  await setCode(code)
  assert.equal((await request(app).post('/api/v1/auth/server-code').set('Cookie', plainSession).send({ code })).status, 204)
  assert.equal((await request(app).post('/api/v1/auth/server-code').set('Cookie', acctSession).send({ code })).status, 204)
  const raw = (id) => mongoose.connection.db.collection('profiles').findOne({ _id: id })
  assert.equal((await raw(plain._id)).account, undefined)
  assert.equal((await raw(withAccount._id)).account.serverAccess, true)
  assert.ok(await Profile.exists({ _id: plain._id }))
})

test('posting the key is rate limited per IP', async () => {
  const fresh = makeApp()
  await setCode(generateServerCode())
  let last
  for (let i = 0; i < 11; i++) last = await request(fresh).post('/api/v1/auth/server-code').send({ code: 'nope' })
  assert.equal(last.status, 429)
  assert.equal(last.body.error.code, 'rate_limited')
})
