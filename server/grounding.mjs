// Grounds model estimates against USDA FoodData Central.
// The model proposes items and a generic search term; we retrieve reference foods,
// keep the one that best agrees with the model's own energy density, and only trust it
// if it is within tolerance. Otherwise the model's estimate stays and is labelled as such.

const FDC_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search'
const cache = new Map()

function nutrient(list, numbers, ids) {
  const n = list.find((x) => numbers.includes(String(x.nutrientNumber)) || ids.includes(x.nutrientId))
  return n && Number.isFinite(n.value) ? n.value : 0
}

export function parseCandidates(body) {
  return (body?.foods || [])
    .map((f) => {
      const n = f.foodNutrients || []
      return {
        id: f.fdcId,
        description: f.description,
        per100: {
          kcal: nutrient(n, ['208'], [1008, 2047, 2048]),
          protein: nutrient(n, ['203'], [1003]),
          fat: nutrient(n, ['204'], [1004]),
          carbs: nutrient(n, ['205'], [1005]),
        },
      }
    })
    .filter((c) => c.per100.kcal > 0)
}

export async function searchFdc(query, { apiKey = 'DEMO_KEY', fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  if (cache.has(q)) return cache.get(q)
  const url = `${FDC_URL}?query=${encodeURIComponent(q)}&dataType=Foundation,SR%20Legacy&pageSize=6&api_key=${apiKey}`
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`FDC ${res.status}`)
  const out = parseCandidates(await res.json())
  cache.set(q, out)
  return out
}

const words = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.replace(/s$/, '')),
  )

// Share of the search words that appear in the candidate's description.
export function nameOverlap(lookup, description) {
  const q = words(lookup)
  if (!q.size) return 0
  const d = words(description)
  return [...q].filter((w) => d.has(w)).length / q.size
}

// Protein, carbs and fat per 100g must each be close to what the model implied.
// This is what stops "beer" being matched to "cola" just because their energy density is similar.
export function macrosAgree(per100, target) {
  return ['protein', 'carbs', 'fat'].every((k) => Math.abs(per100[k] - target[k]) <= Math.max(4, 0.5 * target[k]))
}

// target: { kcal, protein, carbs, fat } per 100g as implied by the model, plus the search term.
// A candidate must look like the same food (name), agree on macros, and be close in energy.
export function pickCandidate(candidates, target, { kcalTolerance = 0.3, minOverlap = 0.6 } = {}) {
  if (!candidates.length || !(target?.kcal > 0)) return null
  let best = null
  for (const c of candidates) {
    if (target.lookup && nameOverlap(target.lookup, c.description) < minOverlap) continue
    if (!macrosAgree(c.per100, target)) continue
    const diff = Math.abs(c.per100.kcal - target.kcal) / target.kcal
    if (diff <= kcalTolerance && (!best || diff < best.diff)) best = { c, diff }
  }
  return best ? best.c : null
}

export function applyCandidate(item, cand) {
  const f = item.grams / 100
  return {
    ...item,
    calories: Math.round(cand.per100.kcal * f),
    protein_g: Math.round(cand.per100.protein * f),
    carbs_g: Math.round(cand.per100.carbs * f),
    fat_g: Math.round(cand.per100.fat * f),
    source: 'usda',
    match: cand.description,
  }
}

export async function groundItem(item, opts) {
  const base = { ...item, source: 'ai', match: '' }
  if (item.type !== 'food' || !item.lookup || !(item.grams > 0) || !(item.calories > 0)) return base
  try {
    const cands = await searchFdc(item.lookup, opts)
    const per = 100 / item.grams
    const best = pickCandidate(cands, {
      kcal: item.calories * per,
      protein: item.protein_g * per,
      carbs: item.carbs_g * per,
      fat: item.fat_g * per,
      lookup: item.lookup,
    })
    return best ? applyCandidate(item, best) : base
  } catch {
    return base
  }
}

export function groundItems(items, opts) {
  return Promise.all(items.map((i) => groundItem(i, opts)))
}
