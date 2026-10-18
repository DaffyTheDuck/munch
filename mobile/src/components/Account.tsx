import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { radius, useTheme } from '@/theme'
import { useSession } from '@/lib/session'
import { Card, PrimaryButton, SecondaryButton, T } from './ui'

export function Avatar({ name, photo, size = 48 }: { name: string; photo: string; size?: number }) {
  const t = useTheme()
  const [broken, setBroken] = useState(false)
  if (photo && !broken) return <Image source={{ uri: photo }} onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.card2 }} />
  return (
    <LinearGradient colors={[t.btnA, t.btnB]} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <T variant="headline" style={{ color: '#fff', fontSize: size * 0.4 }}>
        {(name || '?').trim().charAt(0).toUpperCase()}
      </T>
    </LinearGradient>
  )
}

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

// Who is signed in, whether sync is healthy, and the sign-out button. Hidden when sign-in is not set up.
export function AccountCard() {
  const t = useTheme()
  const { configured, user, sync, syncNow, signOut } = useSession()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15000)
    return () => clearInterval(id)
  }, [])
  if (!configured || !user) return null

  const busy = sync.state === 'syncing'
  const bad = sync.state === 'error'
  const text = busy ? 'Syncing…' : bad ? sync.error ?? 'Sync problem' : sync.lastSyncedAt ? `Synced ${ago(sync.lastSyncedAt)}` : 'Waiting to sync'
  const color = bad ? t.over : busy ? t.accentStrong : t.good

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar name={user.name} photo={user.photo} />
        <View style={{ flex: 1 }}>
          <T variant="headline" numberOfLines={1}>
            {user.name || 'Signed in'}
          </T>
          <T variant="caption" muted numberOfLines={1}>
            {user.email}
          </T>
        </View>
      </View>
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: t.card2 }}>
        {busy ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={bad ? 'alert-circle' : 'cloud-done-outline'} size={16} color={color} />}
        <T variant="callout" style={{ color }} numberOfLines={2}>
          {text}
        </T>
      </View>
      {bad && (
        <T variant="caption" muted>
          If this keeps happening, check that the Firestore rules are published (see SETUP-FIREBASE.md).
        </T>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PrimaryButton title="Sync now" icon="sync" onPress={syncNow} loading={busy} style={{ flex: 1 }} />
        <SecondaryButton title="Sign out" onPress={() => void signOut()} />
      </View>
    </Card>
  )
}
