import { generate } from './llm.mjs'
import { AnalyzeResult, validate } from './schema.mjs'
import { groundItems } from './grounding.mjs'

export const SYSTEM = `You are the nutrition engine of a calorie-tracking app used worldwide.
The user logs food, drinks or exercise as free text and/or a photo. Text can be in any language, in mixed or transliterated scripts
(e.g. Hinglish, Spanglish, Arabizi), and can use slang, regional dish names, restaurant dishes or packaged-food brands.
Interpret each item the way a local of that cuisine would mean it. Identify every distinct item. For photos, estimate portions from the image.
Return ONLY JSON of this exact shape, no prose, no markdown:
{"items":[{"type":"food"|"exercise","name":string,"quantity":string,"grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"lookup":string}],"note":string}
Rules:
- calories and macros are for the WHOLE quantity listed, not per 100g. For drinks use grams = millilitres.
- grams is the edible weight of the whole quantity (0 for exercise).
- For exercise, calories is the calories BURNED (positive) and macros are 0.
- name is a clean English name; add the original term in brackets if it is non-obvious, e.g. "Khari puff (flaky puff pastry)".
- quantity is a human portion such as "2 pieces" or "1 bowl (250g)". Use realistic portions for that cuisine.
- lookup is a short generic English food name suitable for searching a nutrition database (e.g. "rice white cooked", "chicken breast roasted"). Use "" for exercise or when there is no sensible generic equivalent.
- note is one short sentence about assumptions, or "" if none. If there is no food or exercise, return {"items":[],"note":"<why>"}.`

function buildUserText(text, hints) {
  let out = text || 'Analyse the food/exercise in this image.'
  if (hints?.length) {
    out += `\n\nThe user previously corrected these entries. If the same food appears, prefer these values:\n${hints.map((h) => `- ${h}`).join('\n')}`
  }
  return out
}

export async function analyzeInput({ text, image, hints = [], provider, grounding = true }) {
  const user ={ role: 'user', text: buildUserText(text, hints), image }
  const started = Date.now()
  let llmMs = 0
  let raw = await generate({ system: SYSTEM, messages: [user], provider, fast: true })
  llmMs += raw.ms
  let parsed = validate(AnalyzeResult, raw.text)
  let repaired = false

  if (!parsed.ok) {
    repaired = true
    raw = await generate({
      system: SYSTEM,
      messages: [user, { role: 'model', text: raw.text }, { role: 'user', text: `That output was invalid (${parsed.error}). Reply with ONLY the corrected JSON.` }],
      provider,
      fast: true,
    })
    llmMs += raw.ms
    parsed = validate(AnalyzeResult, raw.text)
    if (!parsed.ok) throw new Error('The model returned an unreadable response. Please try again.')
  }

  const apiKey = process.env.USDA_API_KEY || 'DEMO_KEY'
  const enabled = grounding && (process.env.GROUNDING || 'on') !== 'off'
  const items = enabled
    ? await groundItems(parsed.data.items, { apiKey, timeoutMs: 1500 })
    : parsed.data.items.map((i) => ({ ...i, source: 'ai', match: '' }))

  const rounded = items.map((i) => ({
    type: i.type,
    name: i.name,
    quantity: i.quantity,
    grams: Math.round(i.grams),
    calories: Math.round(i.calories),
    protein_g: Math.round(i.protein_g),
    carbs_g: Math.round(i.carbs_g),
    fat_g: Math.round(i.fat_g),
    source: i.source,
    match: i.match,
  }))

  return {
    items: rounded,
    note: parsed.data.note,
    meta: {
      provider: raw.provider,
      model: raw.model,
      fellBackFrom: raw.fellBackFrom,
      ms: Date.now() - started,
      llmMs,
      repaired,
      grounded: rounded.filter((i) => i.source === 'usda').length,
      foodItems: rounded.filter((i) => i.type === 'food').length,
    },
  }
}
