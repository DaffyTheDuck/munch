// @ts-nocheck server modules are plain JS
// Attacks the real HTTP app in-process: forged and replayed tokens, oversized and hostile input, floods,
// parallel abuse, key leakage, thread hijacking, CORS and error leakage. The language-model providers are stubbed.
import { spawnSync } from 'node:child_process'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { createApp } from '../server/app.mjs'
import { UsageStore } from '../server/usage.mjs'
import { threadFor } from '../server/security.mjs'

const PROJECT = 'journable-test'
const SERVER_KEY = 'AIzaSERVERKEY_must_never_be_used_for_own_key_requests'
const OWN_KEY = 'AIzaOWNKEY_1234567890_abcdefghijklmnop'
let privateKey, otherKey, keys
let server, base
const realFetch = globalThis.fetch

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  otherKey = (await generateKeyPair('RS256')).privateKey
  privateKey = pair.privateKey
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] })
})

const token = (claims = {}, { key = () => privateKey, project = PROJECT, expiresIn = '1h', issuer } = {}) =>
  new SignJWT({ email: 'me@example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject(claims.sub ?? 'user-1')
    .setIssuer(issuer ?? `https://securetoken.google.com/${project}`)
    .setAudience(project)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key())

const ENV = ['FIREBASE_PROJECT_ID', 'ALLOWED_EMAILS', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'AI_PROVIDER', 'AI_FALLBACKS', 'LLM_LAYER', 'GROUNDING', 'DAILY_AI_LIMIT', 'GLOBAL_DAILY_AI_LIMIT', 'IP_RATE_LIMIT_PER_MIN', 'AI_RATE_LIMIT_PER_MIN', 'AI_MAX_PARALLEL', 'ALLOWED_ORIGINS', 'COACH_ENGINE', 'RATE_LIMIT_PER_MIN']
const saved = {}
let providerCalls // every request our stubbed providers received
let providerBehaviour

const ANALYZE_JSON = JSON.stringify({ items: [{ type: 'food', name: 'Banana', quantity: '1', grams: 118, calories: 105, protein_g: 1, carbs_g: 27, fat_g: 0, lookup: '' }], note: '' })

async function start(env = {}) {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  Object.assign(process.env, { FIREBASE_PROJECT_ID: PROJECT, GEMINI_API_KEY: SERVER_KEY, AI_PROVIDER: 'gemini', GROUNDING: 'off', LLM_LAYER: '', AI_RATE_LIMIT_PER_MIN: '1000', IP_RATE_LIMIT_PER_MIN: '1000', RATE_LIMIT_PER_MIN: '1000', DAILY_AI_LIMIT: '1000' }, env)
  const app = createApp({ authKeys: keys, usageStore: new UsageStore({ tz: 'UTC' }) })
  await new Promise((r) => (server = app.listen(0, r)))
  base = `http://127.0.0.1:${server.address().port}`
}

beforeEach(() => {
  providerCalls = []
  providerBehaviour = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: ANALYZE_JSON }] } }] } })
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (/generativelanguage|api\.groq|api\.anthropic/.test(u)) {
      providerCalls.push({ url: u, headers: init?.headers ?? {} })
      const r = await providerBehaviour(u, init)
      return new Response(JSON.stringify(r.body), { status: r.status })
    }
    return realFetch(url, init)
  })
})

afterEach(async () => {
  if (server) await new Promise((r) => server.close(r))
  server = undefined
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})
afterAll(() => {
  globalThis.fetch = realFetch
})

const call = (path, { method = 'POST', tok, body, headers = {}, raw } = {}) =>
  realFetch(base + path, {
    method,
    headers: { ...(raw === undefined ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }), ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  })
const analyze = (tok, body = { text: 'a banana' }, headers = {}) => call('/api/analyze', { tok, body, headers })

describe('authentication attacks', () => {
  beforeEach(() => start())

  it('rejects requests with no token, junk, or the "none" algorithm', async () => {
    expect((await analyze()).status).toBe(401)
    expect((await analyze('not.a.jwt')).status).toBe(401)
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, email: 'me@example.com', email_verified: true })).toString('base64url')}.`
    expect((await analyze(none)).status).toBe(401)
  })

  it('rejects an HS256 token signed with the public key (algorithm confusion)', async () => {
    const forged = await new SignJWT({ email: 'me@example.com', email_verified: true })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject('evil').setIssuer(`https://securetoken.google.com/${PROJECT}`).setAudience(PROJECT).setExpirationTime('1h')
      .sign(new TextEncoder().encode('anything'))
    expect((await analyze(forged)).status).toBe(401)
  })

  it('rejects wrong audience, wrong issuer, expired and foreign-signed tokens', async () => {
    expect((await analyze(await token({}, { project: 'someone-elses-project' }))).status).toBe(401)
    expect((await analyze(await token({}, { issuer: 'https://evil.example.com' }))).status).toBe(401)
    expect((await analyze(await token({}, { expiresIn: '-1h' }))).status).toBe(401)
    expect((await analyze(await token({}, { key: () => otherKey }))).status).toBe(401)
  })

  it('accepts a valid token', async () => {
    expect((await analyze(await token())).status).toBe(200)
  })
})

describe('allow-list attacks', () => {
  beforeEach(() => start({ ALLOWED_EMAILS: 'bhavemihir7@gmail.com' }))

  it('refuses unverified emails, other accounts and look-alike addresses', async () => {
    expect((await analyze(await token({ email: 'bhavemihir7@gmail.com', email_verified: false }))).status).toBe(403)
    expect((await analyze(await token({ email: 'other@gmail.com' }))).status).toBe(403)
    expect((await analyze(await token({ email: 'bhave.mihir7@gmail.com' }))).status).toBe(403) // gmail dot trick
    expect((await analyze(await token({ email: 'bhavemihir7@gmail.com.evil.com' }))).status).toBe(403)
    expect((await analyze(await token({ email: 'bhavemihir7@gmail.com ' }))).status).toBe(403)
  })
  it('accepts the listed account in any letter case', async () => {
    expect((await analyze(await token({ email: 'BhaveMihir7@Gmail.com' }))).status).toBe(200)
  })
})

describe('hostile input', () => {
  let tok
  beforeEach(async () => {
    await start()
    tok = await token()
  })

  it('does not read a huge body from someone who is not signed in', async () => {
    const t0 = Date.now()
    const r = await call('/api/analyze', { raw: JSON.stringify({ text: 'x'.repeat(8_000_000) }) })
    expect(r.status).toBe(401)
    expect(Date.now() - t0).toBeLessThan(4000)
  })

  it('limits text length and type', async () => {
    expect((await analyze(tok, { text: 'a'.repeat(5000) })).status).toBe(400)
    expect((await analyze(tok, { text: { $gt: '' } })).status).toBe(400)
    expect((await analyze(tok, { text: ['a'] })).status).toBe(400)
    expect((await analyze(tok, {})).status).toBe(400)
    expect(providerCalls).toHaveLength(0) // nothing hostile ever reached a model
  })

  it('accepts only inline jpeg/png/webp photos of a sane size', async () => {
    const png = 'data:image/png;base64,' + 'A'.repeat(100)
    expect((await analyze(tok, { image: png })).status).toBe(200)
    expect((await analyze(tok, { image: 'https://169.254.169.254/latest/meta-data' })).status).toBe(400) // no URLs: nothing to fetch
    expect((await analyze(tok, { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400)
    expect((await analyze(tok, { image: 'data:text/html;base64,PGgxPg==' })).status).toBe(400)
    expect((await analyze(tok, { image: 'data:image/png;base64,' + 'A'.repeat(9_000_000) })).status).toBe(413)
  })

  it('answers malformed JSON with a small JSON error, not a stack trace', async () => {
    const r = await call('/api/analyze', { tok, raw: '{"text": ' })
    expect(r.status).toBe(400)
    const text = await r.text()
    expect(text).not.toMatch(/at .*\(|node_modules|SyntaxError/)
    expect(JSON.parse(text).error).toBeTruthy()
  })

  it('is not affected by prototype-pollution payloads', async () => {
    const r = await call('/api/analyze', { tok, raw: '{"text":"a banana","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}' })
    expect(r.status).toBe(200)
    expect({}.polluted).toBeUndefined()
  })

  it('never reveals provider error text', async () => {
    providerBehaviour = () => ({ status: 500, body: { error: { message: 'internal host db-7.corp.example account 4421 secret-detail' } } })
    const r = await analyze(tok)
    const body = await r.text()
    expect(body).not.toMatch(/secret-detail|db-7|4421/)
    expect(JSON.parse(body).error).toBeTruthy()
  })

  it('returns JSON 404 for unknown API paths and sends hardening headers', async () => {
    const r = await call('/api/nope', { method: 'GET', tok })
    expect(r.status).toBe(404)
    expect(r.headers.get('x-powered-by')).toBeNull()
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('coach conversations', () => {
  it('namespaces thread ids per user and rejects odd ids', () => {
    expect(threadFor('alice', 'abcdefgh12')).not.toBe(threadFor('bob', 'abcdefgh12'))
    for (const bad of ['../etc', 'a', 'x'.repeat(80), '', null, 42, { a: 1 }, 'spa ce1234']) expect(() => threadFor('u', bad)).toThrow()
  })

  it('refuses to resume a conversation that has nothing waiting', async () => {
    await start({ COACH_ENGINE: 'langgraph' })
    const tok = await token()
    const r = await call('/api/coach/resume', { tok, body: { thread: 'abcdefgh1234', results: [{}], today: '2026-01-01', goals: {} } })
    expect(r.status).toBe(409)
    const bad = await call('/api/coach/resume', { tok, body: { thread: '../../x', results: [], today: '2026-01-01' } })
    expect(bad.status).toBe(400)
  })
})

describe('floods and abuse of the model', () => {
  it('limits requests per address before authentication', async () => {
    await start({ IP_RATE_LIMIT_PER_MIN: '5' })
    const codes = []
    for (let i = 0; i < 8; i++) codes.push((await call('/api/health', { method: 'GET' })).status)
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(codes.slice(5)).toEqual([429, 429, 429])
  })

  it('locks out an address that keeps sending bad tokens', async () => {
    await start()
    const codes = []
    for (let i = 0; i < 24; i++) codes.push((await analyze('bad.token.value')).status)
    expect(codes).toContain(429)
  })

  it('limits how fast one person can call the AI', async () => {
    await start({ AI_RATE_LIMIT_PER_MIN: '3' })
    const tok = await token()
    const codes = []
    for (let i = 0; i < 5; i++) codes.push((await analyze(tok)).status)
    expect(codes).toEqual([200, 200, 200, 429, 429])
  })

  it('limits parallel AI requests per person', async () => {
    await start({ AI_MAX_PARALLEL: '2' })
    providerBehaviour = async () => {
      await new Promise((r) => setTimeout(r, 300))
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: ANALYZE_JSON }] } }] } }
    }
    const tok = await token()
    const results = await Promise.all(Array.from({ length: 6 }, () => analyze(tok)))
    const codes = results.map((r) => r.status)
    expect(codes.filter((c) => c === 200).length).toBe(2)
    expect(codes.filter((c) => c === 429).length).toBe(4)
    expect(providerCalls.length).toBe(2) // the rejected ones never cost a model call
  })

  it('enforces the daily allowance', async () => {
    await start({ DAILY_AI_LIMIT: '2' })
    const tok = await token()
    const codes = []
    for (let i = 0; i < 4; i++) codes.push((await analyze(tok)).status)
    expect(codes).toEqual([200, 200, 429, 429])
    expect(providerCalls.length).toBe(2)
  })

  it('a new account cannot dodge the global cap', async () => {
    await start({ GLOBAL_DAILY_AI_LIMIT: '2' })
    const codes = []
    for (const sub of ['u1', 'u2', 'u3']) codes.push((await analyze(await token({ sub }))).status)
    expect(codes).toEqual([200, 200, 503])
  })
})

describe('bring your own API key', () => {
  const own = { 'X-AI-Provider': 'gemini', 'X-AI-Key': OWN_KEY }

  it('uses only the person\'s key and does not spend their shared allowance', async () => {
    await start({ DAILY_AI_LIMIT: '1' })
    const tok = await token()
    for (let i = 0; i < 3; i++) expect((await analyze(tok, { text: 'a banana' }, own)).status).toBe(200)
    expect(providerCalls).toHaveLength(3)
    for (const c of providerCalls) {
      expect(c.headers['x-goog-api-key']).toBe(OWN_KEY)
      expect(JSON.stringify(c)).not.toContain(SERVER_KEY)
    }
    // the shared allowance is untouched, so one normal request still works, then the limit applies
    expect((await analyze(tok)).status).toBe(200)
    expect((await analyze(tok)).status).toBe(429)
  })

  it('never falls back to the server\'s keys when the person\'s key fails', async () => {
    await start({ GROQ_API_KEY: 'gsk_SERVERGROQKEY_not_to_be_used_12345', AI_FALLBACKS: 'groq' })
    providerBehaviour = () => ({ status: 401, body: { error: { message: `bad key ${OWN_KEY}` } } })
    const r = await analyze(await token(), { text: 'a banana' }, own)
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(providerCalls.every((c) => /generativelanguage/.test(c.url))).toBe(true)
    const body = await r.text()
    expect(body).not.toContain(OWN_KEY) // not echoed back
    expect(body).toMatch(/key was rejected/i)
  })

  it('rejects malformed keys, unknown providers and header tricks', async () => {
    await start()
    const tok = await token()
    expect((await analyze(tok, { text: 'a banana' }, { 'X-AI-Provider': 'gemini', 'X-AI-Key': 'short' })).status).toBe(400)
    expect((await analyze(tok, { text: 'a banana' }, { 'X-AI-Provider': 'evilcorp', 'X-AI-Key': OWN_KEY })).status).toBe(400)
    expect((await analyze(tok, { text: 'a banana' }, { 'X-AI-Provider': 'gemini', 'X-AI-Key': OWN_KEY + ' ; rm -rf' })).status).toBe(400)
    expect((await analyze(tok, { text: 'a banana' }, { 'X-AI-Key': OWN_KEY })).status).toBe(400) // provider missing
    expect(providerCalls).toHaveLength(0)
  })

  it('still needs sign-in and is still rate limited', async () => {
    await start({ AI_RATE_LIMIT_PER_MIN: '2' })
    expect((await analyze(undefined, { text: 'a banana' }, own)).status).toBe(401)
    const tok = await token()
    const codes = []
    for (let i = 0; i < 4; i++) codes.push((await analyze(tok, { text: 'a banana' }, own)).status)
    expect(codes).toEqual([200, 200, 429, 429])
  })

  it('never writes the key to the logs', async () => {
    await start()
    const logs = []
    for (const m of ['log', 'warn', 'error', 'info']) vi.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(' ')))
    providerBehaviour = () => ({ status: 401, body: { error: { message: `bad key ${OWN_KEY}` } } })
    await analyze(await token(), { text: 'a banana' }, own)
    providerBehaviour = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: ANALYZE_JSON }] } }] } })
    await analyze(await token(), { text: 'a banana' }, own)
    expect(logs.join('\n')).not.toContain(OWN_KEY)
  })

  it('checks a key with /api/key/check', async () => {
    await start()
    providerBehaviour = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } })
    const ok = await call('/api/key/check', { tok: await token(), body: {}, headers: own })
    expect(ok.status).toBe(200)
    expect((await call('/api/key/check', { tok: await token(), body: {} })).status).toBe(400)
  })
})

describe('cross-origin access', () => {
  it('gives no access to other websites unless listed', async () => {
    await start({ ALLOWED_ORIGINS: 'https://app.example.com' })
    const evil = await call('/api/health', { method: 'GET', headers: { Origin: 'https://evil.example.com' } })
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
    const good = await call('/api/health', { method: 'GET', headers: { Origin: 'https://app.example.com' } })
    expect(good.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    const pre = await call('/api/analyze', { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('hosting safety', () => {
  it('refuses to start in production without sign-in', () => {
    const r = spawnSync(process.execPath, ['server/index.mjs'], { env: { ...process.env, NODE_ENV: 'production', FIREBASE_PROJECT_ID: '', PORT: '0' }, encoding: 'utf8', timeout: 15000 })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/Refusing to start/)
  })
})
