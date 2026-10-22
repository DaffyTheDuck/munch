import { describe, expect, it } from 'vitest'
import { findSwaps, weeklyReport, weightTrend, type InsightInput } from '../shared/insights'
import { addDays } from '../shared/dates'
import type { Entry, Meal, WeightEntry } from '../shared/types'
import { DEFAULT_DIET } from '../shared/diet'

const TODAY = '2026-10-21' // a Wednesday; the analysed week is 2026-10-14 .. 2026-10-20

const food = (date: string, name: string, calories: number, meal: Meal = 'lunch', protein = 10): Entry => ({ date, createdAt: 1, kind: 'food', meal, name, quantity: '1', calories, protein, carbs: 30, fat: 10 })
const goals = { calories: 1800, protein: 120, carbs: 200, fat: 55, targetKg: 70 }

/** A fully logged day totalling about `kcal`. */
function day(date: string, kcal: number, extra: Entry[] = []): Entry[] {
  return [food(date, 'Poha', kcal * 0.25, 'breakfast', 8), food(date, 'Dal and rice', kcal * 0.35, 'lunch', 20), food(date, 'Roti sabzi', kcal * 0.3, 'dinner', 15), food(date, 'Biscuits', kcal * 0.1, 'snack', 3), ...extra]
}
const week = (kcal: number, from = '2026-10-14') => Array.from({ length: 7 }, (_, i) => day(addDays(from, i), kcal)).flat()
const weights = (start: number, perWeek: number, days = 14): WeightEntry[] =>
  Array.from({ length: days }, (_, i) => ({ date: addDays(TODAY, -(days - 1) + i), kg: round2(start + (perWeek / 7) * i) }))
const round2 = (n: number) => Math.round(n * 100) / 100

const base = (over: Partial<InsightInput> = {}): InsightInput => ({ today: TODAY, entries: week(2200), weights: weights(80, 0), goals, tdee: 2250, diet: { ...DEFAULT_DIET, base: 'vegetarian' }, ...over })
const ids = (r: ReturnType<typeof weeklyReport>) => r.findings.map((f) => f.id)

describe('weight trend', () => {
  it('reads a real trend and ignores day-to-day noise', () => {
    const noisy = weights(80, -0.5).map((w, i) => ({ ...w, kg: round2(w.kg + (i % 2 ? 0.6 : -0.6)) }))
    const t = weightTrend(noisy, TODAY)
    expect(t.status).toBe('losing')
    expect(t.kgPerWeek).toBeLessThan(-0.2)
    expect(t.kgPerWeek).toBeGreaterThan(-0.9)
  })
  it('does not call two readings a trend', () => {
    const t = weightTrend([{ date: TODAY, kg: 80 }, { date: addDays(TODAY, -1), kg: 81 }], TODAY)
    expect(t.status).toBe('unknown')
  })
  it('reports flat when the change is tiny', () => {
    expect(weightTrend(weights(80, 0.05), TODAY).status).toBe('flat')
  })
})

describe('weekly report: not enough data', () => {
  it('asks for more logging instead of guessing', () => {
    const r = weeklyReport(base({ entries: day('2026-10-19', 2000) }))
    expect(r.ready).toBe(false)
    expect(r.notice).toMatch(/Log at least/)
  })
  it('says so when nothing is logged', () => {
    expect(weeklyReport(base({ entries: [] })).notice).toMatch(/Nothing logged/)
  })
})

describe('weight is not dropping', () => {
  it('names the missing deficit and quantifies it', () => {
    const r = weeklyReport(base({ entries: week(2250), weights: weights(80, 0) }))
    expect(r.ready).toBe(true)
    expect(r.verdict.status).toBe('stalled')
    const f = r.findings.find((x) => x.id === 'no-deficit')!
    expect(f).toBeTruthy()
    expect(f.severity).toBe('high')
    expect(f.detail).toContain('2250')
    expect(r.targetKcal).toBeLessThan(2250)
    expect(r.targetKcal).toBeGreaterThanOrEqual(1400)
    expect(r.actions.length).toBeGreaterThan(0)
  })

  it('does not blame a deficit that is not there, and says it may just be water', () => {
    const r = weeklyReport(base({ entries: week(1600), weights: weights(80, 0) }))
    expect(ids(r)).not.toContain('no-deficit')
    expect(ids(r)).toContain('water-masking')
    expect(r.balance.perDay).toBeLessThan(-500)
  })

  it('flags half-logged days as the likely reason', () => {
    const entries = [...week(2100, '2026-10-14').slice(0, 20), ...day('2026-10-19', 2100), food('2026-10-20', 'Coffee', 60, 'snack')]
    const r = weeklyReport(base({ entries }))
    expect(ids(r)).toContain('under-logging')
    expect(r.incompleteDays).toBe(1)
  })

  it('finds a weekend spike', () => {
    // 14 Oct = Wed ... 17 = Sat, 18 = Sun
    const entries = Array.from({ length: 7 }, (_, i) => day(addDays('2026-10-14', i), [3, 4].includes(i) ? 3200 : 1800)).flat()
    const r = weeklyReport(base({ entries }))
    expect(ids(r)).toContain('weekend')
  })

  it('finds heavy liquid calories', () => {
    const extra = Array.from({ length: 7 }, (_, i) => food(addDays('2026-10-14', i), 'Mango milkshake', 350, 'snack'))
    const r = weeklyReport(base({ entries: [...week(1800), ...extra] }))
    expect(ids(r)).toContain('liquid')
  })

  it('finds low protein', () => {
    const r = weeklyReport(base({ entries: week(1900).map((e) => ({ ...e, protein: 2 })) }))
    expect(ids(r)).toContain('protein')
  })

  it('works out what your real maintenance seems to be when the scale disagrees with the log', () => {
    // eating 1700 with a 2250 estimate predicts -0.7 kg/week, but weight is going up
    const r = weeklyReport(base({ entries: week(1700), weights: weights(80, 0.3) }))
    expect(ids(r)).toContain('scale-vs-log')
    expect(r.balance.impliedMaintenance).toBeLessThan(1700) // gaining on 1,700 means you burn less than that
    expect(r.balance.impliedMaintenance).toBeLessThan(r.tdee!)
  })
})

describe('weight went up', () => {
  it('explains a jump a small surplus cannot account for as mostly water', () => {
    const r = weeklyReport(base({ entries: week(2250), weights: weights(80, 1.2) }))
    expect(r.verdict.status).toBe('wrong-way')
    expect(ids(r)).toContain('water-not-fat')
    expect(r.findings.find((f) => f.id === 'water-not-fat')!.fix).toMatch(/7-day trend/)
  })
  it('calls a gain that matches the log a real surplus', () => {
    const r = weeklyReport(base({ entries: week(3000), weights: weights(80, 0.7), goals: { ...goals, targetKg: 76 } }))
    expect(ids(r)).toContain('real-surplus')
  })
  it('notices salty, refined food around a quick gain', () => {
    const extra = ['Pizza', 'Burger and fries', 'Instant noodles', 'Biryani'].map((n, i) => food(addDays('2026-10-14', i), n, 800))
    const r = weeklyReport(base({ entries: [...week(2250), ...extra], weights: weights(80, 1.2) }))
    expect(ids(r)).toContain('salty-refined')
  })
})

describe('on track', () => {
  it('says so and does not invent problems', () => {
    const r = weeklyReport(base({ entries: week(1750), weights: weights(80, -0.5), tdee: 2300 }))
    expect(r.verdict.status).toBe('on-track')
    expect(ids(r)).not.toContain('no-deficit')
    expect(r.findings.filter((f) => f.severity === 'high')).toHaveLength(0)
  })
})

describe('swaps from your own food', () => {
  const items = [{ name: 'Gulab jamun', meal: 'snack' as Meal, avgKcal: 300, avgProtein: 4, count: 5 }]
  it('are lighter, keep most protein, and add up to a weekly saving', () => {
    const s = findSwaps(items, { ...DEFAULT_DIET, base: 'vegetarian' })
    for (const x of s) {
      expect(x.toKcal).toBeLessThan(x.fromKcal * 0.76)
      expect(x.savesPerWeek).toBe((x.fromKcal - x.toKcal) * x.timesPerWeek)
    }
  })
  it('never suggest food that breaks the diet or an allergy', () => {
    const vegan = findSwaps([{ name: 'Chicken biryani', meal: 'lunch', avgKcal: 650, avgProtein: 30, count: 3 }, ...items], { ...DEFAULT_DIET, base: 'vegan', allergies: ['peanuts'] })
    for (const x of vegan) expect(x.to).not.toMatch(/paneer|curd|egg|chicken|fish|milk|peanut|dahi|yogurt|cheese/i)
  })
  it('skips small items and unknown roles', () => {
    expect(findSwaps([{ name: 'Black coffee', meal: 'breakfast', avgKcal: 5, avgProtein: 0, count: 7 }], undefined)).toEqual([])
  })
})

describe('the report as a whole', () => {
  it('always covers the 7 completed days before today', () => {
    const r = weeklyReport(base())
    expect(r.from).toBe('2026-10-14')
    expect(r.to).toBe('2026-10-20')
    expect(r.days).toHaveLength(7)
  })
  it('puts the most serious finding first', () => {
    const r = weeklyReport(base({ entries: week(2250) }))
    const order = { high: 0, medium: 1, low: 2, info: 3 }
    const sev = r.findings.map((f) => order[f.severity])
    expect([...sev].sort((a, b) => a - b)).toEqual(sev)
  })
  it('never suggests eating below the safe floor', () => {
    const r = weeklyReport(base({ entries: week(1500), weights: weights(80, 0), tdee: 1700, minKcal: 1400, pace: 1 }))
    expect(r.targetKcal).toBeGreaterThanOrEqual(1400)
  })
})
