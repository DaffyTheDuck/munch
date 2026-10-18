// @ts-nocheck uses the web app's Dexie database against an in-memory IndexedDB
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

// minimal localStorage for node
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
} as Storage
Object.defineProperty(globalThis.localStorage, 'length', { get: () => store.size })

import { db, deleteEntries, deleteWeight, saveGoals, saveDiet, loadDiet, wipeLocalData, exportAll, importAll } from '../src/db'
import { createLocalAdapter } from '../src/lib/localSync'
import { syncOnce, type RemoteAdapter, type SyncRecord, type CollectionName } from '../shared/sync'

// Same fake cloud as the engine tests
class FakeRemote implements RemoteAdapter {
  docs: Record<string, Map<string, { rec: SyncRecord; at: number }>> = {}
  clock = 0
  col(c: string) {
    return (this.docs[c] ??= new Map())
  }
  async push(c: CollectionName, recs: SyncRecord[]) {
    this.clock++
    for (const r of recs) this.col(c).set(r.cid, { rec: structuredClone(r), at: this.clock })
  }
  async pull(c: CollectionName, cursor: string) {
    const after = Number(cursor || 0)
    const all = [...this.col(c).values()].filter((d) => d.at > after).sort((a, b) => a.at - b.at)
    return { records: all.map((d) => structuredClone(d.rec)), cursor: String(all.length ? all[all.length - 1].at : after), more: false }
  }
}

const entry = (name: string, extra = {}) => ({ date: '2026-10-18', createdAt: 1, kind: 'food', name, quantity: '1', calories: 100, protein: 1, carbs: 1, fat: 1, ...extra })

beforeEach(async () => {
  store.clear()
  await db.transaction('rw', [db.entries, db.weights, db.corrections, db.tombstones], async () => {
    await Promise.all([db.entries.clear(), db.weights.clear(), db.corrections.clear(), db.tombstones.clear()])
  })
})

describe('web local store stamps changes for sync', () => {
  it('gives new records an id and marks them dirty', async () => {
    const id = await db.entries.add(entry('Toast'))
    const row = await db.entries.get(id)
    expect(row.cid).toMatch(/.+/)
    expect(row.dirty).toBe(1)
    expect(row.updatedAt).toBeGreaterThan(0)
  })

  it('bumps updatedAt and re-marks dirty on edit', async () => {
    const id = await db.entries.add(entry('Toast'))
    await db.entries.update(id, { dirty: 0, updatedAt: 5 }) // pretend it was synced long ago
    await db.entries.update(id, { calories: 250 })
    const row = await db.entries.get(id)
    expect(row.dirty).toBe(1)
    expect(row.updatedAt).toBeGreaterThan(5)
  })

  it('uses a deterministic id for weights (one per day)', async () => {
    const id = await db.weights.add({ date: '2026-10-18', kg: 71 })
    expect((await db.weights.get(id)).cid).toBe('w-2026-10-18')
  })

  it('deleting leaves a tombstone', async () => {
    const id = await db.entries.add(entry('Toast'))
    const cid = (await db.entries.get(id)).cid
    await deleteEntries([id])
    expect(await db.entries.count()).toBe(0)
    expect((await db.tombstones.get(`entries:${cid}`)).cid).toBe(cid)
  })
})

describe('web adapter + sync engine', () => {
  const uid = 'u1'

  it('uploads dirty rows once, then nothing', async () => {
    await db.entries.add(entry('Toast'))
    const remote = new FakeRemote()
    const local = createLocalAdapter(uid)
    expect((await syncOnce(local, remote)).pushed).toBe(1)
    expect((await syncOnce(local, remote)).pushed).toBe(0)
    expect((await db.entries.toArray())[0].dirty).toBe(0)
  })

  it('pulling remote data does not mark it dirty (no echo)', async () => {
    const remote = new FakeRemote()
    await remote.push('entries', [{ cid: 'r1', updatedAt: 500, data: entry('From phone') }])
    const local = createLocalAdapter(uid)
    expect((await syncOnce(local, remote)).pulled).toBe(1)
    const row = (await db.entries.toArray())[0]
    expect(row).toMatchObject({ cid: 'r1', name: 'From phone', dirty: 0, updatedAt: 500 })
    expect((await syncOnce(local, remote)).pushed).toBe(0)
  })

  it('a local edit made while applying remote data is still marked dirty', async () => {
    const remote = new FakeRemote()
    await remote.push('entries', [{ cid: 'r1', updatedAt: 500, data: entry('Remote') }])
    const local = createLocalAdapter(uid)
    await syncOnce(local, remote)
    const id = (await db.entries.toArray())[0].id
    await db.entries.update(id, { name: 'Edited here' })
    expect((await db.entries.get(id)).dirty).toBe(1)
    expect((await syncOnce(local, remote)).pushed).toBe(1)
    expect(remote.col('entries').get('r1').rec.data.name).toBe('Edited here')
  })

  it('propagates a delete and ignores a stale remote copy of it', async () => {
    const remote = new FakeRemote()
    const local = createLocalAdapter(uid)
    const id = await db.entries.add(entry('Toast'))
    await syncOnce(local, remote)
    const cid = (await db.entries.get(id)).cid
    await deleteEntries([id])
    await syncOnce(local, remote)
    expect(remote.col('entries').get(cid).rec.deleted).toBe(true)
    expect(await db.tombstones.count()).toBe(0) // marker cleared after upload
    expect(await db.entries.count()).toBe(0)
  })

  it('applies a remote delete to the local row', async () => {
    const remote = new FakeRemote()
    const local = createLocalAdapter(uid)
    const id = await db.entries.add(entry('Toast'))
    await syncOnce(local, remote)
    const cid = (await db.entries.get(id)).cid
    await remote.push('entries', [{ cid, updatedAt: Date.now() + 10000, deleted: true }])
    await syncOnce(local, remote)
    expect(await db.entries.count()).toBe(0)
  })

  it('undo after delete resurrects the record instead of deleting it remotely', async () => {
    const remote = new FakeRemote()
    const local = createLocalAdapter(uid)
    const id = await db.entries.add(entry('Toast'))
    await syncOnce(local, remote)
    const old = await db.entries.get(id)
    await deleteEntries([id])
    const { id: _id, ...copy } = old
    await db.entries.add(copy) // the UI's Undo re-adds the same record (same cid)
    await syncOnce(local, remote)
    expect(remote.col('entries').get(old.cid).rec.deleted).toBeFalsy()
    expect(await db.entries.count()).toBe(1)
  })

  it('keeps the newer side when local and remote both changed', async () => {
    const remote = new FakeRemote()
    const local = createLocalAdapter(uid)
    const id = await db.entries.add(entry('Original'))
    await syncOnce(local, remote)
    const cid = (await db.entries.get(id)).cid
    await remote.push('entries', [{ cid, updatedAt: Date.now() + 60000, data: entry('Newer on phone') }])
    await db.entries.update(id, { name: 'Older local edit' })
    await syncOnce(local, remote)
    expect((await db.entries.get(id)).name).toBe('Newer on phone')
  })

  it('syncs goals through the settings collection', async () => {
    saveGoals({ calories: 1800, protein: 120, carbs: 180, fat: 55, targetKg: 65 })
    const remote = new FakeRemote()
    const local = createLocalAdapter(uid)
    expect((await syncOnce(local, remote)).pushed).toBe(1)
    expect(remote.col('settings').get('goals').rec.data.calories).toBe(1800)

    // another device changed goals later
    await remote.push('settings', [{ cid: 'goals', updatedAt: Date.now() + 5000, data: { calories: 2200, protein: 100, carbs: 250, fat: 65, targetKg: 70 } }])
    await syncOnce(local, remote)
    expect(JSON.parse(localStorage.getItem('goals')).calories).toBe(2200)
    expect(localStorage.getItem('settings:dirty:goals')).toBeNull()
  })

  it('uploads goals saved before sync existed', async () => {
    localStorage.setItem('goals', JSON.stringify({ calories: 1700 }))
    const remote = new FakeRemote()
    expect((await syncOnce(createLocalAdapter(uid), remote)).pushed).toBe(1)
  })
})

describe('food preferences sync', () => {
  it('uploads diet preferences through the settings collection and takes newer ones from the cloud', async () => {
    saveDiet({ base: 'vegetarian', overrides: { 1: 'nonveg', 3: 'nonveg' }, allergies: ['nuts'], dislikes: [], cuisines: ['indian'] })
    const remote = new FakeRemote()
    const local = createLocalAdapter('u1')
    expect((await syncOnce(local, remote)).pushed).toBe(1)
    expect(remote.col('settings').get('diet').rec.data).toMatchObject({ base: 'vegetarian', overrides: { 1: 'nonveg', 3: 'nonveg' } })

    await remote.push('settings', [{ cid: 'diet', updatedAt: Date.now() + 5000, data: { base: 'vegan', overrides: {}, allergies: [], dislikes: [], cuisines: [] } }])
    await syncOnce(local, remote)
    expect(loadDiet().base).toBe('vegan')
  })

  it('wipe removes preferences too', async () => {
    saveDiet({ base: 'jain', overrides: {}, allergies: [], dislikes: [], cuisines: [] })
    await wipeLocalData()
    expect(localStorage.getItem('diet')).toBeNull()
  })
})

describe('backup and wipe', () => {
  it('export excludes sync bookkeeping and import replaces data with tombstones for the old rows', async () => {
    const id = await db.entries.add(entry('Old'))
    const oldCid = (await db.entries.get(id)).cid
    const dump = JSON.parse(await exportAll())
    expect(dump.entries[0].cid).toBeUndefined()
    expect(dump.entries[0].dirty).toBeUndefined()

    await importAll(JSON.stringify({ entries: [entry('Imported')], weights: [], corrections: [] }))
    const rows = await db.entries.toArray()
    expect(rows.map((r) => r.name)).toEqual(['Imported'])
    expect(rows[0].cid).not.toBe(oldCid)
    expect(await db.tombstones.get(`entries:${oldCid}`)).toBeTruthy()
  })

  it('wipeLocalData clears everything for a different account', async () => {
    await db.entries.add(entry('X'))
    await db.weights.add({ date: '2026-10-18', kg: 70 })
    saveGoals({ calories: 1, protein: 1, carbs: 1, fat: 1, targetKg: 1 })
    await wipeLocalData()
    expect(await db.entries.count()).toBe(0)
    expect(await db.weights.count()).toBe(0)
    expect(localStorage.getItem('goals')).toBeNull()
  })
})

describe('weights', () => {
  it('delete leaves a tombstone keyed by date', async () => {
    const id = await db.weights.add({ date: '2026-10-18', kg: 71 })
    await deleteWeight(id)
    expect(await db.tombstones.get('weights:w-2026-10-18')).toBeTruthy()
  })
})
