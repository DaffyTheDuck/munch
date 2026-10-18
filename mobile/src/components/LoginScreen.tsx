import { useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { radius, useTheme } from '@/theme'
import { feel } from '@/lib/feel'
import { useSession } from '@/lib/session'
import { Press, T } from './ui'

function GoogleG() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  )
}

const POINTS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'sparkles', text: 'Log meals in any language, or with a photo' },
  { icon: 'sync', text: 'Your log stays in sync between phone and web' },
  { icon: 'chatbubble-ellipses', text: 'A coach that reads your own data' },
]

export function LoginScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { signIn, error } = useSession()
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    await signIn()
    setBusy(false)
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, justifyContent: 'center' }}>
      <Animated.View entering={FadeInDown.duration(500)} style={{ alignItems: 'center', gap: 14 }}>
        <LinearGradient colors={[t.btnA, t.btnB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="sparkles" size={32} color="#fff" />
        </LinearGradient>
        <T variant="largeTitle" style={{ textAlign: 'center' }}>
          Welcome to Journable
        </T>
        <T variant="body" muted style={{ textAlign: 'center', maxWidth: 320 }}>
          Sign in to sync your log across devices and keep your AI features private to you.
        </T>

        <View style={{ alignSelf: 'stretch', gap: 12, marginVertical: 10 }}>
          {POINTS.map((p) => (
            <View key={p.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={p.icon} size={16} color={t.accentStrong} />
              </View>
              <T variant="callout" style={{ flex: 1 }}>
                {p.text}
              </T>
            </View>
          ))}
        </View>

        <Press
          onPress={() => void go()}
          disabled={busy}
          haptic="press"
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          style={{ alignSelf: 'stretch', minHeight: 52, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dadce0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, opacity: busy ? 0.7 : 1 }}
        >
          {busy ? <ActivityIndicator color="#5f6368" /> : <GoogleG />}
          <T variant="headline" style={{ color: '#1f1f1f' }}>
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </T>
        </Press>

        {error ? (
          <T variant="caption" color="over" style={{ textAlign: 'center' }} onLayout={() => feel.error()}>
            {error}
          </T>
        ) : null}
        <T variant="caption" muted style={{ textAlign: 'center' }}>
          We only use your Google name, email and photo to identify your account.
        </T>
      </Animated.View>
    </View>
  )
}
