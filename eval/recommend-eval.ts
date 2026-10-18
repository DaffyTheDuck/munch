// Benchmarks the recommendation engine on random scenarios. Deterministic (fixed seeds); no network, no model calls.
// Run: npx vite-node eval/recommend-eval.ts [scenarios]        (writes eval/results/recommend.json)
import { mkdirSync, writeFileSync } from 'node:fs'
import { CATALOG, allowsDiet, isAllowed, recommendPlan } from '../shared/recommend'
import { rng } from '../shared/recommend/taste'
import { DIETS, MEAL_SHARE, PLAN_MEALS, dietOn, normalizeDiet, type DietType, type Macros } from '../shared/diet'
import type { Meal } from '../shared/types'

const N = Number(process.argv[2] ?? 600)
const rand = rng(20261018)
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
const ALLERGIES = ['nuts', 'peanuts', 'dairy', 'gluten', 'soy', 'eggs', 'sesame', 'shellfish']
const CUISINE_IDS = ['indian', 'american', 'mediterranean', 'italian', 'mexican', 'middle-eastern', 'chinese', 'japanese', 'thai', 'korean']

interface Result {
  diet: DietType
  unfilled: number
  kcalErr: number
  pErr: number
  cErr: number
  fErr: number
  violations: number
  repeatedDish: number
  ms: number
}

const results: Result[] = []
for (let n = 0; n < N; n++) {
  const diet = pick(DIETS).id
  const allergies = rand() < 0.35 ? [...new Set([pick(ALLERGIES), ...(rand() < 0.3 ? [pick(ALLERGIES)] : [])])] : []
  const cuisines = rand() < 0.7 ? [...new Set([pick(CUISINE_IDS), ...(rand() < 0.4 ? [pick(CUISINE_IDS)] : [])])] : []
  const prefs = normalizeDiet({ base: diet, allergies, cuisines })

  const kcal = 1300 + Math.floor(rand() * 35) * 50
  const protein = (kcal * (0.18 + rand() * 0.12)) / 4
  const fat = (kcal * (0.25 + rand() * 0.1)) / 9
  const carbs = (kcal - protein * 4 - fat * 9) / 4
  const day: Macros = { calories: kcal, protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) }

  const rest = rand() < 0.3
  const meals: Meal[] = rest ? (['lunch', 'snack', 'dinner'].slice(Math.floor(rand() * 3)) as Meal[]) : PLAN_MEALS
  const share = meals.reduce((s, m) => s + MEAL_SHARE[m], 0)
  const target: Macros = { calories: Math.round(day.calories * share), protein: Math.round(day.protein * share), carbs: Math.round(day.carbs * share), fat: Math.round(day.fat * share) }

  const t0 = performance.now()
  const r = recommendPlan({ prefs, date: '2026-10-20', meals, target, seed: n + 1 })
  const ms = performance.now() - t0

  const used = r.meals.flatMap((m) => m.items)
  const constraints = { diet: dietOn(prefs, '2026-10-20'), allergies, dislikes: [] as string[] }
  let violations = 0
  for (const it of used) {
    const food = CATALOG.find((f) => f.id === it.foodId)
    if (!food || !isAllowed(food, constraints) || !allowsDiet(food, constraints.diet)) violations++
  }
  // rice or roti may legitimately repeat across meals; any other dish repeating counts as a repeat
  const nonCarb = used.filter((i) => CATALOG.find((f) => f.id === i.foodId)?.role !== 'carb').map((i) => i.foodId)
  const rel = (a: number, b: number) => (b > 0 ? Math.abs(a - b) / b : 0)
  results.push({
    diet,
    unfilled: r.unfilled.length,
    kcalErr: rel(r.totals.calories, target.calories),
    pErr: rel(r.totals.protein, target.protein),
    cErr: rel(r.totals.carbs, target.carbs),
    fErr: rel(r.totals.fat, target.fat),
    violations,
    repeatedDish: nonCarb.length - new Set(nonCarb).size,
    ms,
  })
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0
const share = (xs: number[], pred: (x: number) => boolean) => (xs.filter(pred).length / (xs.length || 1)) * 100

const summarize = (rs: Result[]) => ({
  scenarios: rs.length,
  unfilledPct: +share(rs.map((r) => r.unfilled), (x) => x > 0).toFixed(1),
  kcalMeanErrPct: +(mean(rs.map((r) => r.kcalErr)) * 100).toFixed(2),
  kcalP95ErrPct: +(pct(rs.map((r) => r.kcalErr), 95) * 100).toFixed(2),
  kcalWithin5Pct: +share(rs.map((r) => r.kcalErr), (x) => x <= 0.05).toFixed(1),
  kcalWithin10Pct: +share(rs.map((r) => r.kcalErr), (x) => x <= 0.1).toFixed(1),
  proteinMeanErrPct: +(mean(rs.map((r) => r.pErr)) * 100).toFixed(1),
  carbsMeanErrPct: +(mean(rs.map((r) => r.cErr)) * 100).toFixed(1),
  fatMeanErrPct: +(mean(rs.map((r) => r.fErr)) * 100).toFixed(1),
  ruleViolations: rs.reduce((s, r) => s + r.violations, 0),
  plansWithRepeatedDishPct: +share(rs.map((r) => r.repeatedDish), (x) => x > 0).toFixed(1),
  latencyMeanMs: +mean(rs.map((r) => r.ms)).toFixed(1),
  latencyP95Ms: +pct(rs.map((r) => r.ms), 95).toFixed(1),
})

const overall = summarize(results)
const byDiet = Object.fromEntries(DIETS.map((d) => [d.id, summarize(results.filter((r) => r.diet === d.id))]))

// Variety: one vegetarian Indian user over 14 days. Does the engine keep serving the same few dishes?
const seen = new Map<string, number>()
for (let d = 0; d < 14; d++) {
  const r = recommendPlan({
    prefs: normalizeDiet({ base: 'vegetarian', cuisines: ['indian'] }),
    date: `2026-10-${String(d + 1).padStart(2, '0')}`,
    meals: PLAN_MEALS,
    target: { calories: 1900, protein: 95, carbs: 250, fat: 60 },
    seed: 1000 + d,
  })
  for (const it of r.meals.flatMap((m) => m.items)) seen.set(it.foodId, (seen.get(it.foodId) ?? 0) + 1)
}
const variety = { days: 14, distinctFoods: seen.size, mostRepeated: [...seen].sort((a, b) => b[1] - a[1]).slice(0, 3) }

const out = { generated: new Date().toISOString().slice(0, 10), catalogSize: CATALOG.length, overall, byDiet, variety }
mkdirSync('eval/results', { recursive: true })
writeFileSync('eval/results/recommend.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
