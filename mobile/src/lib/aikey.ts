import * as SecureStore from 'expo-secure-store'

// The person's own AI provider key. It lives in the device's secure storage (Android Keystore), is never synced to
// the cloud, and is sent to the Journable server only as a request header over HTTPS, for that one request.
export type Provider = 'gemini' | 'groq' | 'anthropic'
export interface OwnKey {
  provider: Provider
  key: string
}

export const PROVIDER_INFO: Record<Provider, { label: string; hint: string; url: string }> = {
  gemini: { label: 'Google Gemini', hint: 'Starts with AIza…', url: 'aistudio.google.com/apikey' },
  groq: { label: 'Groq', hint: 'Starts with gsk_…', url: 'console.groq.com/keys' },
  anthropic: { label: 'Anthropic', hint: 'Starts with sk-ant-…', url: 'console.anthropic.com' },
}

const NAME = 'journable.aiKey'
let cache: OwnKey | null | undefined
const listeners = new Set<() => void>()

export async function getOwnKey(): Promise<OwnKey | null> {
  if (cache !== undefined) return cache
  try {
    const raw = await SecureStore.getItemAsync(NAME)
    const p = raw ? (JSON.parse(raw) as OwnKey) : null
    cache = p && p.key && p.provider in PROVIDER_INFO ? p : null
  } catch {
    cache = null
  }
  return cache
}

export async function saveOwnKey(k: OwnKey) {
  await SecureStore.setItemAsync(NAME, JSON.stringify({ provider: k.provider, key: k.key.trim() }))
  cache = { provider: k.provider, key: k.key.trim() }
  listeners.forEach((l) => l())
}

export async function clearOwnKey() {
  await SecureStore.deleteItemAsync(NAME).catch(() => undefined)
  cache = null
  listeners.forEach((l) => l())
}

export const onKeyChange = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export async function aiHeaders(): Promise<Record<string, string>> {
  const k = await getOwnKey()
  return k ? { 'X-AI-Provider': k.provider, 'X-AI-Key': k.key } : {}
}

export const maskKey = (k: string) => (k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`)
