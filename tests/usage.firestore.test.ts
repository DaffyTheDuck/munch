// @ts-nocheck server modules are plain JS
import { describe, expect, it } from 'vitest'
import { UsageStore } from '../server/usage.mjs'
import { FirestoreUsageBackend } from '../server/usage.firestore.mjs'

// A tiny fake of the metadata server and the Firestore REST API.
function fakeCloud() {
  const docs = new Map()
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, method: init.method ?? 'GET', headers: init.headers })
    if (u.includes('metadata.google.internal')) return new Response(JSON.stringify({ access_token: 'tok-123', expires_in: 3000 }))
    const key = decodeURIComponent(u.split('/serverUsage/')[1])
    if (init.method === 'PATCH') {
      docs.set(key, JSON.parse(init.body))
      return new Response('{}')
    }
    return docs.has(key) ? new Response(JSON.stringify(docs.get(key))) : new Response('{}', { status: 404 })
  }
  return { docs, calls, fetchImpl }
}

const day = () => new Date('2026-10-22T10:00:00Z')

describe('durable usage counts', () => {
  it('survive a restart: a new server instance sees what the old one counted', async () => {
    const cloud = fakeCloud()
    const make = () => new UsageStore({ now: day, tz: 'Asia/Kolkata', backend: new FirestoreUsageBackend({ projectId: 'p', fetchImpl: cloud.fetchImpl }) })

    const first = make()
    await first.init()
    first.consume('alice', 1, { perUser: 40 })
    first.consume('alice', 2, { perUser: 40 })
    first.consume('bob', 1, { perUser: 40 })
    await first.flush() // what happens when the platform stops the instance

    const second = make() // a fresh container, empty memory
    await second.init()
    expect(second.used('alice')).toBe(3)
    expect(second.used('bob')).toBe(1)
    expect(second.used('*')).toBe(4)
    expect(second.consume('alice', 1, { perUser: 40 }).used).toBe(4) // keeps counting, never restarts from 1
  })

  it('authenticates with the service account token and never exposes the document to clients', async () => {
    const cloud = fakeCloud()
    const s = new UsageStore({ now: day, backend: new FirestoreUsageBackend({ projectId: 'p', fetchImpl: cloud.fetchImpl }) })
    s.consume('alice', 1)
    await s.flush()
    const write = cloud.calls.find((c) => c.method === 'PATCH')
    expect(write.headers.Authorization).toBe('Bearer tok-123')
    expect(write.url).toContain('/projects/p/databases/(default)/documents/serverUsage/')
  })

  it('keeps serving from memory when the database is unreachable', async () => {
    const down = { load: async () => { throw new Error('offline') }, save: async () => { throw new Error('offline') } }
    const s = new UsageStore({ now: day, backend: down })
    await s.init()
    expect(s.consume('alice', 1, { perUser: 2 }).ok).toBe(true)
    expect(s.consume('alice', 1, { perUser: 2 }).ok).toBe(true)
    expect(s.consume('alice', 1, { perUser: 2 }).ok).toBe(false) // still enforced
    await expect(s.flush()).resolves.toBeUndefined()
  })

  it('caps refunds per person per day', () => {
    const s = new UsageStore({ now: day })
    for (let i = 0; i < 10; i++) s.consume('alice', 1)
    for (let i = 0; i < 10; i++) s.refund('alice', 1)
    expect(s.used('alice')).toBe(5) // only 5 refunds were honoured
  })
})
