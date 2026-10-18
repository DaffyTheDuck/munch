// @ts-nocheck server modules are plain JS
import { beforeEach, describe, expect, it, vi } from 'vitest'

const llm = vi.hoisted(() => ({ replies: [], calls: [] }))
vi.mock('../server/llm.mjs', () => ({
  generate: async (args) => {
    llm.calls.push(args)
    const text = llm.replies.shift()
    if (text === undefined) throw new Error('no scripted reply')
    return { text, ms: 5, provider: 'fake', model: 'fake-1', fellBackFrom: [] }
  },
  providerInfo: () => ({ provider: 'fake', model: 'fake-1', chain: ['fake'] }),
}))

import { planMeals } from '../server/plan.mjs'

// macros that add up to the calories (about 20% protein, 50% carbs, 30% fat)
const item = (name, calories, extra = {}) => ({
  name,
  quantity: '1 serving',
  grams: 200,
  calories,
  protein_g: Math.round((calories * 0.2) / 4),
  carbs_g: Math.round((calories * 0.5) / 4),
  fat_g: Math.round((calories * 0.3) / 9),
  ...extra,
})
const plan = (meals, tips = []) => JSON.stringify({ meals, tips })

const request = (over = {}) => ({
  diet: 'vegan',
  allergies: [],
  dislikes: [],
  cuisines: ['indian'],
  meals: ['breakfast', 'lunch'],
  target: { calories: 1000, protein: 50, carbs: 130, fat: 30 },
  avoid: [],
  ...over,
})

beforeEach(() => {
  llm.replies = []
  llm.calls = []
})

describe('planMeals', () => {
  it('returns a plan with per-meal and overall totals', async () => {
    llm.replies = [plan([{ meal: 'breakfast', items: [item('Vegetable poha', 300), item('Soy milk tea', 100)] }, { meal: 'lunch', items: [item('Dal and rice', 600)] }], ['Add a B12 source.'])]
    const r = await planMeals(request())
    expect(r.meals.map((m) => m.meal)).toEqual(['breakfast', 'lunch'])
    expect(r.meals[0].totals.calories).toBe(400)
    expect(r.totals.calories).toBe(1000)
    expect(r.onTarget).toBe(true)
    expect(r.tips).toEqual(['Add a B12 source.'])
    expect(r.meta.repaired).toBe(false)
    expect(llm.calls).toHaveLength(1)
  })

  it('sends the diet, allergies, targets and meals to the model', async () => {
    llm.replies = [plan([{ meal: 'breakfast', items: [item('Oats', 500)] }, { meal: 'lunch', items: [item('Rice bowl', 500)] }])]
    await planMeals(request({ allergies: ['nuts'], dislikes: ['mushroom'], avoid: ['Oats'] }))
    const sent = JSON.parse(llm.calls[0].messages[0].text)
    expect(sent.diet).toMatch(/Vegan/)
    expect(sent.allergies).toEqual(['nuts'])
    expect(sent.dislikes).toEqual(['mushroom'])
    expect(sent.avoid).toEqual(['Oats'])
    expect(sent.meals.map((m) => m.meal)).toEqual(['breakfast', 'lunch'])
    expect(sent.meals[0].target.calories + sent.meals[1].target.calories).toBeGreaterThanOrEqual(999)
  })

  it('asks the model to repair a plan that breaks the diet, then accepts the fix', async () => {
    llm.replies = [
      plan([{ meal: 'breakfast', items: [item('Masala omelette', 400)] }, { meal: 'lunch', items: [item('Dal and rice', 600)] }]),
      plan([{ meal: 'breakfast', items: [item('Tofu scramble', 400)] }, { meal: 'lunch', items: [item('Dal and rice', 600)] }]),
    ]
    const r = await planMeals(request())
    expect(llm.calls).toHaveLength(2)
    expect(llm.calls[1].messages.at(-1).text).toMatch(/omelette/i)
    expect(r.meta.repaired).toBe(true)
    expect(r.removed).toEqual([])
    expect(r.meals[0].items[0].name).toBe('Tofu scramble')
  })

  it('removes offending items if the repair still breaks the rules, and says so', async () => {
    const bad = plan([{ meal: 'breakfast', items: [item('Cheese sandwich', 400), item('Fruit bowl', 100)] }, { meal: 'lunch', items: [item('Dal and rice', 500)] }])
    llm.replies = [bad, bad]
    const r = await planMeals(request())
    expect(r.removed).toEqual(['Cheese sandwich'])
    const names = r.meals.flatMap((m) => m.items.map((i) => i.name))
    expect(names).not.toContain('Cheese sandwich')
    expect(r.tips[0]).toMatch(/Removed Cheese sandwich/)
  })

  it('never lets an allergen through, including nut products', async () => {
    const bad = plan([{ meal: 'breakfast', items: [item('Peanut butter toast', 500)] }, { meal: 'lunch', items: [item('Dal and rice', 500)] }])
    llm.replies = [bad, bad]
    const r = await planMeals(request({ diet: 'vegetarian', allergies: ['nuts'] }))
    expect(r.meals.flatMap((m) => m.items.map((i) => i.name))).toEqual(['Dal and rice'])
    expect(r.removed).toEqual(['Peanut butter toast'])
  })

  it('respects per-day diets (non-veg day allows chicken)', async () => {
    llm.replies = [plan([{ meal: 'breakfast', items: [item('Chicken sausage and eggs', 500)] }, { meal: 'lunch', items: [item('Grilled chicken salad', 500)] }])]
    const r = await planMeals(request({ diet: 'nonveg' }))
    expect(r.removed).toEqual([])
    expect(llm.calls).toHaveLength(1)
  })

  it('repairs a plan that misses the calorie target by more than 10%', async () => {
    llm.replies = [
      plan([{ meal: 'breakfast', items: [item('Poha', 200)] }, { meal: 'lunch', items: [item('Dal and rice', 300)] }]),
      plan([{ meal: 'breakfast', items: [item('Poha', 450)] }, { meal: 'lunch', items: [item('Dal and rice', 550)] }]),
    ]
    const r = await planMeals(request())
    expect(llm.calls[1].messages.at(-1).text).toMatch(/totals 500 kcal but the target is 1000/)
    expect(r.totals.calories).toBe(1000)
    expect(r.onTarget).toBe(true)
  })

  it('reports onTarget false when it still cannot hit the target after one repair', async () => {
    const low = plan([{ meal: 'breakfast', items: [item('Poha', 200)] }, { meal: 'lunch', items: [item('Dal and rice', 300)] }])
    llm.replies = [low, low]
    const r = await planMeals(request())
    expect(r.onTarget).toBe(false)
    expect(r.totals.calories).toBe(500)
  })

  it('drops meals that were not requested', async () => {
    llm.replies = [plan([{ meal: 'breakfast', items: [item('Poha', 450)] }, { meal: 'lunch', items: [item('Dal and rice', 550)] }, { meal: 'dinner', items: [item('Khichdi', 400)] }])]
    const r = await planMeals(request())
    expect(r.meals.map((m) => m.meal)).toEqual(['breakfast', 'lunch'])
  })

  it('recovers from an unreadable first reply and fails clearly if it stays unreadable', async () => {
    llm.replies = ['not json at all', plan([{ meal: 'breakfast', items: [item('Poha', 450)] }, { meal: 'lunch', items: [item('Dal and rice', 550)] }])]
    expect((await planMeals(request())).meta.repaired).toBe(true)

    llm.replies = ['nope', 'still nope']
    await expect(planMeals(request())).rejects.toThrow(/unreadable/)
  })

  it('accepts common alternative field names for macros', async () => {
    const alt = (name, calories) => ({ name, quantity: '1 bowl', grams: 200, kcal: calories, protein: Math.round((calories * 0.2) / 4), carbs: Math.round((calories * 0.5) / 4), fat: Math.round((calories * 0.3) / 9) })
    llm.replies = [plan([{ meal: 'breakfast', items: [alt('Poha', 450)] }, { meal: 'lunch', items: [alt('Dal and rice', 550)] }])]
    const r = await planMeals(request())
    expect(llm.calls).toHaveLength(1)
    expect(r.meals[0].items[0]).toMatchObject({ calories: 450, protein_g: 23, carbs_g: 56, fat_g: 15 })
    expect(r.totals.protein).toBeGreaterThan(0)
  })

  it('treats missing macros as an error and asks for a repair (never silently zero)', async () => {
    const noMacros = (name, calories) => ({ name, quantity: '1 bowl', grams: 200, calories })
    llm.replies = [
      plan([{ meal: 'breakfast', items: [noMacros('Poha', 450)] }, { meal: 'lunch', items: [noMacros('Dal and rice', 550)] }]),
      plan([{ meal: 'breakfast', items: [item('Poha', 450)] }, { meal: 'lunch', items: [item('Dal and rice', 550)] }]),
    ]
    const r = await planMeals(request())
    expect(llm.calls).toHaveLength(2)
    expect(r.meta.repaired).toBe(true)
    expect(r.totals.protein).toBeGreaterThan(0)
  })

  it('asks for a repair when macros do not match the calories', async () => {
    const wrong = (name, calories) => item(name, calories, { protein_g: 1, carbs_g: 1, fat_g: 1 })
    llm.replies = [
      plan([{ meal: 'breakfast', items: [wrong('Poha', 450)] }, { meal: 'lunch', items: [wrong('Dal and rice', 550)] }]),
      plan([{ meal: 'breakfast', items: [item('Poha', 450)] }, { meal: 'lunch', items: [item('Dal and rice', 550)] }]),
    ]
    await planMeals(request())
    expect(llm.calls[1].messages.at(-1).text).toMatch(/macros for "Poha".*do not match its calories/)
  })

  it('returns an empty plan without calling the model when nothing is left to plan', async () => {
    const r = await planMeals(request({ target: { calories: 20, protein: 0, carbs: 0, fat: 0 } }))
    expect(r.meals).toEqual([])
    expect(llm.calls).toHaveLength(0)
  })

  it('rejects invalid requests', async () => {
    await expect(planMeals(request({ diet: 'carnivore' }))).rejects.toThrow(/Invalid plan request/)
    await expect(planMeals(request({ meals: [] }))).rejects.toThrow(/Invalid plan request/)
    await expect(planMeals({})).rejects.toThrow(/Invalid plan request/)
  })
})
