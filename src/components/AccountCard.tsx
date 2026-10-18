import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useSession } from '../lib/session'

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

export function Avatar({ name, photo, size = 44 }: { name: string; photo: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return photo && !broken ? (
    <img className="avatar" src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  ) : (
    <span className="avatar fallback" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial}
    </span>
  )
}

export default function AccountCard() {
  const { user, sync, syncNow, signOut } = useSession()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15000)
    return () => clearInterval(id)
  }, [])
  if (!user) return null

  const status =
    sync.state === 'syncing'
      ? { text: 'Syncing…', tone: 'busy' }
      : sync.state === 'error'
        ? { text: sync.error ?? 'Sync problem', tone: 'bad' }
        : { text: sync.lastSyncedAt ? `Synced ${ago(sync.lastSyncedAt)}` : 'Waiting to sync', tone: 'ok' }

  return (
    <section className="card account">
      <div className="account-row">
        <Avatar name={user.name} photo={user.photo} />
        <div className="account-info">
          <b>{user.name || 'Signed in'}</b>
          <span className="muted small-text">{user.email}</span>
        </div>
      </div>
      <div className={`sync-line ${status.tone}`}>
        {status.tone === 'busy' ? <span className="spinner" /> : <Icon name={status.tone === 'bad' ? 'x' : 'repeat'} size={14} />}
        <span>{status.text}</span>
      </div>
      {sync.state === 'error' && <p className="muted small-text">If this keeps happening, check that the Firestore rules are published (see SETUP-FIREBASE.md).</p>}
      <div className="dialog-actions left">
        <button className="btn" onClick={syncNow} disabled={sync.state === 'syncing'}>
          <Icon name="repeat" size={16} /> Sync now
        </button>
        <button className="btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </section>
  )
}
