import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { startDb, stopDb, makeApp, createProfile, loginAs } from './helpers.js'
import { loadJwtSecret, jwtSecret } from '../lib/secret.js'
import Session from '../models/Session.js'
import express from 'express'
import cookieParser from 'cookie-parser'
import { requireNidAdmin } from '../middleware/auth.js'
import { issueSession } from '../lib/session.js'

let app

before(async () => {
  await startDb()
  app = makeApp()
})
after(stopDb)

function tokenFrom(res) {
  const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('nucleus_token='))
  return cookie && decodeURIComponent(cookie.split(';')[0].slice('nucleus_token='.length))
}

test('login sets a SameSite=Lax cookie whose JWT carries sid and via=pin', async () => {
  const profile = await createProfile({ pin: '1A2B' })
  const res = await loginAs(request(app), profile, '1a2b')
  assert.equal(res.status, 200)
  const cookie = res.headers['set-cookie'].find(c => c.startsWith('nucleus_token='))
  assert.match(cookie, /SameSite=Lax/i)
  assert.match(cookie, /HttpOnly/i)
  assert.doesNotMatch(cookie, /Secure/i)
  const claims = jwt.decode(tokenFrom(res))
  assert.equal(claims.via, 'pin')
  assert.equal(claims.profileId, String(profile._id))
  assert.ok(claims.sid)
  const session = await Session.findById(claims.sid).lean()
  assert.equal(String(session.profileId), String(profile._id))
  assert.equal(session.via, 'pin')
  assert.ok(session.expiresAt > new Date(Date.now() + 29 * 86400_000))
})

test('cookie is Secure behind an https proxy', async () => {
  const profile = await createProfile()
  const res = await loginAs(request(app), profile).set('X-Forwarded-Proto', 'https')
  assert.equal(res.status, 200)
  assert.match(res.headers['set-cookie'].find(c => c.startsWith('nucleus_token=')), /Secure/)
})

test('/me works with the session cookie; logout deletes the session', async () => {
  const profile = await createProfile()
  const agent = request.agent(app)
  const login = await loginAs(agent, profile)
  const { sid } = jwt.decode(tokenFrom(login))

  const me = await agent.get('/api/auth/me')
  assert.equal(me.status, 200)
  assert.equal(me.body.name, profile.name)

  const out = await agent.post('/api/auth/logout')
  assert.equal(out.status, 200)
  assert.equal(await Session.exists({ _id: sid }), null)

  // Replay the old cookie explicitly: the browser dropped it, an attacker might not.
  const replay = await request(app).get('/api/auth/me').set('Cookie', `nucleus_token=${tokenFrom(login)}`)
  assert.equal(replay.status, 401)
})

test('set-pin issues a session too', async () => {
  const profile = await createProfile({ pin: 'AAAA', pinTemporary: true })
  const res = await request(app).post('/api/auth/login/set-pin')
    .send({ profileId: String(profile._id), currentPin: 'AAAA', newPin: 'BBBB' })
  assert.equal(res.status, 200)
  const claims = jwt.decode(tokenFrom(res))
  assert.equal(claims.via, 'pin')
  assert.ok(await Session.exists({ _id: claims.sid }))
})

test('token signed with the legacy public secret is rejected', async () => {
  const profile = await createProfile()
  const token = jwt.sign({ profileId: String(profile._id), name: profile.name, role: 'admin' }, 'nucleus-jwt-secret')
  const res = await request(app).get('/api/auth/me').set('Cookie', `nucleus_token=${token}`)
  assert.equal(res.status, 401)
})

test('validly signed token without a live session is rejected', async () => {
  const profile = await createProfile()
  const claims = { profileId: String(profile._id), name: profile.name, role: 'user', via: 'pin' }
  for (const token of [
    jwt.sign(claims, jwtSecret()),
    jwt.sign({ ...claims, sid: 'no-such-session' }, jwtSecret()),
  ]) {
    const res = await request(app).get('/api/auth/me').set('Cookie', `nucleus_token=${token}`)
    assert.equal(res.status, 401)
  }

  const login = await loginAs(request(app), profile)
  const { sid } = jwt.decode(tokenFrom(login))
  await Session.updateOne({ _id: sid }, { expiresAt: new Date(Date.now() - 1000) })
  const expired = await request(app).get('/api/auth/me').set('Cookie', `nucleus_token=${tokenFrom(login)}`)
  assert.equal(expired.status, 401)
})

test('admin-only profile creation rejects a token without a session', async () => {
  const admin = await createProfile({ role: 'admin', pin: '1234' })
  const forged = jwt.sign({ profileId: String(admin._id), name: admin.name, role: 'admin', sid: 'gone' }, jwtSecret())
  const res = await request(app).post('/api/auth/profiles')
    .set('Cookie', `nucleus_token=${forged}`).send({ name: 'Intruder' })
  assert.equal(res.status, 401)

  const agent = request.agent(app)
  await loginAs(agent, admin, '1234')
  const ok = await agent.post('/api/auth/profiles').send({ name: 'Created' })
  assert.equal(ok.status, 201)
})

test('jwt secret is generated once and persisted', async () => {
  const db = mongoose.connection.db
  const a = await loadJwtSecret(db)
  const b = await loadJwtSecret(db)
  assert.equal(a, b)
  assert.ok(a.length >= 64)
  assert.notEqual(a, 'nucleus-jwt-secret')
  const doc = await db.collection('nucleus_secrets').findOne({ _id: 'jwt' })
  assert.equal(doc.value, a)
})

test('JWT_SECRET env wins unless empty or the legacy default', async () => {
  const db = mongoose.connection.db
  const stored = (await db.collection('nucleus_secrets').findOne({ _id: 'jwt' })).value
  try {
    process.env.JWT_SECRET = 'operator-chosen-secret'
    assert.equal(await loadJwtSecret(db), 'operator-chosen-secret')
    assert.equal(jwtSecret(), 'operator-chosen-secret')
    process.env.JWT_SECRET = 'nucleus-jwt-secret'
    assert.equal(await loadJwtSecret(db), stored)
    process.env.JWT_SECRET = ''
    assert.equal(await loadJwtSecret(db), stored)
  } finally {
    delete process.env.JWT_SECRET
    await loadJwtSecret(db)
  }
})

test('requireNidAdmin demands an admin signed in via NucleusID', async () => {
  const admin = await createProfile({ role: 'admin', pin: '1234' })
  const probe = express()
  probe.use(cookieParser())
  probe.post('/session/:via', async (req, res) => { await issueSession(req, res, admin, req.params.via); res.end() })
  probe.get('/admin', requireNidAdmin, (_req, res) => res.json({ ok: true }))

  const pinAgent = request.agent(probe)
  await pinAgent.post('/session/pin')
  const denied = await pinAgent.get('/admin')
  assert.equal(denied.status, 403)
  assert.equal(denied.body.code, 'nid_required')

  const nidAgent = request.agent(probe)
  await nidAgent.post('/session/nid')
  assert.equal((await nidAgent.get('/admin')).status, 200)
})
