// Food preferences shared by the web app, the phone app and the API server.
// Pure logic only (no DOM, React Native or Node APIs) so it can be tested and reused everywhere.
import type { Meal } from './types'

// ------------------------------------------------------------------ diets

export type DietType = 'vegan' | 'vegetarian' | 'eggetarian' | 'jain' | 'pescatarian' | 'nonveg'

export const DIETS: { id: DietType; label: string; blurb: string }[] = [
  { id: 'vegetarian', label: 'Vegetarian', blurb: 'No meat, fish or eggs. Dairy is fine.' },
  { id: 'eggetarian', label: 'Eggetarian', blurb: 'Vegetarian, plus eggs.' },
  { id: 'vegan', label: 'Vegan', blurb: 'No animal products at all.' },
  { id: 'jain', label: 'Jain', blurb: 'Vegetarian, no eggs, no root vegetables, onion or garlic.' },
  { id: 'pescatarian', label: 'Pescatarian', blurb: 'Fish and seafood, but no other meat.' },
  { id: 'nonveg', label: 'Non-vegetarian', blurb: 'Everything.' },
]

export const dietLabel = (d: DietType) => DIETS.find((x) => x.id === d)?.label ?? d

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export interface DietPrefs {
  /** the diet that applies on most days */
  base: DietType
  /** weekday (0 = Sunday … 6 = Saturday) -> a different diet on that day, e.g. non-veg only on Mon and Wed */
  overrides: Partial<Record<number, DietType>>
  /** foods to never suggest, e.g. "peanuts", "dairy" */
  allergies: string[]
  /** foods you just don't like */
  dislikes: string[]
  /** cuisine ids from CUISINES; empty = anything */
  cuisines: string[]
}

export const DEFAULT_DIET: DietPrefs = { base: 'vegetarian', overrides: {}, allergies: [], dislikes: [], cuisines: [] }

const isDiet = (v: unknown): v is DietType => DIETS.some((d) => d.id === v)
const cleanList = (v: unknown, max = 20): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => x.length > 0 && x.length <= 40))].slice(0, max)
    : []

/** Makes anything read from storage or the network safe to use. */
export function normalizeDiet(raw: unknown): DietPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const overrides: Partial<Record<number, DietType>> = {}
  const base: DietType = isDiet(r.base) ? r.base : DEFAULT_DIET.base
  if (r.overrides && typeof r.overrides === 'object') {
    for (const [k, v] of Object.entries(r.overrides as Record<string, unknown>)) {
      const day = Number(k)
      if (Number.isInteger(day) && day >= 0 && day <= 6 && isDiet(v) && v !== base) overrides[day] = v
    }
  }
  return { base, overrides, allergies: cleanList(r.allergies), dislikes: cleanList(r.dislikes), cuisines: cleanList(r.cuisines, 12) }
}

/** The diet that applies on a given date (YYYY-MM-DD), honouring per-weekday overrides. */
export function dietOn(prefs: DietPrefs, date: string): DietType {
  const day = new Date(date + 'T12:00:00').getDay()
  return prefs.overrides[day] ?? prefs.base
}

/** One-line summary, e.g. "Vegetarian · Non-vegetarian on Mon, Wed". */
export function summarizeDiet(prefs: DietPrefs): string {
  const byDiet = new Map<DietType, number[]>()
  for (const [k, v] of Object.entries(prefs.overrides)) byDiet.set(v as DietType, [...(byDiet.get(v as DietType) ?? []), Number(k)])
  const extras = [...byDiet].map(([d, days]) => `${dietLabel(d)} on ${days.sort((a, b) => a - b).map((n) => WEEKDAYS[n]).join(', ')}`)
  return [dietLabel(prefs.base), ...extras].join(' · ')
}

// ------------------------------------------------------------------ cuisines and region

export const CUISINES: { id: string; label: string }[] = [
  { id: 'indian', label: 'Indian' },
  { id: 'american', label: 'American' },
  { id: 'mediterranean', label: 'Mediterranean' },
  { id: 'italian', label: 'Italian' },
  { id: 'mexican', label: 'Mexican' },
  { id: 'middle-eastern', label: 'Middle Eastern' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'japanese', label: 'Japanese' },
  { id: 'korean', label: 'Korean' },
  { id: 'thai', label: 'Thai' },
  { id: 'vietnamese', label: 'Vietnamese' },
  { id: 'french', label: 'French' },
  { id: 'british', label: 'British' },
  { id: 'latin-american', label: 'Latin American' },
  { id: 'african', label: 'African' },
]

const REGION_CUISINES: Record<string, string[]> = {
  IN: ['indian'], PK: ['indian'], BD: ['indian'], LK: ['indian'], NP: ['indian'],
  US: ['american', 'mexican'], CA: ['american'], GB: ['british'], IE: ['british'], AU: ['american', 'mediterranean'], NZ: ['american'],
  MX: ['mexican', 'latin-american'], BR: ['latin-american'], AR: ['latin-american'], CO: ['latin-american'], CL: ['latin-american'], PE: ['latin-american'],
  ES: ['mediterranean'], PT: ['mediterranean'], GR: ['mediterranean'], IT: ['italian', 'mediterranean'], FR: ['french', 'mediterranean'], DE: ['american', 'mediterranean'],
  JP: ['japanese'], KR: ['korean'], CN: ['chinese'], TW: ['chinese'], HK: ['chinese'], TH: ['thai'], VN: ['vietnamese'], ID: ['thai', 'chinese'], MY: ['thai', 'indian'], SG: ['chinese', 'indian'], PH: ['chinese', 'american'],
  TR: ['middle-eastern', 'mediterranean'], AE: ['middle-eastern', 'indian'], SA: ['middle-eastern'], EG: ['middle-eastern'], IL: ['middle-eastern', 'mediterranean'], QA: ['middle-eastern'], KW: ['middle-eastern'],
  NG: ['african'], ZA: ['african'], KE: ['african'], GH: ['african'], ET: ['african'],
}

const TZ_REGION: Record<string, string> = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP',
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Jakarta': 'ID', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Singapore': 'SG', 'Asia/Manila': 'PH', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Jerusalem': 'IL', 'Europe/Istanbul': 'TR',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Lisbon': 'PT', 'Europe/Athens': 'GR',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO', 'America/Santiago': 'CL', 'America/Lima': 'PE',
  'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA', 'Africa/Nairobi': 'KE', 'Africa/Accra': 'GH', 'Africa/Cairo': 'EG', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Pacific/Auckland': 'NZ',
}

/** Best guess at the user's country (ISO code) from the device locale, falling back to the time zone. No permission needed. */
export function detectRegion(locale?: string, timeZone?: string): string {
  const m = /[-_]([A-Za-z]{2})\b/.exec(locale ?? '')
  if (m) return m[1].toUpperCase()
  return (timeZone && TZ_REGION[timeZone]) || ''
}

/** Cuisines to suggest by default for a country. Empty when unknown. */
export function cuisinesForRegion(region: string): string[] {
  return REGION_CUISINES[region.toUpperCase()] ?? []
}

// ------------------------------------------------------------------ what a diet allows

const MEAT = ['chicken', 'mutton', 'lamb', 'beef', 'veal', 'pork', 'bacon', 'ham', 'sausage', 'salami', 'pepperoni', 'turkey', 'duck', 'goat', 'steak', 'meat', 'meatball', 'keema', 'liver', 'lard', 'tallow', 'venison', 'rabbit', 'prosciutto', 'chorizo']
const FISH = ['fish', 'salmon', 'tuna', 'sardine', 'anchovy', 'anchovies', 'cod', 'tilapia', 'mackerel', 'trout', 'haddock', 'prawn', 'shrimp', 'crab', 'lobster', 'squid', 'calamari', 'octopus', 'oyster', 'mussel', 'clam', 'scallop', 'surimi', 'hilsa', 'pomfret', 'rohu', 'bangda', 'seafood']
const EGG = ['egg', 'eggs', 'omelette', 'omelet', 'frittata', 'meringue', 'shakshuka', 'quiche']
const DAIRY = ['milk', 'paneer', 'cheese', 'butter', 'ghee', 'yogurt', 'yoghurt', 'curd', 'dahi', 'cream', 'whey', 'casein', 'lassi', 'buttermilk', 'chaas', 'kefir', 'khoa', 'mawa', 'custard', 'ricotta', 'mozzarella', 'cheddar', 'parmesan', 'feta', 'halloumi', 'skyr']
const OTHER_ANIMAL = ['honey', 'gelatin', 'gelatine', 'rennet', 'isinglass']
const ROOT = ['onion', 'onions', 'garlic', 'potato', 'potatoes', 'aloo', 'carrot', 'carrots', 'radish', 'beetroot', 'beet', 'turnip', 'ginger', 'yam', 'sweet potato', 'mushroom', 'mushrooms', 'shallot', 'leek', 'spring onion']

// Plant-based phrases that contain an animal-product word (so "peanut butter" is fine for a vegan).
const PLANT_PHRASES = [
  'peanut butter', 'almond butter', 'cashew butter', 'nut butter', 'seed butter', 'cocoa butter', 'shea butter', 'apple butter', 'butternut', 'butter bean', 'butter beans', 'butter lettuce',
  'coconut milk', 'almond milk', 'soy milk', 'soya milk', 'oat milk', 'rice milk', 'cashew milk', 'plant milk', 'plant-based milk', 'coconut cream', 'cream of tartar',
  'vegan butter', 'vegan cheese', 'vegan egg', 'vegan mayo', 'vegan yogurt', 'vegan yoghurt', 'vegan cream', 'vegan paneer', 'tofu paneer', 'eggplant', 'egg plant', 'egg-free', 'eggless', 'dairy-free', 'sweet potato fries',
]

const BLOCKED: Record<DietType, string[]> = {
  nonveg: [],
  pescatarian: [...MEAT, ...OTHER_ANIMAL.filter((t) => t !== 'honey')],
  eggetarian: [...MEAT, ...FISH, 'gelatin', 'gelatine', 'rennet', 'isinglass'],
  vegetarian: [...MEAT, ...FISH, ...EGG, 'gelatin', 'gelatine', 'rennet', 'isinglass'], // eggs are what 'eggetarian' adds
  jain: [...MEAT, ...FISH, ...EGG, ...OTHER_ANIMAL, ...ROOT],
  vegan: [...MEAT, ...FISH, ...EGG, ...DAIRY, ...OTHER_ANIMAL],
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (term: string) => new RegExp(`(^|[^a-z])${esc(term)}(s|es)?($|[^a-z])`, 'i')

const stripPlantPhrases = (text: string) => {
  let t = ` ${text.toLowerCase()} `
  for (const p of PLANT_PHRASES) t = t.split(p).join(' ')
  return t
}

/** Words in a food name that a diet does not allow (empty = fine). */
export function dietViolations(foodName: string, diet: DietType): string[] {
  const t = stripPlantPhrases(foodName)
  return [...new Set(BLOCKED[diet].filter((term) => wordRe(term).test(t)))]
}

const ALLERGEN_TERMS: Record<string, string[]> = {
  nuts: ['nut', 'nuts', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'peanut', 'pine nut', 'brazil nut'],
  'tree nuts': ['almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'pine nut', 'brazil nut'],
  peanuts: ['peanut', 'groundnut'],
  peanut: ['peanut', 'groundnut'],
  dairy: DAIRY,
  milk: DAIRY,
  lactose: DAIRY,
  eggs: EGG,
  egg: EGG,
  gluten: ['wheat', 'bread', 'roti', 'chapati', 'naan', 'paratha', 'pasta', 'noodle', 'flour', 'maida', 'atta', 'barley', 'rye', 'semolina', 'suji', 'rava', 'couscous', 'seitan', 'cracker', 'pizza', 'toast', 'burger bun', 'sandwich'],
  wheat: ['wheat', 'bread', 'roti', 'chapati', 'naan', 'paratha', 'pasta', 'flour', 'maida', 'atta', 'semolina', 'suji', 'rava', 'couscous'],
  soy: ['soy', 'soya', 'tofu', 'tempeh', 'edamame', 'miso', 'soy sauce'],
  sesame: ['sesame', 'tahini', 'til'],
  shellfish: ['prawn', 'shrimp', 'crab', 'lobster', 'oyster', 'mussel', 'clam', 'scallop', 'squid', 'octopus'],
  seafood: [...FISH],
  fish: FISH,
}

/** Expands "nuts" into every nut name, "gluten" into wheat foods, etc. Unknown terms are matched as written. */
export function expandAvoid(term: string): string[] {
  const t = term.trim().toLowerCase()
  return ALLERGEN_TERMS[t] ?? [t]
}

/** Which of the avoid-terms (allergies / dislikes) appear in a food name. Deliberately conservative: no plant-based exceptions. */
export function avoidMatches(foodName: string, terms: string[]): string[] {
  const t = ` ${foodName.toLowerCase()} `
  const hits: string[] = []
  for (const term of terms) if (expandAvoid(term).some((w) => w && wordRe(w).test(t))) hits.push(term)
  return [...new Set(hits)]
}

/** Everything wrong with a suggested food for this person on this day. */
export function foodProblems(foodName: string, diet: DietType, allergies: string[], dislikes: string[]): string[] {
  const out = dietViolations(foodName, diet).map((w) => `${w} (not ${dietLabel(diet).toLowerCase()})`)
  for (const a of avoidMatches(foodName, allergies)) out.push(`${a} (allergy)`)
  for (const d of avoidMatches(foodName, dislikes)) out.push(`${d} (disliked)`)
  return out
}

// ------------------------------------------------------------------ planning the day

export const PLAN_MEALS: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner']

/** Typical share of the day's calories per meal. */
export const MEAL_SHARE: Record<Meal, number> = { breakfast: 0.25, lunch: 0.35, snack: 0.1, dinner: 0.3 }

export interface Macros {
  calories: number
  protein: number
  carbs: number
  fat: number
}

/** Splits a target across the requested meals in proportion to their usual share. */
export function splitTargets(target: Macros, meals: Meal[]): Record<string, Macros> {
  const total = meals.reduce((s, m) => s + MEAL_SHARE[m], 0) || 1
  return Object.fromEntries(
    meals.map((m) => {
      const f = MEAL_SHARE[m] / total
      return [m, { calories: Math.round(target.calories * f), protein: Math.round(target.protein * f), carbs: Math.round(target.carbs * f), fat: Math.round(target.fat * f) }]
    }),
  )
}

// A meal is "still ahead" until its usual window ends.
const MEAL_ENDS: Record<Meal, number> = { breakfast: 11, lunch: 15, snack: 18, dinner: 23 }

/** Meals worth planning for the rest of today: not logged yet, and whose time has not passed. */
export function remainingMeals(now: Date, logged: Iterable<Meal>): Meal[] {
  const done = new Set(logged)
  const hour = now.getHours() + now.getMinutes() / 60
  return PLAN_MEALS.filter((m) => !done.has(m) && hour < MEAL_ENDS[m])
}

/** What is left of the day's goals after what you have eaten (never negative). */
export function remainingTarget(goal: Macros, eaten: Macros, burned = 0): Macros {
  return {
    calories: Math.max(0, Math.round(goal.calories - eaten.calories + burned)),
    protein: Math.max(0, Math.round(goal.protein - eaten.protein)),
    carbs: Math.max(0, Math.round(goal.carbs - eaten.carbs)),
    fat: Math.max(0, Math.round(goal.fat - eaten.fat)),
  }
}

// ------------------------------------------------------------------ plan API shapes (shared by clients)

export interface PlanItem {
  name: string
  quantity: string
  grams: number
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g?: number
  /** catalog food id (engine plans only); used to learn what the user likes */
  foodId?: string
  /** short plain-language reasons this was suggested (engine plans only) */
  reasons?: string[]
}

export interface PlanMeal {
  meal: Meal
  items: PlanItem[]
  target: Macros
  totals: Macros
}

export interface PlanResponse {
  meals: PlanMeal[]
  totals: Macros
  target: Macros
  /** within 10% of the calorie target */
  onTarget: boolean
  /** items dropped because they conflicted with the diet, an allergy or a dislike */
  removed: string[]
  tips: string[]
  /** engine = recommendation engine, llm = language model, hybrid = engine with the model filling gaps */
  meta: { engine?: 'catalog' | 'llm' | 'hybrid'; provider?: string; model?: string; ms: number; repaired: boolean }
}

export interface PlanRequestBody {
  diet: DietType
  allergies: string[]
  dislikes: string[]
  cuisines: string[]
  meals: Meal[]
  target: Macros
  /** dish names not to repeat (used for "swap") */
  avoid: string[]
}
