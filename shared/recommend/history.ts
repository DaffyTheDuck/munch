import type { Entry } from '../types'
import type { HistoryFood } from './types'

const norm = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const dayNumber = (date: string) => Math.floor(new Date(date + 'T12:00:00').getTime() / 86400000)

/** Summarises logged food entries (last 120 days) into per-food history used for personalisation. */
export function buildHistory(entries: Pick<Entry, 'kind' | 'name' | 'meal' | 'calories' | 'protein' | 'carbs' | 'fat' | 'quantity' | 'date'>[], today: string): HistoryFood[] {
  const t = dayNumber(today)
  const groups = new Map<string, typeof entries>()
  for (const e of entries) {
    if (e.kind !== 'food' || t - dayNumber(e.date) > 120) continue
    const k = norm(e.name)
    if (k) groups.set(k, [...(groups.get(k) ?? []), e])
  }
  return [...groups.values()].map((g) => {
    const meals = new Map<string, number>()
    for (const e of g) meals.set(e.meal ?? 'snack', (meals.get(e.meal ?? 'snack') ?? 0) + 1)
    const meal = [...meals].sort((a, b) => b[1] - a[1])[0][0] as HistoryFood['meal']
    const last = g.reduce((a, b) => (a.date >= b.date ? a : b))
    return {
      name: last.name,
      meal,
      kcal: Math.round(median(g.map((e) => e.calories))),
      protein: Math.round(median(g.map((e) => e.protein))),
      carbs: Math.round(median(g.map((e) => e.carbs))),
      fat: Math.round(median(g.map((e) => e.fat))),
      quantity: last.quantity,
      count: g.length,
      daysAgo: Math.max(0, t - dayNumber(last.date)),
    }
  })
}
