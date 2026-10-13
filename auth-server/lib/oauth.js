import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import mongoose from 'mongoose'
import Profile from '../models/Profile.js'
import { OAuthClient, OAuthCode, OAuthGrant, OAuthToken } from '../models/OAuth.js'

// Port of nucleus-web server/src/models/oauth.js. Prefixes make a leaked secret recognisable:
// ncs_ client secret, nac_ authorization code, nat_ access token, nrt_ refresh token.

export const SCOPES = ['profile', 'email', 'data']
export const ACCESS_TTL_SECONDS = 3600
const REFRESH_TTL_MS = 90 * 86400_000
const CODE_TTL_MS = 60_000
// A parallel refresh losing the race is normal; a retired token after this means a stolen copy.
const REFRESH_RACE_MS = 30_000
const MAX_CROSS_APP = 50

const CLIENT_ID = /^[a-z0-9][a-z0-9-]{1,48}$/
export const CROSS_APP_SCOPE = /^(read|send):([a-z0-9][a-z0-9-]{1,48})\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/
const EXPOSED_AS = { read: 'view', send: 'command' }
// RFC 7636: 43–128 characters of this alphabet.
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/

const hash = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex')
const secret = (prefix) => prefix + randomBytes(32).toString('base64url')
const challenge = (verifier) => createHash('sha256').update(verifier).digest('base64url')
const sameString = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}
const oid = (id) => new mongoose.Types.ObjectId(String(id))

// First-party apps; labels are nucleus-web's README registrations.
const SEED = [
  {
    _id: 'todo', name: 'Todo', redirectUris: ['com.nucleushome.todo:/oauth'],
    exposes: ['view:lists', 'command:setDone', 'command:addTask'],
    exposeLabels: { 'view:lists': 'See your Todo lists', 'command:setDone': 'Check off tasks in Todo', 'command:addTask': 'Add tasks in Todo' },
  },
  {
    _id: 'notes', name: 'Notes', redirectUris: ['com.nucleushome.notes:/oauth'],
    exposes: ['view:notes', 'command:createNote'],
    exposeLabels: { 'view:notes': 'See your notes', 'command:createNote': 'Add notes in Notes' },
  },
  {
    _id: 'watchlist', name: 'Watchlist', redirectUris: ['com.nucleushome.watchlist:/oauth'],
    exposes: ['view:library', 'command:markWatched', 'command:unmarkWatched'],
    exposeLabels: {
      'view:library': 'See your Watchlist library',
      'command:markWatched': 'Mark things watched in Watchlist',
      'command:unmarkWatched': 'Mark things unwatched in Watchlist',
    },
  },
]

// `trusted` only on insert, so an admin who turned consent back on keeps that across restarts.
export async function seedClients() {
  for (const { _id, ...fields } of SEED) {
    await OAuthClient.updateOne(
      { _id },
      { $set: fields, $setOnInsert: { trusted: true, secretHash: null, createdAt: new Date(), revokedAt: null } },
      { upsert: true },
    )
  }
}

// ── Clients ─────────────────────────────────────────────────────────────────

export async function findClient(id) {
  if (typeof id !== 'string' || !CLIENT_ID.test(id)) return null
  return OAuthClient.findOne({ _id: id, revokedAt: null }).lean()
}

export function clientSecretMatches(client, presented) {
  if (!client.secretHash) return !presented
  if (typeof presented !== 'string' || !presented) return false
  return sameString(hash(presented), client.secretHash)
}

export async function listClients() {
  const [clients, counts] = await Promise.all([
    OAuthClient.find({}).sort({ revokedAt: 1, createdAt: 1 }).lean(),
    OAuthGrant.aggregate([{ $group: { _id: '$clientId', n: { $sum: 1 } } }]),
  ])
  const connected = new Map(counts.map(c => [c._id, c.n]))
  return clients.map(c => clientView(c, connected.get(c._id) || 0))
}

export const clientView = (c, connectedAccounts) => ({
  id: c._id, name: c.name, redirectUris: c.redirectUris, trusted: c.trusted, confidential: !!c.secretHash,
  exposes: c.exposes, exposeLabels: c.exposeLabels || {}, createdAt: c.createdAt, revokedAt: c.revokedAt,
  ...(connectedAccounts === undefined ? {} : { connectedAccounts }),
})

export async function setTrusted(id, trusted) {
  return OAuthClient.findOneAndUpdate({ _id: id, revokedAt: null }, { $set: { trusted } }, { returnDocument: 'after' }).lean()
}

// ── Scopes ──────────────────────────────────────────────────────────────────

async function exposingClients(ids) {
  if (!ids.length) return new Map()
  const rows = await OAuthClient.find({ _id: { $in: ids }, revokedAt: null }).lean()
  return new Map(rows.map(c => [c._id, c]))
}

// Sorted list with `profile` always in it; null when anything named isn't a scope right now.
export async function parseScopes(raw) {
  const asked = [...new Set(String(raw ?? '').split(/\s+/).filter(Boolean))]
  const crossApp = asked.filter(s => !SCOPES.includes(s))
  const parsed = crossApp.map(s => s.match(CROSS_APP_SCOPE))
  if (crossApp.length > MAX_CROSS_APP || parsed.some(m => !m)) return null
  const clients = await exposingClients([...new Set(parsed.map(m => m[2]))])
  const exposed = ([, verb, clientId, name]) => clients.get(clientId)?.exposes.includes(`${EXPOSED_AS[verb]}:${name}`)
  if (!parsed.every(exposed)) return null
  return [...SCOPES.filter(s => s === 'profile' || asked.includes(s)), ...crossApp.sort()]
}

export async function describeScopes(scopes) {
  const parsed = scopes.map(s => s.match(CROSS_APP_SCOPE)).filter(Boolean)
  const clients = await exposingClients([...new Set(parsed.map(m => m[2]))])
  const descriptions = {}
  for (const [scope, verb, clientId, name] of parsed) {
    const client = clients.get(clientId)
    if (!client) continue
    descriptions[scope] = client.exposeLabels?.[`${EXPOSED_AS[verb]}:${name}`]
      ?? (verb === 'read' ? `Read “${name}” from ${client.name}` : `Send “${name}” to ${client.name}`)
  }
  return descriptions
}

// ── Grants ──────────────────────────────────────────────────────────────────

export async function findGrant(clientId, profileId) {
  return OAuthGrant.findOne({ clientId, profileId: oid(profileId) }).lean()
}

async function upsertGrant(clientId, profileId, scopes) {
  const filter = { clientId, profileId: oid(profileId) }
  const update = { $addToSet: { scopes: { $each: scopes } }, $set: { lastUsedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }
  let grant
  try {
    grant = await OAuthGrant.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after' }).lean()
  } catch (err) {
    // Two first approvals at once: the loser's upsert hits the unique index; the row exists now.
    if (err?.code !== 11000) throw err
    grant = await OAuthGrant.findOneAndUpdate(filter, update, { returnDocument: 'after' }).lean()
  }
  // No $sortArray on Mongo 4.4; an empty sorted $push reorders in place.
  await OAuthGrant.updateOne({ _id: grant._id }, { $push: { scopes: { $each: [], $sort: 1 } } })
  return grant
}

export async function approve({ clientId, profileId, scopes, redirectUri, codeChallenge }) {
  const grant = await upsertGrant(clientId, profileId, scopes)
  const code = secret('nac_')
  await OAuthCode.create({
    _id: hash(code), grantId: grant._id, clientId, profileId: oid(profileId),
    redirectUri, scopes, codeChallenge, expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })
  return code
}

export async function listGrantsForProfile(profileId) {
  const grants = await OAuthGrant.find({ profileId: oid(profileId) }).sort({ lastUsedAt: -1 }).lean()
  const clients = await exposingClients([...new Set(grants.map(g => g.clientId))])
  return grants.filter(g => clients.has(g.clientId)).map(g => ({
    clientId: g.clientId, name: clients.get(g.clientId).name, scopes: g.scopes,
    connectedAt: g.createdAt, lastUsedAt: g.lastUsedAt,
  }))
}

// Signs the app out everywhere for this account; its stored data is untouched.
export async function revokeGrant(clientId, profileId) {
  const grant = await OAuthGrant.findOneAndDelete({ clientId, profileId: oid(profileId) }).lean()
  if (!grant) return false
  await Promise.all([OAuthToken.deleteMany({ grantId: grant._id }), OAuthCode.deleteMany({ grantId: grant._id })])
  return true
}

export async function revokeAllForProfile(profileId) {
  const filter = { profileId: oid(profileId) }
  await OAuthGrant.deleteMany(filter)
  await Promise.all([OAuthToken.deleteMany(filter), OAuthCode.deleteMany(filter)])
}

// ── Codes and tokens ────────────────────────────────────────────────────────

async function issuePair(grant, scopes) {
  const accessToken = secret('nat_')
  const refreshToken = secret('nrt_')
  const now = Date.now()
  const base = { grantId: grant._id, clientId: grant.clientId, profileId: grant.profileId, scopes, createdAt: new Date(now) }
  await OAuthToken.insertMany([
    { ...base, _id: hash(accessToken), kind: 'access', expiresAt: new Date(now + ACCESS_TTL_SECONDS * 1000) },
    { ...base, _id: hash(refreshToken), kind: 'refresh', expiresAt: new Date(now + REFRESH_TTL_MS) },
  ])
  await OAuthGrant.updateOne({ _id: grant._id }, { $set: { lastUsedAt: new Date(now) } })
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, scopes }
}

// Returns tokens or the refusal reason. The code is deleted as it is read, so only one caller ever sees it.
export async function redeemCode({ code, clientId, redirectUri, verifier }) {
  if (typeof code !== 'string' || !code.startsWith('nac_')) return 'Unknown or expired code.'
  const row = await OAuthCode.findOneAndDelete({ _id: hash(code) }).lean()
  if (!row || row.expiresAt < new Date()) return 'Unknown or expired code.'
  const grant = await OAuthGrant.findById(row.grantId).lean()
  if (!grant) return 'Unknown or expired code.'
  if (row.clientId !== clientId) return 'That code was issued to another client.'
  if (row.redirectUri !== redirectUri) return 'redirect_uri does not match the one the code was issued for.'
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier) || !sameString(challenge(verifier), row.codeChallenge))
    return 'code_verifier does not match the code_challenge.'
  return issuePair(grant, row.scopes)
}

export async function refresh({ refreshToken, clientId }) {
  if (typeof refreshToken !== 'string' || !refreshToken.startsWith('nrt_')) return 'Unknown or expired refresh token.'
  const id = hash(refreshToken)
  let row = await OAuthToken.findOne({ _id: id, kind: 'refresh' }).lean()
  if (!row || row.expiresAt < new Date()) return 'Unknown or expired refresh token.'
  if (row.clientId !== clientId) return 'That refresh token was issued to another client.'

  if (!row.usedAt) {
    // Compare-and-set on usedAt: of parallel refreshes exactly one retires the token and gets a pair.
    const claimed = await OAuthToken.findOneAndUpdate({ _id: id, usedAt: null }, { $set: { usedAt: new Date() } }).lean()
    if (claimed) {
      const grant = await OAuthGrant.findById(row.grantId).lean()
      if (!grant) return 'Unknown or expired refresh token.'
      return issuePair(grant, row.scopes)
    }
    row = await OAuthToken.findById(id).lean()
    if (!row) return 'Unknown or expired refresh token.'
  }

  if (Date.now() - new Date(row.usedAt).getTime() > REFRESH_RACE_MS) {
    await Promise.all([OAuthToken.deleteMany({ grantId: row.grantId }), OAuthCode.deleteMany({ grantId: row.grantId })])
    console.warn(`[oauth] refresh token reused for grant ${row.grantId}; its tokens were revoked`)
  }
  return 'That refresh token was already used.'
}

// RFC 7009. Revoking a refresh token takes the grant's access tokens with it: the app is done.
export async function revokeToken({ token, clientId }) {
  if (typeof token !== 'string') return
  const row = await OAuthToken.findOne({ _id: hash(token), clientId }).lean()
  if (!row) return
  if (row.kind === 'refresh') await OAuthToken.deleteMany({ $or: [{ _id: row._id }, { grantId: row.grantId, kind: 'access' }] })
  else await OAuthToken.deleteOne({ _id: row._id })
}

// The account, app and scopes behind a live access token, or null.
export async function findAccessToken(token) {
  if (typeof token !== 'string' || !token.startsWith('nat_')) return null
  const row = await OAuthToken.findOne({ _id: hash(token), kind: 'access', expiresAt: { $gt: new Date() } }).lean()
  if (!row) return null
  const [grant, client, profile] = await Promise.all([
    OAuthGrant.exists({ _id: row.grantId }),
    OAuthClient.exists({ _id: row.clientId, revokedAt: null }),
    Profile.findOne({ _id: row.profileId, account: { $exists: true } }).lean(),
  ])
  if (!grant || !client || !profile) return null
  return { grantId: row.grantId, clientId: row.clientId, scopes: row.scopes, profile }
}
