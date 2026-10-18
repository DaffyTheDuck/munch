// @ts-nocheck server modules are plain JS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GLOBAL_KEY, UsageStore, dayKey, limitsFor, meterAI, nextReset, usageHandler } from '../server/usage.mjs'

const ENV = ['DAILY_AI_LIMIT', 'GLOBAL_DAILY_AI_LIMIT', 'UNLIMITED_EMAILS']
const saved = {}
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  delete process.env.DAILY_AI_LIMIT
  delete process.env.GLOBAL_DAILY_AI_LIMIT
  delete process.env.UNLIMITED_EMAILS
})
afterEach(() => {
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
})

const at = (iso: string) => () => new Date(iso)

describe('day boundaries', () => {
  it('uses the configured time zone', () => {
    const t = new Date('2026-10-18T20:00:00Z') // 01:30 on the 19th in India
    expect(dayKey(t, 'UTC')).toBe('2026-10-18')
    expect(dayKey(t, 'Asia/Kolkata')).toBe('2026-10-19')
  })
  it('finds the next midnight in that zone', () => {
    const r = nextReset(new Date('2026-10-18T10:00:00Z'), 'Asia/Kolkata') // 15:30 IST
    expect(r.toISOString()).toBe('2026-10-18T18:30:00.000Z') // 00:00 IST on the 19th
    expect(nextReset(new Date('2026-10-18T10:00:00Z'), 'UTC').toISOString()).toBe('2026-10-19T00:00:00.000Z')
  })
})

describe('UsageStore', () => {
  it('spends actions until the per-user limit, then refuses without spending', () => {
    const s = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    expect(s.consume('u1', 1, { perUser: 3 })).toMatchObject({ ok: true, used: 1, remaining: 2 })
    s.consume('u1', 2, { perUser: 3 })
    const r = s.consume('u1', 1, { perUser: 3 })
    expect(r).toMatchObject({ ok: false, reason: 'user', used: 3, remaining: 0 })
    expect(s.used('u1')).toBe(3)
  })

  it('does not let a costly action overshoot the limit', () => {
    const s = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    s.consume('u1', 2, { perUser: 3 })
    expect(s.consume('u1', 2, { perUser: 3 }).ok).toBe(false)
    expect(s.consume('u1', 1, { perUser: 3 }).ok).toBe(true)
  })

  it('keeps people separate', () => {
    const s = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    s.consume('a', 3, { perUser: 3 })
    expect(s.consume('b', 1, { perUser: 3 }).ok).toBe(true)
  })

  it('resets on a new day', () => {
    let now = new Date('2026-10-18T10:00:00Z')
    const s = new UsageStore({ now: () => now, tz: 'UTC' })
    s.consume('u1', 3, { perUser: 3 })
    expect(s.consume('u1', 1, { perUser: 3 }).ok).toBe(false)
    now = new Date('2026-10-19T00:01:00Z')
    expect(s.consume('u1', 1, { perUser: 3 })).toMatchObject({ ok: true, used: 1 })
  })

  it('a global cap pauses everyone', () => {
    const s = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    s.consume('a', 2, { perUser: 10, global: 3 })
    expect(s.consume('b', 2, { perUser: 10, global: 3 })).toMatchObject({ ok: false, reason: 'global' })
    expect(s.consume('b', 1, { perUser: 10, global: 3 }).ok).toBe(true)
    expect(s.used(GLOBAL_KEY)).toBe(3)
  })

  it('0 means unlimited', () => {
    const s = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    for (let i = 0; i < 500; i++) expect(s.consume('u1', 1, { perUser: 0, global: 0 }).ok).toBe(true)
  })

  it('refunds', () => {
    const s = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    s.consume('u1', 2, { perUser: 5 })
    s.refund('u1', 2)
    expect(s.used('u1')).toBe(0)
    s.refund('u1', 9)
    expect(s.used('u1')).toBe(0) // never negative
  })

  it('survives a restart through its file, but not a day change', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-')), 'usage.json')
    vi.useFakeTimers()
    const a = new UsageStore({ file, now: at('2026-10-18T10:00:00Z') })
    a.consume('u1', 4, { perUser: 10 })
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).counts.u1).toBe(4)
    expect(new UsageStore({ file, now: at('2026-10-18T12:00:00Z') }).used('u1')).toBe(4) // same day
    expect(new UsageStore({ file, now: at('2026-10-19T12:00:00Z') }).used('u1')).toBe(0) // next day
  })

  it('ignores a corrupt file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-')), 'usage.json')
    fs.writeFileSync(file, '{not json')
    expect(new UsageStore({ file, now: at('2026-10-18T10:00:00Z') }).used('u1')).toBe(0)
  })
})

describe('limitsFor', () => {
  it('defaults to 40 a day, honours overrides and exemptions', () => {
    expect(limitsFor({ email: 'a@x.com' })).toEqual({ perUser: 40, global: 0 })
    process.env.DAILY_AI_LIMIT = '12'
    process.env.GLOBAL_DAILY_AI_LIMIT = '500'
    process.env.UNLIMITED_EMAILS = ' Me@x.com ,other@x.com'
    expect(limitsFor({ email: 'a@x.com' })).toEqual({ perUser: 12, global: 500 })
    expect(limitsFor({ email: 'me@x.com' })).toEqual({ perUser: 0, global: 500 })
    process.env.DAILY_AI_LIMIT = '0'
    expect(limitsFor({ email: 'a@x.com' }).perUser).toBe(0)
  })
})

function run(mw, user) {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    handlers: [],
    set(k, v) { this.headers[k] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    on(ev, fn) { this.handlers.push([ev, fn]) },
    finish() { this.handlers.filter(([e]) => e === 'finish').forEach(([, f]) => f()) },
  }
  let nextCalled = false
  mw({ user }, res, () => (nextCalled = true))
  return { res, nextCalled }
}

describe('meterAI middleware', () => {
  const user = { uid: 'u1', email: 'a@x.com' }

  it('lets requests through and reports usage in headers', () => {
    process.env.DAILY_AI_LIMIT = '3'
    const store = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    const { res, nextCalled } = run(meterAI(1, store), user)
    expect(nextCalled).toBe(true)
    expect(res.headers).toMatchObject({ 'X-AI-Limit': '3', 'X-AI-Used': '1' })
  })

  it('answers 429 with a friendly message once the allowance is spent', () => {
    process.env.DAILY_AI_LIMIT = '2'
    const store = new UsageStore({ now: at('2026-10-18T10:00:00Z'), tz: 'Asia/Kolkata' })
    run(meterAI(2, store), user)
    const { res, nextCalled } = run(meterAI(1, store), user)
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(429)
    expect(res.body).toMatchObject({ code: 'daily_limit', used: 2, limit: 2 })
    expect(res.body.error).toMatch(/used all 2 AI actions/)
    expect(res.body.error).toMatch(/Foods you have logged before/)
  })

  it('answers 503 when the global cap is hit', () => {
    process.env.GLOBAL_DAILY_AI_LIMIT = '1'
    const store = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    run(meterAI(1, store), user)
    const { res } = run(meterAI(1, store), { uid: 'u2', email: 'b@x.com' })
    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe('ai_paused')
  })

  it('does not meter free actions or unauthenticated local use', () => {
    process.env.DAILY_AI_LIMIT = '1'
    const store = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    expect(run(meterAI(0, store), user).nextCalled).toBe(true)
    expect(run(meterAI(1, store), undefined).nextCalled).toBe(true)
    expect(store.used('u1')).toBe(0)
  })

  it('refunds when the request fails on our side, not when it succeeds or the user erred', () => {
    process.env.DAILY_AI_LIMIT = '5'
    const store = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    const a = run(meterAI(2, store), user)
    a.res.statusCode = 500
    a.res.finish()
    expect(store.used('u1')).toBe(0)
    const b = run(meterAI(2, store), user)
    b.res.statusCode = 200
    b.res.finish()
    expect(store.used('u1')).toBe(2)
    const c = run(meterAI(1, store), user)
    c.res.statusCode = 400
    c.res.finish()
    expect(store.used('u1')).toBe(3)
  })

  it('usage endpoint reports used, limit, remaining and reset time', () => {
    process.env.DAILY_AI_LIMIT = '10'
    const store = new UsageStore({ now: at('2026-10-18T10:00:00Z') })
    store.consume('u1', 4, { perUser: 10 })
    const res = { json(b) { this.body = b } } as any
    usageHandler(store)({ user }, res)
    expect(res.body).toMatchObject({ enabled: true, unlimited: false, used: 4, limit: 10, remaining: 6 })
    expect(typeof res.body.resetAt).toBe('string')
    const open = { json(b) { this.body = b } } as any
    usageHandler(store)({}, open)
    expect(open.body).toEqual({ enabled: false })
  })
})
