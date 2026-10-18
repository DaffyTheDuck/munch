import { generate } from './llm.mjs'
import { validate } from './schema.mjs'
import { PlanRequest, PlanResult } from './planSchema.mjs'
import { DIETS, foodProblems, splitTargets } from '../shared/diet.ts'

// Plans meals for a calorie/macro target that respect a diet, allergies and dislikes.
// The model proposes; this module checks the result itself (it never trusts the model on diet or allergy rules)
// and gives the model one chance to repair problems before offending items are removed.

export const SYSTEM = `You are a meal planner inside a food-tracking app used worldwide.
You get a JSON request with: the diet to follow today, allergies, dislikes, preferred cuisines, the meals to plan with a calorie and macro target for each, and foods to avoid repeating.
Return ONLY JSON of this exact shape, no prose, no markdown:
{"meals":[{"meal":"breakfast"|"lunch"|"snack"|"dinner","items":[{"name":string,"quantity":string,"grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}]}],"tips":[string]}
Rules:
- Plan exactly the meals requested, in the order given, and no others.
- Each meal's calories must land within 8% of its target, and protein/carbs/fat should be close to the targets too. Check your arithmetic: a meal's calories should roughly equal 4*protein + 4*carbs + 9*fat.
- Follow the diet strictly. Never include any ingredient the diet forbids, and never include allergens or disliked foods, even as a minor ingredient or sauce.
- Use real, everyday dishes and ingredients with realistic portions (2 to 4 items per meal). Prefer the listed cuisines when given, but vary dishes and do not repeat anything in "avoid".
- name is a plain dish or food name without brands, e.g. "Vegetable poha" or "Grilled chicken salad". quantity is a human portion like "1 bowl (250g)". calories and macros are for the whole quantity.
- tips: up to 3 short, practical notes, including any nutrient worth watching on this diet (for example vitamin B12 or iron on a vegan diet). Not medical advice.`

const TOLERANCE = 0.1

function issuesFor(plan, req) {
  const issues = []
  for (const m of plan.meals) {
    for (const it of m.items) {
      const p = foodProblems(it.name, req.diet, req.allergies, req.dislikes)
      if (p.length) issues.push(`"${it.name}" (${m.meal}) is not allowed: ${p.join(', ')}`)
      // calories should roughly equal 4*protein + 4*carbs + 9*fat; zeros or wild mismatches mean the macros are wrong
      const fromMacros = 4 * it.protein_g + 4 * it.carbs_g + 9 * it.fat_g
      if (it.calories >= 50 && Math.abs(fromMacros - it.calories) / it.calories > 0.3) {
        issues.push(`the macros for "${it.name}" (${m.meal}) do not match its calories (${Math.round(it.calories)} kcal vs ${Math.round(fromMacros)} kcal from protein, carbs and fat)`)
      }
    }
  }
  const total = plan.meals.reduce((s, m) => s + m.items.reduce((a, i) => a + i.calories, 0), 0)
  if (req.target.calories > 0 && Math.abs(total - req.target.calories) / req.target.calories > TOLERANCE) {
    issues.push(`the plan totals ${Math.round(total)} kcal but the target is ${Math.round(req.target.calories)} kcal, so adjust portions to land within 10%`)
  }
  return issues
}

const sum = (items, k) => Math.round(items.reduce((s, i) => s + (i[k] || 0), 0))
const totalsOf = (items) => ({ calories: sum(items, 'calories'), protein: sum(items, 'protein_g'), carbs: sum(items, 'carbs_g'), fat: sum(items, 'fat_g') })

export async function planMeals(rawRequest, { provider } = {}) {
  const parsedReq = PlanRequest.safeParse(rawRequest)
  if (!parsedReq.success) {
    throw new Error('Invalid plan request: ' + parsedReq.error.issues.slice(0, 2).map((i) => `${i.path.join('.')} ${i.message}`).join('; '))
  }
  const req = parsedReq.data
  const started = Date.now()

  if (req.target.calories < 80) {
    return { meals: [], totals: totalsOf([]), target: req.target, onTarget: true, removed: [], tips: ['You have already reached your goal for today.'], meta: { ms: 0, repaired: false } }
  }

  req.meals = [...new Set(req.meals)] // keep the requested order, drop duplicates
  const perMeal = splitTargets(req.target, req.meals)
  const dietInfo = DIETS.find((d) => d.id === req.diet)
  const payload = {
    diet: `${dietInfo.label}: ${dietInfo.blurb}`,
    allergies: req.allergies,
    dislikes: req.dislikes,
    cuisines: req.cuisines,
    meals: req.meals.map((m) => ({ meal: m, target: perMeal[m] })),
    avoid: req.avoid,
  }

  const messages = [{ role: 'user', text: JSON.stringify(payload) }]
  let plan = null
  let repaired = false
  let used = { provider: '', model: '' }

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate({ system: SYSTEM, messages, maxTokens: 2800, provider })
    used = { provider: raw.provider, model: raw.model }
    const parsed = validate(PlanResult, raw.text)

    let issues
    if (parsed.ok) {
      const seen = new Set() // only the requested meals, each at most once
      plan = { ...parsed.data, meals: parsed.data.meals.filter((m) => req.meals.includes(m.meal) && !seen.has(m.meal) && seen.add(m.meal)) }
      issues = issuesFor(plan, req)
    } else {
      issues = [`your reply was not valid JSON in the required shape (${parsed.error})`]
    }

    if (!issues.length) break
    if (attempt === 1) {
      if (!parsed.ok) throw new Error('The planner returned an unreadable response. Please try again.')
      break
    }
    repaired = true
    messages.push({ role: 'model', text: raw.text }, { role: 'user', text: `Fix these problems and return the full corrected JSON: ${issues.join('; ')}.` })
  }

  // Final guarantee: nothing that breaks the diet, an allergy or a dislike leaves this function.
  const removed = []
  const meals = plan.meals
    .map((m) => ({
      meal: m.meal,
      items: m.items
        .filter((it) => {
          if (foodProblems(it.name, req.diet, req.allergies, req.dislikes).length === 0) return true
          removed.push(it.name)
          return false
        })
        .map((it) => ({ ...it, calories: Math.round(it.calories), protein_g: Math.round(it.protein_g), carbs_g: Math.round(it.carbs_g), fat_g: Math.round(it.fat_g), grams: Math.round(it.grams) })),
    }))
    .filter((m) => m.items.length > 0)
    .map((m) => ({ ...m, target: perMeal[m.meal], totals: totalsOf(m.items) }))

  const totals = totalsOf(meals.flatMap((m) => m.items))
  const onTarget = Math.abs(totals.calories - req.target.calories) / req.target.calories <= TOLERANCE
  const tips = [...plan.tips]
  if (removed.length) tips.unshift(`Removed ${removed.join(', ')} because it conflicts with your food preferences.`)

  return { meals, totals, target: req.target, onTarget, removed, tips, meta: { ...used, ms: Date.now() - started, repaired } }
}
