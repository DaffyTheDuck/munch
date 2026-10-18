// Platform-independent, local-first sync engine shared by the web and mobile apps.
//
// Each app keeps its own local database (IndexedDB / SQLite) and plugs in two small adapters:
//   LocalAdapter  - reads dirty (not yet uploaded) records, applies remote changes, stores sync metadata
//   RemoteAdapter - pushes records to the cloud (Firestore) and pulls changes made elsewhere
//
// Rules:
//   * Every record has a stable id (cid) and a client `updatedAt` time. Last write wins by `updatedAt`.
//   * Deletes are records too ("tombstones", deleted: true) so they reach other devices.
//   * Local edits mark a record dirty; applying remote changes never does, so records never ping-pong.
//   * Each sync downloads before it uploads, so an older unsynced edit never overwrites a newer remote one.
//   * The pull cursor is an opaque string issued by the remote (server time), so a device with a wrong
//     clock cannot make other devices miss changes.

export type CollectionName = 'entries' | 'weights' | 'corrections' | 'settings'
export const COLLECTIONS: CollectionName[] = ['entries', 'weights', 'corrections', 'settings']

export interface SyncRecord {
  cid: string
  updatedAt: number
  deleted?: boolean
  /** the record's fields; omitted for tombstones */
  data?: Record<string, unknown>
}

export interface LocalAdapter {
  /** one-time setup before syncing, e.g. give legacy rows an id and mark them dirty */
  prepare(): Promise<void>
  /** records changed locally and not yet uploaded, including tombstones */
  dirty(collection: CollectionName): Promise<SyncRecord[]>
  /** mark uploaded records clean, but only if they were not edited again in the meantime */
  markClean(collection: CollectionName, records: Pick<SyncRecord, 'cid' | 'updatedAt'>[]): Promise<void>
  /** upsert or delete records coming from the cloud (must use isNewer; must NOT mark them dirty). Returns how many changed. */
  applyRemote(collection: CollectionName, records: SyncRecord[]): Promise<number>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}

export interface RemoteAdapter {
  push(collection: CollectionName, records: SyncRecord[]): Promise<void>
  /** records the cloud has stored since `cursor` ('' = from the beginning), one page at a time */
  pull(collection: CollectionName, cursor: string): Promise<{ records: SyncRecord[]; cursor: string; more: boolean }>
}

/** Last-write-wins: a remote record replaces the local one only if it is strictly newer. */
export function isNewer(remoteUpdatedAt: number, localUpdatedAt: number | undefined): boolean {
  return localUpdatedAt === undefined || remoteUpdatedAt > localUpdatedAt
}

export interface SyncResult {
  pushed: number
  pulled: number
}

const PUSH_BATCH = 400

export async function syncOnce(local: LocalAdapter, remote: RemoteAdapter, collections: CollectionName[] = COLLECTIONS): Promise<SyncResult> {
  await local.prepare()
  let pushed = 0
  let pulled = 0

  for (const c of collections) {
    // 1. download first, so a stale local edit can never overwrite a newer edit made on another device:
    //    anything newer from the cloud replaces our copy (and clears its dirty flag) before we upload.
    let cursor = (await local.getMeta(`pull:${c}`)) ?? ''
    for (;;) {
      const page = await remote.pull(c, cursor)
      if (page.records.length) pulled += await local.applyRemote(c, page.records)
      cursor = page.cursor
      await local.setMeta(`pull:${c}`, cursor)
      if (!page.more) break
    }

    // 2. upload what is still dirty
    const dirty = await local.dirty(c)
    for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
      const batch = dirty.slice(i, i + PUSH_BATCH)
      await remote.push(c, batch)
      await local.markClean(c, batch.map((r) => ({ cid: r.cid, updatedAt: r.updatedAt })))
      pushed += batch.length
    }
  }
  return { pushed, pulled }
}

// ------------------------------------------------------------------ scheduling

export type SyncState = 'idle' | 'syncing' | 'error'

export interface SyncStatus {
  state: SyncState
  lastSyncedAt: number | null
  error: string | null
}

export interface SyncManager {
  start(): void
  stop(): void
  /** request a sync soon (debounced); call after local edits */
  trigger(): void
  /** sync right now; resolves when finished (or fails quietly into status) */
  syncNow(): Promise<void>
  status(): SyncStatus
}

export function createSyncManager(deps: {
  local: LocalAdapter
  remote: RemoteAdapter
  onChange?: (s: SyncStatus) => void
  debounceMs?: number
  intervalMs?: number
}): SyncManager {
  const { local, remote, onChange, debounceMs = 1500, intervalMs = 30000 } = deps
  let st: SyncStatus = { state: 'idle', lastSyncedAt: null, error: null }
  let running: Promise<void> | null = null
  let rerun = false
  let debounce: ReturnType<typeof setTimeout> | null = null
  let interval: ReturnType<typeof setInterval> | null = null
  let stopped = true

  const set = (patch: Partial<SyncStatus>) => {
    st = { ...st, ...patch }
    onChange?.(st)
  }

  async function run() {
    set({ state: 'syncing', error: null })
    try {
      await syncOnce(local, remote)
      set({ state: 'idle', lastSyncedAt: Date.now() })
    } catch (e) {
      set({ state: 'error', error: (e as Error).message || 'Sync failed' })
    }
  }

  function syncNow(): Promise<void> {
    if (running) {
      rerun = true // changes arrived mid-sync: go again right after
      return running
    }
    running = (async () => {
      do {
        rerun = false
        await run()
      } while (rerun && !stopped && st.state !== 'error')
    })().finally(() => {
      running = null
    })
    return running
  }

  return {
    start() {
      stopped = false
      void syncNow()
      interval = setInterval(() => void syncNow(), intervalMs)
    },
    stop() {
      stopped = true
      if (debounce) clearTimeout(debounce)
      if (interval) clearInterval(interval)
      debounce = interval = null
    },
    trigger() {
      if (stopped) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => void syncNow(), debounceMs)
    },
    syncNow,
    status: () => st,
  }
}
