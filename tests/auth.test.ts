// @ts-nocheck server modules are plain JS
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { requireAuth, verifyFirebaseToken } from '../server/auth.mjs'

const PROJECT = 'journable-test'
let privateKey, otherPrivateKey, keys

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  const other = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  otherPrivateKey = other.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  keys = createLocalJWKSet({ keys: [jwk] })
})

const sign = (claims = {}, { key = () => privateKey, project = PROJECT, expiresIn = '1h', kid = 'k1' } = {}) =>
  new SignJWT({ email: 'me@example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(claims.sub ?? 'user-1')
    .setIssuer(`https://securetoken.google.com/${project}`)
    .setAudience(project)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key())

const ENV = ['FIREBASE_PROJECT_ID', 'ALLOWED_EMAILS', 'RATE_LIMIT_PER_MIN']
const saved = {}
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.FIREBASE_PROJECT_ID = PROJECT
  delete process.env.ALLOWED_EMAILS
  delete process.env.RATE_LIMIT_PER_MIN
})
afterEach(() => {
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
})

// minimal express-like request/response
async function run(mw, headers = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  const req = { headers }
  let nextCalled = false
  await mw(req, res, () => (nextCalled = true))
  return { req, res, nextCalled }
}
const bearer = async (opts, claims) => ({ authorization: `Bearer ${await sign(claims, opts)}` })

describe('verifyFirebaseToken', () => {
  it('accepts a valid token and returns the user', async () => {
    const u = await verifyFirebaseToken(await sign({ email: 'Me@Example.com' }), { keys })
    expect(u).toEqual({ uid: 'user-1', email: 'me@example.com', emailVerified: true })
  })
  it('rejects expired tokens', async () => {
    await expect(verifyFirebaseToken(await sign({}, { expiresIn: '-1h' }), { keys })).rejects.toThrow()
  })
  it('rejects tokens for another Firebase project', async () => {
    await expect(verifyFirebaseToken(await sign({}, { project: 'someone-else' }), { keys })).rejects.toThrow()
  })
  it('rejects tokens signed with a different key', async () => {
    await expect(verifyFirebaseToken(await sign({}, { key: () => otherPrivateKey }), { keys })).rejects.toThrow()
  })
  it('rejects garbage', async () => {
    await expect(verifyFirebaseToken('not.a.jwt', { keys })).rejects.toThrow()
  })
})

describe('requireAuth middleware', () => {
  it('stays open when FIREBASE_PROJECT_ID is not set (local development)', async () => {
    delete process.env.FIREBASE_PROJECT_ID
    const { nextCalled } = await run(requireAuth({ keys }))
    expect(nextCalled).toBe(true)
  })

  it('401 without a token', async () => {
    const { res, nextCalled } = await run(requireAuth({ keys }))
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(401)
  })

  it('401 for an invalid or expired token', async () => {
    const { res } = await run(requireAuth({ keys }), await bearer({ expiresIn: '-1h' }))
    expect(res.statusCode).toBe(401)
  })

  it('lets a valid user through and attaches them to the request', async () => {
    const { req, nextCalled } = await run(requireAuth({ keys }), await bearer())
    expect(nextCalled).toBe(true)
    expect(req.user).toMatchObject({ uid: 'user-1', email: 'me@example.com' })
  })

  it('403 when the account is not in ALLOWED_EMAILS', async () => {
    process.env.ALLOWED_EMAILS = 'owner@example.com'
    const { res, nextCalled } = await run(requireAuth({ keys }), await bearer())
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it('allows an account in ALLOWED_EMAILS (case-insensitive) but only if the email is verified', async () => {
    process.env.ALLOWED_EMAILS = ' Me@Example.com , other@x.com'
    expect((await run(requireAuth({ keys }), await bearer())).nextCalled).toBe(true)
    const unverified = await run(requireAuth({ keys }), await bearer({}, { email_verified: false }))
    expect(unverified.res.statusCode).toBe(403)
  })

  it('429 after too many requests, per user', async () => {
    process.env.RATE_LIMIT_PER_MIN = '2'
    const mw = requireAuth({ keys })
    const h = await bearer()
    expect((await run(mw, h)).nextCalled).toBe(true)
    expect((await run(mw, h)).nextCalled).toBe(true)
    expect((await run(mw, h)).res.statusCode).toBe(429)
    const another = await bearer({}, { sub: 'user-2' })
    expect((await run(mw, another)).nextCalled).toBe(true) // a different user is unaffected
  })
})
