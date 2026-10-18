import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut as fbSignOut } from 'firebase/auth'
import { createSyncManager, type SyncManager, type SyncStatus } from '../../shared/sync'
import { hasLocalData, onLocalChange, wipeLocalData } from '../db'
import { auth, firebaseConfigured } from './firebase'
import { createLocalAdapter } from './localSync'
import { createRemoteAdapter } from './remote'

export interface AccountUser {
  uid: string
  name: string
  email: string
  photo: string
}

interface Session {
  /** false when no Firebase config is present: the app is local-only and never asks you to sign in */
  configured: boolean
  loading: boolean
  user: AccountUser | null
  error: string
  sync: SyncStatus
  signIn(): Promise<void>
  signOut(): Promise<void>
  syncNow(): void
}

const IDLE: SyncStatus = { state: 'idle', lastSyncedAt: null, error: null }
const Ctx = createContext<Session>({ configured: false, loading: false, user: null, error: '', sync: IDLE, signIn: async () => {}, signOut: async () => {}, syncNow: () => {} })
export const useSession = () => useContext(Ctx)

function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return ''
  if (code === 'auth/unauthorized-domain') return 'This address is not authorised in Firebase yet. Add it under Authentication → Settings → Authorized domains.'
  if (code === 'auth/operation-not-allowed') return 'Google sign-in is not enabled in your Firebase project yet.'
  if (code === 'auth/network-request-failed') return 'No connection. Check your internet and try again.'
  return (e as Error)?.message || 'Sign-in failed. Please try again.'
}

const OWNER_KEY = 'sync:owner'

// If this device holds data from a different account, make the user decide before mixing them.
async function claimLocalData(uid: string, email: string): Promise<boolean> {
  const owner = localStorage.getItem(OWNER_KEY)
  if (owner && owner !== uid && (await hasLocalData())) {
    const ok = window.confirm(`This device has data from a different account.\n\nReplace it with the data from ${email || 'this account'}? (The other account's data stays safe in the cloud.)`)
    if (!ok) return false
    await wipeLocalData()
  }
  localStorage.setItem(OWNER_KEY, uid)
  return true
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)
  const [error, setError] = useState('')
  const [sync, setSync] = useState<SyncStatus>(IDLE)
  const manager = useRef<SyncManager | null>(null)

  // who is signed in
  useEffect(() => {
    if (!auth) return
    void getRedirectResult(auth).catch((e) => setError(friendly(e)))
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, name: u.displayName ?? '', email: u.email ?? '', photo: u.photoURL ?? '' } : null)
      setLoading(false)
    })
  }, [])

  // keep this device in sync while signed in
  useEffect(() => {
    if (!user) return
    let cancelled = false
    let stopListening = () => {}
    let cleanupEvents = () => {}

    void (async () => {
      if (!(await claimLocalData(user.uid, user.email))) {
        await auth?.signOut()
        return
      }
      if (cancelled) return
      const mgr = createSyncManager({ local: createLocalAdapter(user.uid), remote: createRemoteAdapter(user.uid), onChange: setSync })
      manager.current = mgr
      mgr.start()
      stopListening = onLocalChange(() => mgr.trigger())
      const wake = () => mgr.trigger()
      window.addEventListener('focus', wake)
      window.addEventListener('online', wake)
      cleanupEvents = () => {
        window.removeEventListener('focus', wake)
        window.removeEventListener('online', wake)
      }
    })()

    return () => {
      cancelled = true
      stopListening()
      cleanupEvents()
      manager.current?.stop()
      manager.current = null
      setSync(IDLE)
    }
  }, [user])

  const signIn = useCallback(async () => {
    if (!auth) return
    setError('')
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    try {
      await signInWithPopup(auth, provider)
    } catch (e) {
      if ((e as { code?: string }).code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider)
        return
      }
      setError(friendly(e))
    }
  }, [])

  const signOut = useCallback(async () => {
    manager.current?.stop()
    await fbSignOut(auth!)
  }, [])

  const syncNow = useCallback(() => void manager.current?.syncNow(), [])

  return <Ctx.Provider value={{ configured: firebaseConfigured, loading, user, error, sync, signIn, signOut, syncNow }}>{children}</Ctx.Provider>
}
