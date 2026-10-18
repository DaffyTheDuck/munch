// Resolving what the user typed WITHOUT a language model, whenever that is safe.
//
// The "resolution ladder": 1) your own history (exact name match), 2) the built-in catalog (exact name or a known alias),
// 3) otherwise hand the leftover text to the AI. Matching is deliberately strict: a phrase must equal a known food name
// (after lower-casing, plural-stripping and dropping filler words). "2 idli" and "a glass of milk" resolve; "dal",
// "chicken" or "30 min run" do not, and go to the AI. Quantities must be unambiguous or the segment is left to the AI.
//
// This saves AI calls (cost, quota, latency), works offline, and gives the same numbers every time for the same food.
import type { AiItem } from './types'
import { CATALOG } from './recommend/catalog'
import type { Food, HistoryFood } from './recommend/types'

export interface Resolved {
  /** foods recognised locally, in the order typed */
  items: AiItem[]
  /** the original text of everything that was NOT recognised (empty when everything was) */
  rest: string
}

// ---------------------------------------------------------------- text helpers

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
  half: 0.5, aadha: 0.5, adha: 0.5, quarter: 0.25,
}

const STOP = new Set(['of', 'the', 'some', 'my', 'little', 'about', 'around', 'approx', 'just'])
const UNIT_ALIASES: Record<string, string> = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', kg: 'kg', ml: 'ml',
  cup: 'cup', cups: 'cup', bowl: 'bowl', bowls: 'bowl', glass: 'glass', glasses: 'glass', plate: 'plate', plates: 'plate',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', slice: 'slice', slices: 'slice', tbsp: 'tbsp', tsp: 'tsp',
  handful: 'handful', handfuls: 'handful', serving: 'serving', servings: 'serving', scoop: 'scoop', scoops: 'scoop',
}

const stem = (w: string): string => {
  if (w.length <= 3) return w
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (/(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1)
  return w
}

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9./\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Canonical key of a food phrase: stemmed words, filler removed. */
export const phraseKey = (s: string) =>
  clean(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem)
    .join(' ')

const toNumber = (tok: string): number | null => {
  if (tok in NUMBER_WORDS) return NUMBER_WORDS[tok]
  if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok)
  const f = /^(\d+)\/(\d+)$/.exec(tok)
  return f && Number(f[2]) ? Number(f[1]) / Number(f[2]) : null
}

interface Parsed {
  qty: number
  unit: string | null
  phrase: string
  /** the user typed a quantity ("2 idli"), as opposed to a bare name ("idli") */
  explicit: boolean
}

/** "2 cups rice" -> { qty 2, unit cup, phrase "rice" };  "200g paneer" -> { 200, g, "paneer" };  "banana" -> { 1, null, "banana" } */
export function parseSegment(segment: string): Parsed | null {
  const toks = clean(segment).split(' ').filter(Boolean)
  if (!toks.length) return null
  let i = 0
  let qty = 1
  const attached = /^(\d+(?:\.\d+)?)(g|gm|gms|gram|grams|kg|ml)$/.exec(toks[0])
  let unit: string | null = null

  if (attached) {
    qty = Number(attached[1])
    unit = UNIT_ALIASES[attached[2]]
    i = 1
  } else {
    const first = toNumber(toks[0])
    if (first !== null) {
      qty = first
      i = 1
      const second = toks[1] !== undefined ? toNumber(toks[1]) : null
      // mixed numbers such as "1 1/2"
      if (second !== null && toks[1].includes('/')) {
        qty += second
        i = 2
      }
      // "half a banana"
      if (toks[0] === 'half' || toks[0] === 'aadha' || toks[0] === 'adha' || toks[0] === 'quarter') {
        if (toks[i] === 'a' || toks[i] === 'an' || toks[i] === 'of') i++
      }
    }
    if (toks[i] && UNIT_ALIASES[toks[i]]) {
      unit = UNIT_ALIASES[toks[i]]
      i++
    }
  }
  const phrase = toks.slice(i).filter((w) => !STOP.has(w)).map(stem).join(' ')
  if (!phrase || qty <= 0) return null
  const explicit = i > 0
  if (unit === 'kg') return { qty: qty * 1000, unit: 'g', phrase, explicit }
  return { qty, unit, phrase, explicit }
}

// ---------------------------------------------------------------- serving arithmetic

interface ServingInfo {
  count: number
  unit: string | null // normalised unit word, e.g. 'cup', 'piece', or null for count nouns ("2 rotis")
  gramBased: boolean
}

/** Reads the leading quantity of a serving label: "2 pieces (80 g)" -> 2 piece;  "1 cup cooked" -> 1 cup;  "120 g" -> grams. */
export function parseServing(label: string): ServingInfo {
  const t = label.toLowerCase().replace(/\(.*?\)/g, ' ').trim()
  const m = /^(\d+\/\d+|\d+(?:\.\d+)?)(-[a-z]+)?\s*([a-z]+)?/.exec(t) // fraction first, so "1/4" is not read as "1"
  if (!m) return { count: 1, unit: null, gramBased: false }
  const count = m[2] ? 1 : (toNumber(m[1]) ?? 1) // "2-egg omelette" is one omelette
  const word = m[3] ?? ''
  const unit = UNIT_ALIASES[word] ?? null
  return { count: unit === 'g' || unit === 'ml' ? 1 : count, unit: unit === 'g' || unit === 'ml' ? null : unit, gramBased: unit === 'g' || unit === 'ml' }
}

const MIN_SERVINGS = 0.25
const MAX_SERVINGS = 6

/** How many servings the typed quantity is, or null when it is not clear enough to trust. */
export function servingsFor(p: Pick<Parsed, 'qty' | 'unit'> & { explicit?: boolean }, serving: { label: string; grams: number }): number | null {
  const lab = parseServing(serving.label)
  let m: number | null
  if (p.unit === 'g' || p.unit === 'ml') {
    m = serving.grams > 0 ? p.qty / serving.grams : null
  } else if (p.unit === 'serving') {
    m = p.qty
  } else if (p.unit) {
    m = lab.unit === p.unit && !lab.gramBased ? p.qty / lab.count : null // the unit must match what the serving is measured in
  } else if (p.explicit === false) {
    m = lab.gramBased || lab.count !== 1 ? null : 1 // a bare name ("idli") is only clear when the serving is a single item
  } else {
    m = lab.gramBased ? null : p.qty / lab.count // a plain count: "3 roti" against "2 rotis"
  }
  if (m === null || !Number.isFinite(m) || m < MIN_SERVINGS || m > MAX_SERVINGS) return null
  return Math.round(m * 100) / 100
}

// ---------------------------------------------------------------- known foods

/** Names people actually type, for catalog foods whose own name is longer or different. Only unambiguous ones. */
const ALIASES: Record<string, string[]> = {
  'white-rice': ['rice', 'white rice', 'steamed rice', 'plain rice', 'chawal'],
  'brown-rice': ['brown rice'],
  roti: ['roti', 'chapati', 'chapatti', 'chappati', 'phulka', 'fulka', 'wheat roti', 'whole wheat roti'],
  paratha: ['paratha', 'plain paratha'],
  'aloo-paratha': ['aloo paratha', 'potato paratha'],
  idli: ['idli', 'idly'],
  'plain-dosa': ['dosa', 'plain dosa', 'dosai'],
  'masala-dosa': ['masala dosa'],
  poha: ['poha', 'kanda poha', 'vegetable poha'],
  upma: ['upma', 'vegetable upma'],
  sambar: ['sambar', 'sambhar'],
  curd: ['curd', 'dahi', 'yogurt', 'yoghurt', 'plain curd'],
  buttermilk: ['buttermilk', 'chaas', 'chaach', 'chhaas'],
  milk: ['milk'],
  'masala-chai': ['chai', 'masala chai', 'milk tea', 'cutting chai'],
  'coconut-water': ['coconut water', 'nariyal pani'],
  banana: ['banana', 'kela'],
  apple: ['apple', 'seb'],
  orange: ['orange', 'santra'],
  mango: ['mango', 'aam'],
  papaya: ['papaya'],
  guava: ['guava', 'amrud'],
  watermelon: ['watermelon', 'tarbooz'],
  almonds: ['almond', 'badam'],
  'roasted-peanuts': ['peanut', 'roasted peanut', 'moongphali'],
  dates: ['date', 'khajoor'],
  'boiled-egg-snack': ['anda'],
  'masala-omelette': ['omelette', 'omelet', 'masala omelette'],
  'paneer-tikka': ['paneer tikka'],
  'dal-tadka': ['dal tadka', 'dal fry', 'tadka dal'],
  'chana-masala': ['chana masala', 'chole', 'chhole', 'chole masala'],
  rajma: ['rajma', 'rajma masala'],
  'palak-paneer': ['palak paneer'],
  khichdi: ['khichdi', 'khichri', 'moong dal khichdi'],
  'veg-biryani': ['veg biryani', 'vegetable biryani'],
  'chicken-biryani': ['chicken biryani'],
  'chicken-curry': ['chicken curry'],
  'grilled-chicken': ['grilled chicken', 'grilled chicken breast'],
  'oats-milk': ['oatmeal', 'oats porridge', 'oats with milk'],
  'greek-yogurt-cup': ['greek yogurt', 'greek yoghurt'],
  'whey-shake': ['whey', 'whey protein', 'protein shake'],
  'pb-toast': ['peanut butter toast'],
  'sprouts-salad': ['sprouts salad', 'sprout salad'],
  'sprout-chaat': ['sprout chaat', 'sprouts chaat'],
  'hummus-veg': ['hummus'],
  avocado: ['avocado'],
  popcorn: ['popcorn'],
  'dark-chocolate': ['dark chocolate'],
  naan: ['naan'],
  'veg-pulao': ['pulao', 'veg pulao', 'vegetable pulao'],
  'curd-rice': ['curd rice'],
  'lemon-rice': ['lemon rice'],
  'jeera-rice': ['jeera rice'],
  quinoa: ['quinoa'],
  'wholewheat-bread': ['bread', 'brown bread', 'whole wheat bread', 'wheat bread'],
  daliya: ['daliya', 'dalia'],
  'moong-chilla': ['moong dal chilla', 'moong chilla', 'moong dal cheela'],
  'besan-chilla': ['besan chilla', 'besan cheela'],
  'fruit-bowl': ['fruit bowl', 'mixed fruit bowl', 'fruit salad'],
  makhana: ['makhana', 'fox nut'],
}

/** Catalog foods that are a variant of another entry and must not claim their own name (it belongs to the main entry). */
const ALIAS_ONLY = new Set(['boiled-egg-snack'])

interface Known {
  name: string
  serving: { label: string; grams: number }
  kcal: number
  protein: number
  carbs: number
  fat: number
  from: 'history' | 'catalog'
}

/** Builds the lookup table. A name claimed by two different foods is dropped rather than guessed. */
function buildIndex(history: HistoryFood[], catalog: Food[]): Map<string, Known> {
  const index = new Map<string, Known>()
  const ambiguous = new Set<string>()

  const add = (key: string, k: Known) => {
    if (!key || ambiguous.has(key)) return
    const existing = index.get(key)
    if (existing && existing.name !== k.name) {
      if (existing.from === 'history' || k.from === 'history') return // your own history wins; keep the first
      index.delete(key)
      ambiguous.add(key)
      return
    }
    if (!existing) index.set(key, k)
  }

  // your own history first, so it takes precedence over the catalog
  for (const h of history) {
    add(phraseKey(h.name), { name: h.name, serving: { label: h.quantity || '1 serving', grams: 0 }, kcal: h.kcal, protein: h.protein, carbs: h.carbs, fat: h.fat, from: 'history' })
  }
  for (const f of catalog) {
    const k: Known = { name: f.name, serving: f.serving, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, from: 'catalog' }
    if (!ALIAS_ONLY.has(f.id)) add(phraseKey(f.name), k)
    for (const a of ALIASES[f.id] ?? []) add(phraseKey(a), k)
  }
  return index
}

let defaultIndex: { catalog: Food[]; index: Map<string, Known> } | null = null

const SPLIT = /\s*(?:,|;|\+|&|\n|\band\b|\baur\b|\bwith\b|\bplus\b)\s*/i

/**
 * Recognise as much of `text` as possible without a model. Segments that are not recognised with confidence are
 * returned in `rest` (original wording) so the caller can send just those to the AI.
 */
export function resolveLocally(text: string, history: HistoryFood[] = [], catalog: Food[] = CATALOG): Resolved {
  let index: Map<string, Known>
  if (history.length === 0 && catalog === CATALOG) {
    if (!defaultIndex || defaultIndex.catalog !== catalog) defaultIndex = { catalog, index: buildIndex([], catalog) }
    index = defaultIndex.index
  } else index = buildIndex(history, catalog)

  const items: AiItem[] = []
  const restParts: string[] = []

  for (const raw of text.split(SPLIT)) {
    const segment = raw.trim()
    if (!segment) continue
    const p = parseSegment(segment)
    const known = p ? index.get(p.phrase) : undefined
    // a bare name of something you log often means the portion you usually log
    const servings = p && known ? (known.from === 'history' && !p.explicit ? 1 : servingsFor(p, known.serving)) : null
    if (!p || !known || servings === null) {
      restParts.push(segment)
      continue
    }
    const k = servings
    items.push({
      type: 'food',
      name: known.name,
      quantity: k === 1 ? known.serving.label : `${k} × ${known.serving.label}`,
      grams: Math.round(known.serving.grams * k),
      calories: Math.round(known.kcal * k),
      protein_g: Math.round(known.protein * k),
      carbs_g: Math.round(known.carbs * k),
      fat_g: Math.round(known.fat * k),
      source: 'local',
      match: known.from === 'history' ? 'Matched from your history' : 'Matched from the built-in catalog',
    })
  }
  return { items, rest: restParts.join(', ') }
}
