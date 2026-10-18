import type { Meal } from '../types'
import type { DietPrefs, Macros, PlanMeal, PlanResponse } from '../diet'

/** The part a food plays in a meal. Meal templates are built from roles (e.g. lunch = carb + protein + veg). */
export type Role = 'main' | 'carb' | 'protein' | 'veg' | 'side' | 'fruit' | 'drink' | 'snack'

/** Animal-derived or restricted ingredient classes. Diets are derived from these, not guessed from names. */
export type Ingredient = 'meat' | 'fish' | 'shellfish' | 'egg' | 'dairy' | 'honey' | 'gelatin' | 'root' | 'allium' | 'mushroom'

export type Allergen = 'nuts' | 'peanuts' | 'dairy' | 'eggs' | 'gluten' | 'soy' | 'sesame' | 'shellfish' | 'fish'

export type Tag = 'high-protein' | 'whole-grain' | 'legume' | 'fried' | 'sweet' | 'indulgent' | 'light' | 'fermented'

export interface Food {
  id: string
  name: string
  /** cuisine ids (see CUISINES) or '*' for foods that suit every cuisine */
  cuisines: string[]
  meals: Meal[]
  role: Role
  /** one serving; the optimizer scales it by a multiplier */
  serving: { label: string; grams: number }
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  contains: Ingredient[]
  allergens: Allergen[]
  tags: Tag[]
  /** allowed multiplier of one serving, and the step it snaps to */
  portion: { min: number; max: number; step: number }
  /** extra words used to match dislikes, e.g. the main ingredients */
  keywords: string[]
  source: 'catalog' | 'history'
  /** history foods only: how often the user logs it (0..1) */
  familiarity?: number
}

/** A food the user has logged before, summarised from their history. */
export interface HistoryFood {
  name: string
  meal: Meal
  kcal: number
  protein: number
  carbs: number
  fat: number
  quantity: string
  /** how many times it was logged */
  count: number
  /** days since it was last logged */
  daysAgo: number
}

export interface RecommendInput {
  prefs: DietPrefs
  /** YYYY-MM-DD; decides which weekday diet applies */
  date: string
  meals: Meal[]
  /** calories and macros to plan for these meals together */
  target: Macros
  history?: HistoryFood[]
  /** learned likes/dislikes per food id */
  taste?: import('./taste').Taste
  /** dish names to exclude (used for "swap") */
  avoid?: string[]
  /** different seeds give different (but equally valid) plans */
  seed?: number
  catalog?: Food[]
}

export interface RecommendedItem {
  foodId: string
  name: string
  quantity: string
  grams: number
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  reasons: string[]
  source: 'catalog' | 'history'
}

export interface RecommendOutput extends Omit<PlanResponse, 'meals' | 'meta'> {
  meals: (Omit<PlanMeal, 'items'> & { items: RecommendedItem[] })[]
  /** meals the catalog could not fill within the constraints (a caller may fall back to the LLM planner) */
  unfilled: Meal[]
  fiber: number
  meta: { engine: 'catalog'; ms: number; repaired: false; combosEvaluated: number; poolSize: number; seed: number }
}
