import { isNewer, type CollectionName, type LocalAdapter, type SyncRecord } from '@shared/sync'
import { SYNCED_SETTINGS, bump, getDb, toEntry, type Row } from './db'

type Data = Record<string, unknown>
const clean = (o: Data): Data => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

// The record shapes below must match the web app's (src/lib/localSync.ts), since both read and write the same cloud documents.
const entryData = (r: Row): Data => {
  const { id: _id, ...e } = toEntry(r)
  return clean(e as unknown as Data)
}

type WeightRow = { id: number; date: string; kg: number; cid: string; updated_at: number; deleted: number }
type CorrectionRow = { id: number; key: string; name: string; quantity: string; calories: number; protein: number; carbs: number; fat: number; created_at: number; cid: string; updated_at: number; deleted: number }

const isSetting = (k: string) => (SYNCED_SETTINGS as readonly string[]).includes(k)

// Connects the phone's SQLite database to the shared sync engine.
export function createLocalAdapter(uid: string): LocalAdapter {
  const metaKey = (k: string) => `sync:${uid}:${k}`

  return {
    async prepare() {
      // getDb() already assigned ids to legacy rows during migration; nothing else to do.
      await getDb()
    },

    async dirty(c: CollectionName): Promise<SyncRecord[]> {
      const db = await getDb()
      if (c === 'settings') {
        const rows = await db.getAllAsync<{ key: string; value: string; updated_at: number }>('SELECT key, value, updated_at FROM settings WHERE dirty = 1')
        return rows.filter((r) => isSetting(r.key)).map((r) => ({ cid: r.key, updatedAt: r.updated_at, data: JSON.parse(r.value) as Data }))
      }
      if (c === 'entries') {
        return (await db.getAllAsync<Row>('SELECT * FROM entries WHERE dirty = 1 AND cid IS NOT NULL')).map((r) =>
          r.deleted ? { cid: r.cid!, updatedAt: r.updated_at, deleted: true } : { cid: r.cid!, updatedAt: r.updated_at, data: entryData(r) },
        )
      }
      if (c === 'weights') {
        return (await db.getAllAsync<WeightRow>('SELECT * FROM weights WHERE dirty = 1 AND cid IS NOT NULL')).map((r) =>
          r.deleted ? { cid: r.cid, updatedAt: r.updated_at, deleted: true } : { cid: r.cid, updatedAt: r.updated_at, data: { date: r.date, kg: r.kg } },
        )
      }
      return (await db.getAllAsync<CorrectionRow>('SELECT * FROM corrections WHERE dirty = 1 AND cid IS NOT NULL')).map((r) => ({
        cid: r.cid,
        updatedAt: r.updated_at,
        data: { key: r.key, name: r.name, quantity: r.quantity, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat, createdAt: r.created_at },
      }))
    },

    async markClean(c, records) {
      const db = await getDb()
      for (const r of records) {
        if (c === 'settings') await db.runAsync('UPDATE settings SET dirty = 0 WHERE key = ? AND updated_at = ?', r.cid, r.updatedAt)
        else await db.runAsync(`UPDATE ${c} SET dirty = 0 WHERE cid = ? AND updated_at = ?`, r.cid, r.updatedAt)
      }
    },

    async applyRemote(c, records) {
      const db = await getDb()
      let n = 0
      for (const r of records) {
        if (c === 'settings') {
          if (!isSetting(r.cid) || r.deleted || !r.data) continue
          const local = await db.getFirstAsync<{ updated_at: number }>('SELECT updated_at FROM settings WHERE key = ?', r.cid)
          if (!isNewer(r.updatedAt, local?.updated_at)) continue
          await db.runAsync(
            'INSERT INTO settings (key, value, updated_at, dirty) VALUES (?, ?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, dirty = 0',
            r.cid, JSON.stringify(r.data), r.updatedAt,
          )
          n++
          continue
        }

        const existing = await db.getFirstAsync<{ id: number; updated_at: number }>(`SELECT id, updated_at FROM ${c} WHERE cid = ?`, r.cid)
        if (!isNewer(r.updatedAt, existing?.updated_at)) continue // our copy (or our delete) is newer

        if (r.deleted) {
          if (existing) await db.runAsync(`UPDATE ${c} SET deleted = 1, updated_at = ?, dirty = 0 WHERE id = ?`, r.updatedAt, existing.id)
          else continue
          n++
          continue
        }

        const d = (r.data ?? {}) as Data
        if (c === 'entries') {
          const v = [d.date, d.createdAt ?? 0, d.kind, d.meal ?? null, d.name, d.quantity ?? '', d.grams ?? null, d.servings ?? null, d.source ?? null, d.match ?? null, d.calories ?? 0, d.protein ?? 0, d.carbs ?? 0, d.fat ?? 0, d.photo ?? null] as (string | number | null)[]
          if (existing)
            await db.runAsync(
              'UPDATE entries SET date=?, created_at=?, kind=?, meal=?, name=?, quantity=?, grams=?, servings=?, source=?, match=?, calories=?, protein=?, carbs=?, fat=?, photo=?, updated_at=?, dirty=0, deleted=0 WHERE id=?',
              ...v, r.updatedAt, existing.id,
            )
          else
            await db.runAsync(
              'INSERT INTO entries (date, created_at, kind, meal, name, quantity, grams, servings, source, match, calories, protein, carbs, fat, photo, cid, updated_at, dirty, deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)',
              ...v, r.cid, r.updatedAt,
            )
        } else if (c === 'weights') {
          await db.runAsync(
            'INSERT INTO weights (date, kg, cid, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0) ON CONFLICT(date) DO UPDATE SET kg = excluded.kg, cid = excluded.cid, updated_at = excluded.updated_at, dirty = 0, deleted = 0',
            d.date as string, d.kg as number, r.cid, r.updatedAt,
          )
        } else {
          const v = [d.key, d.name, d.quantity ?? '', d.calories ?? 0, d.protein ?? 0, d.carbs ?? 0, d.fat ?? 0, d.createdAt ?? r.updatedAt] as (string | number)[]
          if (existing) await db.runAsync('UPDATE corrections SET key=?, name=?, quantity=?, calories=?, protein=?, carbs=?, fat=?, created_at=?, updated_at=?, dirty=0, deleted=0 WHERE id=?', ...v, r.updatedAt, existing.id)
          else await db.runAsync('INSERT INTO corrections (key, name, quantity, calories, protein, carbs, fat, created_at, cid, updated_at, dirty, deleted) VALUES (?,?,?,?,?,?,?,?,?,?,0,0)', ...v, r.cid, r.updatedAt)
        }
        n++
      }
      if (n) bump(false) // refresh the UI, but don't treat it as a local edit
      return n
    },

    async getMeta(key) {
      const db = await getDb()
      return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', metaKey(key)))?.value ?? null
    },
    async setMeta(key, value) {
      const db = await getDb()
      await db.runAsync('INSERT INTO settings (key, value, updated_at, dirty) VALUES (?, ?, 0, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value', metaKey(key), value)
    },
  }
}
