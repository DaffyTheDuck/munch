import { Appearance } from 'react-native'
import { getSetting, setSetting } from './db'

export type ThemePref = 'system' | 'light' | 'dark'

// Forcing the colour scheme through Appearance makes every screen, the status bar and native pickers follow it.
export function applyTheme(pref: ThemePref) {
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref)
}

export async function loadTheme(): Promise<ThemePref> {
  const v = await getSetting('theme')
  return v === 'light' || v === 'dark' ? v : 'system'
}

export async function saveTheme(pref: ThemePref) {
  applyTheme(pref)
  await setSetting('theme', pref)
}
