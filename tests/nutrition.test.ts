import { describe, expect, it } from 'vitest'
import { buildPlan, DEFAULT_PROFILE } from '../src/nutrition'

const base = { ...DEFAULT_PROFILE, sex: 'male' as const, age: 25, heightCm: 170, weightKg: 70, activity: 1.375, pace: 0.5 }

describe('buildPlan', () => {
  it('computes a deficit when the target is lower', () => {
    const p = buildPlan(base, 65)
    expect(p.direction).toBe('lose')
    expect(p.tdee).toBe(2258)
    expect(p.goals.calories).toBeLessThan(p.tdee)
    expect(p.weeks).toBe(10)
  })

  it('maintains when target is within 0.3 kg', () => {
    const p = buildPlan(base, 70.2)
    expect(p.direction).toBe('maintain')
    expect(p.weeks).toBe(0)
    expect(p.goals.calories).toBe(Math.round(p.tdee / 10) * 10)
  })

  it('caps gaining pace at 0.5 kg/week', () => {
    const slow = buildPlan({ ...base, pace: 0.5 }, 75)
    const fast = buildPlan({ ...base, pace: 1 }, 75)
    expect(fast.goals.calories).toBe(slow.goals.calories)
  })

  it('never goes below the safety floor and reports it', () => {
    const p = buildPlan({ ...base, sex: 'female', weightKg: 50, heightCm: 155, age: 40, activity: 1.2, pace: 1 }, 45)
    expect(p.goals.calories).toBeGreaterThanOrEqual(1200)
    expect(p.floorHit).toBe(true)
  })

  it('macros add up to roughly the calorie target', () => {
    const { calories, protein, carbs, fat } = buildPlan(base, 65).goals
    const total = protein * 4 + carbs * 4 + fat * 9
    expect(Math.abs(total - calories)).toBeLessThan(30)
  })
})
