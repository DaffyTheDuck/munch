import { useEffect, useState, useSyncExternalStore } from 'react'
import * as SQLite from 'expo-sqlite'
import type { Correction, Entry, Goals, Meal, Source, WeightEntry } from '@shared/types'
import { DEFAULT_PROFILE, type Profile } from '@shared/nutrition'
import { DEFAULT_DIET, normalizeDiet, type DietPrefs } from '@shared/diet'
import type { Taste } from '@shared/recommend/taste'

export const newId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
})

// ---------------------------------------------------------------- connection + schema

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

async function columns(db: SQLite.SQLiteDatabase, table: string) {
  return (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name)
}

async function addMissingColumns(db: SQLite.SQLiteDatabase, table: string, defs: Record<string, string>) {
  const have = await columns(db, table)
  for (const [name, def] of Object.entries(defs)) if (!have.includes(name)) await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`)
}

async function init() {
  const db = await SQLite.openDatabaseAsync('journable.db')
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      meal TEXT,
      name TEXT NOT NULL,
      quantity TEXT NOT NULL DEFAULT '',
      grams REAL,
      servings REAL,
      source TEXT,
      match TEXT,
      calories INTEGER NOT NULL DEFAULT 0,
      protein INTEGER NOT NULL DEFAULT 0,
      carbs INTEGER NOT NULL DEFAULT 0,
      fat INTEGER NOT NULL DEFAULT 0,
      photo TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
    CREATE TABLE IF NOT EXISTS weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      kg REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity TEXT NOT NULL DEFAULT '',
      calories INTEGER NOT NULL,
      protein INTEGER NOT NULL,
      carbs INTEGER NOT NULL,
      fat INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `)

  // Sync columns. Deletes are soft (deleted = 1) so they can be uploaded; dirty = 1 means "changed here, not uploaded yet".
  const sync = { cid: 'TEXT', updated_at: 'INTEGER NOT NULL DEFAULT 0', dirty: 'INTEGER NOT NULL DEFAULT 0', deleted: 'INTEGER NOT NULL DEFAULT 0' }
  for (const t of ['entries', 'weights', 'corrections']) await addMissingColumns(db, t, sync)
  await addMissingColumns(db, 'settings', { updated_at: 'INTEGER NOT NULL DEFAULT 0', dirty: 'INTEGER NOT NULL DEFAULT 0' })
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_entries_cid ON entries(cid); CREATE INDEX IF NOT EXISTS idx_weights_cid ON weights(cid); CREATE INDEX IF NOT EXISTS idx_corrections_cid ON corrections(cid);')

  // Records created before sync existed: give them an id and mark them to upload on first sign-in.
  const now = Date.now()
  for (const r of await db.getAllAsync<{ id: number; created_at: number }>('SELECT id, created_at FROM entries WHERE cid IS NULL'))
    await db.runAsync('UPDATE entries SET cid = ?, updated_at = ?, dirty = 1 WHERE id = ?', newId(), r.created_at || now, r.id)
  await db.runAsync("UPDATE weights SET cid = 'w-' || date, updated_at = ?, dirty = 1 WHERE cid IS NULL", now)
  for (const r of await db.getAllAsync<{ id: number; created_at: number }>('SELECT id, created_at FROM corrections WHERE cid IS NULL'))
    await db.runAsync('UPDATE corrections SET cid = ?, updated_at = ?, dirty = 1 WHERE id = ?', newId(), r.created_at || now, r.id)
  await db.runAsync("UPDATE settings SET updated_at = ?, dirty = 1 WHERE key IN ('goals', 'profile', 'diet', 'taste') AND updated_at = 0", now)
  return db
}

export const getDb = () => (dbPromise ??= init())

// ---------------------------------------------------------------- live queries + change notifications

const listeners = new Set<() => void>()
let version = 0
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

// Local edits also tell the sync manager (so it uploads soon). Changes applied from the cloud only refresh the UI.
const localListeners = new Set<() => void>()
export function onLocalChange(cb: () => void) {
  localListeners.add(cb)
  return () => void localListeners.delete(cb)
}
export function bump(fromLocalEdit = true) {
  version++
  listeners.forEach((l) => l())
  if (fromLocalEdit) localListeners.forEach((l) => l())
}

// Re-runs `fn` whenever anything is written, so screens stay in sync without manual refresh.
export function useLive<T>(fn: () => Promise<T>, deps: unknown[], initial: T): T {
  const [data, setData] = useState<T>(initial)
  const v = useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    let on = true
    fn().then((r) => on && setData(r))
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ...deps])
  return data
}

// ---------------------------------------------------------------- entries

export type Row = {
  id: number
  date: string
  created_at: number
  kind: 'food' | 'exercise'
  meal: Meal | null
  name: string
  quantity: string
  grams: number | null
  servings: number | null
  source: Source | null
  match: string | null
  calories: number
  protein: number
  carbs: number
  fat: number
  photo: string | null
  cid: string | null
  updated_at: number
  dirty: number
  deleted: number
}

export const toEntry = (r: Row): Entry => ({
  id: r.id,
  date: r.date,
  createdAt: r.created_at,
  kind: r.kind,
  meal: r.meal ?? undefined,
  name: r.name,
  quantity: r.quantity,
  grams: r.grams ?? undefined,
  servings: r.servings ?? undefined,
  source: r.source ?? undefined,
  match: r.match ?? undefined,
  calories: r.calories,
  protein: r.protein,
  carbs: r.carbs,
  fat: r.fat,
  photo: r.photo ?? undefined,
})

export async function entriesForDate(date: string): Promise<Entry[]> {
  const db = await getDb()
  return (await db.getAllAsync<Row>('SELECT * FROM entries WHERE date = ? AND deleted = 0 ORDER BY created_at', date)).map(toEntry)
}

export async function entriesBetween(start: string, end: string): Promise<Entry[]> {
  const db = await getDb()
  return (await db.getAllAsync<Row>('SELECT * FROM entries WHERE date BETWEEN ? AND ? AND deleted = 0 ORDER BY created_at', start, end)).map(toEntry)
}

export async function recentEntries(limit = 120): Promise<Entry[]> {
  const db = await getDb()
  return (await db.getAllAsync<Row>('SELECT * FROM entries WHERE deleted = 0 ORDER BY created_at DESC LIMIT ?', limit)).map(toEntry)
}

export async function getEntry(id: number): Promise<Entry | null> {
  const db = await getDb()
  const r = await db.getFirstAsync<Row>('SELECT * FROM entries WHERE id = ? AND deleted = 0', id)
  return r ? toEntry(r) : null
}

export async function addEntry(e: Omit<Entry, 'id'>): Promise<number> {
  const db = await getDb()
  const r = await db.runAsync(
    `INSERT INTO entries (date, created_at, kind, meal, name, quantity, grams, servings, source, match, calories, protein, carbs, fat, photo, cid, updated_at, dirty, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
    e.date, e.createdAt, e.kind, e.meal ?? null, e.name, e.quantity, e.grams ?? null, e.servings ?? null,
    e.source ?? null, e.match ?? null, e.calories, e.protein, e.carbs, e.fat, e.photo ?? null, newId(), Date.now(),
  )
  bump()
  return r.lastInsertRowId
}

export async function addEntries(list: Omit<Entry, 'id'>[]): Promise<number[]> {
  const ids: number[] = []
  for (const e of list) ids.push(await addEntry(e))
  return ids
}

const COLUMN: Record<string, string> = { createdAt: 'created_at' }

export async function updateEntry(id: number, patch: Partial<Omit<Entry, 'id'>>) {
  const db = await getDb()
  const keys = Object.keys(patch) as (keyof typeof patch)[]
  if (!keys.length) return
  const sets = [...keys.map((k) => `${COLUMN[k] ?? k} = ?`), 'updated_at = ?', 'dirty = 1'].join(', ')
  const values = keys.map((k) => (patch[k] === undefined ? null : (patch[k] as string | number)))
  await db.runAsync(`UPDATE entries SET ${sets} WHERE id = ?`, ...values, Date.now(), id)
  bump()
}

// Soft delete: the row stays (hidden) so the deletion can be uploaded to other devices.
export async function deleteEntries(ids: number[]) {
  const db = await getDb()
  const now = Date.now()
  for (const id of ids) await db.runAsync('UPDATE entries SET deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?', now, id)
  bump()
}

// ---------------------------------------------------------------- weights

export async function allWeights(): Promise<WeightEntry[]> {
  const db = await getDb()
  return db.getAllAsync<WeightEntry>('SELECT id, date, kg FROM weights WHERE deleted = 0 ORDER BY date')
}

export async function saveWeight(date: string, kg: number) {
  const db = await getDb()
  await db.runAsync(
    `INSERT INTO weights (date, kg, cid, updated_at, dirty, deleted) VALUES (?, ?, 'w-' || ?, ?, 1, 0)
     ON CONFLICT(date) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at, dirty = 1, deleted = 0`,
    date, kg, date, Date.now(),
  )
  bump()
}

export async function deleteWeight(id: number) {
  const db = await getDb()
  await db.runAsync('UPDATE weights SET deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?', Date.now(), id)
  bump()
}

// ---------------------------------------------------------------- corrections (the AI learns from your edits)

const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)

export async function addCorrection(c: Omit<Correction, 'id' | 'key' | 'createdAt'>) {
  const db = await getDb()
  const now = Date.now()
  await db.runAsync(
    'INSERT INTO corrections (key, name, quantity, calories, protein, carbs, fat, created_at, cid, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)',
    c.name.toLowerCase(), c.name, c.quantity, c.calories, c.protein, c.carbs, c.fat, now, newId(), now,
  )
  bump()
}

export async function getHints(text: string, max = 5): Promise<string[]> {
  const words = new Set(tokens(text))
  if (!words.size) return []
  const db = await getDb()
  const all = await db.getAllAsync<{ key: string; name: string; quantity: string; calories: number; protein: number; carbs: number; fat: number }>(
    'SELECT key, name, quantity, calories, protein, carbs, fat FROM corrections WHERE deleted = 0 ORDER BY created_at DESC LIMIT 300',
  )
  const seen = new Set<string>()
  const scored: { c: (typeof all)[number]; score: number }[] = []
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

// ---------------------------------------------------------------- settings

/** Only these settings sync between devices; the rest (server address, onboarding) stay on the phone. */
export const SYNCED_SETTINGS = ['goals', 'profile', 'diet', 'taste'] as const

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb()
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value ?? null
}

export async function setSetting(key: string, value: string) {
  const db = await getDb()
  const synced = (SYNCED_SETTINGS as readonly string[]).includes(key)
  await db.runAsync(
    'INSERT INTO settings (key, value, updated_at, dirty) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, dirty = excluded.dirty',
    key, value, synced ? Date.now() : 0, synced ? 1 : 0,
  )
  bump(synced)
}

export async function deleteSetting(key: string) {
  const db = await getDb()
  await db.runAsync('DELETE FROM settings WHERE key = ?', key)
  bump(false)
}

export const DEFAULT_GOALS: Goals = { calories: 2000, protein: 100, carbs: 250, fat: 65, targetKg: 70 }

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await getSetting(key)
    return v ? { ...fallback, ...JSON.parse(v) } : fallback
  } catch {
    return fallback
  }
}

export const loadGoals = () => readJson<Goals>('goals', DEFAULT_GOALS)
export const saveGoals = (g: Goals) => setSetting('goals', JSON.stringify(g))
export const loadProfile = () => readJson<Profile>('profile', DEFAULT_PROFILE)
export const saveProfile = (p: Profile) => setSetting('profile', JSON.stringify(p))
export const hasSavedGoals = async () => (await getSetting('goals')) !== null

// Food preferences (diet, per-weekday overrides, allergies, dislikes, cuisines)
export const loadDiet = async (): Promise<DietPrefs> => {
  try {
    return normalizeDiet(JSON.parse((await getSetting('diet')) ?? 'null'))
  } catch {
    return DEFAULT_DIET
  }
}
export const saveDiet = (d: DietPrefs) => setSetting('diet', JSON.stringify(normalizeDiet(d)))
export const hasSavedDiet = async () => (await getSetting('diet')) !== null

// Learned taste: what the recommender has seen you like or swap away
export const loadTaste = async (): Promise<Taste> => {
  try {
    const v = JSON.parse((await getSetting('taste')) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
export const saveTaste = (t: Taste) => setSetting('taste', JSON.stringify(t))

export const useGoals = () => useLive(loadGoals, [], DEFAULT_GOALS)

// ---------------------------------------------------------------- account switching

export async function hasLocalData() {
  const db = await getDb()
  const r = await db.getFirstAsync<{ n: number }>('SELECT (SELECT COUNT(*) FROM entries WHERE deleted = 0) + (SELECT COUNT(*) FROM weights WHERE deleted = 0) + (SELECT COUNT(*) FROM corrections) AS n')
  return (r?.n ?? 0) > 0
}

/** Removes all data from this phone (used when a different account signs in). */
export async function wipeLocalData() {
  const db = await getDb()
  await db.execAsync("DELETE FROM entries; DELETE FROM weights; DELETE FROM corrections; DELETE FROM settings WHERE key IN ('goals', 'profile', 'diet', 'taste') OR key LIKE 'sync:%' OR key LIKE 'plan:%';")
  bump(false)
}
