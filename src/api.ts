import type { AiResult } from './types'
import type { PlanRequestBody, PlanResponse } from '../shared/diet'
import { authHeader } from './lib/token'
import { aiHeaders } from './lib/aikey'
import { noteHeaders, setUsage, type Usage } from './lib/usage'

export type { Usage }

async function post<T>(url: string, body: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()), ...aiHeaders() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    noteHeaders(res)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
    return data as T
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('The AI took too long to respond. Please try again.')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export const analyze = (text: string, image?: string, hints: string[] = []) => post<AiResult>('/api/analyze', { text, image, hints })

export type CoachReply = { action: 'tool'; name: string; args: Record<string, unknown> } | { action: 'answer'; text: string }

export const coachStep = (messages: { role: 'user' | 'model'; text: string }[], today: string, goals: unknown) =>
  post<CoachReply>('/api/coach', { messages, today, goals })

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export type GraphReply = { status: 'tool'; calls: ToolCall[] } | { status: 'answer'; text: string }

export const coachChat = (thread: string, message: string, today: string, goals: unknown) =>
  post<GraphReply>('/api/coach/chat', { thread, message, today, goals })

export const coachResume = (thread: string, results: unknown[], today: string, goals: unknown) =>
  post<GraphReply>('/api/coach/resume', { thread, results, today, goals })

export async function aiStatus(): Promise<{
  ok: boolean
  provider?: string
  model?: string
  chain?: string[]
  llmLayer?: 'native' | 'langchain'
  coachEngine?: 'classic' | 'langgraph'
}> {
  try {
    const res = await fetch('/api/health')
    return await res.json()
  } catch {
    return { ok: false }
  }
}

/** How many AI actions you have used today (only when the server meters them). */
export async function fetchUsage(): Promise<Usage> {
  try {
    const res = await fetch('/api/usage', { headers: { ...(await authHeader()), ...aiHeaders() } })
    const u = res.ok ? ((await res.json()) as Usage) : { enabled: false }
    setUsage(u)
    return u
  } catch {
    return { enabled: false }
  }
}

export const requestPlan = (body: PlanRequestBody) => post<PlanResponse>('/api/plan', body)

/** Tests the key saved in this browser with a tiny request (their key and quota, not ours). */
export const checkOwnKey = () => post<{ ok: boolean; provider: string }>('/api/key/check', {})

export interface Recipe {
  title: string
  servings: number
  timeMinutes: number
  ingredients: { item: string; amount: string }[]
  steps: string[]
  tip: string
}
export const fetchRecipe = (body: { name: string; quantity?: string; diet?: string; allergies?: string[] }) => post<{ recipe: Recipe; videoUrl: string }>('/api/recipe', body)

export const explainReport = (report: unknown) => post<{ text: string }>('/api/insights/explain', report)
