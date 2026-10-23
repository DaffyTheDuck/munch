// Free, offline facts about a logged food: how its calories split between protein, carbs and fat, simple labels,
// and (when it matches the built-in catalog) its main ingredients, diet class and allergens.
// The richer breakdown (ingredients with amounts, benefits, watch-outs) is written on demand by the AI.
import { catalogMatch } from './insights'
import type { Allergen, Ingredient, Tag } from './recommend/types'

export interface FoodFacts {
  /** share of the macro calories, in percent (sums to about 100) */
  split: { protein: number; carbs: number; fat: number }
  labels: string[]
  /** what the dish is made of, for foods that match the built-in catalog */
  ingredients: string[]
  contains: string[]
  allergens: string[]
  tags: string[]
  fiber: number | null
  matchedName: string | null
}

const CONTAINS: Record<Ingredient, string> = { meat: 'Meat', fish: 'Fish', shellfish: 'Shellfish', egg: 'Egg', dairy: 'Dairy', honey: 'Honey', gelatin: 'Gelatin', root: 'Root vegetables', allium: 'Onion / garlic', mushroom: 'Mushroom' }
const ALLERGEN: Record<Allergen, string> = { nuts: 'Tree nuts', peanuts: 'Peanuts', dairy: 'Dairy', eggs: 'Eggs', gluten: 'Gluten', soy: 'Soy', sesame: 'Sesame', shellfish: 'Shellfish', fish: 'Fish' }
const TAG: Record<Tag, string> = { 'high-protein': 'High protein', 'whole-grain': 'Whole grain', legume: 'Legumes', fried: 'Fried', sweet: 'Sweet', indulgent: 'Indulgent', light: 'Light', fermented: 'Fermented' }

export function foodFacts(f: { name: string; calories: number; protein: number; carbs: number; fat: number }): FoodFacts {
  const p = Math.max(0, f.protein) * 4
  const c = Math.max(0, f.carbs) * 4
  const fa = Math.max(0, f.fat) * 9
  const total = p + c + fa
  const pct = (x: number) => (total > 0 ? Math.round((x / total) * 100) : 0)
  const split = { protein: pct(p), carbs: pct(c), fat: pct(fa) }

  const labels: string[] = []
  if (total > 0) {
    if (split.protein >= 30 && f.protein >= 12) labels.push('High protein')
    if (split.carbs <= 20 && f.calories > 80) labels.push('Low carb')
    if (split.carbs >= 65) labels.push('Carb-heavy')
    if (split.fat <= 15 && f.calories > 80) labels.push('Low fat')
    if (split.fat >= 45) labels.push('Rich in fat')
    if (f.calories > 0 && f.calories < 150) labels.push('Light')
    if (f.calories >= 600) labels.push('Big meal')
  }

  const food = catalogMatch(f.name)
  return {
    split,
    labels,
    ingredients: food ? food.keywords.slice(0, 8) : [],
    contains: food ? food.contains.map((x) => CONTAINS[x]) : [],
    allergens: food ? food.allergens.map((x) => ALLERGEN[x]) : [],
    tags: food ? food.tags.map((x) => TAG[x]) : [],
    fiber: food ? Math.round(food.fiber * 10) / 10 : null,
    matchedName: food?.name ?? null,
  }
}
