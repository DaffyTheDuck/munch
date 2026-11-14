import { useColorScheme } from 'react-native'

// Same palette as the web app: neutral graphite surfaces with a violet-to-blue accent.
const light = {
  dark: false,
  bg: '#f6f6fa',
  card: '#ffffff',
  card2: '#efeff6',
  text: '#16161d',
  muted: '#6a6a80',
  line: '#e3e3ee',
  accent: '#6d4ef0',
  accentStrong: '#5a3fd8',
  accentSoft: '#eeeafe',
  onAccent: '#ffffff',
  accent2: '#2f7cf6',
  btnA: '#6d4ef0',
  btnB: '#2f7cf6',
  over: '#e5484d',
  good: '#12a37a',
  protein: '#3b82f6',
  carbs: '#f59e0b',
  fat: '#ec4899',
  overlay: 'rgba(16,16,28,0.45)',
  shadow: '#16162a',
}

const dark: typeof light = {
  dark: true,
  bg: '#09090c',
  card: '#111116',
  card2: '#1a1a21',
  text: '#f2f2f6',
  muted: '#9a9aab',
  line: '#25252e',
  accent: '#8b7cf6',
  accentStrong: '#b8adff',
  accentSoft: '#1c1a34',
  onAccent: '#0c0a1f',
  accent2: '#5ea1ff',
  btnA: '#7c4dee',
  btnB: '#3b82f6',
  over: '#fb7185',
  good: '#4ade80',
  protein: '#60a5fa',
  carbs: '#fbbf24',
  fat: '#f472b6',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: '#000000',
}

export type Theme = typeof light

/** Both palettes, for places that cannot use the hook (home-screen widgets draw light and dark versions). */
export const palettes = { light, dark }

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}

export const font = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
} as const

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const

export const mealColor: Record<string, string> = {
  breakfast: '#f59e0b',
  lunch: '#38bdf8',
  snack: '#f472b6',
  dinner: '#a78bfa',
  activity: '#fb923c',
}
