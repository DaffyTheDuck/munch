import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIET, avoidMatches, cuisinesForRegion, detectRegion, dietOn, dietViolations, expandAvoid, foodProblems, normalizeDiet,
  remainingMeals, remainingTarget, splitTargets, summarizeDiet,
} from '../shared/diet'

// 2026-10-19 is a Monday, 2026-10-21 a Wednesday, 2026-10-18 a Sunday
describe('dietOn (per-weekday overrides)', () => {
  const prefs = normalizeDiet({ base: 'vegetarian', overrides: { 1: 'nonveg', 3: 'nonveg' } })

  it('uses the base diet on ordinary days', () => {
    expect(dietOn(prefs, '2026-10-18')).toBe('vegetarian') // Sunday
    expect(dietOn(prefs, '2026-10-20')).toBe('vegetarian') // Tuesday
  })
  it('uses the override on selected days', () => {
    expect(dietOn(prefs, '2026-10-19')).toBe('nonveg') // Monday
    expect(dietOn(prefs, '2026-10-21')).toBe('nonveg') // Wednesday
  })
  it('works the other way round for non-veg people who skip meat on some days', () => {
    const p = normalizeDiet({ base: 'nonveg', overrides: { 2: 'vegetarian', 4: 'jain' } })
    expect(dietOn(p, '2026-10-20')).toBe('vegetarian') // Tuesday
    expect(dietOn(p, '2026-10-22')).toBe('jain') // Thursday
    expect(dietOn(p, '2026-10-19')).toBe('nonveg')
  })
  it('summarises the plan in one line', () => {
    expect(summarizeDiet(prefs)).toBe('Vegetarian · Non-vegetarian on Mon, Wed')
    expect(summarizeDiet(DEFAULT_DIET)).toBe('Vegetarian')
  })
})

describe('normalizeDiet', () => {
  it('repairs bad input', () => {
    const p = normalizeDiet({ base: 'carnivore', overrides: { 9: 'vegan', x: 'vegan', 2: 'nope' }, allergies: ['  Peanuts ', 'peanuts', ''], dislikes: 'nope', cuisines: ['Indian'] })
    expect(p.base).toBe('vegetarian')
    expect(p.overrides).toEqual({})
    expect(p.allergies).toEqual(['peanuts'])
    expect(p.dislikes).toEqual([])
    expect(p.cuisines).toEqual(['indian'])
  })
  it('drops overrides equal to the base diet', () => {
    expect(normalizeDiet({ base: 'vegan', overrides: { 1: 'vegan', 2: 'vegetarian' } }).overrides).toEqual({ 2: 'vegetarian' })
  })
  it('handles null and non-objects', () => {
    expect(normalizeDiet(null)).toEqual(DEFAULT_DIET)
    expect(normalizeDiet('x')).toEqual(DEFAULT_DIET)
  })
})

describe('dietViolations', () => {
  it('flags animal products for vegans', () => {
    expect(dietViolations('Paneer butter masala', 'vegan').sort()).toEqual(['butter', 'paneer'])
    expect(dietViolations('Scrambled eggs on toast', 'vegan')).toContain('eggs')
    expect(dietViolations('Greek yogurt with honey', 'vegan').sort()).toEqual(['honey', 'yogurt'])
  })
  it('does not flag plant-based foods that contain animal-sounding words', () => {
    expect(dietViolations('Peanut butter on toast', 'vegan')).toEqual([])
    expect(dietViolations('Coconut milk curry', 'vegan')).toEqual([])
    expect(dietViolations('Roasted eggplant salad', 'vegan')).toEqual([])
    expect(dietViolations('Oat milk porridge', 'vegan')).toEqual([])
    expect(dietViolations('Butternut squash soup', 'vegan')).toEqual([])
  })
  it('vegetarians skip meat, fish and eggs but may have dairy', () => {
    expect(dietViolations('Chicken tikka', 'vegetarian')).toEqual(['chicken'])
    expect(dietViolations('Grilled salmon', 'vegetarian')).toEqual(['salmon'])
    expect(dietViolations('Egg curry', 'vegetarian')).toEqual(['egg'])
    expect(dietViolations('Paneer tikka with curd', 'vegetarian')).toEqual([])
  })
  it('eggetarians may have eggs', () => {
    expect(dietViolations('Masala omelette', 'eggetarian')).toEqual([])
    expect(dietViolations('Chicken curry', 'eggetarian')).toEqual(['chicken'])
  })
  it('pescatarians may have fish but not other meat', () => {
    expect(dietViolations('Prawn curry', 'pescatarian')).toEqual([])
    expect(dietViolations('Mutton biryani', 'pescatarian')).toEqual(['mutton'])
  })
  it('Jain also excludes eggs, root vegetables, onion and garlic', () => {
    expect(dietViolations('Aloo gobi with onion', 'jain').sort()).toEqual(['aloo', 'onion'])
    expect(dietViolations('Garlic naan', 'jain')).toEqual(['garlic'])
    expect(dietViolations('Moong dal with spinach', 'jain')).toEqual([])
  })
  it('non-veg allows everything', () => {
    expect(dietViolations('Bacon cheeseburger', 'nonveg')).toEqual([])
  })
  it('matches whole words only', () => {
    expect(dietViolations('Hamburger-free hammock', 'vegan')).toEqual([]) // "ham" inside other words
    expect(dietViolations('Chickpea salad', 'vegetarian')).toEqual([]) // "chick" is not "chicken"
  })
})

describe('allergies and dislikes', () => {
  it('expands umbrella allergies', () => {
    expect(expandAvoid('nuts')).toContain('almond')
    expect(expandAvoid('dairy')).toContain('paneer')
    expect(expandAvoid('gluten')).toContain('roti')
    expect(expandAvoid('mango')).toEqual(['mango'])
  })
  it('matches an allergy conservatively (peanut butter is a nut)', () => {
    expect(avoidMatches('Peanut butter sandwich', ['nuts'])).toEqual(['nuts'])
    expect(avoidMatches('Almond milk latte', ['dairy'])).toEqual(['dairy']) // errs on the safe side
    expect(avoidMatches('Rice and dal', ['nuts', 'dairy'])).toEqual([])
  })
  it('matches plain dislikes', () => {
    expect(avoidMatches('Bitter gourd stir fry', ['bitter gourd'])).toEqual(['bitter gourd'])
    expect(avoidMatches('Mushroom soup', ['mushroom'])).toEqual(['mushroom'])
  })
  it('foodProblems combines diet, allergy and dislike issues', () => {
    const p = foodProblems('Cheese and mushroom omelette', 'vegetarian', ['dairy'], ['mushroom'])
    expect(p.join(' | ')).toMatch(/omelette.*not vegetarian/)
    expect(p.join(' | ')).toMatch(/dairy \(allergy\)/)
    expect(p.join(' | ')).toMatch(/mushroom \(disliked\)/)
    expect(foodProblems('Dal and rice', 'vegan', ['nuts'], [])).toEqual([])
  })
})

describe('region and cuisines', () => {
  it('reads the country from the locale', () => {
    expect(detectRegion('en-IN', 'America/New_York')).toBe('IN')
    expect(detectRegion('pt_BR')).toBe('BR')
    expect(detectRegion('en-US')).toBe('US')
  })
  it('falls back to the time zone when the locale has no country', () => {
    expect(detectRegion('en', 'Asia/Kolkata')).toBe('IN')
    expect(detectRegion('fr', 'Europe/Paris')).toBe('FR')
    expect(detectRegion('en', 'Mars/Olympus')).toBe('')
  })
  it('suggests cuisines for a country, and nothing when unknown', () => {
    expect(cuisinesForRegion('IN')).toEqual(['indian'])
    expect(cuisinesForRegion('jp')).toEqual(['japanese'])
    expect(cuisinesForRegion('ZZ')).toEqual([])
    expect(cuisinesForRegion('')).toEqual([])
  })
})

describe('meal planning helpers', () => {
  it('splits a target by usual meal shares and keeps the total about right', () => {
    const t = splitTargets({ calories: 2000, protein: 100, carbs: 250, fat: 65 }, ['breakfast', 'lunch', 'snack', 'dinner'])
    expect(t.breakfast.calories).toBe(500)
    expect(t.lunch.calories).toBe(700)
    expect(t.snack.calories).toBe(200)
    expect(t.dinner.calories).toBe(600)
  })
  it('re-normalises when only some meals remain', () => {
    const t = splitTargets({ calories: 1000, protein: 50, carbs: 100, fat: 30 }, ['snack', 'dinner'])
    expect(t.snack.calories + t.dinner.calories).toBeGreaterThanOrEqual(999)
    expect(t.dinner.calories).toBeGreaterThan(t.snack.calories)
  })
  it('plans only the meals still ahead and not yet logged', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 18, h, m)
    expect(remainingMeals(at(8), [])).toEqual(['breakfast', 'lunch', 'snack', 'dinner'])
    expect(remainingMeals(at(13), ['breakfast'])).toEqual(['lunch', 'snack', 'dinner'])
    expect(remainingMeals(at(13), [])).toEqual(['lunch', 'snack', 'dinner']) // breakfast window has passed
    expect(remainingMeals(at(16), ['lunch'])).toEqual(['snack', 'dinner'])
    expect(remainingMeals(at(19), [])).toEqual(['dinner'])
    expect(remainingMeals(at(23, 30), [])).toEqual([])
  })
  it('computes what is left of the goals without going negative', () => {
    const goal = { calories: 2000, protein: 100, carbs: 250, fat: 65 }
    expect(remainingTarget(goal, { calories: 800, protein: 30, carbs: 90, fat: 20 })).toEqual({ calories: 1200, protein: 70, carbs: 160, fat: 45 })
    expect(remainingTarget(goal, { calories: 2500, protein: 150, carbs: 300, fat: 90 })).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 })
    expect(remainingTarget(goal, { calories: 2000, protein: 0, carbs: 0, fat: 0 }, 300).calories).toBe(300)
  })
})
