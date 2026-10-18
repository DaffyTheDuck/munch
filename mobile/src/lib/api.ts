import Constants from 'expo-constants'
import type { AiResult } from '@shared/types'
import type { PlanRequestBody, PlanResponse } from '@shared/diet'
import { getSetting } from './db'
import { authHeader } from './token'
import { aiHeaders } from './aikey'

// The phone talks to the same API server as the web app. In development, the server is assumed to run
// on the computer that is serving the app (same Wi-Fi), on port 8787. Override it in Goals → Server.
export async function serverUrl(): Promise<string> {
  const saved = await getSetting('serverUrl')
  if (saved) return saved.replace(/\/+$/, '')
  const host = Constants.expoConfig?.hostUri?.split(':')[0]
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '')
  return host ? `http://${host}:8787` : 'http://localhost:8787'
}

// The person's own API key is only ever sent over HTTPS, or over plain HTTP to a private-network address (home Wi-Fi).
const privateHost = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
function safeForKey(url: string) {
  if (url.startsWith('https://')) return true
  const m = /^http:\/\/([^/:]+)/.exec(url)
  return Boolean(m && privateHost.test(m[1]))
}

async function request<T>(path: string, body?: unknown, timeoutMs = 60000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const base = await serverUrl()
    const extra = path === '/api/health' ? {} : await aiHeaders()
    if (extra['X-AI-Key'] && !safeForKey(base)) throw new Error('Your API key is only sent over HTTPS. Use an https:// server address, or remove the key in Settings.')
    const res = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
    return data as T
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') throw new Error('That took too long. Check your connection and try again.')
    if (/network request failed|failed to fetch/i.test(err.message)) {
      throw new Error("Can't reach your Munch server. Check the address in Settings → Server and your connection.")
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export const analyze = (text: string, image?: string, hints: string[] = []) => request<AiResult>('/api/analyze', { text, image, hints })

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}
export type GraphReply = { status: 'tool'; calls: ToolCall[] } | { status: 'answer'; text: string }
export type CoachReply = { action: 'tool'; name: string; args: Record<string, unknown> } | { action: 'answer'; text: string }

export const coachChat = (thread: string, message: string, today: string, goals: unknown) =>
  request<GraphReply>('/api/coach/chat', { thread, message, today, goals })
export const coachResume = (thread: string, results: unknown[], today: string, goals: unknown) =>
  request<GraphReply>('/api/coach/resume', { thread, results, today, goals })
export const coachStep = (messages: { role: 'user' | 'model'; text: string }[], today: string, goals: unknown) =>
  request<CoachReply>('/api/coach', { messages, today, goals })

export interface Health {
  ok: boolean
  provider?: string
  model?: string
  chain?: string[]
  llmLayer?: 'native' | 'langchain'
  coachEngine?: 'classic' | 'langgraph'
}

export async function health(): Promise<Health> {
  try {
    return await request<Health>('/api/health', undefined, 6000)
  } catch {
    return { ok: false }
  }
}

export const requestPlan = (body: PlanRequestBody) => request<PlanResponse>('/api/plan', body)

export interface Usage {
  enabled: boolean
  unlimited?: boolean
  used?: number
  limit?: number
  remaining?: number | null
  resetAt?: string
  ownKey?: boolean
}

/** How many AI actions you have used today (only when the server meters them). */
export async function fetchUsage(): Promise<Usage> {
  try {
    return await request<Usage>('/api/usage', undefined, 6000)
  } catch {
    return { enabled: false }
  }
}

/** Tests the key saved on this device with a tiny request (it uses their key and quota, not ours). */
export const checkOwnKey = () => request<{ ok: boolean; provider: string }>('/api/key/check', {}, 20000)

export interface Recipe {
  title: string
  servings: number
  timeMinutes: number
  ingredients: { item: string; amount: string }[]
  steps: string[]
  tip: string
}
export const fetchRecipe = (body: { name: string; quantity?: string; diet?: string; allergies?: string[] }) =>
  request<{ recipe: Recipe; videoUrl: string }>('/api/recipe', body, 60000)
