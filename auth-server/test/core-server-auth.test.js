import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import mongoose from 'mongoose'
import { startDb, stopDb, createProfile, loginAsNid } from './helpers.js'
import { OAuthClient, OAuthGrant, OAuthToken } from '../models/OAuth.js'
import Profile from '../models/Profile.js'
import { seedClients, approve, redeemCode } from '../lib/oauth.js'

// core/server has no node_modules on the host; a copy under test/tmp/ (gitignored) resolves
// jsonwebtoken/mongoose from auth-server, sharing this process's mongoose connection.
const here = path.dirname(fileURLToPath(import.meta.url))
mkdirSync(path.join(here, 'tmp'), { recursive: true })
const copyDir = mkdtempSync(path.join(here, 'tmp', 'core-server-'))
cpSync(path.join(here, '..', '..', 'server'), copyDir, { recursive: true })
const { requireAuth, requireScope, verifyProfile } = await import(path.join(copyDir, 'auth.js'))
const { requireAppEnabled } = await import(path.join(copyDir, 'appAccess.js'))

const REDIRECT = 'com.nucleushome.todo:/oauth'
let app

before(async () => {
  await startDb()
  await seedClients()
  app = express()
  app.use(cookieParser())
  app.get('/me', requireAppEnabled('watchlist'), requireAuth, (req, res) => res.json(req.profile))
  app.get('/data', requireAuth, requireScope('data'), (req, res) => res.json({ ok: true }))
  app.get('/peek', async (req, res) => res.json(await verifyProfile(req)))
})
after(async () => {
  rmSync(copyDir, { recursive: true, force: true })
  await stopDb()
})

async function account(attrs = {}) {
  const handle = `u${randomBytes(4).toString('hex')}`
  return createProfile({
    name: attrs.name || 'Jana', role: attrs.role || 'user',
    account: { handle, handleLower: handle, email: `${handle}@example.org`, emailLower: `${handle}@example.org`, identities: [] },
  })
}

// Mints through auth-server's own lib, so the hashing must match core/server's.
async function mint(profile, scopes = ['profile', 'data']) {
  const verifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
  const code = await approve({ clientId: 'todo', profileId: profile._id, scopes, redirectUri: REDIRECT, codeChallenge })
  const pair = await redeemCode({ code, clientId: 'todo', redirectUri: REDIRECT, verifier })
  assert.equal(typeof pair, 'object', String(pair))
  return pair
}

const hashOf = (token) => createHash('sha256').update(token).digest('hex')
const bearer = (token, url = '/me') => request(app).get(url).set('Authorization', `Bearer ${token}`)

function assertInvalid(res) {
  assert.equal(res.status, 401)
  assert.equal(res.headers['www-authenticate'], 'Bearer realm="nucleus", error="invalid_token"')
  assert.equal(res.body.error.code, 'unauthorized')
}

test('cookie session still authenticates', async () => {
  const profile = await account()
  const res = await request(app).get('/me').set('Cookie', await loginAsNid(profile))
  assert.equal(res.status, 200)
  assert.equal(res.body.profileId, String(profile._id))
  assert.equal(res.body.via, 'nid')
})

test('no credentials is 401 with a bearer challenge', async () => {
  const res = await request(app).get('/me')
  assert.equal(res.status, 401)
  assert.equal(res.body.error, 'Unauthenticated')
  assert.equal(res.headers['www-authenticate'], 'Bearer realm="nucleus"')
})

test('a live access token authenticates with role from the database', async () => {
  const profile = await account({ name: 'Petr', role: 'admin' })
  const { accessToken } = await mint(profile)
  const res = await bearer(accessToken)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual(res.body, {
    profileId: String(profile._id), name: 'Petr', role: 'admin', via: 'oauth', clientId: 'todo', scopes: ['profile', 'data'],
  })
  assert.equal((await request(app).get('/peek').set('Authorization', `Bearer ${accessToken}`)).body.via, 'oauth')
})

test('the bearer header wins over a valid cookie', async () => {
  const profile = await account()
  const res = await bearer('nat_bogus').set('Cookie', await loginAsNid(profile))
  assertInvalid(res)
})

test('refresh tokens, other prefixes and unknown tokens are refused', async () => {
  const profile = await account()
  const { refreshToken, accessToken } = await mint(profile)
  assertInvalid(await bearer(refreshToken))
  assertInvalid(await bearer(accessToken.replace('nat_', 'xyz_')))
  assertInvalid(await bearer(`nat_${randomBytes(32).toString('base64url')}`))
  assertInvalid(await bearer(''))
})

test('an expired access token is refused', async () => {
  const { accessToken } = await mint(await account())
  await OAuthToken.updateOne({ _id: hashOf(accessToken) }, { expiresAt: new Date(Date.now() - 1000) })
  assertInvalid(await bearer(accessToken))
})

test('a deleted grant, revoked client or deleted account refuses the token', async () => {
  const a = await mint(await account())
  await OAuthGrant.deleteOne({ _id: (await OAuthToken.findById(hashOf(a.accessToken)).lean()).grantId })
  assertInvalid(await bearer(a.accessToken))

  const p = await account()
  const b = await mint(p)
  await Profile.updateOne({ _id: p._id }, { $unset: { account: 1 } })
  assertInvalid(await bearer(b.accessToken))

  const c = await mint(await account())
  await OAuthClient.updateOne({ _id: 'todo' }, { revokedAt: new Date() })
  try {
    assertInvalid(await bearer(c.accessToken))
  } finally {
    await OAuthClient.updateOne({ _id: 'todo' }, { revokedAt: null })
  }
})

test('a verified token is cached for a few seconds, so revocation lags', async () => {
  const { accessToken } = await mint(await account())
  assert.equal((await bearer(accessToken)).status, 200)
  await OAuthToken.deleteOne({ _id: hashOf(accessToken) })
  assert.equal((await bearer(accessToken)).status, 200)
})

test('requireScope passes cookies and scoped tokens, refuses the rest', async () => {
  const profile = await account()
  assert.equal((await request(app).get('/data').set('Cookie', await loginAsNid(profile))).status, 200)
  assert.equal((await bearer((await mint(profile)).accessToken, '/data')).status, 200)

  const narrow = await mint(await account(), ['profile'])
  const res = await bearer(narrow.accessToken, '/data')
  assert.equal(res.status, 403)
  assert.equal(res.headers['www-authenticate'], 'Bearer realm="nucleus", error="insufficient_scope", scope="data"')
  assert.equal(res.body.error.code, 'forbidden')
})

test('app access reads the admin role from the database, not the JWT', async () => {
  const db = mongoose.connection.db
  const disable = (p) => db.collection('useroverrides').insertOne({ profileId: String(p._id), kind: 'app', itemId: 'watchlist', disabled: true })

  const demoted = await account({ role: 'admin' })
  const demotedCookie = await loginAsNid(demoted)
  await Profile.updateOne({ _id: demoted._id }, { role: 'user' })
  await disable(demoted)
  const blocked = await request(app).get('/me').set('Cookie', demotedCookie)
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'APP_DISABLED')

  const promoted = await account({ role: 'user' })
  const promotedCookie = await loginAsNid(promoted)
  await Profile.updateOne({ _id: promoted._id }, { role: 'admin' })
  await disable(promoted)
  assert.equal((await request(app).get('/me').set('Cookie', promotedCookie)).status, 200)

  const viaToken = await account()
  await disable(viaToken)
  assert.equal((await bearer((await mint(viaToken)).accessToken)).status, 403)
})
