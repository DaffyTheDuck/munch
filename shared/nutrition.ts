import type { Goals } from './types'

export interface Profile {
  sex: 'male' | 'female'
  age: number
  heightCm: number
  weightKg: number
  activity: number // TDEE multiplier
  pace: number // kg per week, magnitude only; direction comes from current vs target
}

export const ACTIVITY: { value: number; label: string }[] = [
  { value: 1.2, label: 'Sedentary (desk job, little exercise)' },
  { value: 1.375, label: 'Light (exercise 1-3 days/week)' },
  { value: 1.55, label: 'Moderate (exercise 3-5 days/week)' },
  { value: 1.725, label: 'Very active (hard exercise 6-7 days/week)' },
]

export const PACES: { value: number; label: string }[] = [
  { value: 0.25, label: 'Slow (0.25 kg/week)' },
  { value: 0.5, label: 'Steady (0.5 kg/week)' },
  { value: 0.75, label: 'Fast (0.75 kg/week)' },
  { value: 1, label: 'Aggressive (1 kg/week)' },
]

export const DEFAULT_PROFILE: Profile = { sex: 'male', age: 25, heightCm: 170, weightKg: 70, activity: 1.375, pace: 0.5 }

export interface Plan {
  goals: Omit<Goals, 'targetKg'>
  bmr: number
  tdee: number
  direction: 'lose' | 'gain' | 'maintain'
  weeks: number
  floorHit: boolean
}

// Mifflin-St Jeor, 7700 kcal per kg of body weight change.
export function buildPlan(p: Profile, targetKg: number): Plan {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161)
  const tdee = bmr * p.activity
  const diff = targetKg - p.weightKg
  const direction = Math.abs(diff) < 0.3 ? 'maintain' : diff < 0 ? 'lose' : 'gain'
  const sign = direction === 'lose' ? -1 : direction === 'gain' ? 1 : 0
  const pace = direction === 'gain' ? Math.min(p.pace, 0.5) : p.pace
  let calories = tdee + (sign * pace * 7700) / 7
  const floor = p.sex === 'male' ? 1500 : 1200
  const floorHit = direction === 'lose' && calories < floor
  calories = Math.max(calories, floor)
  calories = Math.round(calories / 10) * 10

  const refWeight = Math.min(Math.max(targetKg, 40), p.weightKg + 10)
  const proteinPerKg = direction === 'lose' ? 2 : direction === 'gain' ? 1.8 : 1.6
  const protein = Math.round(refWeight * proteinPerKg)
  const fat = Math.round((calories * 0.25) / 9)
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4))

  const weeks = direction === 'maintain' || !pace ? 0 : Math.ceil(Math.abs(diff) / pace)
  return { goals: { calories, protein, carbs, fat }, bmr: Math.round(bmr), tdee: Math.round(tdee), direction, weeks, floorHit }
}
