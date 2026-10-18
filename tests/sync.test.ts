import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLLECTIONS, createSyncManager, isNewer, syncOnce, type CollectionName, type LocalAdapter, type RemoteAdapter, type SyncRecord } from '../shared/sync'

// ---- in-memory fakes -------------------------------------------------------------------------

class FakeRemote implements RemoteAdapter {
  docs: Record<string, Map<string, { rec: SyncRecord; at: number }>> = {}
  clock = 0
  pageSize = 500
  pushes = 0
  failNext = false
  private col(c: string) {
    return (this.docs[c] ??= new Map())
  }
  async push(c: CollectionName, records: SyncRecord[]) {
    if (this.failNext) {
      this.failNext = false
      throw new Error('network down')
    }
    this.pushes += records.length
    this.clock++ // one server timestamp per batch, like a Firestore batch
    for (const rec of records) this.col(c).set(rec.cid, { rec: structuredClone(rec), at: this.clock })
  }
  async pull(c: CollectionName, cursor: string) {
    const after = Number(cursor || 0)
    const all = [...this.col(c).values()].filter((d) => d.at > after).sort((a, b) => a.at - b.at)
    const page = all.slice(0, this.pageSize)
    return { records: page.map((d) => structuredClone(d.rec)), cursor: String(page.length ? page[page.length - 1].at : after), more: all.length > page.length }
  }
}

class FakeLocal implements LocalAdapter {
  rows: Record<string, Map<string, { rec: SyncRecord; dirty: boolean }>> = {}
  meta = new Map<string, string>()
  private col(c: string) {
    return (this.rows[c] ??= new Map())
  }
  // what the app does when the user edits data
  edit(c: CollectionName, cid: string, data: Record<string, unknown>, at: number) {
    this.col(c).set(cid, { rec: { cid, updatedAt: at, data }, dirty: true })
  }
  remove(c: CollectionName, cid: string, at: number) {
    this.col(c).set(cid, { rec: { cid, updatedAt: at, deleted: true }, dirty: true })
  }
  live(c: CollectionName) {
    return [...this.col(c).values()].filter((r) => !r.rec.deleted).map((r) => r.rec)
  }
  get(c: CollectionName, cid: string) {
    return this.col(c).get(cid)
  }
  async prepare() {}
  async dirty(c: CollectionName) {
    return [...this.col(c).values()].filter((r) => r.dirty).map((r) => structuredClone(r.rec))
  }
  async markClean(c: CollectionName, recs: { cid: string; updatedAt: number }[]) {
    for (const r of recs) {
      const cur = this.col(c).get(r.cid)
      if (cur && cur.rec.updatedAt === r.updatedAt) cur.dirty = false
    }
  }
  async applyRemote(c: CollectionName, recs: SyncRecord[]) {
    let n = 0
    for (const r of recs) {
      if (isNewer(r.updatedAt, this.col(c).get(r.cid)?.rec.updatedAt)) {
        this.col(c).set(r.cid, { rec: structuredClone(r), dirty: false })
        n++
      }
    }
    return n
  }
  async getMeta(k: string) {
    return this.meta.get(k) ?? null
  }
  async setMeta(k: string, v: string) {
    this.meta.set(k, v)
  }
}

const names = (l: FakeLocal) => l.live('entries').map((r) => r.data!.name).sort()

describe('isNewer', () => {
  it('is strictly newer, and accepts anything when there is no local copy', () => {
    expect(isNewer(5, undefined)).toBe(true)
    expect(isNewer(5, 4)).toBe(true)
    expect(isNewer(5, 5)).toBe(false)
    expect(isNewer(4, 5)).toBe(false)
  })
})

describe('syncOnce', () => {
  it('uploads dirty records once and marks them clean', async () => {
    const a = new FakeLocal()
    const remote = new FakeRemote()
    a.edit('entries', 'e1', { name: 'Toast' }, 100)
    expect(await syncOnce(a, remote)).toMatchObject({ pushed: 1 })
    expect(a.get('entries', 'e1')!.dirty).toBe(false)
    expect((await syncOnce(a, remote)).pushed).toBe(0)
    expect(remote.pushes).toBe(1)
  })

  it('a second device receives what the first uploaded', async () => {
    const [a, b, remote] = [new FakeLocal(), new FakeLocal(), new FakeRemote()]
    a.edit('entries', 'e1', { name: 'Toast' }, 100)
    a.edit('weights', 'w-2026-10-18', { kg: 71 }, 100)
    await syncOnce(a, remote)
    const res = await syncOnce(b, remote)
    expect(res.pulled).toBe(2)
    expect(names(b)).toEqual(['Toast'])
    expect(b.live('weights')[0].data).toEqual({ kg: 71 })
  })

  it('last write wins when two devices edit the same record', async () => {
    const [a, b, remote] = [new FakeLocal(), new FakeLocal(), new FakeRemote()]
    a.edit('entries', 'e1', { name: 'Original' }, 100)
    await syncOnce(a, remote)
    await syncOnce(b, remote)
    a.edit('entries', 'e1', { name: 'Edited on A' }, 200)
    b.edit('entries', 'e1', { name: 'Edited on B' }, 300)
    await syncOnce(a, remote)
    await syncOnce(b, remote)
    await syncOnce(a, remote)
    expect(names(a)).toEqual(['Edited on B'])
    expect(names(b)).toEqual(['Edited on B'])
  })

  it('propagates deletes', async () => {
    const [a, b, remote] = [new FakeLocal(), new FakeLocal(), new FakeRemote()]
    a.edit('entries', 'e1', { name: 'Toast' }, 100)
    await syncOnce(a, remote)
    await syncOnce(b, remote)
    b.remove('entries', 'e1', 200)
    await syncOnce(b, remote)
    await syncOnce(a, remote)
    expect(names(a)).toEqual([])
  })

  it('a newer edit beats an older delete (and the reverse)', async () => {
    const [a, b, remote] = [new FakeLocal(), new FakeLocal(), new FakeRemote()]
    a.edit('entries', 'e1', { name: 'Toast' }, 100)
    await syncOnce(a, remote)
    await syncOnce(b, remote)
    a.remove('entries', 'e1', 200)
    b.edit('entries', 'e1', { name: 'Kept' }, 300)
    await syncOnce(a, remote)
    await syncOnce(b, remote)
    await syncOnce(a, remote)
    expect(names(a)).toEqual(['Kept'])
    expect(names(b)).toEqual(['Kept'])
  })

  it('does not ping-pong: once converged nothing is pushed again', async () => {
    const [a, b, remote] = [new FakeLocal(), new FakeLocal(), new FakeRemote()]
    a.edit('entries', 'e1', { name: 'Toast' }, 100)
    await syncOnce(a, remote)
    await syncOnce(b, remote)
    const pushesBefore = remote.pushes
    for (let i = 0; i < 3; i++) {
      await syncOnce(a, remote)
      await syncOnce(b, remote)
    }
    expect(remote.pushes).toBe(pushesBefore)
  })

  it('keeps a record dirty if it was edited again while uploading', async () => {
    const a = new FakeLocal()
    const remote = new FakeRemote()
    a.edit('entries', 'e1', { name: 'v1' }, 100)
    const origPush = remote.push.bind(remote)
    remote.push = async (c, recs) => {
      await origPush(c, recs)
      a.edit('entries', 'e1', { name: 'v2' }, 150) // user edits during the upload
    }
    await syncOnce(a, remote)
    expect(a.get('entries', 'e1')!.dirty).toBe(true)
    remote.push = origPush
    await syncOnce(a, remote)
    expect(a.get('entries', 'e1')!.dirty).toBe(false)
    expect((await new FakeRemote().pull('entries', '')).records).toEqual([]) // sanity: fresh remote is empty
    expect(remote.docs.entries.get('e1')!.rec.data).toEqual({ name: 'v2' })
  })

  it('pulls in pages until everything is received', async () => {
    const [a, b, remote] = [new FakeLocal(), new FakeLocal(), new FakeRemote()]
    remote.pageSize = 2
    for (let i = 0; i < 7; i++) {
      a.edit('entries', `e${i}`, { name: `f${i}` }, 100 + i)
      await syncOnce(a, remote) // separate batches, separate server timestamps
    }
    const res = await syncOnce(b, remote)
    expect(res.pulled).toBe(7)
    expect(b.live('entries')).toHaveLength(7)
  })

  it('syncs every collection', async () => {
    const [a, b, remote] = [new FakeLocal(), new FakeLocal(), new FakeRemote()]
    for (const c of COLLECTIONS) a.edit(c, 'x', { v: c }, 100)
    await syncOnce(a, remote)
    await syncOnce(b, remote)
    for (const c of COLLECTIONS) expect(b.live(c)[0].data).toEqual({ v: c })
  })
})

describe('createSyncManager', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const local = new FakeLocal()
    const remote = new FakeRemote()
    const statuses: string[] = []
    const mgr = createSyncManager({ local, remote, debounceMs: 1000, intervalMs: 30000, onChange: (s) => statuses.push(s.state) })
    return { local, remote, mgr, statuses }
  }

  it('syncs on start and then on the interval', async () => {
    const { local, remote, mgr } = setup()
    mgr.start()
    await vi.advanceTimersByTimeAsync(0)
    local.edit('entries', 'e1', { name: 'A' }, 1)
    await vi.advanceTimersByTimeAsync(30000)
    expect(remote.pushes).toBe(1)
    mgr.stop()
  })

  it('debounces triggers into a single sync', async () => {
    const { local, remote, mgr } = setup()
    mgr.start()
    await vi.advanceTimersByTimeAsync(0)
    local.edit('entries', 'e1', { name: 'A' }, 1)
    mgr.trigger()
    mgr.trigger()
    mgr.trigger()
    await vi.advanceTimersByTimeAsync(999)
    expect(remote.pushes).toBe(0)
    await vi.advanceTimersByTimeAsync(2)
    expect(remote.pushes).toBe(1)
    mgr.stop()
  })

  it('records errors in status and recovers on the next sync', async () => {
    const { local, remote, mgr } = setup()
    local.edit('entries', 'e1', { name: 'A' }, 1)
    remote.failNext = true
    await mgr.syncNow()
    expect(mgr.status()).toMatchObject({ state: 'error', error: 'network down' })
    await mgr.syncNow()
    expect(mgr.status()).toMatchObject({ state: 'idle', error: null })
    expect(mgr.status().lastSyncedAt).not.toBeNull()
    expect(remote.pushes).toBe(1)
  })

  it('never runs two syncs at once and re-runs for changes that arrive mid-sync', async () => {
    const { local, remote, mgr } = setup()
    let concurrent = 0
    let maxConcurrent = 0
    const orig = remote.push.bind(remote)
    remote.push = async (c, r) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((res) => setTimeout(res, 50))
      await orig(c, r)
      concurrent--
    }
    local.edit('entries', 'e1', { name: 'A' }, 1)
    const first = mgr.syncNow()
    local.edit('entries', 'e2', { name: 'B' }, 2)
    const second = mgr.syncNow() // arrives while the first is running
    await vi.advanceTimersByTimeAsync(500)
    await Promise.all([first, second])
    expect(maxConcurrent).toBe(1)
    expect(remote.docs.entries.size).toBe(2)
  })

  it('does nothing after stop()', async () => {
    const { local, remote, mgr } = setup()
    mgr.start()
    await vi.advanceTimersByTimeAsync(0)
    mgr.stop()
    local.edit('entries', 'e1', { name: 'A' }, 1)
    mgr.trigger()
    await vi.advanceTimersByTimeAsync(60000)
    expect(remote.pushes).toBe(0)
  })
})

describe('ordering', () => {
  it('a stale unsynced edit does not overwrite a newer edit already in the cloud', async () => {
    const [a, b, remote] = [new FakeLocal(), new FakeLocal(), new FakeRemote()]
    a.edit('entries', 'e1', { name: 'Original' }, 100)
    await syncOnce(a, remote)
    await syncOnce(b, remote)
    // B edits later and uploads first; A made an older edit while offline and syncs afterwards
    b.edit('entries', 'e1', { name: 'Newer, from B' }, 300)
    await syncOnce(b, remote)
    a.edit('entries', 'e1', { name: 'Older, from A' }, 200)
    await syncOnce(a, remote)
    expect(remote.docs.entries.get('e1')!.rec.data).toEqual({ name: 'Newer, from B' })
    expect(names(a)).toEqual(['Newer, from B'])
    expect(a.get('entries', 'e1')!.dirty).toBe(false)
  })
})
