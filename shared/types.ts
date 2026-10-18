export type Kind = 'food' | 'exercise'
export type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner'

export interface Entry {
  id?: number
  date: string // YYYY-MM-DD
  createdAt: number
  kind: Kind
  meal?: Meal
  name: string
  quantity: string
  calories: number // eaten, or burned for exercise
  protein: number
  carbs: number
  fat: number
  photo?: string
  // sync bookkeeping, maintained by the local store (see shared/sync.ts)
  cid?: string
  updatedAt?: number
  dirty?: 0 | 1
  grams?: number
  servings?: number // portion multiplier set with the +/- controls (1 = as logged)
  // usda = matched to a reference database, ai = model estimate, edited = corrected by you
  source?: Source
  match?: string
}

// local = recognised on the device from your history or the built-in catalog, with no AI call
export type Source = 'usda' | 'ai' | 'edited' | 'local'

export interface Correction {
  id?: number
  key: string
  name: string
  quantity: string
  calories: number
  protein: number
  carbs: number
  fat: number
  createdAt: number
  // sync bookkeeping, maintained by the local store (see shared/sync.ts)
  cid?: string
  updatedAt?: number
  dirty?: 0 | 1
}

export interface WeightEntry {
  id?: number
  date: string
  kg: number
  // sync bookkeeping, maintained by the local store (see shared/sync.ts)
  cid?: string
  updatedAt?: number
  dirty?: 0 | 1
}

export interface Goals {
  calories: number
  protein: number
  carbs: number
  fat: number
  targetKg: number
}

export interface AiItem {
  type: Kind
  name: string
  quantity: string
  grams: number
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  source: Source
  match: string
}

export interface AiResult {
  items: AiItem[]
  note: string
  meta?: { provider: string; model: string; ms: number; grounded: number; foodItems: number }
}
