import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { startDb, stopDb, makeApp, createProfile, loginAs, loginAsNid } from './helpers.js'
import AuthSettings, { invalidateSettings } from '../models/AuthSettings.js'
import Profile from '../models/Profile.js'
import Session from '../models/Session.js'
import EmailToken from '../models/EmailToken.js'
import { setTransport } from '../lib/mailer.js'
import { hashPassword, verifyPassword, checkPasswordStrength } from '../lib/password.js'
import { claimBootstrap } from '../routes/nid.js'

const PW = 'correct horse battery'
const CODE = 'nucleus' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6' + 'home'

let app
let sent

before(startDb)
after(async () => {
  setTransport(null)
  await stopDb()
})
beforeEach(async () => {
  await Promise.all([Profile.deleteMany({}), Session.deleteMany({}), EmailToken.deleteMany({}), AuthSettings.deleteMany({})])
  invalidateSettings()
  sent = []
  setTransport(async (mail) => { sent.push(mail) })
  app = makeApp()
})

async function settings(patch) {
  await AuthSettings.updateOne({ _id: 'auth' }, { $set: patch }, { upsert: true })
  invalidateSettings()
}
const ORIGIN = 'https://home.example.org'
const enableMail = () => settings({ 'mail.resendKey': 're_test_key', 'mail.from': 'Nucleus <hi@nucleus.test>', publicOrigin: ORIGIN })

const cookieOf = (res) => (res.headers['set-cookie'] || []).find(c => c.startsWith('nucleus_token='))?.split(';')[0]
const claimsOf = (cookie) => jwt.decode(decodeURIComponent(cookie.slice('nucleus_token='.length)))
const tokenIn = (mail, kind) => new RegExp(`[?&]${kind}=([A-Za-z0-9_-]+)`).exec(mail.message.text)?.[1]

function register(body = {}, agent = request(app)) {
  return agent.post('/api/auth/nid/register').send({
    handle: 'alice', displayName: 'Alice', email: 'alice@example.com', password: PW, ...body,
  })
}
const login = (body, agent = request(app)) => agent.post('/api/auth/nid/login').send(body)

async function waitFor(fn) {
  for (let i = 0; i < 50; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 10))
  }
}

test('password: scrypt round trip and length rule', async () => {
  const h = await hashPassword(PW)
  assert.match(h, /^scrypt\$32768\$8\$1\$/)
  assert.equal(await verifyPassword(PW, h), true)
  assert.equal(await verifyPassword('nope nope nope', h), false)
  assert.equal(await verifyPassword(PW, 'garbage'), false)
  assert.equal(checkPasswordStrength('short'), 'Use at least 10 characters.')
  assert.equal(checkPasswordStrength(PW), null)
})

test('register without mail: active at once, nid session, first account is admin', async () => {
  const res = await register()
  assert.equal(res.status, 201)
  assert.equal(res.body.profile.name, 'Alice')
  assert.equal(res.body.profile.role, 'admin')
  assert.deepEqual(res.body.profile.account, { handle: 'alice', email: 'alice@example.com', emailVerified: true, appearance: null })
  const cookie = cookieOf(res)
  assert.equal(claimsOf(cookie).via, 'nid')
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie)
  assert.equal(me.status, 200)
  assert.equal(me.body.via, 'nid')
  assert.deepEqual(me.body.account, { handle: 'alice', email: 'alice@example.com', emailVerified: true, appearance: null })
  assert.equal(JSON.stringify(me.body).includes('scrypt'), false)
  assert.equal(sent.length, 0)

  const second = await register({ handle: 'bob', email: 'bob@example.com', displayName: 'Bob' })
  assert.equal(second.status, 201)
  assert.equal(second.body.profile.role, 'user')
})

test('existing PIN admin: a new account is not admin', async () => {
  await createProfile({ name: 'boss', role: 'admin', pin: '1234' })
  const res = await register()
  assert.equal(res.status, 201)
  assert.equal(res.body.profile.role, 'user')
})

test('register validates handle, email and password', async () => {
  const res = await register({ handle: '-x', email: 'not-an-email', password: 'short' })
  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'invalid')
  assert.ok(res.body.fields.handle && res.body.fields.email && res.body.fields.password)
  assert.equal((await register({ displayName: '  ' })).body.fields.displayName !== undefined, true)
  assert.equal(await Profile.countDocuments(), 0)
})

test('email and handle are case/whitespace-insensitive; duplicates are 409', async () => {
  const res = await register({ handle: ' Alice ', email: ' Foo@X.com ' })
  assert.equal(res.status, 201)
  assert.equal(res.body.profile.account.handle, 'alice')
  assert.equal(res.body.profile.account.email, 'foo@x.com')

  for (const id of [{ email: 'foo@x.com' }, { email: '  FOO@x.COM ' }, { handle: 'ALICE' }, { email: ' alice ' }]) {
    const r = await login({ ...id, password: PW })
    assert.equal(r.status, 200, JSON.stringify(id))
    assert.equal(r.body.profile.account.handle, 'alice')
  }

  const dupEmail = await register({ handle: 'other', email: 'FOO@x.com' })
  assert.equal(dupEmail.status, 409)
  assert.equal(dupEmail.body.code, 'email_taken')
  const dupHandle = await register({ handle: 'ALICE', email: 'new@x.com' })
  assert.equal(dupHandle.status, 409)
  assert.equal(dupHandle.body.code, 'handle_taken')
})

test('signup closed only once an admin exists', async () => {
  await settings({ signupOpen: false })
  const first = await register()
  assert.equal(first.status, 201)
  assert.equal(first.body.profile.role, 'admin')
  const res = await register({ handle: 'bob', email: 'bob@example.com' })
  assert.equal(res.status, 403)
  assert.equal(res.body.code, 'signup_closed')
})

test('with mail: pending until verified, login refused, verify signs in once', async () => {
  await enableMail()
  const res = await register()
  assert.equal(res.status, 201)
  assert.deepEqual(res.body, { pending: true, email: 'alice@example.com' })
  assert.equal(cookieOf(res), undefined)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].key, 're_test_key')
  assert.equal(sent[0].message.to, 'alice@example.com')
  assert.equal(sent[0].message.from, 'Nucleus <hi@nucleus.test>')
  assert.ok(sent[0].message.text.includes(`${ORIGIN}/?verify=`))
  assert.match(sent[0].message.text, /password/)

  const early = await login({ email: 'alice@example.com', password: PW })
  assert.equal(early.status, 403)
  assert.equal(early.body.code, 'email_unverified')

  const token = tokenIn(sent[0], 'verify')
  assert.ok(token)
  assert.equal((await EmailToken.findById(token)), null)
  const missing = await request(app).post('/api/auth/nid/verify').send({ token })
  assert.equal(missing.status, 400)
  assert.equal(missing.body.code, 'invalid')
  const wrong = await request(app).post('/api/auth/nid/verify').send({ token, password: 'wrong password!' })
  assert.equal(wrong.status, 401)
  assert.equal(wrong.body.code, 'invalid_credentials')
  assert.equal(cookieOf(wrong), undefined)
  const v = await request(app).post('/api/auth/nid/verify').send({ token, password: PW })
  assert.equal(v.status, 200)
  assert.equal(v.body.profile.account.emailVerified, true)
  assert.equal(claimsOf(cookieOf(v)).via, 'nid')

  const again = await request(app).post('/api/auth/nid/verify').send({ token, password: PW })
  assert.equal(again.status, 400)
  assert.equal(again.body.code, 'token_invalid')
  assert.equal((await login({ email: 'alice@example.com', password: PW })).status, 200)
})

test('mail links ignore request host headers', async () => {
  await enableMail()
  await request(app).post('/api/auth/nid/register')
    .set('X-Forwarded-Host', 'evil.tld').set('Host', 'evil.tld').set('X-Forwarded-Proto', 'https')
    .send({ handle: 'alice', displayName: 'Alice', email: 'alice@example.com', password: PW })
  assert.equal(sent.length, 1)
  assert.ok(sent[0].message.text.includes(`${ORIGIN}/?verify=`))
  assert.equal(sent[0].message.text.includes('evil.tld'), false)
  assert.equal(sent[0].message.html.includes('evil.tld'), false)

  await request(app).post('/api/auth/nid/verify').send({ token: tokenIn(sent[0], 'verify'), password: PW })
  await request(app).post('/api/auth/nid/forgot').set('X-Forwarded-Host', 'evil.tld').send({ email: 'alice@example.com' })
  await waitFor(() => sent.length > 1)
  assert.ok(sent[1].message.text.includes(`${ORIGIN}/?reset=`))
  assert.equal(sent[1].message.text.includes('evil.tld'), false)
})

test('mail without a public origin counts as not configured', async () => {
  await settings({ 'mail.resendKey': 're_test_key', 'mail.from': 'Nucleus <hi@nucleus.test>' })
  const res = await register()
  assert.equal(res.status, 201)
  assert.equal(res.body.profile.account.emailVerified, true)
  assert.equal(sent.length, 0)
})

test('with mail: an unverified claim does not block a new sign-up', async () => {
  await enableMail()
  await register()
  const res = await register({ displayName: 'Real Alice' })
  assert.equal(res.status, 201)
  assert.equal(await Profile.countDocuments(), 1)
  assert.equal((await Profile.findOne().lean()).name, 'Real Alice')
})

test('mail send failure is 503 mail_failed', async () => {
  await enableMail()
  setTransport(async () => { throw new Error('down') })
  const res = await register()
  assert.equal(res.status, 503)
  assert.equal(res.body.code, 'mail_failed')
})

test('login: one message for unknown and wrong; nid login works in any userLogin mode', async () => {
  await register()
  for (const body of [{ email: 'alice@example.com', password: 'wrong password!' }, { email: 'nobody@x.com', password: PW }]) {
    const r = await login(body)
    assert.equal(r.status, 401)
    assert.equal(r.body.code, 'invalid_credentials')
  }
  await settings({ userLogin: 'nid' })
  const ok = await login({ email: 'alice@example.com', password: PW })
  assert.equal(ok.status, 200)
  assert.equal(claimsOf(cookieOf(ok)).via, 'nid')
  assert.ok((await Profile.findOne().lean()).lastLoginAt)
})

test('login is rate limited per IP and identifier', async () => {
  await register()
  for (let i = 0; i < 10; i++) await login({ email: 'alice@example.com', password: 'wrong password!' })
  const limited = await login({ email: 'ALICE@example.com', password: PW })
  assert.equal(limited.status, 429)
  assert.equal(limited.body.code, 'rate_limited')
  assert.equal((await login({ email: 'other@example.com', password: PW })).status, 401)
})

test('PIN login rules: nid_only mode, pinAfterUpgrade, PIN-less accounts', async () => {
  const plain = await createProfile({ name: 'plain', pin: '1111' })
  await settings({ userLogin: 'nid' })
  const r = await loginAs(request(app), plain, '1111')
  assert.equal(r.status, 403)
  assert.equal(r.body.code, 'nid_only')
  await settings({ userLogin: 'both' })
  assert.equal((await loginAs(request(app), plain, '1111')).status, 200)

  const reg = await register()
  const nidProfile = await Profile.findById(reg.body.profile._id)
  const noPin = await loginAs(request(app), nidProfile)
  assert.equal(noPin.status, 403)
  assert.equal(cookieOf(noPin), undefined)

  await Profile.updateOne({ _id: plain._id }, { $set: { account: { handle: 'plain', handleLower: 'plain', email: 'p@x.com', emailLower: 'p@x.com', passwordHash: 'x', emailVerifiedAt: new Date(), createdAt: new Date() } } })
  assert.equal((await loginAs(request(app), plain, '1111')).status, 200)
  await settings({ pinAfterUpgrade: false })
  const blocked = await loginAs(request(app), plain, '1111')
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'nid_required')
})

test('upgrade binds an account to the logged-in profile and swaps the session', async () => {
  const p = await createProfile({ name: 'Petr', pin: '1234' })
  const pinLogin = await loginAs(request(app), p, '1234')
  const pinCookie = cookieOf(pinLogin)
  const oldSid = claimsOf(pinCookie).sid

  assert.equal((await request(app).post('/api/auth/nid/upgrade').send({ handle: 'petr', email: 'p@x.com', password: PW, pin: '1234' })).status, 401)
  const wrongPin = await request(app).post('/api/auth/nid/upgrade').set('Cookie', pinCookie)
    .send({ handle: 'Petr', email: ' P@X.com', password: PW, pin: '9999' })
  assert.equal(wrongPin.status, 401)
  assert.equal(wrongPin.body.code, 'wrong_pin')
  const res = await request(app).post('/api/auth/nid/upgrade').set('Cookie', pinCookie)
    .send({ handle: 'Petr', email: ' P@X.com', password: PW, pin: '1234' })
  assert.equal(res.status, 200)
  assert.equal(String(res.body.profile._id), String(p._id))
  assert.equal(res.body.profile.account.email, 'p@x.com')
  assert.equal(claimsOf(cookieOf(res)).via, 'nid')
  assert.equal(await Session.exists({ _id: oldSid }), null)
  assert.equal((await Profile.findById(p._id).lean()).name, 'Petr')

  const again = await request(app).post('/api/auth/nid/upgrade').set('Cookie', cookieOf(res))
    .send({ handle: 'petr2', email: 'p2@x.com', password: PW, pin: '1234' })
  assert.equal(again.status, 409)
  assert.equal(again.body.code, 'account_exists')
  assert.equal((await login({ email: 'p@x.com', password: PW })).status, 200)
  assert.equal((await loginAs(request(app), p, '1234')).status, 200)
})

test('upgrade: guests refused, duplicates 409, mail makes it pending', async () => {
  const guest = await createProfile({ name: 'Guest', isGuest: true })
  const g = await request(app).post('/api/auth/nid/upgrade').set('Cookie', await loginAsNid(guest))
    .send({ handle: 'guest', email: 'g@x.com', password: PW })
  assert.equal(g.status, 403)

  const pinless = await createProfile({ name: 'NoPin' })
  const np = await request(app).post('/api/auth/nid/upgrade').set('Cookie', cookieOf(await loginAs(request(app), pinless)))
    .send({ handle: 'nopin', email: 'np@x.com', password: PW })
  assert.equal(np.status, 403)
  assert.equal(np.body.code, 'pin_required')

  await register()
  const p = await createProfile({ name: 'Petr', pin: '1234' })
  const pinCookie = cookieOf(await loginAs(request(app), p, '1234'))
  const dup = await request(app).post('/api/auth/nid/upgrade').set('Cookie', pinCookie)
    .send({ handle: 'petr', email: 'ALICE@example.com', password: PW, pin: '1234' })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.code, 'email_taken')

  await enableMail()
  const pending = await request(app).post('/api/auth/nid/upgrade').set('Cookie', pinCookie)
    .send({ handle: 'petr', email: 'p@x.com', password: PW, pin: '1234' })
  assert.equal(pending.status, 201)
  assert.deepEqual(pending.body, { pending: true, email: 'p@x.com' })
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', pinCookie)).status, 200)
  const v = await request(app).post('/api/auth/nid/verify').send({ token: tokenIn(sent[0], 'verify'), password: PW })
  assert.equal(v.status, 200)
  assert.equal(String(v.body.profile._id), String(p._id))
})

test('password change needs a nid session and signs out other sessions', async () => {
  const reg = await register()
  const a = cookieOf(reg)
  const b = cookieOf(await login({ email: 'alice@example.com', password: PW }))

  const wrong = await request(app).post('/api/auth/nid/password').set('Cookie', a)
    .send({ currentPassword: 'not it at all', newPassword: 'another long one' })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.code, 'wrong_password')

  const ok = await request(app).post('/api/auth/nid/password').set('Cookie', a)
    .send({ currentPassword: PW, newPassword: 'another long one' })
  assert.equal(ok.status, 204)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', a)).status, 200)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', b)).status, 401)
  assert.equal((await login({ email: 'alice@example.com', password: 'another long one' })).status, 200)

  const pinUser = await createProfile({ name: 'pinny', pin: '1234', account: { handle: 'pinny', handleLower: 'pinny', email: 'pin@x.com', emailLower: 'pin@x.com', passwordHash: await hashPassword(PW), emailVerifiedAt: new Date(), createdAt: new Date() } })
  const pinCookie = cookieOf(await loginAs(request(app), pinUser, '1234'))
  const viaPin = await request(app).post('/api/auth/nid/password').set('Cookie', pinCookie)
    .send({ currentPassword: PW, newPassword: 'another long one' })
  assert.equal(viaPin.status, 403)
  assert.equal(viaPin.body.code, 'nid_required')
})

test('forgot + reset: always 204, mail only for real accounts, reset signs everything else out', async () => {
  await enableMail()
  await register()
  const verifyToken = tokenIn(sent[0], 'verify')
  const v = await request(app).post('/api/auth/nid/verify').send({ token: verifyToken, password: PW })
  const oldCookie = cookieOf(v)
  sent = []

  assert.equal((await request(app).post('/api/auth/nid/forgot').send({ email: 'nobody@x.com' })).status, 204)
  assert.equal((await request(app).post('/api/auth/nid/forgot').send({ email: ' ALICE@example.com' })).status, 204)
  await waitFor(() => sent.length)
  assert.equal(sent.length, 1)
  const token = tokenIn(sent[0], 'reset')
  assert.ok(token)

  const weak = await request(app).post('/api/auth/nid/reset').send({ token, password: 'short' })
  assert.equal(weak.status, 400)
  const res = await request(app).post('/api/auth/nid/reset').send({ token, password: 'brand new password' })
  assert.equal(res.status, 200)
  assert.equal(claimsOf(cookieOf(res)).via, 'nid')
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status, 401)
  const reuse = await request(app).post('/api/auth/nid/reset').send({ token, password: 'brand new password' })
  assert.equal(reuse.status, 400)
  assert.equal(reuse.body.code, 'token_invalid')
  assert.equal((await login({ email: 'alice@example.com', password: 'brand new password' })).status, 200)
})

test('tokens are stored hashed and expire', async () => {
  await enableMail()
  await register()
  const token = tokenIn(sent[0], 'verify')
  const row = await EmailToken.findOne().lean()
  assert.notEqual(row._id, token)
  assert.equal(row.purpose, 'verify')
  await EmailToken.updateOne({ _id: row._id }, { expiresAt: new Date(Date.now() - 1000) })
  const res = await request(app).post('/api/auth/nid/verify').send({ token, password: PW })
  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'token_invalid')
})

test('logout-all revokes every session and clears the cookie', async () => {
  const reg = await register()
  const a = cookieOf(reg)
  const b = cookieOf(await login({ email: 'alice@example.com', password: PW }))
  const res = await request(app).post('/api/auth/nid/logout-all').set('Cookie', a)
  assert.equal(res.status, 204)
  assert.match(res.headers['set-cookie'].join(), /nucleus_token=;/)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', b)).status, 401)
  assert.equal(await Session.countDocuments(), 0)
})

test('account: get, patch and delete', async () => {
  await createProfile({ name: 'boss', role: 'admin', pin: '1234' })
  const reg = await register()
  const cookie = cookieOf(reg)
  await register({ handle: 'bob', email: 'bob@example.com' })

  const got = await request(app).get('/api/auth/nid/account').set('Cookie', cookie)
  assert.equal(got.status, 200)
  assert.equal(got.body.handle, 'alice')
  assert.equal(got.body.displayName, 'Alice')
  assert.equal(got.body.passwordHash, undefined)
  assert.equal(got.body.hasPassword, true)

  const taken = await request(app).patch('/api/auth/nid/account').set('Cookie', cookie).send({ handle: 'BOB' })
  assert.equal(taken.status, 409)
  assert.equal(taken.body.code, 'handle_taken')
  const badLook = await request(app).patch('/api/auth/nid/account').set('Cookie', cookie).send({ appearance: { accent: 'pink' } })
  assert.equal(badLook.status, 400)

  const noPw = await request(app).patch('/api/auth/nid/account').set('Cookie', cookie).send({ email: 'AB@x.com' })
  assert.equal(noPw.status, 400)
  assert.equal(noPw.body.code, 'wrong_password')
  const longName = await request(app).patch('/api/auth/nid/account').set('Cookie', cookie).send({ displayName: 'x'.repeat(65) })
  assert.equal(longName.status, 400)

  const patched = await request(app).patch('/api/auth/nid/account').set('Cookie', cookie)
    .send({ displayName: 'Alice B', handle: 'aliceb', email: 'AB@x.com', currentPassword: PW, appearance: { accent: 'ember' } })
  assert.equal(patched.status, 200)
  assert.equal(patched.body.handle, 'aliceb')
  assert.equal(patched.body.email, 'ab@x.com')
  assert.equal(patched.body.appearance.accent, 'ember')
  const prof = await Profile.findById(reg.body.profile._id).lean()
  assert.equal(prof.name, 'Alice B')
  assert.equal(prof.account.handleLower, 'aliceb')

  const wrong = await request(app).delete('/api/auth/nid/account').set('Cookie', cookie).send({ password: 'nope nope nope' })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.code, 'wrong_password')
  const del = await request(app).delete('/api/auth/nid/account').set('Cookie', cookie).send({ password: PW })
  assert.equal(del.status, 204)
  assert.equal(await Profile.exists({ _id: reg.body.profile._id }), null)
  assert.equal(await Session.countDocuments({ profileId: reg.body.profile._id }), 0)
})

test('account delete refuses the last admin', async () => {
  const reg = await register()
  const res = await request(app).delete('/api/auth/nid/account').set('Cookie', cookieOf(reg)).send({ password: PW })
  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'last_admin')
})

test('admin accounts list and reset-password', async () => {
  const reg = await register()
  const adminCookie = cookieOf(reg)
  const bob = await register({ handle: 'bob', email: 'bob@example.com', displayName: 'Bob' })
  const bobCookie = cookieOf(bob)
  await createProfile({ name: 'plain' })

  assert.equal((await request(app).get('/api/auth/settings/accounts').set('Cookie', bobCookie)).status, 403)
  const list = await request(app).get('/api/auth/settings/accounts').set('Cookie', adminCookie)
  assert.equal(list.status, 200)
  assert.equal(list.body.length, 2)
  const row = list.body.find(a => a.handle === 'bob')
  assert.equal(row.email, 'bob@example.com')
  assert.equal(row.verified, true)
  assert.equal(row.role, 'user')
  assert.ok('lastLoginAt' in row)
  assert.equal(JSON.stringify(list.body).includes('scrypt'), false)

  const reset = await request(app).post(`/api/auth/settings/accounts/${row._id}/reset-password`).set('Cookie', adminCookie)
  assert.equal(reset.status, 200)
  assert.ok(reset.body.temporaryPassword.length >= 10)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', bobCookie)).status, 401)
  assert.equal((await login({ email: 'bob@example.com', password: reset.body.temporaryPassword })).status, 200)
})

test('no admin: profile bootstrap is refused in favour of NucleusID', async () => {
  const res = await request(app).post('/api/auth/profiles').send({ name: 'First', pin: '1234' })
  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'nid_bootstrap')
  assert.equal(await Profile.countDocuments(), 0)
})

test('admin API needs a nid session; PIN admin still uses the hub', async () => {
  const admin = await createProfile({ name: 'boss', role: 'admin', pin: '1234' })
  const user = await createProfile({ name: 'u', pin: '5555' })
  const pinCookie = cookieOf(await loginAs(request(app), admin, '1234'))
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', pinCookie)).body.via, 'pin')

  const checks = [
    ['get', '/api/auth/groups'],
    ['post', '/api/auth/groups', { name: 'g' }],
    ['post', `/api/auth/profiles/${user._id}/pin/reset`],
    ['get', `/api/auth/profiles/${user._id}/pin-temp`],
    ['patch', '/api/auth/overrides/app/x', { disabled: true }],
    ['get', `/api/auth/users/${user._id}/overrides`],
    ['post', '/api/auth/profiles', { name: 'New' }],
    ['patch', `/api/auth/profiles/${user._id}`, { name: 'Hacked' }],
    ['patch', `/api/auth/profiles/${user._id}/pin`, { pin: '9999' }],
  ]
  for (const [m, url, body] of checks) {
    const r = await request(app)[m](url).set('Cookie', pinCookie).send(body)
    assert.equal(r.status, 403, `${m} ${url}`)
    assert.equal(r.body.code, 'nid_required', `${m} ${url}`)
  }
  const own = await request(app).patch(`/api/auth/profiles/${admin._id}`).set('Cookie', pinCookie).send({ name: 'Boss' })
  assert.equal(own.status, 200)

  const nid = await loginAsNid(admin)
  assert.equal((await request(app).get('/api/auth/groups').set('Cookie', nid)).status, 200)
  const created = await request(app).post('/api/auth/profiles').set('Cookie', nid).send({ name: 'New' })
  assert.equal(created.status, 201)
  const renamed = await request(app).patch(`/api/auth/profiles/${user._id}`).set('Cookie', nid).send({ name: 'Renamed' })
  assert.equal(renamed.status, 200)
})

test('JWT role claim grants nothing once the DB says otherwise', async () => {
  const admin = await createProfile({ name: 'boss', role: 'admin', pin: '1234' })
  await createProfile({ name: 'boss2', role: 'admin', pin: '1234' })
  const user = await createProfile({ name: 'u' })
  const nid = await loginAsNid(admin)
  await Profile.updateOne({ _id: admin._id }, { role: 'user' })
  assert.equal(claimsOf(nid).role, 'admin')
  const r = await request(app).patch(`/api/auth/profiles/${user._id}`).set('Cookie', nid).send({ role: 'admin' })
  assert.equal(r.status, 403)
  const own = await request(app).patch(`/api/auth/profiles/${admin._id}`).set('Cookie', nid).send({ role: 'admin' })
  assert.equal(own.status, 200)
  assert.equal(own.body.role, 'user')
  assert.equal(own.body.account?.passwordHash, undefined)
})

test('account admins may be PIN-less: promotion and PIN removal allowed', async () => {
  const reg = await register()
  const admin = cookieOf(reg)
  const bob = await register({ handle: 'bob', email: 'bob@example.com' })
  const promote = await request(app).patch(`/api/auth/profiles/${bob.body.profile._id}`).set('Cookie', admin).send({ role: 'admin' })
  assert.equal(promote.status, 200)
  assert.equal(promote.body.role, 'admin')
  assert.equal(JSON.stringify(promote.body).includes('scrypt'), false)
  const plain = await createProfile({ name: 'plain' })
  const refused = await request(app).patch(`/api/auth/profiles/${plain._id}`).set('Cookie', admin).send({ role: 'admin' })
  assert.equal(refused.status, 400)
})

test('logout works with a stale or garbage cookie', async () => {
  for (const cookie of ['nucleus_token=garbage', null]) {
    const req = request(app).post('/api/auth/logout')
    const res = cookie ? await req.set('Cookie', cookie) : await req
    assert.equal(res.status, 200)
    assert.match(res.headers['set-cookie'].join(), /nucleus_token=;/)
  }
})

test('server key gates logged-out NID routes; passing it grants serverAccess', async () => {
  await settings({ serverCode: CODE })
  const gated = [
    ['/api/auth/nid/register', { handle: 'alice', displayName: 'A', email: 'a@x.com', password: PW }],
    ['/api/auth/nid/login', { email: 'a@x.com', password: PW }],
    ['/api/auth/nid/verify', { token: 'x' }],
    ['/api/auth/nid/forgot', { email: 'a@x.com' }],
    ['/api/auth/nid/reset', { token: 'x', password: PW }],
  ]
  for (const [url, body] of gated) {
    const r = await request(app).post(url).send(body)
    assert.equal(r.status, 403, url)
    assert.equal(r.body.code, 'server_code_required', url)
  }
  const agent = request.agent(app)
  assert.equal((await agent.post('/api/v1/auth/server-code').send({ code: CODE })).status, 204)
  const res = await register({}, agent)
  assert.equal(res.status, 201)
  assert.equal((await Profile.findById(res.body.profile._id).lean()).account.serverAccess, true)
})

test('with mail: email change stays pending, keeps the account safe, and swaps on confirm', async () => {
  await enableMail()
  await register()
  await request(app).post('/api/auth/nid/verify').send({ token: tokenIn(sent[0], 'verify'), password: PW })
  const cookie = cookieOf(await login({ email: 'alice@example.com', password: PW }))
  sent = []

  const res = await request(app).patch('/api/auth/nid/account').set('Cookie', cookie)
    .send({ email: 'New@x.com', currentPassword: PW })
  assert.equal(res.status, 200)
  assert.equal(res.body.email, 'alice@example.com')
  assert.equal(res.body.pendingEmail, 'new@x.com')
  assert.equal(res.body.emailVerified, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].message.to, 'new@x.com')

  // Old address still signs in, and the established account can't be wiped by a squatter.
  assert.equal((await login({ email: 'alice@example.com', password: PW })).status, 200)
  const squat = await register({ email: 'squat@x.com' })
  assert.equal(squat.status, 409)
  assert.equal(squat.body.code, 'handle_taken')
  assert.equal(await Profile.countDocuments({ 'account.handle': 'alice' }), 1)

  const token = tokenIn(sent[0], 'verify')
  assert.equal((await request(app).post('/api/auth/nid/verify').send({ token, password: 'wrong password!' })).status, 401)
  const v = await request(app).post('/api/auth/nid/verify').send({ token, password: PW })
  assert.equal(v.status, 200)
  assert.equal(v.body.profile.account.email, 'new@x.com')
  const prof = await Profile.findOne({ 'account.handle': 'alice' }).lean()
  assert.equal(prof.account.emailLower, 'new@x.com')
  assert.equal(prof.account.pendingEmail ?? null, null)
  assert.equal((await login({ email: 'new@x.com', password: PW })).status, 200)
  assert.equal((await login({ email: 'alice@example.com', password: PW })).status, 401)
})

test('releasing a never-verified upgrade also revokes that profile sessions', async () => {
  await enableMail()
  const p = await createProfile({ name: 'Petr', pin: '1234' })
  const pinCookie = cookieOf(await loginAs(request(app), p, '1234'))
  const up = await request(app).post('/api/auth/nid/upgrade').set('Cookie', pinCookie)
    .send({ handle: 'petr', email: 'p@x.com', password: PW, pin: '1234' })
  assert.equal(up.status, 201)
  assert.equal((await register({ handle: 'petr', email: 'other@x.com' })).status, 201)
  assert.equal((await Profile.findById(p._id).lean()).account, undefined)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', pinCookie)).status, 401)
})

test('IP-wide limit caps attempts across identifiers', async () => {
  let last
  for (let i = 0; i < 31; i++) last = await login({ email: `spray${i}@x.com`, password: 'wrong password!' })
  assert.equal(last.status, 429)
  assert.equal(last.body.code, 'rate_limited')
  const reg = await register({ handle: 'fresh', email: 'fresh@x.com' })
  assert.equal(reg.status, 201)
})

test('picker hides never-verified accounts', async () => {
  await enableMail()
  await register()
  await createProfile({ name: 'plain' })
  const res = await request(app).get('/api/auth/profiles')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.map(p => p.name), ['plain'])
  await request(app).post('/api/auth/nid/verify').send({ token: tokenIn(sent[0], 'verify'), password: PW })
  assert.equal((await request(app).get('/api/auth/profiles')).body.length, 2)
})

test('bootstrap: concurrent first sign-ups make exactly one admin', async () => {
  const results = await Promise.all(['a1', 'a2', 'a3'].map(h => register({ handle: h, email: `${h}@x.com` })))
  assert.deepEqual(results.map(r => r.status), [201, 201, 201])
  assert.equal(results.filter(r => r.body.profile.role === 'admin').length, 1)
  assert.equal(await Profile.countDocuments({ role: 'admin' }), 1)
})

test('bootstrap: a claim left by a deleted profile does not block the next first account', async () => {
  const gone = await createProfile({ name: 'gone' })
  await settings({ bootstrapAdminId: gone._id })
  await Profile.deleteOne({ _id: gone._id })
  const res = await register()
  assert.equal(res.body.profile.role, 'admin')
})

test('bootstrap claim is compare-and-set: one winner, later claims lose', async () => {
  await settings({})
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map(name => createProfile({ name })))
  const wins = await Promise.all([claimBootstrap(a._id), claimBootstrap(b._id)])
  assert.equal(wins.filter(Boolean).length, 1)
  assert.equal(await claimBootstrap(c._id), false)
})

test('picker keeps an upgraded PIN profile whose verification is pending, and PIN login still works', async () => {
  await enableMail()
  const p = await createProfile({ name: 'Petr', pin: '1234' })
  const pinCookie = cookieOf(await loginAs(request(app), p, '1234'))
  const up = await request(app).post('/api/auth/nid/upgrade').set('Cookie', pinCookie)
    .send({ handle: 'petr', email: 'p@x.com', password: PW, pin: '1234' })
  assert.equal(up.status, 201)
  assert.equal((await Profile.findById(p._id).lean()).account.emailVerifiedAt, null)
  const list = await request(app).get('/api/auth/profiles')
  assert.deepEqual(list.body.map(x => x.name), ['Petr'])
  assert.equal((await loginAs(request(app), p, '1234')).status, 200)
})
