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
import http from 'node:http'
import { writeFileSync, mkdtempSync as mkd } from 'node:fs'
import { tmpdir } from 'node:os'
import { startDb, stopDb, makeApp, createProfile, loginAsNid } from './helpers.js'
import { seedClients, approve, redeemCode } from '../lib/oauth.js'

const here = path.dirname(fileURLToPath(import.meta.url))
mkdirSync(path.join(here, 'tmp'), { recursive: true })
const copyDir = mkdtempSync(path.join(here, 'tmp', 'app-data-'))
cpSync(path.join(here, '..', '..', 'server'), copyDir, { recursive: true })
const { appDataRouter } = await import(path.join(copyDir, 'appData.js'))

let todo, notes

const serve = (appId) => express().use(cookieParser()).use(appDataRouter({ appId }))

before(async () => {
  await startDb()
  await seedClients()
  todo = serve('todo')
  notes = serve('notes')
})
after(async () => {
  rmSync(copyDir, { recursive: true, force: true })
  await stopDb()
})

async function account() {
  const handle = `u${randomBytes(4).toString('hex')}`
  return createProfile({
    name: 'Jana',
    account: { handle, handleLower: handle, email: `${handle}@example.org`, emailLower: `${handle}@example.org`, identities: [] },
  })
}

async function mint(profile, clientId, scopes = ['profile', 'data']) {
  const redirectUri = `com.nucleushome.${clientId}:/oauth`
  const verifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
  const code = await approve({ clientId, profileId: profile._id, scopes, redirectUri, codeChallenge })
  const pair = await redeemCode({ code, clientId, redirectUri, verifier })
  return pair.accessToken ?? pair.access_token
}

const auth = (r, token) => r.set('Authorization', `Bearer ${token}`)

test('put/get versions, ETag, 304 and 412', async () => {
  const token = await mint(await account(), 'todo')
  let res = await auth(request(todo).put('/api/v1/app-data/lists').set('If-None-Match', '*'), token).send({ value: { a: 1 } })
  assert.equal(res.status, 201)
  assert.equal(res.body.version, 1)
  assert.equal(res.headers.etag, '"1"')

  res = await auth(request(todo).put('/api/v1/app-data/lists').set('If-None-Match', '*'), token).send({ value: 2 })
  assert.equal(res.status, 412)
  assert.equal(res.body.error.code, 'version_mismatch')
  assert.deepEqual(res.body.error.details, { version: 1 })

  res = await auth(request(todo).get('/api/v1/app-data/lists'), token)
  assert.deepEqual(res.body.value, { a: 1 })
  assert.equal(res.headers.etag, '"1"')
  res = await auth(request(todo).get('/api/v1/app-data/lists').set('If-None-Match', 'W/"1"'), token)
  assert.equal(res.status, 304)

  res = await auth(request(todo).put('/api/v1/app-data/lists').set('If-Match', '"1"'), token).send({ value: { a: 2 } })
  assert.equal(res.status, 200)
  assert.equal(res.body.version, 2)
  res = await auth(request(todo).put('/api/v1/app-data/lists').set('If-Match', '"1"'), token).send({ value: 3 })
  assert.equal(res.status, 412)
  assert.equal(res.body.error.details.version, 2)

  res = await auth(request(todo).get('/api/v1/app-data'), token)
  assert.deepEqual(res.body.keys.map(k => [k.key, k.version]), [['lists', 2]])
  assert.equal(res.body.usage.keys, 1)
  assert.ok(res.body.usage.quotaBytes > 0 && res.body.usage.files.quotaBytes > 0)

  res = await auth(request(todo).delete('/api/v1/app-data/lists').set('If-Match', '"1"'), token)
  assert.equal(res.status, 412)
  assert.equal((await auth(request(todo).delete('/api/v1/app-data/lists').set('If-Match', '"2"'), token)).status, 204)
  assert.equal((await auth(request(todo).get('/api/v1/app-data/lists'), token)).status, 404)
  assert.equal((await auth(request(todo).delete('/api/v1/app-data/lists'), token)).status, 404)
})

test('bad keys and bodies are 400', async () => {
  const token = await mint(await account(), 'todo')
  assert.equal((await auth(request(todo).get('/api/v1/app-data/-bad'), token)).status, 400)
  const res = await auth(request(todo).put('/api/v1/app-data/k'), token).send({ nope: 1 })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'bad_request')
})

test('quota and value size are 413', async () => {
  const token = await mint(await account(), 'todo')
  await mongoose.connection.db.collection('auth_settings').updateOne(
    { _id: 'auth' }, { $set: { limits: { dataValueBytes: 100, dataQuotaBytes: 150, dataMaxKeys: 2 } } }, { upsert: true })
  try {
    await new Promise(r => setTimeout(r, 5100))
    let res = await auth(request(todo).put('/api/v1/app-data/big'), token).send({ value: 'x'.repeat(200) })
    assert.equal(res.status, 413)
    assert.equal(res.body.error.code, 'too_large')
    assert.equal((await auth(request(todo).put('/api/v1/app-data/a'), token).send({ value: 'x'.repeat(80) })).status, 201)
    res = await auth(request(todo).put('/api/v1/app-data/b'), token).send({ value: 'x'.repeat(80) })
    assert.equal(res.status, 413)
    assert.equal((await auth(request(todo).put('/api/v1/app-data/a'), token).send({ value: 'x'.repeat(90) })).status, 200)
  } finally {
    await mongoose.connection.db.collection('auth_settings').deleteOne({ _id: 'auth' })
  }
})

test('files are write-once with checksums', async () => {
  const token = await mint(await account(), 'notes')
  const bytes = Buffer.from('hello world')
  const sha = createHash('sha256').update(bytes).digest('hex')
  const put = (body, headers = {}) => {
    let r = auth(request(notes).put('/api/v1/files/img1'), token).set('Content-Type', 'image/png')
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v)
    return r.send(body)
  }
  let res = await put(bytes, { 'X-File-Name': 'a%20b.png', 'X-Content-SHA256': sha })
  assert.equal(res.status, 201)
  assert.equal(res.body.sha256, sha)
  assert.equal(res.body.name, 'a b.png')
  assert.equal((await put(bytes)).status, 200)
  res = await put(Buffer.from('other'))
  assert.equal(res.status, 409)
  assert.equal(res.body.error.code, 'file_exists')
  res = await put(Buffer.from('zzz'), { 'X-Content-SHA256': sha })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'checksum_mismatch')

  res = await auth(request(notes).get('/api/v1/files/img1'), token).buffer(true).parse((r, cb) => {
    const chunks = []
    r.on('data', c => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)))
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.toString(), 'hello world')
  assert.equal(res.headers['x-content-sha256'], sha)
  assert.equal(res.headers['content-type'], 'image/png')
  assert.match(res.headers['cache-control'], /immutable/)
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.match(res.headers['content-disposition'], /^attachment/)
  assert.equal((await auth(request(notes).head('/api/v1/files/img1'), token)).status, 200)
  assert.equal((await auth(request(notes).get('/api/v1/files/img1').set('If-None-Match', `"${sha}"`), token)).status, 304)

  res = await auth(request(notes).get('/api/v1/files'), token)
  assert.equal(res.body.files.length, 1)
  assert.equal(res.body.nextCursor, null)
  assert.equal(res.body.files[0].id, 'img1')
  res = await auth(request(notes).get('/api/v1/app-data'), token)
  assert.equal(res.body.usage.files.count, 1)

  assert.equal((await auth(request(notes).delete('/api/v1/files/img1'), token)).status, 204)
  assert.equal((await auth(request(notes).get('/api/v1/files/img1'), token)).status, 404)
})

test('a token for another app, or without data, is refused', async () => {
  const profile = await account()
  const foreign = await mint(profile, 'notes')
  assert.equal((await auth(request(todo).get('/api/v1/app-data'), foreign)).status, 403)
  const noData = await mint(profile, 'todo', ['profile'])
  assert.equal((await auth(request(todo).get('/api/v1/app-data'), noData)).status, 403)
  assert.equal((await request(todo).get('/api/v1/app-data')).status, 401)
  assert.equal((await request(todo).get('/api/v1/app-data').set('Cookie', await loginAsNid(profile))).status, 200)
})

test('accounts are isolated', async () => {
  const a = await mint(await account(), 'todo')
  const b = await mint(await account(), 'todo')
  await auth(request(todo).put('/api/v1/app-data/mine'), a).send({ value: 1 })
  assert.equal((await auth(request(todo).get('/api/v1/app-data/mine'), b)).status, 404)
})

test('views and commands across apps need their scopes', async () => {
  const profile = await account()
  const publisher = await mint(profile, 'notes')
  const reader = await mint(profile, 'todo', ['profile', 'read:notes/notes', 'send:notes/createNote'])
  const plain = await mint(profile, 'todo')

  let res = await auth(request(notes).put('/api/v1/views/notes'), publisher).send({ value: [1] })
  assert.equal(res.status, 201)
  res = await auth(request(notes).get('/api/v1/apps/notes/views/notes'), reader)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.value, [1])
  assert.equal(res.body.app, 'notes')
  assert.equal((await auth(request(notes).get('/api/v1/apps/notes/views/notes'), plain)).status, 403)
  // exposed views only: a name the client doesn't expose is 404 even if published
  await auth(request(notes).put('/api/v1/views/secret'), publisher).send({ value: 1 })
  const sneaky = await mint(profile, 'todo', ['profile', 'read:notes/notes'])
  assert.equal((await auth(request(notes).get('/api/v1/apps/notes/views/secret'), sneaky)).status, 403)

  res = await auth(request(notes).post('/api/v1/apps/notes/commands'), plain).send({ type: 'createNote', payload: {} })
  assert.equal(res.status, 403)
  res = await auth(request(notes).post('/api/v1/apps/notes/commands'), reader).send({ type: 'createNote', payload: { title: 'x' } })
  assert.equal(res.status, 201)
  assert.equal(res.body.status, 'pending')
  const id = res.body.id

  res = await auth(request(todo).get(`/api/v1/commands/sent/${id}`), reader)
  assert.equal(res.status, 200)
  res = await auth(request(notes).get('/api/v1/commands/inbox'), publisher)
  assert.deepEqual(res.body.commands.map(c => [c.id, c.status]), [[id, 'delivered']])
  assert.equal((await auth(request(todo).delete(`/api/v1/commands/sent/${id}`), reader)).status, 409)
  res = await auth(request(notes).post(`/api/v1/commands/${id}/settle`), publisher).send({ status: 'applied', result: { ok: 1 } })
  assert.equal(res.body.status, 'applied')
  assert.equal((await auth(request(notes).post(`/api/v1/commands/${id}/settle`), publisher).send({ status: 'applied' })).status, 409)
  assert.deepEqual((await auth(request(notes).get('/api/v1/commands/inbox'), publisher)).body.commands, [])

  // unexposed command type
  const other = await mint(profile, 'todo', ['profile'])
  assert.equal((await auth(request(notes).post('/api/v1/apps/notes/commands'), other).send({ type: 'wipe' })).status, 403)
})

test('auth-server proxies /api/v1 data calls to the installed app server', async () => {
  const stub = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c)).on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json', 'x-stub': '1' })
      res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() }))
    })
  })
  await new Promise(r => stub.listen(0, '127.0.0.1', r))
  const appsDir = mkd(path.join(tmpdir(), 'apps-'))
  mkdirSync(path.join(appsDir, 'todo'))
  writeFileSync(path.join(appsDir, 'todo', 'nucleus.app.json'),
    JSON.stringify({ id: 'todo', nucleusId: { clientId: 'todo' }, server: { service: '127.0.0.1', port: stub.address().port } }))
  process.env.APPS_DIR = appsDir
  const gateway = makeApp()
  try {
    const profile = await account()
    const token = await mint(profile, 'todo')
    const res = await auth(request(gateway).put('/api/v1/app-data/k?x=1'), token).send({ value: 1 })
    assert.equal(res.status, 201)
    assert.equal(res.headers['x-stub'], '1')
    assert.equal(res.body.method, 'PUT')
    assert.equal(res.body.url, '/api/v1/app-data/k?x=1')
    assert.equal(res.body.auth, `Bearer ${token}`)
    assert.equal(res.body.body, '{"value":1}')

    const cross = await auth(request(gateway).get('/api/v1/apps/todo/views/lists'), token)
    assert.equal(cross.body.url, '/api/v1/apps/todo/views/lists')

    const notesToken = await mint(profile, 'notes')
    const missing = await auth(request(gateway).get('/api/v1/files'), notesToken)
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'app_not_installed')
    assert.equal((await request(gateway).get('/api/v1/app-data')).status, 401)
  } finally {
    delete process.env.APPS_DIR
    stub.close()
  }
})

test('admin lists app data and drops only uninstalled apps', async () => {
  const profile = await account()
  const token = await mint(profile, 'todo')
  await auth(request(todo).put('/api/v1/app-data/k'), token).send({ value: 1 })
  const ghost = mongoose.connection.db.collection('gone_appdata')
  await ghost.insertOne({ _id: { account: 'a', key: 'k' }, size: 1, version: 1 })

  const appsDir = mkd(path.join(tmpdir(), 'apps-'))
  mkdirSync(path.join(appsDir, 'todo'))
  writeFileSync(path.join(appsDir, 'todo', 'nucleus.app.json'), JSON.stringify({ id: 'todo', nucleusId: { clientId: 'todo' } }))
  process.env.APPS_DIR = appsDir
  const gateway = makeApp()
  try {
    const admin = await createProfile({ name: 'boss', role: 'admin', account: { handle: 'boss', handleLower: 'boss', email: 'b@example.org', emailLower: 'b@example.org', identities: [] } })
    const cookie = await loginAsNid(admin)
    const list = await request(gateway).get('/api/auth/settings/data').set('Cookie', cookie)
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.map(a => [a.appId, a.installed]), [['gone', false], ['notes', false], ['todo', true]])
    assert.equal((await request(gateway).delete('/api/auth/settings/data/todo').set('Cookie', cookie)).status, 409)
    assert.equal((await request(gateway).delete('/api/auth/settings/data/gone').set('Cookie', cookie)).status, 204)
    assert.equal((await request(gateway).delete('/api/auth/settings/data/gone').set('Cookie', cookie)).status, 404)
    assert.equal((await request(gateway).get('/api/auth/settings/data')).status, 401)
  } finally {
    delete process.env.APPS_DIR
  }
})

test('proxy strips cookies from the request and set-cookie from the response', async () => {
  let seen
  const upstream = http.createServer((req, res) => {
    seen = req.headers
    res.setHeader('Set-Cookie', 'sid=evil')
    res.end('ok')
  })
  await new Promise(r => upstream.listen(0, '127.0.0.1', r))
  const appsDir = mkd(path.join(tmpdir(), 'apps-'))
  mkdirSync(path.join(appsDir, 'todo'))
  writeFileSync(path.join(appsDir, 'todo', 'nucleus.app.json'), JSON.stringify({
    id: 'todo', nucleusId: { clientId: 'todo' }, server: { service: '127.0.0.1', port: upstream.address().port },
  }))
  process.env.APPS_DIR = appsDir
  try {
    const res = await request(makeApp()).get('/api/v1/apps/todo/ping').set('Cookie', 'nid=secret').set('X-Forwarded-For', '6.6.6.6')
    assert.equal(res.status, 200)
    assert.equal(seen.cookie, undefined)
    assert.equal(res.headers['set-cookie'], undefined)
  } finally {
    delete process.env.APPS_DIR
    upstream.close()
  }
})
