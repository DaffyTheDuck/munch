import { MEALS, autoMeal, todayStr } from '@shared/dates'
import type { Entry } from '@shared/types'
import { entriesForDate, loadGoals } from '@/lib/db'

export interface Macro {
  value: number
  goal: number
}

// Everything a widget draws. Built from the same local database the app uses, so it works offline and costs nothing.
export interface WidgetData {
  eaten: number
  burned: number
  goal: number
  /** calories left today (negative when over) */
  remaining: number
  /** 0..1+ of the goal eaten (net of exercise) */
  progress: number
  protein: Macro
  carbs: Macro
  fat: Macro
  mealLabel: string
}

const sum = (list: Entry[], k: 'calories' | 'protein' | 'carbs' | 'fat') => list.reduce((s, e) => s + e[k], 0)

export async function loadWidgetData(): Promise<WidgetData> {
  const [entries, goals] = await Promise.all([entriesForDate(todayStr()), loadGoals()])
  const food = entries.filter((e) => e.kind === 'food')
  const burned = sum(entries.filter((e) => e.kind === 'exercise'), 'calories')
  const eaten = sum(food, 'calories')
  const net = eaten - burned
  return {
    eaten,
    burned,
    goal: goals.calories,
    remaining: goals.calories - net,
    progress: goals.calories > 0 ? Math.max(0, net) / goals.calories : 0,
    protein: { value: sum(food, 'protein'), goal: goals.protein },
    carbs: { value: sum(food, 'carbs'), goal: goals.carbs },
    fat: { value: sum(food, 'fat'), goal: goals.fat },
    mealLabel: MEALS.find((m) => m.id === autoMeal())?.label ?? 'Meal',
  }
}
