import { z } from 'zod'

const num = z.coerce
  .number()
  .finite()
  .transform((n) => Math.min(Math.max(n, 0), 10000))

const MealName = z.enum(['breakfast', 'lunch', 'snack', 'dinner'])
const DietName = z.enum(['vegan', 'vegetarian', 'eggetarian', 'jain', 'pescatarian', 'nonveg'])
const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([])

// Models sometimes name macro fields differently. Accept the common aliases, but never default a missing macro to 0.
const withAliases = (o) => {
  if (!o || typeof o !== 'object') return o
  const x = { ...o }
  x.protein_g ??= x.protein ?? x.proteins ?? x.protein_grams
  x.carbs_g ??= x.carbs ?? x.carbohydrates ?? x.carbohydrates_g ?? x.carbs_grams
  x.fat_g ??= x.fat ?? x.fats ?? x.fat_grams
  x.calories ??= x.kcal ?? x.energy_kcal
  return x
}

const PlanItem = z.preprocess(
  withAliases,
  z.object({
    name: z.string().trim().min(1).max(120),
    quantity: z.string().trim().max(120).default(''),
    grams: num.default(0),
    calories: num,
    protein_g: num,
    carbs_g: num,
    fat_g: num,
  }),
)

/** What the model must return. */
export const PlanResult = z.object({
  meals: z.array(z.object({ meal: MealName, items: z.array(PlanItem).max(8) })).max(4),
  tips: z.array(z.string().trim().max(240)).max(5).default([]),
})

const target = z.object({
  calories: z.coerce.number().min(0).max(8000),
  protein: z.coerce.number().min(0).max(500),
  carbs: z.coerce.number().min(0).max(1000),
  fat: z.coerce.number().min(0).max(500),
})

/** What a client may ask for. */
export const PlanRequest = z.object({
  diet: DietName,
  allergies: tags,
  dislikes: tags,
  cuisines: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  meals: z.array(MealName).min(1).max(4),
  target,
  avoid: tags,
})
