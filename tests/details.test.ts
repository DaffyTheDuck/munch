import { describe, expect, it } from 'vitest'
import { activityReport, matchActivity, parseKm, parseMinutes } from '../shared/activity'
import { foodFacts } from '../shared/foodinfo'

describe('activity: durations and distances', () => {
  it('reads minutes and hours in the ways people write them', () => {
    expect(parseMinutes('30 min run')).toBe(30)
    expect(parseMinutes('45 minutes yoga')).toBe(45)
    expect(parseMinutes('1 hour yoga')).toBe(60)
    expect(parseMinutes('1.5 hrs cycling')).toBe(90)
    expect(parseMinutes('1h 20m gym')).toBe(80)
    expect(parseMinutes('went for a run')).toBeNull()
    expect(parseMinutes('99 hours')).toBeNull() // not a day-long activity
  })
  it('reads distance', () => {
    expect(parseKm('5 km run')).toBe(5)
    expect(parseKm('10k run')).toBe(10)
    expect(parseKm('30 min run')).toBeNull()
  })
})

describe('activity: matching', () => {
  it('recognises common activities by name, in any phrasing', () => {
    expect(matchActivity('30 min run')?.id).toBe('run')
    expect(matchActivity('evening walk')?.id).toBe('walk')
    expect(matchActivity('Surya namaskar 12 rounds')?.id).toBe('surya')
    expect(matchActivity('gym - chest day')?.id).toBe('strength')
    expect(matchActivity('skipping rope')?.id).toBe('skip')
    expect(matchActivity('cycling to work')?.id).toBe('cycle')
  })
  it('returns null for something unknown, never a wrong guess', () => {
    expect(matchActivity('underwater basket weaving')).toBeNull()
  })
  it('gives every known activity something useful to show', () => {
    for (const a of ['run', 'walk', 'yoga', 'swimming', 'gym', 'hiit', 'badminton', 'dance', 'hiking', 'cycling']) {
      const i = matchActivity(a)!
      expect(i.benefits.length, a).toBeGreaterThan(0)
      expect(i.met, a).toBeGreaterThan(1)
    }
  })
})

describe('activity: is the logged burn plausible?', () => {
  const w = 70
  it('accepts a number near the standard formula', () => {
    // 9.8 MET x 70 kg x 0.5 h = 343 kcal
    const r = activityReport({ name: 'Running', quantity: '30 min', calories: 330, weightKg: w })
    expect(r.expectedKcal).toBe(343)
    expect(r.verdict).toBe('plausible')
    expect(r.kcalPerMinute).toBe(11)
  })
  it('flags a number that is far too high and suggests the formula value', () => {
    const r = activityReport({ name: 'Walking', quantity: '30 min', calories: 400, weightKg: w })
    expect(r.verdict).toBe('high')
    expect(r.note).toContain(String(r.expectedKcal))
  })
  it('notes a low number without scolding', () => {
    const r = activityReport({ name: 'Running', quantity: '30 min', calories: 120, weightKg: w })
    expect(r.verdict).toBe('low')
  })
  it('asks for what is missing instead of guessing', () => {
    expect(activityReport({ name: 'Running', quantity: '', calories: 300, weightKg: w }).note).toMatch(/duration/)
    expect(activityReport({ name: 'Running', quantity: '30 min', calories: 300, weightKg: null }).note).toMatch(/weight/)
    expect(activityReport({ name: 'Running', quantity: '30 min', calories: 300, weightKg: null }).verdict).toBe('unknown')
  })
  it('works out pace when distance is given', () => {
    expect(activityReport({ name: '5 km run', quantity: '30 min', calories: 340, weightKg: w }).paceMinPerKm).toBe(6)
  })
  it('gives food equivalents', () => {
    const r = activityReport({ name: 'Running', quantity: '30 min', calories: 315, weightKg: w })
    expect(r.equivalents[0]).toEqual({ label: 'bananas', count: 3 })
  })
})

describe('food facts (offline)', () => {
  it('splits calories between protein, carbs and fat', () => {
    const f = foodFacts({ name: 'Chicken breast', calories: 165, protein: 31, carbs: 0, fat: 4 })
    expect(f.split.protein + f.split.carbs + f.split.fat).toBeGreaterThanOrEqual(99)
    expect(f.split.protein).toBeGreaterThan(70)
    expect(f.labels).toContain('High protein')
    expect(f.labels).toContain('Low carb')
  })
  it('labels carb-heavy and rich foods', () => {
    expect(foodFacts({ name: 'Plain rice', calories: 260, protein: 5, carbs: 57, fat: 1 }).labels).toContain('Carb-heavy')
    expect(foodFacts({ name: 'Butter', calories: 360, protein: 0, carbs: 0, fat: 40 }).labels).toContain('Rich in fat')
  })
  it('adds catalog facts (fibre, diet class, allergens) when the food is known', () => {
    const f = foodFacts({ name: 'Idli (2 pieces)', calories: 109, protein: 4, carbs: 22, fat: 0 })
    expect(f.matchedName).toBeTruthy()
    expect(f.fiber).not.toBeNull() // catalog foods carry fibre, diet class and allergens; only some list ingredients
  })
  it('does not break on empty or unknown foods', () => {
    const f = foodFacts({ name: 'Mystery', calories: 0, protein: 0, carbs: 0, fat: 0 })
    expect(f.split).toEqual({ protein: 0, carbs: 0, fat: 0 })
    expect(f.matchedName).toBeNull()
  })
})
