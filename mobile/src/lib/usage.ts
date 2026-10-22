import { useSyncExternalStore } from 'react'

// One source of truth for "how much AI have I used today". Every AI response updates it from the server's headers,
// so Settings and the warning toast can never disagree.
export interface Usage {
  enabled: boolean
  unlimited?: boolean
  used?: number
  limit?: number
  remaining?: number | null
  resetAt?: string
  ownKey?: boolean
}

let state: Usage = { enabled: false }
const listeners = new Set<() => void>()

export const getUsage = () => state
export function setUsage(next: Usage) {
  state = next
  listeners.forEach((l) => l())
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
export const useUsage = () => useSyncExternalStore(subscribe, getUsage)

/** Reads the allowance headers the server puts on every metered response. */
export function noteHeaders(res: Response) {
  if (res.headers.get('x-ai-key') === 'own') return setUsage({ ...state, enabled: true, ownKey: true })
  const usedHeader = res.headers.get('x-ai-used')
  const limit = Number(res.headers.get('x-ai-limit'))
  if (!limit || usedHeader === null || Number.isNaN(Number(usedHeader))) return
  const used = Number(usedHeader)
  setUsage({ enabled: true, unlimited: false, ownKey: false, used, limit, remaining: Math.max(0, limit - used), resetAt: res.headers.get('x-ai-reset') ?? state.resetAt })
}

/** Whether to warn, and how: only when the allowance is nearly or fully used. */
export function warningFor(u: Usage): { level: 'low' | 'out'; text: string } | null {
  if (!u.enabled || u.unlimited || u.ownKey || !u.limit) return null
  const left = u.remaining ?? u.limit - (u.used ?? 0)
  const reset = u.resetAt ? new Date(u.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'tomorrow'
  if (left <= 0) return { level: 'out', text: `You have used all ${u.limit} AI actions for today. Foods you have logged before and meal plans still work. Resets at ${reset}.` }
  if (left <= 5) return { level: 'low', text: `Only ${left} AI action${left === 1 ? '' : 's'} left today (resets at ${reset}). You can add your own API key in Settings.` }
  return null
}
