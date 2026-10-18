import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore'
import type { CollectionName, RemoteAdapter, SyncRecord } from '../../shared/sync'
import { firestore } from './firebase'

const PUSH_CHUNK = 200
const PAGE = 300

// Firestore layout: users/{uid}/{collection}/{cid} = { cid, updatedAt, deleted, data, syncedAt }
// `syncedAt` is a server timestamp and is what the pull cursor follows, so device clocks cannot cause missed changes.
export function createRemoteAdapter(uid: string): RemoteAdapter {
  const db = firestore!
  const col = (c: CollectionName) => collection(db, 'users', uid, c)

  return {
    async push(c, records) {
      for (let i = 0; i < records.length; i += PUSH_CHUNK) {
        const batch = writeBatch(db)
        for (const r of records.slice(i, i + PUSH_CHUNK)) {
          batch.set(doc(col(c), r.cid), {
            cid: r.cid,
            updatedAt: r.updatedAt,
            deleted: r.deleted === true,
            // Firestore rejects `undefined`, so round-trip through JSON
            data: r.deleted ? null : JSON.parse(JSON.stringify(r.data ?? {})),
            syncedAt: serverTimestamp(),
          })
        }
        await batch.commit()
      }
    },

    async pull(c, cursor) {
      const [s, n] = cursor ? cursor.split(':').map(Number) : [0, 0]
      const snap = await getDocs(query(col(c), where('syncedAt', '>', new Timestamp(s, n)), orderBy('syncedAt'), limit(PAGE)))
      const records: SyncRecord[] = snap.docs.map((d) => {
        const v = d.data()
        return { cid: (v.cid as string) ?? d.id, updatedAt: Number(v.updatedAt) || 0, deleted: v.deleted === true, data: v.data ?? undefined }
      })
      const last = snap.docs[snap.docs.length - 1]?.data().syncedAt as Timestamp | undefined
      return { records, cursor: last ? `${last.seconds}:${last.nanoseconds}` : cursor, more: snap.docs.length === PAGE }
    },
  }
}
