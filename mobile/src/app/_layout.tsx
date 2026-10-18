import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useTheme } from '@/theme'
import { getDb } from '@/lib/db'
import { ToastProvider } from '@/components/Toast'
import { SessionProvider, useSession } from '@/lib/session'
import { LoginScreen } from '@/components/LoginScreen'
import { View } from 'react-native'
import { applyTheme, loadTheme } from '@/lib/themePref'

SplashScreen.preventAutoHideAsync()
void getDb() // open the database early so the first screen has data quickly

// With Firebase configured the app asks you to sign in first. Without it, it runs locally as before (and in Expo Go).
function Gate() {
  const t = useTheme()
  const { configured, loading, user } = useSession()
  if (configured && loading) return <View style={{ flex: 1, backgroundColor: t.bg }} />
  if (configured && !user) return <LoginScreen />
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="entry/[id]"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.8, 1],
          sheetInitialDetentIndex: 0,
          sheetGrabberVisible: true,
          sheetCornerRadius: 28,
          contentStyle: { backgroundColor: t.card },
        }}
      />
    </Stack>
  )
}

export default function RootLayout() {
  const t = useTheme()
  const [loaded, error] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold })

  useEffect(() => {
    void loadTheme().then(applyTheme) // the light/dark choice from Settings
  }, [])

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync()
  }, [loaded, error])

  if (!loaded && !error) return null

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaProvider>
        <ToastProvider>
          <StatusBar style={t.dark ? 'light' : 'dark'} />
          <SessionProvider>
            <Gate />
          </SessionProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
