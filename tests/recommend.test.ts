import { describe, expect, it } from 'vitest'
import { CATALOG, allowsDiet, buildHistory, historyToFoods, isAllowed, nutrientTips, recommendPlan, snapAndPolish, solve, cost, updateTaste, meanOf, rng, sampleBeta, PRIOR } from '../shared/recommend'
import { isCoherent } from '../shared/recommend/engine'
import { DIETS, MEAL_SHARE, PLAN_MEALS, dietOn, foodProblems, normalizeDiet, type DietType, type Macros } from '../shared/diet'
import type { Food, HistoryFood } from '../shared/recommend'

const DAY: Macros = { calories: 1900, protein: 95, carbs: 245, fat: 60 }
const plan = (over: Partial<Parameters<typeof recommendPlan>[0]> = {}) =>
  recommendPlan({ prefs: normalizeDiet({ base: 'vegetarian' }), date: '2026-10-20', meals: PLAN_MEALS, target: DAY, seed: 1, ...over })
const byId = (id: string) => CATALOG.find((f) => f.id === id)!
const itemsOf = (r: ReturnType<typeof plan>) => r.meals.flatMap((m) => m.items)

describe('catalog integrity', () => {
  it('has unique ids and sensible fields', () => {
    expect(new Set(CATALOG.map((f) => f.id)).size).toBe(CATALOG.length)
    for (const f of CATALOG) {
      expect(f.meals.length, f.id).toBeGreaterThan(0)
      expect(f.serving.grams, f.id).toBeGreaterThan(0)
      expect(f.kcal, f.id).toBeGreaterThanOrEqual(15)
      expect(f.kcal, f.id).toBeLessThanOrEqual(900)
      expect(f.kcal, f.id).toBe(Math.round(4 * f.protein + 4 * f.carbs + 9 * f.fat)) // derived, never contradictory
      expect(f.portion.min, f.id).toBeLessThanOrEqual(1)
      expect(f.portion.max, f.id).toBeGreaterThanOrEqual(1)
      expect(f.portion.step, f.id).toBeGreaterThan(0)
      expect(f.fiber, f.id).toBeLessThanOrEqual(f.carbs + 0.01) // fibre is part of carbohydrate
    }
  })

  it('has enough foods for every diet and every meal', () => {
    for (const d of DIETS) {
      for (const meal of PLAN_MEALS) {
        const n = CATALOG.filter((f) => allowsDiet(f, d.id) && f.meals.includes(meal)).length
        expect(n, `${d.id} ${meal}`).toBeGreaterThanOrEqual(meal === 'snack' ? 6 : 12)
      }
    }
  })

  it('derives diets from ingredient flags', () => {
    expect(allowsDiet(byId('masala-omelette'), 'vegetarian')).toBe(false)
    expect(allowsDiet(byId('masala-omelette'), 'eggetarian')).toBe(true)
    expect(allowsDiet(byId('chicken-curry'), 'pescatarian')).toBe(false)
    expect(allowsDiet(byId('fish-curry'), 'pescatarian')).toBe(true)
    expect(allowsDiet(byId('fish-curry'), 'eggetarian')).toBe(false)
    expect(allowsDiet(byId('paneer-tikka'), 'vegan')).toBe(false)
    expect(allowsDiet(byId('paneer-tikka'), 'vegetarian')).toBe(true)
    expect(allowsDiet(byId('dal-tadka'), 'jain')).toBe(false) // tempered with onion/garlic
    expect(allowsDiet(byId('simple-moong-dal'), 'jain')).toBe(true)
    expect(allowsDiet(byId('aloo-gobi'), 'jain')).toBe(false) // root vegetable
    expect(allowsDiet(byId('grilled-salmon'), 'nonveg')).toBe(true)
  })
})

describe('hard constraints are never broken', () => {
  const allergySets = [[], ['nuts'], ['peanuts'], ['dairy'], ['gluten'], ['soy'], ['eggs'], ['dairy', 'gluten'], ['sesame', 'soy']]

  it('every suggested food is allowed, across every diet, allergy set and many seeds', () => {
    let checked = 0
    for (const d of DIETS) {
      for (const allergies of allergySets) {
        for (let seed = 1; seed <= 6; seed++) {
          const prefs = normalizeDiet({ base: d.id, allergies, cuisines: seed % 2 ? ['indian'] : ['mediterranean'] })
          const r = plan({ prefs, seed, date: '2026-10-21' })
          for (const it of itemsOf(r)) {
            const food = byId(it.foodId)
            expect(isAllowed(food, { diet: d.id, allergies, dislikes: [] }), `${it.name} for ${d.id} avoiding ${allergies}`).toBe(true)
            // second line of defence: the keyword checker agrees
            expect(foodProblems(it.name, d.id, allergies, []), `${it.name} (${d.id}, ${allergies})`).toEqual([])
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1500)
  })

  it('honours dislikes', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = plan({ prefs: normalizeDiet({ base: 'vegetarian', dislikes: ['paneer', 'spinach', 'okra'] }), seed })
      for (const it of itemsOf(r)) expect(it.name.toLowerCase()).not.toMatch(/paneer|spinach|okra|bhindi/)
    }
  })

  it('uses the weekday diet: non-veg on Monday, vegetarian on Tuesday', () => {
    const prefs = normalizeDiet({ base: 'vegetarian', overrides: { 1: 'nonveg' } })
    expect(dietOn(prefs, '2026-10-19')).toBe('nonveg')
    let monMeat = 0
    for (let seed = 1; seed <= 40; seed++) {
      const mon = plan({ prefs, date: '2026-10-19', seed })
      const tue = plan({ prefs, date: '2026-10-20', seed })
      if (itemsOf(mon).some((i) => byId(i.foodId).contains.some((c) => ['meat', 'fish', 'shellfish'].includes(c)))) monMeat++
      for (const it of itemsOf(tue)) expect(allowsDiet(byId(it.foodId), 'vegetarian'), it.name).toBe(true)
    }
    expect(monMeat).toBeGreaterThan(0) // meat is actually offered on the non-veg day
  })

  it('Jain plans never contain root vegetables, onion, garlic or eggs', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = plan({ prefs: normalizeDiet({ base: 'jain', cuisines: ['indian'] }), seed })
      for (const it of itemsOf(r)) {
        const f = byId(it.foodId)
        expect(f.contains.some((c) => ['root', 'allium', 'mushroom', 'egg', 'meat', 'fish'].includes(c)), it.name).toBe(false)
      }
    }
  })

  it('only offers foods in the right meal', () => {
    const r = plan({ seed: 9 })
    for (const m of r.meals) for (const it of m.items) expect(byId(it.foodId).meals, it.name).toContain(m.meal)
  })

  it('"avoid" removes dishes (used for Swap)', () => {
    const first = plan({ meals: ['breakfast'], target: { calories: 450, protein: 20, carbs: 60, fat: 15 }, seed: 3 })
    const names = itemsOf(first).map((i) => i.name)
    for (let seed = 1; seed <= 15; seed++) {
      const again = plan({ meals: ['breakfast'], target: { calories: 450, protein: 20, carbs: 60, fat: 15 }, seed, avoid: names })
      for (const it of itemsOf(again)) expect(names).not.toContain(it.name)
    }
  })
})

describe('quality of the plans', () => {
  it('hits calorie and macro targets closely over many random scenarios', () => {
    const rand = rng(77)
    const errs = { kcal: [] as number[], p: [] as number[], c: [] as number[], f: [] as number[] }
    let unfilled = 0
    const N = 120
    for (let n = 0; n < N; n++) {
      const kcal = 1300 + Math.floor(rand() * 35) * 50
      const protein = (kcal * (0.18 + rand() * 0.12)) / 4
      const fat = (kcal * (0.25 + rand() * 0.1)) / 9
      const target = { calories: kcal, protein: Math.round(protein), fat: Math.round(fat), carbs: Math.round((kcal - protein * 4 - fat * 9) / 4) }
      const diet = DIETS[n % DIETS.length].id
      const r = plan({ prefs: normalizeDiet({ base: diet, cuisines: n % 3 === 0 ? ['indian'] : [] }), target, seed: n + 1 })
      unfilled += r.unfilled.length ? 1 : 0
      const rel = (a: number, b: number) => Math.abs(a - b) / b
      errs.kcal.push(rel(r.totals.calories, target.calories))
      errs.p.push(rel(r.totals.protein, target.protein))
      errs.c.push(rel(r.totals.carbs, target.carbs))
      errs.f.push(rel(r.totals.fat, target.fat))
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(unfilled).toBe(0)
    expect(mean(errs.kcal)).toBeLessThan(0.02)
    expect(Math.max(...errs.kcal)).toBeLessThan(0.06)
    expect(mean(errs.p)).toBeLessThan(0.07)
    expect(mean(errs.c)).toBeLessThan(0.07)
    expect(mean(errs.f)).toBeLessThan(0.08)
  })

  it('is reproducible for a given seed and varies between seeds', () => {
    const strip = (r: ReturnType<typeof plan>) => JSON.stringify({ ...r, meta: { ...r.meta, ms: 0 } })
    expect(strip(plan({ seed: 5 }))).toBe(strip(plan({ seed: 5 })))
    const variants = new Set(Array.from({ length: 12 }, (_, s) => itemsOf(plan({ seed: s + 1 })).map((i) => i.foodId).join(',')))
    expect(variants.size).toBeGreaterThan(8)
  })

  it('never repeats a non-staple dish within a plan', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const items = itemsOf(plan({ seed })).filter((i) => byId(i.foodId).role !== 'carb')
      expect(new Set(items.map((i) => i.foodId)).size).toBe(items.length)
    }
  })

  it('plans only the meals asked for, and a single small meal works', () => {
    const r = plan({ meals: ['snack'], target: { calories: 160, protein: 8, carbs: 20, fat: 5 } })
    expect(r.meals.map((m) => m.meal)).toEqual(['snack'])
    expect(Math.abs(r.totals.calories - 160)).toBeLessThan(40)
    const rest = plan({ meals: ['dinner', 'snack'], target: { calories: 700, protein: 35, carbs: 85, fat: 22 } })
    expect(rest.meals.map((m) => m.meal).sort()).toEqual(['dinner', 'snack'])
  })

  it('returns an empty plan when nothing is left to plan', () => {
    const r = plan({ target: { calories: 20, protein: 0, carbs: 0, fat: 0 } })
    expect(r.meals).toEqual([])
    expect(r.tips[0]).toMatch(/already reached/)
  })

  it('is fast enough to run on a phone', () => {
    const t0 = performance.now()
    plan({ seed: 2 })
    expect(performance.now() - t0).toBeLessThan(800)
  })

  it('reports fiber and explains its choices', () => {
    const r = plan({ prefs: normalizeDiet({ base: 'vegetarian', cuisines: ['indian'] }), seed: 4 })
    expect(r.fiber).toBeGreaterThan(5)
    expect(itemsOf(r).some((i) => i.reasons.length > 0)).toBe(true)
  })

  it('keeps a meal to one cuisine (rice with dal yes, bread with dal no)', () => {
    expect(isCoherent([byId('white-rice'), byId('dal-tadka')])).toBe(true)
    expect(isCoherent([byId('wholewheat-bread'), byId('dal-tadka')])).toBe(false)
    expect(isCoherent([byId('boiled-eggs'), byId('dal-tadka')])).toBe(true) // universal foods are neutral
    for (let seed = 1; seed <= 25; seed++) {
      const r = plan({ prefs: normalizeDiet({ base: 'vegetarian', cuisines: ['indian'] }), seed })
      for (const m of r.meals) expect(isCoherent(m.items.map((i) => byId(i.foodId))), `${m.meal}: ${m.items.map((i) => i.name).join(' + ')}`).toBe(true)
    }
  })
})

describe('learning taste (Thompson sampling)', () => {
  const freq = (id: string, taste: Record<string, { a: number; b: number }>) => {
    let n = 0
    for (let seed = 1; seed <= 120; seed++) {
      const r = plan({ meals: ['breakfast'], target: { calories: 450, protein: 20, carbs: 60, fat: 15 }, prefs: normalizeDiet({ base: 'vegetarian', cuisines: ['indian'] }), taste, seed })
      if (itemsOf(r).some((i) => i.foodId === id)) n++
    }
    return n
  }

  it('shows liked foods more often and swapped-away foods less often', () => {
    // pick a dish that appears at baseline, so "less often" is measurable
    const counts = new Map<string, number>()
    for (let seed = 1; seed <= 120; seed++) {
      const r = plan({ meals: ['breakfast'], target: { calories: 450, protein: 20, carbs: 60, fat: 15 }, prefs: normalizeDiet({ base: 'vegetarian', cuisines: ['indian'] }), seed })
      for (const i of itemsOf(r)) counts.set(i.foodId, (counts.get(i.foodId) ?? 0) + 1)
    }
    const [id, base] = [...counts].sort((a, b) => b[1] - a[1])[0]
    expect(base).toBeGreaterThan(15)
    const liked = freq(id, { [id]: { a: 40, b: 2 } })
    const disliked = freq(id, { [id]: { a: 2, b: 40 } })
    expect(liked).toBeGreaterThanOrEqual(base)
    expect(disliked).toBeLessThan(base)
    expect(liked).toBeGreaterThan(disliked + 10)
  })

  it('updates beliefs, decays old evidence, and stays bounded', () => {
    let t = updateTaste({}, ['poha'], 'liked')
    expect(t.poha).toEqual({ a: PRIOR.a + 1, b: PRIOR.b })
    t = updateTaste(t, ['poha'], 'swapped')
    expect(t.poha.b).toBeGreaterThan(PRIOR.b)
    expect(t.poha.a).toBeLessThan(PRIOR.a + 1) // the earlier "liked" has faded a little
    let big = {} as Record<string, { a: number; b: number }>
    for (let i = 0; i < 700; i++) big = updateTaste(big, [`food-${i}`], 'liked')
    expect(Object.keys(big).length).toBeLessThanOrEqual(600)
  })

  it('samples from the Beta distribution (mean a/(a+b)) with a reproducible generator', () => {
    const r = rng(11)
    const xs = Array.from({ length: 4000 }, () => sampleBeta({ a: 8, b: 2 }, r))
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean).toBeGreaterThan(0.77)
    expect(mean).toBeLessThan(0.83)
    expect(xs.every((x) => x > 0 && x < 1)).toBe(true)
    expect(meanOf({ a: 8, b: 2 })).toBeCloseTo(0.8)
    const a = rng(5)
    const b = rng(5)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe('personalising from history', () => {
  const hist = (over: Partial<HistoryFood>): HistoryFood => ({ name: 'Sprouts bhel', meal: 'snack', kcal: 160, protein: 8, carbs: 24, fat: 4, quantity: '1 bowl', count: 12, daysAgo: 2, ...over })

  it('builds history from logged entries (medians, counts, recency, ignores exercise and old data)', () => {
    const e = (name: string, date: string, calories: number, kind: 'food' | 'exercise' = 'food') => ({ kind, name, meal: 'lunch' as const, calories, protein: 10, carbs: 30, fat: 5, quantity: '1 bowl', date })
    const h = buildHistory(
      [e('Dal rice', '2026-10-18', 400), e('Dal rice', '2026-10-16', 500), e('Dal rice', '2026-10-10', 450), e('Run', '2026-10-18', 300, 'exercise'), e('Old thing', '2026-01-01', 300)],
      '2026-10-20',
    )
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ name: 'Dal rice', count: 3, kcal: 450, daysAgo: 2 })
  })

  it('turns frequently logged foods into candidates and offers them', () => {
    expect(historyToFoods([hist({ count: 1 })])).toHaveLength(0) // needs at least 2 logs
    let seen = 0
    for (let seed = 1; seed <= 40; seed++) {
      const r = plan({ meals: ['snack'], target: { calories: 160, protein: 8, carbs: 24, fat: 4 }, history: [hist({})], seed })
      if (itemsOf(r).some((i) => i.name === 'Sprouts bhel')) seen++
    }
    expect(seen).toBeGreaterThan(8)
  })

  it('still applies diet and allergy rules to history foods', () => {
    const bad = [hist({ name: 'Chicken sandwich', meal: 'lunch', kcal: 420, count: 30 }), hist({ name: 'Peanut chikki', count: 30 })]
    for (let seed = 1; seed <= 25; seed++) {
      const r = plan({ prefs: normalizeDiet({ base: 'vegetarian', allergies: ['peanuts'] }), history: bad, seed })
      for (const it of itemsOf(r)) expect(it.name).not.toMatch(/chicken|peanut/i)
    }
  })

  it('avoids dishes eaten in the last few days', () => {
    const recent = [hist({ name: 'Masala chai', meal: 'snack', kcal: 77, protein: 2.5, carbs: 10, fat: 3, count: 3, daysAgo: 1 })]
    const count = (history: HistoryFood[]) => {
      let n = 0
      for (let seed = 1; seed <= 60; seed++) {
        const r = plan({ meals: ['snack'], target: { calories: 180, protein: 6, carbs: 25, fat: 6 }, prefs: normalizeDiet({ base: 'vegetarian', cuisines: ['indian'] }), history, seed })
        if (itemsOf(r).some((i) => i.name === 'Masala chai')) n++
      }
      return n
    }
    expect(count(recent)).toBeLessThan(count([]))
  })
})

describe('portion solver', () => {
  const vars = (n: number, min = 0.5, max = 3): { min: number; max: number; prior: number; priorWeight: number }[] =>
    Array.from({ length: n }, () => ({ min, max, prior: 1, priorWeight: 0 }))

  it('finds the exact portions when they exist', () => {
    // food A: 100 kcal / 10 g protein; food B: 200 kcal / 0 g protein. Want 500 kcal and 20 g protein -> 2 A + 1.5 B ... check
    const rows = [
      { target: 500, weight: 1, a: [100, 200] },
      { target: 20, weight: 1, a: [10, 0] },
    ]
    const s = solve(rows, vars(2))
    expect(s.x[0]).toBeCloseTo(2, 3)
    expect(s.x[1]).toBeCloseTo(1.5, 3)
    expect(s.cost).toBeLessThan(1e-8)
  })

  it('respects the bounds', () => {
    const s = solve([{ target: 1000, weight: 1, a: [100] }], vars(1, 0.5, 2))
    expect(s.x[0]).toBe(2)
  })

  it('snaps to steps without making things worse than the obvious rounding', () => {
    const rows = [{ target: 330, weight: 1, a: [100, 60] }]
    const vs = vars(2, 0.5, 3)
    const relaxed = solve(rows, vs)
    const snapped = snapAndPolish(rows, vs, [0.5, 0.5], relaxed.x)
    for (const v of snapped.x) expect(Math.abs(v / 0.5 - Math.round(v / 0.5))).toBeLessThan(1e-9)
    expect(snapped.cost).toBeLessThanOrEqual(cost(rows, vs, relaxed.x.map((v) => Math.round(v / 0.5) * 0.5)) + 1e-12)
  })

  it('the prior pulls portions toward one serving when the fit is indifferent', () => {
    const rows = [{ target: 0, weight: 0, a: [1] }]
    const s = solve(rows, [{ min: 0.5, max: 3, prior: 1, priorWeight: 1 }])
    expect(s.x[0]).toBeCloseTo(1, 3)
  })
})

describe('nutrient tips (rule base)', () => {
  const base = { totals: { calories: 1900, protein: 95, carbs: 245, fat: 60 }, target: DAY, fiber: 30, itemNames: [] as string[], dietName: '' }
  it('flags a protein shortfall with diet-appropriate fixes', () => {
    const t = nutrientTips({ ...base, diet: 'vegan' as DietType, totals: { ...base.totals, protein: 60 } })
    expect(t[0]).toMatch(/35 g short on protein/)
    expect(t[0]).toMatch(/tofu|tempeh|lentils/)
    expect(nutrientTips({ ...base, diet: 'nonveg', totals: { ...base.totals, protein: 60 } })[0]).toMatch(/chicken|fish|eggs/)
  })
  it('flags low fiber using the 14 g per 1,000 kcal guideline', () => {
    expect(nutrientTips({ ...base, diet: 'nonveg', fiber: 10 }).join(' ')).toMatch(/Fiber is on the low side/)
    expect(nutrientTips({ ...base, diet: 'nonveg', fiber: 30 }).join(' ')).not.toMatch(/Fiber/)
  })
  it('adds B12 and iron notes for vegans and vegetarians, at most three tips', () => {
    const vegan = nutrientTips({ ...base, diet: 'vegan', totals: { ...base.totals, protein: 50 }, fiber: 5 })
    expect(vegan.length).toBeLessThanOrEqual(3)
    expect(nutrientTips({ ...base, diet: 'vegan' }).join(' ')).toMatch(/B12/)
    expect(nutrientTips({ ...base, diet: 'vegetarian' }).join(' ')).toMatch(/iron/i)
  })
})

describe('meal shares', () => {
  it('sum to 1', () => {
    expect(Object.values(MEAL_SHARE).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })
})

// keep TypeScript honest about the Food type being exported
const _food: Food | undefined = undefined
void _food
