import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { startDb, stopDb, makeApp, createProfile, loginAs, loginAsNid } from './helpers.js'
import AuthSettings, { getSettings, invalidateSettings } from '../models/AuthSettings.js'
import { isServerCode } from '../lib/serverCode.js'

let app
let admin
let nidCookie

before(async () => {
  await startDb()
  app = makeApp()
  admin = await createProfile({ name: 'boss', role: 'admin', pin: '1234' })
  nidCookie = await loginAsNid(admin)
})
after(stopDb)
beforeEach(async () => {
  await AuthSettings.deleteMany({})
  invalidateSettings()
})

const sessionCookie = (res) => (res.headers['set-cookie'] || []).find(c => c.startsWith('nucleus_token='))?.split(';')[0]

test('defaults', async () => {
  const s = await getSettings()
  assert.equal(s.userLogin, 'profiles')
  assert.equal(s.signupOpen, true)
  assert.equal(s.pinAfterUpgrade, true)
  assert.equal(s.serverCode, null)
  assert.deepEqual({ ...s.limits }, {
    dataValueBytes: 262144, dataQuotaBytes: 16777216, dataMaxKeys: 100,
    fileMaxBytes: 26214400, filesQuotaBytes: 262144000, filesMaxCount: 5000,
  })
})

test('settings need a NucleusID admin session', async () => {
  assert.equal((await request(app).get('/api/auth/settings')).status, 401)
  const user = await createProfile({ name: 'joe' })
  const userNid = await loginAsNid(user)
  assert.equal((await request(app).get('/api/auth/settings').set('Cookie', userNid)).status, 403)
  const pinSession = sessionCookie(await loginAs(request(app), admin, '1234'))
  const res = await request(app).get('/api/auth/settings').set('Cookie', pinSession)
  assert.equal(res.status, 403)
  assert.equal(res.body.code, 'nid_required')
  assert.equal((await request(app).patch('/api/auth/settings').set('Cookie', pinSession).send({ signupOpen: false })).status, 403)
  assert.equal((await request(app).post('/api/auth/settings/server-code').set('Cookie', pinSession).send({ action: 'rotate' })).status, 403)
  assert.equal((await request(app).get('/api/auth/settings').set('Cookie', nidCookie)).status, 200)
})

test('secrets are masked and masked values do not overwrite them', async () => {
  let res = await request(app).patch('/api/auth/settings').set('Cookie', nidCookie).send({
    userLogin: 'both',
    mail: { resendKey: 're_secretkey1234', from: 'Nucleus <a@b.c>' },
    sso: { google: { clientId: 'gid', clientSecret: 'gsecret5678' } },
    limits: { dataMaxKeys: 50 },
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.mail.resendKey, '••••1234')
  assert.equal(res.body.sso.google.clientSecret, '••••5678')
  assert.equal(res.body.sso.google.clientId, 'gid')
  assert.equal(res.body.userLogin, 'both')
  assert.equal(res.body.limits.dataMaxKeys, 50)
  assert.equal(res.body.limits.fileMaxBytes, 26214400)

  res = await request(app).patch('/api/auth/settings').set('Cookie', nidCookie).send({
    mail: { resendKey: '••••1234', from: 'New <n@b.c>' },
    sso: { google: { clientSecret: '••••5678' } },
  })
  assert.equal(res.status, 200)
  const stored = await AuthSettings.findById('auth').lean()
  assert.equal(stored.mail.resendKey, 're_secretkey1234')
  assert.equal(stored.mail.from, 'New <n@b.c>')
  assert.equal(stored.sso.google.clientSecret, 'gsecret5678')
  assert.equal(stored.sso.google.clientId, 'gid')

  const full = await request(app).get('/api/auth/settings').set('Cookie', nidCookie)
  assert.equal(JSON.stringify(full.body).includes('re_secretkey1234'), false)
  assert.equal(JSON.stringify(full.body).includes('gsecret5678'), false)
})

test('invalid settings are rejected and serverCode cannot be patched', async () => {
  for (const body of [{ userLogin: 'nope' }, { signupOpen: 'yes' }, { limits: { dataMaxKeys: -1 } }]) {
    const res = await request(app).patch('/api/auth/settings').set('Cookie', nidCookie).send(body)
    assert.equal(res.status, 400, JSON.stringify(body))
  }
  await request(app).patch('/api/auth/settings').set('Cookie', nidCookie).send({ serverCode: 'nucleus' + 'a'.repeat(32) + 'home' })
  assert.equal((await getSettings()).serverCode, null)
})

test('rotate returns code, per-app setup links and a setup file; clear removes it', async () => {
  let res = await request(app).post('/api/auth/settings/server-code').set('Cookie', nidCookie)
    .set('Host', 'nucleus.example:8080').send({ action: 'rotate' })
  assert.equal(res.status, 200)
  const { code, links, file } = res.body
  assert.ok(isServerCode(code))
  assert.equal((await getSettings()).serverCode, code)
  assert.deepEqual(file, { scheme: 'http', host: 'nucleus.example', port: 8080, path: '/api/v1/oauth/metadata', code })
  assert.deepEqual(Object.keys(links), ['todo', 'notes', 'watchlist'])
  assert.equal(links.todo, `com.nucleushome.todo://server?scheme=http&host=nucleus.example&port=8080&path=%2Fapi%2Fv1%2Foauth%2Fmetadata&code=${code}`)

  res = await request(app).post('/api/auth/settings/server-code').set('Cookie', nidCookie)
    .set('X-Forwarded-Host', 'home.example').set('X-Forwarded-Proto', 'https').send({ action: 'rotate' })
  assert.notEqual(res.body.code, code)
  assert.deepEqual(res.body.file, { scheme: 'https', host: 'home.example', path: '/api/v1/oauth/metadata', code: res.body.code })
  assert.equal(res.body.links.notes.includes('port='), false)

  res = await request(app).post('/api/auth/settings/server-code').set('Cookie', nidCookie).send({ action: 'clear' })
  assert.equal(res.status, 200)
  assert.equal(res.body.code, null)
  assert.equal((await getSettings()).serverCode, null)

  assert.equal((await request(app).post('/api/auth/settings/server-code').set('Cookie', nidCookie).send({ action: 'x' })).status, 400)
})

test('public settings expose flags only, plus hasAdmin and serverCodeRequired', async () => {
  await request(app).patch('/api/auth/settings').set('Cookie', nidCookie).send({
    mail: { resendKey: 're_k', from: 'a@b.c' },
    sso: { github: { clientId: 'gh', clientSecret: 'ghs' } },
  })
  let res = await request(app).get('/api/auth/settings/public')
  assert.equal(res.status, 200)
  assert.equal(res.body.userLogin, 'profiles')
  assert.equal(res.body.signupOpen, true)
  assert.equal(res.body.mailEnabled, true)
  assert.deepEqual(res.body.sso, { apple: false, google: false, github: true })
  assert.equal(res.body.hasAdmin, true)
  assert.equal(res.body.serverCodeRequired, false)
  assert.equal(JSON.stringify(res.body).includes('re_k'), false)
  assert.equal(res.body.mail, undefined)

  await request(app).post('/api/auth/settings/server-code').set('Cookie', nidCookie).send({ action: 'rotate' })
  res = await request(app).get('/api/auth/settings/public')
  assert.equal(res.status, 200)
  assert.equal(res.body.serverCodeRequired, true)
  assert.equal(JSON.stringify(res.body).includes((await getSettings()).serverCode), false)
})
