// The person's own AI provider key. It stays in this browser (localStorage), is never synced, and is sent to the
// Journable server only as a request header for that one request. Anyone with access to this browser profile can read it,
// so use a key with a spending limit and remove it on shared computers.
export type Provider = 'gemini' | 'groq' | 'anthropic'

export const PROVIDER_INFO: Record<Provider, { label: string; hint: string; url: string }> = {
  gemini: { label: 'Google Gemini', hint: 'Starts with AIza…', url: 'aistudio.google.com/apikey' },
  groq: { label: 'Groq', hint: 'Starts with gsk_…', url: 'console.groq.com/keys' },
  anthropic: { label: 'Anthropic', hint: 'Starts with sk-ant-…', url: 'console.anthropic.com' },
}

const NAME = 'aiKey'
export interface OwnKey {
  provider: Provider
  key: string
}

export function getOwnKey(): OwnKey | null {
  try {
    const p = JSON.parse(localStorage.getItem(NAME) || 'null') as OwnKey | null
    return p && typeof p.key === 'string' && p.key && p.provider in PROVIDER_INFO ? p : null
  } catch {
    return null
  }
}

export function saveOwnKey(k: OwnKey) {
  localStorage.setItem(NAME, JSON.stringify({ provider: k.provider, key: k.key.trim() }))
}

export function clearOwnKey() {
  try {
    localStorage.removeItem(NAME)
  } catch {
    /* storage unavailable */
  }
}

export function aiHeaders(): Record<string, string> {
  const k = getOwnKey()
  return k ? { 'X-AI-Provider': k.provider, 'X-AI-Key': k.key } : {}
}

export const maskKey = (k: string) => (k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`)
