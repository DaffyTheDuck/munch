// Rule base for nutrient advice. These are deterministic, explainable rules, not model output.
// Sources are listed in docs/Architecture.md (Dietary Reference Intakes for fibre; the Academy of Nutrition and
// Dietetics position paper on vegetarian diets for B12, iron, calcium and omega-3 notes).
import type { DietType, Macros } from '../diet'

export interface TipInput {
  diet: DietType
  totals: Macros
  target: Macros
  /** grams of fiber in the plan */
  fiber: number
  itemNames: string[]
  dietName: string
}

/** Adequate Intake for fiber from the DRI report: 14 g per 1,000 kcal. */
export const FIBER_PER_1000_KCAL = 14

const PROTEIN_FIXES: Record<DietType, string> = {
  vegan: 'add lentils, chickpeas, tofu, tempeh or soya chunks',
  vegetarian: 'add dal, paneer, curd, sprouts or soya chunks',
  eggetarian: 'add eggs, dal, paneer or curd',
  jain: 'add moong dal, curd, paneer or sprouts',
  pescatarian: 'add fish, eggs, dal or curd',
  nonveg: 'add chicken, fish, eggs or dal',
}

/** Up to three short tips: first what is off in this plan, then what to watch on this diet. */
export function nutrientTips(i: TipInput): string[] {
  const tips: string[] = []

  if (i.target.protein > 0 && i.totals.protein < 0.85 * i.target.protein) {
    tips.push(`This plan is about ${Math.round(i.target.protein - i.totals.protein)} g short on protein. To close the gap, ${PROTEIN_FIXES[i.diet]}.`)
  }

  const fiberGoal = (i.totals.calories / 1000) * FIBER_PER_1000_KCAL
  if (i.totals.calories >= 600 && i.fiber < 0.8 * fiberGoal) {
    tips.push(`Fiber is on the low side (${i.fiber} g; about ${Math.round(fiberGoal)} g is recommended for this many calories). Add legumes, vegetables or whole grains.`)
  }

  const diet: string[] = []
  if (i.diet === 'vegan') {
    diet.push('Vitamin B12 is not reliably found in plant foods. Use B12-fortified foods or a supplement.')
    diet.push('Pair iron-rich foods (lentils, chickpeas, spinach) with vitamin C (lemon, citrus, tomato) to help absorption.')
    diet.push('Include calcium (fortified plant milk, calcium-set tofu, leafy greens) and an omega-3 source such as flax, chia or walnuts.')
  } else if (i.diet === 'vegetarian' || i.diet === 'eggetarian' || i.diet === 'jain') {
    diet.push('Pair iron-rich foods (dal, chickpeas, spinach) with vitamin C (lemon, citrus, tomato) to help absorption.')
    diet.push('Vitamin B12 comes mainly from dairy and eggs. If you eat little of them, consider fortified foods or a supplement.')
  } else if (i.diet === 'pescatarian') {
    diet.push('Oily fish (salmon, sardines, mackerel) about twice a week is a good omega-3 source.')
  }
  for (const t of diet) if (tips.length < 3) tips.push(t)

  return tips.slice(0, 3)
}
