// Meal recommendation engine.
//
// A knowledge-based, optimisation-driven recommender (the "hybrid" family surveyed by Burke 2002, Trattner & Elsweiler
// 2017 and Min et al. 2019). No language model is involved in any decision here:
//
//   1. FILTER   hard constraints from ingredient flags: diet (per weekday), allergies, dislikes, recent "avoid" list
//   2. SCORE    soft preferences: cuisine, familiarity, learned taste (Thompson sampling), healthiness, recency, variety
//   3. SEARCH   for each meal, enumerate combinations of foods that follow a role template (carb + protein + veg ...)
//   4. OPTIMISE choose portions for each combination with a bounded least-squares solve (the diet problem), pick the best
//   5. REFINE   re-solve all chosen portions together against the whole day's targets
//   6. EXPLAIN  attach plain-language reasons and nutrient tips from rules
//
// It runs on the device (web and phone), so plans are instant, free, private and work offline.
import type { Meal } from '../types'
import { MEAL_SHARE, avoidMatches, dietLabel, dietOn, foodProblems, splitTargets, type DietType, type Macros } from '../diet'
import { CATALOG, allowsDiet } from './catalog'
import { cost, snapAndPolish, solve, type Row, type Variable } from './solver'
import { PRIOR, rng, sampleBeta, type Taste } from './taste'
import { nutrientTips } from './rules'
import type { Allergen, Food, HistoryFood, RecommendInput, RecommendOutput, RecommendedItem, Role } from './types'

// ---------------------------------------------------------------- tunable constants (documented in Architecture.md)

export const WEIGHTS = {
  /** importance of each nutrient in the fit, relative */
  fit: { calories: 3, protein: 2, carbs: 1, fat: 1 },
  /** how strongly portions are pulled back toward one normal serving */
  portionPull: 0.004,
  /** preference score is traded against fit: objective = fitCost * FIT_SCALE - preference */
  fitScale: 100,
  cuisineMatch: 0.25,
  familiarity: 0.3,
  taste: 0.6,
  healthBonus: 0.1,
  healthPenalty: 0.15,
  /** penalty for something eaten in the last few days, fading with the days since: recent * exp(-days / 2) */
  recent: 0.6,
  jitter: 0.08,
  /** penalty for a meal that mixes unrelated cuisines (bread with dal) */
  incoherent: 0.45,
  /** per-meal calorie row weight during the whole-day refinement */
  mealShare: 0.5,
}

const K_PER_ROLE = 6
const MAX_COMBOS = 700

/** The shapes a meal can take, by the roles that fill it. Earlier templates are slightly preferred. */
const TEMPLATES: Record<Meal, Role[][]> = {
  breakfast: [['main'], ['main', 'fruit'], ['main', 'drink'], ['carb', 'protein'], ['carb', 'protein', 'fruit']],
  lunch: [['carb', 'protein', 'veg'], ['main', 'veg'], ['carb', 'protein', 'veg', 'side'], ['main', 'side'], ['main']],
  dinner: [['carb', 'protein', 'veg'], ['main', 'veg'], ['carb', 'protein', 'veg', 'side'], ['main', 'side'], ['main']],
  snack: [['snack'], ['snack', 'fruit'], ['fruit', 'drink'], ['snack', 'drink']],
}

// ---------------------------------------------------------------- constraints

const ALLERGY_CATEGORIES: Record<string, Allergen[]> = {
  nuts: ['nuts', 'peanuts'], 'tree nuts': ['nuts'], peanut: ['peanuts'], peanuts: ['peanuts'],
  dairy: ['dairy'], milk: ['dairy'], lactose: ['dairy'], egg: ['eggs'], eggs: ['eggs'],
  gluten: ['gluten'], wheat: ['gluten'], soy: ['soy'], soya: ['soy'], sesame: ['sesame'],
  shellfish: ['shellfish'], seafood: ['fish', 'shellfish'], fish: ['fish'],
}

function allergyCategories(allergies: string[]): Set<Allergen> {
  const s = new Set<Allergen>()
  for (const a of allergies) for (const c of ALLERGY_CATEGORIES[a.trim().toLowerCase()] ?? []) s.add(c)
  return s
}

export interface Constraints {
  diet: DietType
  allergies: string[]
  dislikes: string[]
}

/** True when the food is acceptable for this person today. Flags decide; name keywords are a second safety net. */
export function isAllowed(food: Food, c: Constraints): boolean {
  if (food.source === 'catalog') {
    if (!allowsDiet(food, c.diet)) return false
    const cats = allergyCategories(c.allergies)
    if (food.allergens.some((a) => cats.has(a))) return false
  }
  const text = `${food.name} ${food.keywords.join(' ')}`
  // names are checked for every food (history foods have no flags, so this is their only check)
  if (avoidMatches(text, c.allergies).length || avoidMatches(text, c.dislikes).length) return false
  if (food.source === 'history' && foodProblems(food.name, c.diet, [], []).length) return false
  return true
}

// ---------------------------------------------------------------- history -> candidate foods

const norm = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Turns foods the user logs often into candidates, so suggestions include things they actually eat. */
export function historyToFoods(history: HistoryFood[]): Food[] {
  const maxCount = Math.max(1, ...history.map((h) => h.count))
  return history
    .filter((h) => h.count >= 2 && h.kcal >= 40 && h.kcal <= 900)
    .map((h): Food => {
      const role: Role = h.kcal >= 250 ? 'main' : h.meal === 'snack' ? 'snack' : 'side'
      return {
        id: `hist:${norm(h.name)}`,
        name: h.name,
        cuisines: ['*'],
        meals: role === 'snack' ? ['snack'] : role === 'main' ? [h.meal] : [h.meal, 'snack'],
        role,
        serving: { label: h.quantity || '1 serving', grams: 0 },
        kcal: h.kcal,
        protein: h.protein,
        carbs: h.carbs,
        fat: h.fat,
        fiber: 0,
        contains: [],
        allergens: [],
        tags: [],
        portion: { min: 0.75, max: 1.25, step: 0.25 },
        keywords: [],
        source: 'history',
        familiarity: Math.min(1, h.count / maxCount) * Math.exp(-h.daysAgo / 60),
      }
    })
}

// ---------------------------------------------------------------- scoring

interface ScoreCtx {
  cuisines: string[]
  taste: Taste
  rand: () => number
  recentDays: Map<string, number>
  familiarByName: Map<string, number>
}

function preference(food: Food, ctx: ScoreCtx): number {
  let s = 0
  const universal = food.cuisines.includes('*')
  if (ctx.cuisines.length) {
    if (food.cuisines.some((c) => ctx.cuisines.includes(c))) s += WEIGHTS.cuisineMatch
    else if (universal) s += WEIGHTS.cuisineMatch * 0.4
    else s -= WEIGHTS.cuisineMatch * 0.6
  }
  const fam = food.familiarity ?? ctx.familiarByName.get(norm(food.name)) ?? 0
  s += WEIGHTS.familiarity * fam

  // Thompson sampling: one draw from this food's Beta belief (explore + exploit)
  const theta = sampleBeta(ctx.taste[food.id] ?? PRIOR, ctx.rand)
  s += WEIGHTS.taste * (theta - 0.5) * 2

  if (food.fiber >= 4 || food.tags.includes('whole-grain') || food.tags.includes('legume')) s += WEIGHTS.healthBonus
  if (food.tags.includes('indulgent') || food.tags.includes('fried')) s -= WEIGHTS.healthPenalty

  const daysAgo = ctx.recentDays.get(norm(food.name))
  if (daysAgo !== undefined) s -= WEIGHTS.recent * Math.exp(-daysAgo / 2)

  s += (ctx.rand() - 0.5) * 2 * WEIGHTS.jitter // so "plan again" gives variety
  return s
}

/**
 * A meal should read like one cuisine. Foods that suit every cuisine ('*') are neutral; the rest must share at least one
 * cuisine, so rice + dal is fine but bread + dal is not.
 */
export function isCoherent(foods: Food[]): boolean {
  const specific = foods.filter((f) => !f.cuisines.includes('*'))
  if (specific.length <= 1) return true
  return specific[0].cuisines.some((c) => specific.every((f) => f.cuisines.includes(c)))
}

// ---------------------------------------------------------------- per-meal optimisation

interface Combo {
  foods: Food[]
  x: number[]
  fit: number
  pref: number
  objective: number
}

const metrics = (f: Food) => [f.kcal, f.protein, f.carbs, f.fat]

function mealRows(foods: Food[], target: Macros): Row[] {
  const t = [target.calories, target.protein, target.carbs, target.fat]
  const w = [WEIGHTS.fit.calories, WEIGHTS.fit.protein, WEIGHTS.fit.carbs, WEIGHTS.fit.fat]
  return t.map((target, n) => ({ target, weight: w[n], a: foods.map((f) => metrics(f)[n]) }))
}

const varsFor = (foods: Food[]): Variable[] =>
  foods.map((f) => ({ min: f.portion.min, max: f.portion.max, prior: 1, priorWeight: WEIGHTS.portionPull }))

function bestForMeal(meal: Meal, target: Macros, candidates: Food[], scores: Map<string, number>, used: Set<string>, usedStaples: Set<string>): { combo: Combo | null; evaluated: number } {
  let best: Combo | null = null
  let fallback: Combo | null = null // best combination that mixes cuisines; used only if nothing coherent exists
  let evaluated = 0

  TEMPLATES[meal].forEach((roles, templateIdx) => {
    const lists = roles.map((role) => {
      const pool = candidates.filter((f) => f.role === role && f.meals.includes(meal) && !used.has(f.id))
      pool.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
      return pool.slice(0, K_PER_ROLE)
    })
    if (lists.some((l) => l.length === 0)) return

    // enumerate combinations (capped), skipping repeats of the same food within a meal
    const idx = roles.map(() => 0)
    let count = 0
    for (;;) {
      const foods = idx.map((i, r) => lists[r][i])
      if (new Set(foods.map((f) => f.id)).size === foods.length && count++ < MAX_COMBOS) {
        evaluated++
        const rows = mealRows(foods, target)
        const vars = varsFor(foods)
        const relaxed = solve(rows, vars)
        const snapped = snapAndPolish(rows, vars, foods.map((f) => f.portion.step), relaxed.x)
        const pref = foods.reduce((s, f) => s + (scores.get(f.id) ?? 0) - (usedStaples.has(f.id) ? 0.15 : 0), 0) / foods.length
        const objective = snapped.cost * WEIGHTS.fitScale - pref + templateIdx * 0.03
        const candidate = { foods, x: snapped.x, fit: snapped.cost, pref, objective }
        if (isCoherent(foods)) {
          if (!best || objective < best.objective) best = candidate
        } else if (!fallback || objective + WEIGHTS.incoherent < fallback.objective) fallback = { ...candidate, objective: objective + WEIGHTS.incoherent }
      }
      // advance the odometer
      let k = roles.length - 1
      while (k >= 0 && ++idx[k] >= lists[k].length) idx[k--] = 0
      if (k < 0 || count >= MAX_COMBOS) break
    }
  })
  return { combo: best ?? fallback, evaluated }
}

// ---------------------------------------------------------------- output

const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace(/\.0+$/, '')

function quantityLabel(f: Food, x: number): string {
  if (f.source === 'history') return x === 1 ? f.serving.label : `${fmt(x)} × ${f.serving.label}`
  return x === 1 ? f.serving.label : `${fmt(x)} × ${f.serving.label}`
}

function reasonsFor(f: Food, x: number, mealTarget: Macros, ctx: ScoreCtx, taste: Taste, diet: DietType): string[] {
  const out: string[] = []
  const protein = f.protein * x
  if (mealTarget.protein > 0 && protein >= 0.3 * mealTarget.protein && protein >= 8) out.push(`Good protein source (${Math.round(protein)} g)`)
  if (f.source === 'history' || (ctx.familiarByName.get(norm(f.name)) ?? 0) > 0.3) out.push('You eat this often')
  else if (taste[f.id] && taste[f.id].a - PRIOR.a > taste[f.id].b - PRIOR.b + 0.5) out.push('You have liked this before')
  if (ctx.cuisines.length && f.cuisines.some((c) => ctx.cuisines.includes(c))) out.push(`Fits your ${f.cuisines.find((c) => ctx.cuisines.includes(c))!.replace('-', ' ')} preference`)
  if (f.fiber * x >= 6) out.push(`High in fiber (${Math.round(f.fiber * x)} g)`)
  if (diet === 'jain' && f.source === 'catalog') out.push('No root vegetables, onion or garlic')
  return out.slice(0, 2)
}

function totalsOf(items: RecommendedItem[]): Macros {
  const s = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') => Math.round(items.reduce((a, i) => a + i[k], 0))
  return { calories: s('calories'), protein: s('protein_g'), carbs: s('carbs_g'), fat: s('fat_g') }
}

// ---------------------------------------------------------------- the entry point

export function recommendPlan(input: RecommendInput): RecommendOutput {
  const started = Date.now()
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31)
  const rand = rng(seed)
  const diet = dietOn(input.prefs, input.date)
  const constraints: Constraints = { diet, allergies: input.prefs.allergies, dislikes: input.prefs.dislikes }
  const taste = input.taste ?? {}
  const avoid = new Set((input.avoid ?? []).map(norm))
  const meals = [...new Set(input.meals)]

  // nothing meaningful left to plan (e.g. the goal is already met)
  if (input.target.calories < 80 || meals.length === 0) {
    return {
      meals: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      target: input.target,
      onTarget: true,
      removed: [],
      tips: ['You have already reached your goal for today.'],
      unfilled: [],
      fiber: 0,
      meta: { engine: 'catalog', ms: 0, repaired: false, combosEvaluated: 0, poolSize: 0, seed },
    }
  }

  const history = input.history ?? []
  const catalog = input.catalog ?? CATALOG
  const known = new Set(catalog.map((f) => norm(f.name)))
  // a logged food that is already in the catalog is the same food: reuse the catalog entry (familiarity still counts)
  const fromHistory = historyToFoods(history).filter((f) => !known.has(norm(f.name)))
  const pool = [...catalog, ...fromHistory].filter((f) => isAllowed(f, constraints) && !avoid.has(norm(f.name)))

  const recentDays = new Map<string, number>()
  for (const h of history) if (h.daysAgo <= 3) recentDays.set(norm(h.name), Math.min(recentDays.get(norm(h.name)) ?? 99, h.daysAgo))
  const familiarByName = new Map<string, number>()
  const maxCount = Math.max(1, ...history.map((h) => h.count))
  for (const h of history) familiarByName.set(norm(h.name), Math.min(1, h.count / maxCount) * Math.exp(-h.daysAgo / 60))

  const ctx: ScoreCtx = { cuisines: input.prefs.cuisines, taste, rand, recentDays, familiarByName }
  const scores = new Map<string, number>(pool.map((f) => [f.id, preference(f, ctx)]))

  const perMeal = splitTargets(input.target, meals)
  const order = [...meals].sort((a, b) => MEAL_SHARE[b] - MEAL_SHARE[a]) // fill the biggest meals first
  const used = new Set<string>()
  const usedStaples = new Set<string>()
  const chosen = new Map<Meal, Combo>()
  const unfilled: Meal[] = []
  let combosEvaluated = 0

  for (const meal of order) {
    const { combo, evaluated } = bestForMeal(meal, perMeal[meal], pool, scores, used, usedStaples)
    combosEvaluated += evaluated
    if (!combo) {
      unfilled.push(meal)
      continue
    }
    chosen.set(meal, combo)
    for (const f of combo.foods) {
      // carbs like rice or roti may repeat across meals; everything else is used once per plan
      if (f.role === 'carb') usedStaples.add(f.id)
      else used.add(f.id)
    }
  }

  // ---- whole-day refinement: re-solve every chosen portion against the day's totals
  const filled = meals.filter((m) => chosen.has(m))
  if (filled.length) {
    const foods = filled.flatMap((m) => chosen.get(m)!.foods)
    const vars = varsFor(foods)
    const x0 = filled.flatMap((m) => chosen.get(m)!.x)
    const dayT = [input.target.calories, input.target.protein, input.target.carbs, input.target.fat]
    const w = [WEIGHTS.fit.calories, WEIGHTS.fit.protein, WEIGHTS.fit.carbs, WEIGHTS.fit.fat]
    const rows: Row[] = dayT.map((target, n) => ({ target, weight: w[n] * 2, a: foods.map((f) => metrics(f)[n]) }))
    let off = 0
    for (const m of filled) {
      const n = chosen.get(m)!.foods.length
      rows.push({ target: perMeal[m].calories, weight: WEIGHTS.mealShare, a: foods.map((f, i) => (i >= off && i < off + n ? f.kcal : 0)) })
      off += n
    }
    const start = x0.map((v, i) => Math.min(vars[i].max, Math.max(vars[i].min, v)))
    const refined = solve(rows, vars.map((v, i) => ({ ...v, prior: start[i] })))
    const final = snapAndPolish(rows, vars, foods.map((f) => f.portion.step), refined.x)
    // keep the refinement only if it genuinely fits the day better than the per-meal choice
    if (cost(rows, vars, final.x) <= cost(rows, vars, x0) + 1e-9) {
      let k = 0
      for (const m of filled) {
        const c = chosen.get(m)!
        c.x = c.foods.map(() => final.x[k++])
      }
    }
  }

  // ---- build the response
  const outMeals = meals
    .filter((m) => chosen.has(m))
    .map((m) => {
      const c = chosen.get(m)!
      const items: RecommendedItem[] = c.foods.map((f, i) => {
        const x = c.x[i]
        return {
          foodId: f.id,
          name: f.name,
          quantity: quantityLabel(f, x),
          grams: Math.round(f.serving.grams * x),
          calories: Math.round(f.kcal * x),
          protein_g: Math.round(f.protein * x),
          carbs_g: Math.round(f.carbs * x),
          fat_g: Math.round(f.fat * x),
          fiber_g: Math.round(f.fiber * x),
          reasons: reasonsFor(f, x, perMeal[m], ctx, taste, diet),
          source: f.source,
        }
      })
      return { meal: m, items, target: perMeal[m], totals: totalsOf(items) }
    })

  const allItems = outMeals.flatMap((m) => m.items)
  const totals = totalsOf(allItems)
  const fiber = Math.round(allItems.reduce((a, i) => a + i.fiber_g, 0))
  const onTarget = input.target.calories > 0 && Math.abs(totals.calories - input.target.calories) / input.target.calories <= 0.1 && unfilled.length === 0

  return {
    meals: outMeals,
    totals,
    target: input.target,
    onTarget,
    removed: [],
    tips: nutrientTips({ diet, totals, target: input.target, fiber, itemNames: allItems.map((i) => i.name), dietName: dietLabel(diet) }),
    unfilled,
    fiber,
    meta: { engine: 'catalog', ms: Date.now() - started, repaired: false, combosEvaluated, poolSize: pool.length, seed },
  }
}
