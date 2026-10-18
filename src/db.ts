import { useSyncExternalStore } from 'react'
import Dexie, { type Table } from 'dexie'
import type { Correction, Entry, Goals, WeightEntry } from './types'
import { DEFAULT_PROFILE, type Profile } from './nutrition'
import { DEFAULT_DIET, normalizeDiet, type DietPrefs } from '../shared/diet'
import type { Taste } from '../shared/recommend/taste'

// A marker left behind when a synced record is deleted, so the deletion reaches other devices.
export interface Tombstone {
  key: string // `${collection}:${cid}`
  collection: 'entries' | 'weights' | 'corrections'
  cid: string
  updatedAt: number
}

export const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

class JournableDB extends Dexie {
  entries!: Table<Entry, number>
  weights!: Table<WeightEntry, number>
  corrections!: Table<Correction, number>
  tombstones!: Table<Tombstone, string>

  constructor() {
    super('journable')
    this.version(1).stores({
      entries: '++id, date, createdAt',
      weights: '++id, date',
    })
    this.version(2).stores({
      entries: '++id, date, createdAt',
      weights: '++id, date',
      corrections: '++id, key, createdAt',
    })
    // v3: every record gets a stable id (cid) and is marked dirty so existing data uploads on first sign-in.
    this.version(3)
      .stores({
        entries: '++id, date, createdAt, cid',
        weights: '++id, date, cid',
        corrections: '++id, key, createdAt, cid',
        tombstones: 'key',
      })
      .upgrade(async (tx) => {
        const now = Date.now()
        await tx.table('entries').toCollection().modify((r) => {
          r.cid ||= newId()
          r.updatedAt ||= r.createdAt || now
          r.dirty = 1
        })
        await tx.table('weights').toCollection().modify((r) => {
          r.cid ||= `w-${r.date}`
          r.updatedAt ||= now
          r.dirty = 1
        })
        await tx.table('corrections').toCollection().modify((r) => {
          r.cid ||= newId()
          r.updatedAt ||= r.createdAt || now
          r.dirty = 1
        })
      })
  }
}

export const db = new JournableDB()

// ------------------------------------------------------------------ change tracking
// Every normal write stamps updatedAt and marks the record dirty. Writes made while applying remote changes
// run in a transaction flagged `remote`, which skips the stamp so they never bounce back to the cloud.

const changeListeners = new Set<() => void>()
export function onLocalChange(cb: () => void) {
  changeListeners.add(cb)
  return () => void changeListeners.delete(cb)
}
const fire = () => changeListeners.forEach((cb) => cb())

type Trans = { remote?: boolean }

db.entries.hook('creating', (_pk, obj, trans) => {
  if ((trans as Trans).remote) return
  obj.cid ||= newId()
  obj.updatedAt = Date.now()
  obj.dirty = 1
  fire()
})
db.entries.hook('updating', (_mods, _pk, _obj, trans) => {
  if ((trans as Trans).remote) return
  fire()
  return { updatedAt: Date.now(), dirty: 1 as const }
})

db.weights.hook('creating', (_pk, obj, trans) => {
  if ((trans as Trans).remote) return
  obj.cid ||= `w-${obj.date}`
  obj.updatedAt = Date.now()
  obj.dirty = 1
  fire()
})
db.weights.hook('updating', (_mods, _pk, _obj, trans) => {
  if ((trans as Trans).remote) return
  fire()
  return { updatedAt: Date.now(), dirty: 1 as const }
})

db.corrections.hook('creating', (_pk, obj, trans) => {
  if ((trans as Trans).remote) return
  obj.cid ||= newId()
  obj.updatedAt = Date.now()
  obj.dirty = 1
  fire()
})

/** Run `fn` as a remote-apply transaction: writes inside do not stamp or mark records dirty. */
export function remoteTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [db.entries, db.weights, db.corrections, db.tombstones], async (tx) => {
    ;(tx as unknown as Trans).remote = true
    return fn()
  })
}

// ------------------------------------------------------------------ deletes (leave tombstones so they sync)

export async function deleteEntries(ids: number[]) {
  await db.transaction('rw', db.entries, db.tombstones, async () => {
    const rows = await db.entries.bulkGet(ids)
    const now = Date.now()
    for (const r of rows) if (r?.cid) await db.tombstones.put({ key: `entries:${r.cid}`, collection: 'entries', cid: r.cid, updatedAt: now })
    await db.entries.bulkDelete(ids)
  })
  fire()
}

export async function deleteWeight(id: number) {
  await db.transaction('rw', db.weights, db.tombstones, async () => {
    const r = await db.weights.get(id)
    if (r?.cid) await db.tombstones.put({ key: `weights:${r.cid}`, collection: 'weights', cid: r.cid, updatedAt: Date.now() })
    await db.weights.delete(id)
  })
  fire()
}

// ------------------------------------------------------------------ settings (goals + profile live in localStorage)

let settingsVersion = 0
const settingsListeners = new Set<() => void>()
export function bumpSettings() {
  settingsVersion++
  settingsListeners.forEach((l) => l())
}
/** Call in a component so it re-renders when goals/profile change (including from another device). */
export function useSettingsVersion() {
  return useSyncExternalStore(
    (cb) => {
      settingsListeners.add(cb)
      return () => void settingsListeners.delete(cb)
    },
    () => settingsVersion,
  )
}

export const DEFAULT_GOALS: Goals = { calories: 2000, protein: 100, carbs: 250, fat: 65, targetKg: 70 }
export const SETTING_KEYS = ['goals', 'profile', 'diet', 'taste'] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

export function stampSetting(k: SettingKey) {
  localStorage.setItem(`settings:updatedAt:${k}`, String(Date.now()))
  localStorage.setItem(`settings:dirty:${k}`, '1')
}

export function loadGoals(): Goals {
  try {
    return { ...DEFAULT_GOALS, ...JSON.parse(localStorage.getItem('goals') || '{}') }
  } catch {
    return DEFAULT_GOALS
  }
}

export function saveGoals(g: Goals) {
  localStorage.setItem('goals', JSON.stringify(g))
  stampSetting('goals')
  bumpSettings()
  fire()
}

export function loadProfile(): Profile {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem('profile') || '{}') }
  } catch {
    return DEFAULT_PROFILE
  }
}

export function saveProfile(p: Profile) {
  localStorage.setItem('profile', JSON.stringify(p))
  stampSetting('profile')
  bumpSettings()
  fire()
}

// ------------------------------------------------------------------ food preferences

export function loadDiet(): DietPrefs {
  try {
    return normalizeDiet(JSON.parse(localStorage.getItem('diet') || 'null'))
  } catch {
    return DEFAULT_DIET
  }
}

/** true once the user has saved their food preferences at least once */
export const hasSavedDiet = () => localStorage.getItem('diet') !== null

export function saveDiet(d: DietPrefs) {
  localStorage.setItem('diet', JSON.stringify(normalizeDiet(d)))
  stampSetting('diet')
  bumpSettings()
  fire()
}

// ------------------------------------------------------------------ learned taste (what the recommender has seen you like or swap)

export function loadTaste(): Taste {
  try {
    const v = JSON.parse(localStorage.getItem('taste') || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function saveTaste(t: Taste) {
  localStorage.setItem('taste', JSON.stringify(t))
  stampSetting('taste')
  fire() // upload soon; no screen shows taste directly
}

// ------------------------------------------------------------------ corrections (the AI learns from your edits)

const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)

// Remember what the user corrected so the model can reuse it next time that food comes up.
export async function addCorrection(c: Omit<Correction, 'id' | 'key' | 'createdAt'>) {
  await db.corrections.add({ ...c, key: c.name.toLowerCase(), createdAt: Date.now() })
}

export async function getHints(text: string, max = 5): Promise<string[]> {
  const words = new Set(tokens(text))
  if (!words.size) return []
  const all = await db.corrections.orderBy('createdAt').reverse().limit(300).toArray()
  const seen = new Set<string>()
  const scored: { c: Correction; score: number }[] = []
  for (const c of all) {
    if (seen.has(c.key)) continue
    seen.add(c.key)
    const score = tokens(`${c.name} ${c.quantity}`).filter((w) => words.has(w)).length
    if (score > 0) scored.push({ c, score })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ c }) => `${c.name} (${c.quantity}): ${c.calories} kcal, protein ${c.protein}g, carbs ${c.carbs}g, fat ${c.fat}g`)
}

// ------------------------------------------------------------------ backup, wipe

const syncFields = (r: object) => {
  const { cid: _c, updatedAt: _u, dirty: _d, id: _i, ...rest } = r as Record<string, unknown>
  return rest
}

export async function exportAll() {
  return JSON.stringify({
    entries: (await db.entries.toArray()).map(syncFields),
    weights: (await db.weights.toArray()).map(syncFields),
    corrections: (await db.corrections.toArray()).map(syncFields),
    goals: loadGoals(),
  })
}

// Replaces everything. Existing records get tombstones first, so the replacement also reaches other devices.
export async function importAll(json: string) {
  const data = JSON.parse(json)
  await db.transaction('rw', [db.entries, db.weights, db.corrections, db.tombstones], async () => {
    const now = Date.now()
    const stones = (name: Tombstone['collection'], rows: { cid?: string }[]) =>
      rows.filter((r) => r.cid).map((r) => ({ key: `${name}:${r.cid}`, collection: name, cid: r.cid as string, updatedAt: now }))
    await db.tombstones.bulkPut([
      ...stones('entries', await db.entries.toArray()),
      ...stones('weights', await db.weights.toArray()),
      ...stones('corrections', await db.corrections.toArray()),
    ])
    await db.entries.clear()
    await db.weights.clear()
    await db.corrections.clear()
    await db.entries.bulkAdd((data.entries || []).map((e: Entry) => syncFields(e) as unknown as Entry))
    await db.weights.bulkAdd((data.weights || []).map((w: WeightEntry) => syncFields(w) as unknown as WeightEntry))
    await db.corrections.bulkAdd((data.corrections || []).map((c: Correction) => syncFields(c) as unknown as Correction))
  })
  if (data.goals) saveGoals(data.goals)
  fire()
}

export async function hasLocalData() {
  return (await db.entries.count()) + (await db.weights.count()) + (await db.corrections.count()) > 0
}

/** Removes all data from this device (used when a different account signs in). */
export async function wipeLocalData() {
  await db.transaction('rw', [db.entries, db.weights, db.corrections, db.tombstones], async () => {
    await Promise.all([db.entries.clear(), db.weights.clear(), db.corrections.clear(), db.tombstones.clear()])
  })
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) as string)
  for (const k of keys) if (k === 'goals' || k === 'profile' || k === 'diet' || k === 'taste' || k.startsWith('settings:') || k.startsWith('plan:')) localStorage.removeItem(k)
  bumpSettings()
}
