import { isNewer, type CollectionName, type LocalAdapter, type SyncRecord } from '../../shared/sync'
import { SETTING_KEYS, bumpSettings, db, remoteTransaction, stampSetting, type SettingKey } from '../db'
import type { Table } from 'dexie'

type Row = { id?: number; cid?: string; updatedAt?: number; dirty?: 0 | 1; [k: string]: unknown }
type RowCollection = 'entries' | 'weights' | 'corrections'

const table = (c: RowCollection) => db[c] as unknown as Table<Row, number>
const stripBookkeeping = ({ id: _i, cid: _c, updatedAt: _u, dirty: _d, ...rest }: Row) => rest

const isSetting = (cid: string): cid is SettingKey => (SETTING_KEYS as readonly string[]).includes(cid)

// Connects the web app's IndexedDB (and localStorage settings) to the shared sync engine.
export function createLocalAdapter(uid: string): LocalAdapter {
  const metaKey = (k: string) => `sync:${uid}:${k}`

  return {
    async prepare() {
      // Give any record that somehow lacks an id one (normal writes get it from the table hooks).
      for (const c of ['entries', 'weights', 'corrections'] as RowCollection[]) {
        await table(c).filter((r) => !r.cid).modify((r) => void (r.dirty = 1))
      }
      // Existing goals/profile saved before sync existed: upload them once.
      for (const k of SETTING_KEYS) {
        if (localStorage.getItem(k) !== null && localStorage.getItem(`settings:updatedAt:${k}`) === null) stampSetting(k)
      }
    },

    async dirty(c: CollectionName): Promise<SyncRecord[]> {
      if (c === 'settings') {
        return SETTING_KEYS.filter((k) => localStorage.getItem(`settings:dirty:${k}`) === '1' && localStorage.getItem(k) !== null).map((k) => ({
          cid: k,
          updatedAt: Number(localStorage.getItem(`settings:updatedAt:${k}`)) || 0,
          data: JSON.parse(localStorage.getItem(k)!),
        }))
      }
      const t = table(c)
      const rows = await t.filter((r) => r.dirty === 1 && !!r.cid).toArray()
      const out: SyncRecord[] = rows.map((r) => ({ cid: r.cid!, updatedAt: r.updatedAt ?? 0, data: stripBookkeeping(r) }))

      // Deleted records. If one was re-created since (e.g. "Undo"), the live row wins and the marker is dropped.
      const stones = await db.tombstones.filter((s) => s.collection === c).toArray()
      for (const s of stones) {
        if ((await t.where('cid').equals(s.cid).count()) > 0) await db.tombstones.delete(s.key)
        else out.push({ cid: s.cid, updatedAt: s.updatedAt, deleted: true })
      }
      return out
    },

    async markClean(c, records) {
      if (c === 'settings') {
        for (const r of records) {
          if (isSetting(r.cid) && Number(localStorage.getItem(`settings:updatedAt:${r.cid}`)) === r.updatedAt) localStorage.removeItem(`settings:dirty:${r.cid}`)
        }
        return
      }
      const t = table(c)
      await remoteTransaction(async () => {
        for (const r of records) {
          const row = await t.where('cid').equals(r.cid).first()
          if (row && row.dirty === 1 && row.updatedAt === r.updatedAt) await t.update(row.id!, { dirty: 0 })
          const stone = await db.tombstones.get(`${c}:${r.cid}`)
          if (stone && stone.updatedAt === r.updatedAt) await db.tombstones.delete(stone.key)
        }
      })
    },

    async applyRemote(c, records) {
      if (c === 'settings') {
        let n = 0
        for (const r of records) {
          if (!isSetting(r.cid) || r.deleted || !r.data) continue
          const local = localStorage.getItem(`settings:updatedAt:${r.cid}`)
          if (!isNewer(r.updatedAt, local === null ? undefined : Number(local))) continue
          localStorage.setItem(r.cid, JSON.stringify(r.data))
          localStorage.setItem(`settings:updatedAt:${r.cid}`, String(r.updatedAt))
          localStorage.removeItem(`settings:dirty:${r.cid}`)
          n++
        }
        if (n) bumpSettings()
        return n
      }

      const t = table(c)
      return remoteTransaction(async () => {
        let n = 0
        for (const r of records) {
          const existing = await t.where('cid').equals(r.cid).first()
          const stone = await db.tombstones.get(`${c}:${r.cid}`)
          const local = Math.max(existing?.updatedAt ?? -1, stone?.updatedAt ?? -1)
          if (!isNewer(r.updatedAt, local < 0 ? undefined : local)) continue // our copy (or our delete) is newer

          if (r.deleted) {
            if (existing) await t.delete(existing.id!)
          } else {
            const row: Row = { ...(r.data as Row), cid: r.cid, updatedAt: r.updatedAt, dirty: 0 }
            if (existing) await t.put({ ...row, id: existing.id })
            else await t.add(row)
          }
          if (stone) await db.tombstones.delete(stone.key)
          n++
        }
        return n
      })
    },

    async getMeta(key) {
      return localStorage.getItem(metaKey(key))
    },
    async setMeta(key, value) {
      localStorage.setItem(metaKey(key), value)
    },
  }
}
