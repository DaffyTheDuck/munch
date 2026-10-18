import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, AppState } from 'react-native'
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signOut as fbSignOut } from 'firebase/auth'
import { createSyncManager, type SyncManager, type SyncStatus } from '@shared/sync'
import { getSetting, hasLocalData, onLocalChange, setSetting, wipeLocalData } from './db'
import { auth, firebaseConfigured, googleWebClientId } from './firebase'
import { createLocalAdapter } from './localSync'
import { createRemoteAdapter } from './remote'

export interface AccountUser {
  uid: string
  name: string
  email: string
  photo: string
}

interface Session {
  /** false without Firebase config: the app is local-only and never asks you to sign in */
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

type GoogleModule = typeof import('@react-native-google-signin/google-signin')

// The Google sign-in library is a native module. It is not part of Expo Go, so load it lazily and
// report a clear message instead of crashing when it is missing.
function loadGoogle(): GoogleModule | null {
  try {
    return require('@react-native-google-signin/google-signin') as GoogleModule
  } catch {
    return null
  }
}

function friendly(e: unknown, G: GoogleModule | null): string {
  const code = String((e as { code?: unknown })?.code ?? '')
  if (G && code === String(G.statusCodes.SIGN_IN_CANCELLED)) return ''
  if (G && code === String(G.statusCodes.IN_PROGRESS)) return ''
  if (G && code === String(G.statusCodes.PLAY_SERVICES_NOT_AVAILABLE)) return 'Google Play services are missing or out of date on this phone.'
  if (code === '10' || /DEVELOPER_ERROR/i.test(String((e as Error)?.message))) {
    return "Google rejected this app build. Check that the web client ID is correct and that this build's SHA-1 is registered in Firebase (see SETUP-FIREBASE.md)."
  }
  if (code === 'auth/network-request-failed') return 'No connection. Check your internet and try again.'
  return (e as Error)?.message || 'Sign-in failed. Please try again.'
}

const OWNER_KEY = 'sync:owner'

const confirm = (title: string, message: string, action: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  )

// If this phone holds data from a different account, make the user decide before mixing them.
async function claimLocalData(uid: string, email: string): Promise<boolean> {
  const owner = await getSetting(OWNER_KEY)
  if (owner && owner !== uid && (await hasLocalData())) {
    const ok = await confirm('Different account', `This phone has data from a different account.\n\nReplace it with the data from ${email || 'this account'}? The other account's data stays safe in the cloud.`, 'Replace')
    if (!ok) return false
    await wipeLocalData()
  }
  await setSetting(OWNER_KEY, uid)
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
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, name: u.displayName ?? '', email: u.email ?? '', photo: u.photoURL ?? '' } : null)
      setLoading(false)
    })
  }, [])

  // keep this phone in sync while signed in
  useEffect(() => {
    if (!user) return
    let cancelled = false
    let stopListening = () => {}
    let appStateSub: { remove(): void } | null = null

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
      appStateSub = AppState.addEventListener('change', (s) => s === 'active' && mgr.trigger())
    })()

    return () => {
      cancelled = true
      stopListening()
      appStateSub?.remove()
      manager.current?.stop()
      manager.current = null
      setSync(IDLE)
    }
  }, [user])

  const signIn = useCallback(async () => {
    if (!auth) return
    setError('')
    const G = loadGoogle()
    if (!G) {
      setError('Google sign-in needs the development build of the app. It does not work inside Expo Go. See mobile/README.md.')
      return
    }
    if (!googleWebClientId) {
      setError('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. See mobile/.env.example.')
      return
    }
    try {
      G.GoogleSignin.configure({ webClientId: googleWebClientId, offlineAccess: false })
      await G.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
      const res = await G.GoogleSignin.signIn()
      if (!G.isSuccessResponse(res)) return // user cancelled
      const idToken = res.data.idToken
      if (!idToken) throw new Error('Google did not return an ID token. Check the web client ID.')
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
    } catch (e) {
      setError(friendly(e, G))
    }
  }, [])

  const signOut = useCallback(async () => {
    manager.current?.stop()
    try {
      await loadGoogle()?.GoogleSignin.signOut()
    } catch {
      /* not signed in with the native library */
    }
    if (auth) await fbSignOut(auth)
  }, [])

  const syncNow = useCallback(() => void manager.current?.syncNow(), [])

  return <Ctx.Provider value={{ configured: firebaseConfigured, loading, user, error, sync, signIn, signOut, syncNow }}>{children}</Ctx.Provider>
}
