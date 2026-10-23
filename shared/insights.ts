// Weekly analysis: what happened to your weight, why, and what to change.
//
// Everything here is plain arithmetic and rules on your own logs (no AI, free, works offline). The AI is only used
// afterwards, optionally, to put these verified facts into friendly words (see server/insights.mjs).
//
// Core idea: a kilogram of body weight is about 7,700 kcal. So the week's average intake compared with what you burn
// predicts how much you should have gained or lost. When the scale disagrees, the gap points at the cause:
// logging gaps, a wrong maintenance estimate, or normal water swings.
import type { Entry, Goals, Meal, WeightEntry } from './types'
import { addDays } from './dates'
import { CATALOG } from './recommend/catalog'
import type { Food } from './recommend/types'
import { foodProblems, type DietPrefs, type DietType } from './diet'

export const KCAL_PER_KG = 7700

export type Severity = 'high' | 'medium' | 'low' | 'info'
export interface Finding {
  id: string
  severity: Severity
  title: string
  detail: string
  fix: string
}
export interface Swap {
  from: string
  fromKcal: number
  to: string
  toKcal: number
  timesPerWeek: number
  savesPerWeek: number
}
export interface DayStat {
  date: string
  eaten: number
  burned: number
  protein: number
  carbs: number
  fat: number
  entries: number
}
export interface TopItem {
  name: string
  kcal: number
  count: number
  share: number
}
export type Direction = 'lose' | 'gain' | 'maintain'
export type WeightStatus = 'losing' | 'flat' | 'gaining' | 'unknown'

export interface WeeklyReport {
  ready: boolean
  /** why the report is empty or limited */
  notice?: string
  from: string
  to: string
  days: DayStat[]
  loggedDays: number
  incompleteDays: number
  avgEaten: number
  avgBurned: number
  avgProtein: number
  goalKcal: number
  tdee: number | null
  direction: Direction
  weight: { latest: number | null; changeKg: number | null; kgPerWeek: number | null; points: number; status: WeightStatus }
  verdict: { status: 'on-track' | 'stalled' | 'wrong-way' | 'unknown'; headline: string; summary: string }
  balance: { perDay: number | null; expectedKgPerWeek: number | null; impliedMaintenance: number | null }
  topItems: TopItem[]
  findings: Finding[]
  swaps: Swap[]
  actions: string[]
  /** a calorie target that would produce the pace you want, or null when it cannot be worked out */
  targetKcal: number | null
}

export interface InsightInput {
  /** the day the report is made on; the analysed week ends the day before (today is still incomplete) */
  today: string
  entries: Entry[]
  weights: WeightEntry[]
  goals: Goals
  /** estimated maintenance calories (from the profile), or null when the profile is not filled in */
  tdee: number | null
  diet?: DietPrefs
  /** kg per week the person wants, magnitude only (default 0.5) */
  pace?: number
  /** lowest calories ever suggested (default 1400) */
  minKcal?: number
}

const round = (n: number, d = 0) => {
  const f = 10 ** d
  return Math.round(n * f) / f
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
const dayOfWeek = (date: string) => new Date(date + 'T12:00:00').getDay()
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)

/** Below this a day with food logged is probably an incomplete log, not a real day of eating. */
export const PLAUSIBLE_DAY_KCAL = 800

const LIQUID = /\b(juice|soda|cola|coke|pepsi|sprite|fanta|shake|smoothie|latte|cappuccino|frappe|mocha|beer|wine|whisky|whiskey|vodka|rum|cocktail|lassi|milkshake|energy drink|sweet tea|bubble tea|boba|hot chocolate|cold coffee|thandai)\b/i
const SALTY_OR_REFINED = /\b(pizza|burger|fries|noodles|ramen|biryani|pasta|chips|namkeen|samosa|pakora|momos|maggi|instant|pav|vada pav|fried rice|sandwich|roll|wrap|kebab|nachos|taco|burrito)\b/i

const normalizeName = (n: string) => n.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').replace(/\s+/g, ' ').trim()

// -------------------------------------------------------------------------------------------- weight trend

interface Point {
  t: number
  kg: number
}

/** Least-squares slope in kg per day. */
function slope(points: Point[]) {
  const n = points.length
  const mt = mean(points.map((p) => p.t))
  const mk = mean(points.map((p) => p.kg))
  const num = sum(points.map((p) => (p.t - mt) * (p.kg - mk)))
  const den = sum(points.map((p) => (p.t - mt) ** 2))
  return n >= 2 && den > 0 ? num / den : 0
}

export function weightTrend(weights: WeightEntry[], end: string, windowDays = 14) {
  const start = addDays(end, -(windowDays - 1))
  const pts = weights
    .filter((w) => w.date >= start && w.date <= end && w.kg > 20 && w.kg < 400)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({ t: daysBetween(start, w.date), kg: w.kg }))
  const latest = [...weights].filter((w) => w.date <= end).sort((a, b) => b.date.localeCompare(a.date))[0]?.kg ?? null
  const span = pts.length ? pts[pts.length - 1].t - pts[0].t : 0
  // two readings a few days apart are not a trend; three or more over most of a week are
  if (pts.length < 3 || span < 4) {
    const rough = pts.length >= 2 && span >= 3 ? round(((pts[pts.length - 1].kg - pts[0].kg) / span) * 7, 2) : null
    return { latest, changeKg: pts.length >= 2 ? round(pts[pts.length - 1].kg - pts[0].kg, 1) : null, kgPerWeek: rough, points: pts.length, status: 'unknown' as WeightStatus, reliable: false }
  }
  const kgPerWeek = round(slope(pts) * 7, 2)
  const status: WeightStatus = kgPerWeek <= -0.15 ? 'losing' : kgPerWeek >= 0.15 ? 'gaining' : 'flat'
  return { latest, changeKg: round(pts[pts.length - 1].kg - pts[0].kg, 1), kgPerWeek, points: pts.length, status, reliable: true }
}

// -------------------------------------------------------------------------------------------- swaps

const tokens = (s: string) => new Set(normalizeName(s).split(' ').filter((w) => w.length > 2))
function overlap(a: string, b: string) {
  const A = tokens(a)
  const B = tokens(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return hit / Math.min(A.size, B.size)
}

export function catalogMatch(name: string): Food | null {
  let best: { f: Food; s: number } | null = null
  for (const f of CATALOG) {
    const s = overlap(name, f.name)
    if (s >= 0.6 && (!best || s > best.s)) best = { f, s }
  }
  return best?.f ?? null
}

/** Lighter alternatives for the foods that supply most of your calories, from the built-in catalog, respecting your diet. */
export function findSwaps(items: { name: string; meal: Meal; avgKcal: number; avgProtein: number; count: number }[], diet: DietPrefs | undefined, limit = 3): Swap[] {
  const base: DietType = diet?.base ?? 'nonveg'
  const out: Swap[] = []
  const used = new Set<string>()
  for (const it of items) {
    if (it.avgKcal < 120) continue
    const known = catalogMatch(it.name)
    const role = known?.role ?? (it.meal === 'snack' ? 'snack' : null)
    if (!role) continue
    const pool = CATALOG.filter((f) => {
      if (f.id === known?.id || used.has(f.id)) return false
      if (f.role !== role && !(role === 'snack' && (f.role === 'fruit' || f.role === 'snack'))) return false
      if (!f.meals.includes(it.meal) && it.meal !== 'snack') return false
      if (f.kcal > it.avgKcal * 0.75) return false // must be clearly lighter
      if (f.protein < it.avgProtein * 0.7) return false // and keep most of the protein
      return foodProblems(f.name, base, diet?.allergies ?? [], diet?.dislikes ?? []).length === 0
    })
    if (!pool.length) continue
    // prefer the biggest saving, with a small bonus for protein and for foods that fill you up
    const score = (f: Food) => it.avgKcal - f.kcal + f.protein * 2 + (f.tags.includes('high-protein') ? 20 : 0) + (f.fiber ?? 0) * 3
    const to = [...pool].sort((a, b) => score(b) - score(a))[0]
    used.add(to.id)
    out.push({ from: it.name, fromKcal: round(it.avgKcal), to: to.name, toKcal: to.kcal, timesPerWeek: it.count, savesPerWeek: round((it.avgKcal - to.kcal) * it.count) })
    if (out.length >= limit) break
  }
  return out.sort((a, b) => b.savesPerWeek - a.savesPerWeek)
}

// -------------------------------------------------------------------------------------------- the report

export function weeklyReport(input: InsightInput): WeeklyReport {
  const { today, entries, weights, goals, tdee, diet } = input
  const to = addDays(today, -1)
  const from = addDays(to, -6)
  const direction: Direction = (() => {
    const latest = [...weights].sort((a, b) => b.date.localeCompare(a.date))[0]?.kg
    if (!latest || !goals.targetKg) return 'maintain'
    const diff = goals.targetKg - latest
    return Math.abs(diff) < 1 ? 'maintain' : diff < 0 ? 'lose' : 'gain'
  })()

  const week = entries.filter((e) => e.date >= from && e.date <= to)
  const days: DayStat[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i)
    const es = week.filter((e) => e.date === date)
    const food = es.filter((e) => e.kind === 'food')
    return {
      date,
      eaten: sum(food.map((e) => e.calories)),
      burned: sum(es.filter((e) => e.kind === 'exercise').map((e) => e.calories)),
      protein: sum(food.map((e) => e.protein)),
      carbs: sum(food.map((e) => e.carbs)),
      fat: sum(food.map((e) => e.fat)),
      entries: food.length,
    }
  })
  const withFood = days.filter((d) => d.entries > 0)
  const plausible = days.filter((d) => d.eaten >= PLAUSIBLE_DAY_KCAL)
  const incompleteDays = withFood.length - plausible.length
  const trend = weightTrend(weights, today)

  const base: WeeklyReport = {
    ready: false,
    from,
    to,
    days,
    loggedDays: withFood.length,
    incompleteDays,
    avgEaten: round(mean(plausible.map((d) => d.eaten))),
    avgBurned: round(mean(days.map((d) => d.burned))),
    avgProtein: round(mean(plausible.map((d) => d.protein))),
    goalKcal: goals.calories,
    tdee,
    direction,
    weight: { latest: trend.latest, changeKg: trend.changeKg, kgPerWeek: trend.kgPerWeek, points: trend.points, status: trend.status },
    verdict: { status: 'unknown', headline: '', summary: '' },
    balance: { perDay: null, expectedKgPerWeek: null, impliedMaintenance: null },
    topItems: [],
    findings: [],
    swaps: [],
    actions: [],
    targetKcal: null,
  }

  if (plausible.length < 3) {
    return {
      ...base,
      notice: withFood.length
        ? `Only ${plausible.length} day${plausible.length === 1 ? '' : 's'} of the last 7 look fully logged. Log at least 3–4 full days and the analysis will appear.`
        : 'Nothing logged in the last 7 days yet. Log a few days of meals and the analysis will appear here.',
    }
  }

  const findings: Finding[] = []
  const add = (f: Finding) => findings.push(f)
  const avg = base.avgEaten
  const ref = tdee ?? null

  // ------- energy balance and what it predicts
  const perDay = ref !== null ? round(avg - ref) : null
  const expectedKgPerWeek = perDay !== null ? round((perDay * 7) / KCAL_PER_KG, 2) : null
  // if the scale is trustworthy, what maintenance would explain it?
  const impliedMaintenance = trend.reliable && trend.kgPerWeek !== null ? round(avg - (trend.kgPerWeek * KCAL_PER_KG) / 7) : null

  // ------- top foods
  const food = week.filter((e) => e.kind === 'food')
  const byName = new Map<string, { name: string; kcal: number; protein: number; count: number; meals: Map<Meal, number> }>()
  for (const e of food) {
    const k = normalizeName(e.name)
    if (!k) continue
    const cur = byName.get(k) ?? { name: e.name, kcal: 0, protein: 0, count: 0, meals: new Map() }
    cur.kcal += e.calories
    cur.protein += e.protein
    cur.count += 1
    const m = e.meal ?? 'snack'
    cur.meals.set(m, (cur.meals.get(m) ?? 0) + 1)
    byName.set(k, cur)
  }
  const totalKcal = sum(food.map((e) => e.calories)) || 1
  const ranked = [...byName.values()].sort((a, b) => b.kcal - a.kcal)
  const topItems: TopItem[] = ranked.slice(0, 5).map((r) => ({ name: r.name, kcal: round(r.kcal), count: r.count, share: round(r.kcal / totalKcal, 2) }))

  // ------- verdict
  const goingRight = direction === 'lose' ? trend.status === 'losing' : direction === 'gain' ? trend.status === 'gaining' : trend.status === 'flat'
  const goingWrong = direction === 'lose' ? trend.status === 'gaining' : direction === 'gain' ? trend.status === 'losing' : trend.status === 'gaining' || trend.status === 'losing'
  const rate = trend.kgPerWeek !== null ? `${trend.kgPerWeek > 0 ? '+' : ''}${trend.kgPerWeek} kg/week` : ''
  let verdict: WeeklyReport['verdict']
  if (trend.status === 'unknown') {
    verdict = { status: 'unknown', headline: 'Not enough weigh-ins to judge', summary: `Weigh yourself on at least 3 mornings a week (same time, after the toilet, before eating). Meanwhile here is what your food log shows: you averaged ${avg} kcal a day${ref !== null ? ` against about ${ref} to maintain` : ''}.` }
  } else if (goingRight) {
    verdict = { status: 'on-track', headline: direction === 'maintain' ? 'Weight is steady' : `On track: ${rate}`, summary: `Your weight trend is ${rate}, which matches your goal. Keep doing what you are doing.` }
  } else if (goingWrong) {
    verdict = { status: 'wrong-way', headline: direction === 'lose' ? `Weight is going up (${rate})` : direction === 'gain' ? `Weight is going down (${rate})` : `Weight is drifting (${rate})`, summary: 'The trend over the last two weeks is moving away from your goal. The reasons below are ranked by how much they explain.' }
  } else {
    verdict = { status: 'stalled', headline: `No clear progress (${rate || 'flat'})`, summary: 'Your weight trend is flat. That is normal for a few days, so here is what to check.' }
  }

  // ------- why: the rules
  const intakeVsGoal = avg - goals.calories
  if (direction === 'lose' && ref !== null && perDay !== null && perDay > -150) {
    add({
      id: 'no-deficit',
      severity: 'high',
      title: 'You are not eating less than you burn',
      detail: `You averaged ${avg} kcal a day. Your estimated maintenance is about ${ref}, so the gap is ${perDay >= 0 ? '+' : ''}${perDay} kcal a day. A real loss of 0.5 kg a week needs a gap of about −550.`,
      fix: `Bring your average down to roughly ${Math.max(input.minKcal ?? 1400, Math.round((ref - (input.pace ?? 0.5) * 1100) / 10) * 10)} kcal on most days.`,
    })
  } else if (direction === 'gain' && ref !== null && perDay !== null && perDay < 150) {
    add({ id: 'no-surplus', severity: 'high', title: 'You are not eating enough to gain', detail: `You averaged ${avg} kcal, about ${perDay} against maintenance (${ref}). Gaining needs a surplus of roughly +300 a day.`, fix: `Aim for around ${Math.round((ref + 300) / 10) * 10} kcal a day, with protein at every meal.` })
  }
  if (direction !== 'gain' && intakeVsGoal > Math.max(150, goals.calories * 0.08)) {
    add({ id: 'over-goal', severity: 'medium', title: `You averaged ${round(intakeVsGoal)} kcal over your goal`, detail: `Goal ${goals.calories}, actual ${avg} kcal a day on the days you logged fully.`, fix: 'Pick the two heaviest meals of the day and trim about 15% from each. That is usually enough to close this gap.' })
  }
  if (incompleteDays > 0 || withFood.length < 5) {
    add({
      id: 'under-logging',
      severity: incompleteDays > 0 ? 'high' : 'medium',
      title: incompleteDays > 0 ? `${incompleteDays} day${incompleteDays > 1 ? 's' : ''} look incomplete` : `Only ${withFood.length} of 7 days have food logged`,
      detail: 'People forget snacks, drinks, cooking oil and bites more than anything else, and a half-logged day makes your deficit look bigger than it was.',
      fix: 'Log each meal right after you eat. If a day was not tracked, mark it as untracked instead of leaving a half-day.',
    })
  }
  // weekend versus weekday
  const wkEnd = plausible.filter((d) => [0, 6].includes(dayOfWeek(d.date)))
  const wkDay = plausible.filter((d) => ![0, 6].includes(dayOfWeek(d.date)))
  if (wkEnd.length && wkDay.length) {
    const gap = mean(wkEnd.map((d) => d.eaten)) - mean(wkDay.map((d) => d.eaten))
    if (gap > 300) add({ id: 'weekend', severity: 'medium', title: `Weekends are ${round(gap)} kcal heavier`, detail: `Weekend days averaged ${round(mean(wkEnd.map((d) => d.eaten)))} kcal against ${round(mean(wkDay.map((d) => d.eaten)))} on weekdays. Two high days can cancel a whole week of deficit (${round((gap * 2) / 1)} kcal).`, fix: 'Plan one weekend meal you really enjoy, and keep the others near your normal. No need to skip eating out.' })
  }
  // snacks and drinks
  const snackKcal = sum(food.filter((e) => (e.meal ?? 'snack') === 'snack').map((e) => e.calories))
  if (snackKcal / totalKcal > 0.25) add({ id: 'snacks', severity: 'medium', title: `Snacks are ${round((snackKcal / totalKcal) * 100)}% of your calories`, detail: `${round(snackKcal)} kcal of ${round(totalKcal)} came from snacks this week.`, fix: 'Swap two snacks a day for fruit, curd or a protein snack, and keep the rest for mealtimes.' })
  const liquid = food.filter((e) => LIQUID.test(e.name))
  const liquidKcal = sum(liquid.map((e) => e.calories))
  if (liquidKcal / totalKcal > 0.1) add({ id: 'liquid', severity: 'medium', title: `Drinks add ${round(liquidKcal)} kcal a week`, detail: `${liquid.length} sweet or alcoholic drinks (${round((liquidKcal / totalKcal) * 100)}% of the week's calories). They add calories without making you feel full.`, fix: `Swap most of them for water, black coffee or unsweetened tea. That alone is about ${round(liquidKcal * 0.7)} kcal a week.` })
  const heavy = ranked[0]
  if (heavy && heavy.kcal / totalKcal >= 0.12 && heavy.count >= 3) add({ id: 'repeat-heavy', severity: 'low', title: `${heavy.name} supplies ${round((heavy.kcal / totalKcal) * 100)}% of your week`, detail: `You had it ${heavy.count} times for ${round(heavy.kcal)} kcal in total.`, fix: 'Keep it if you love it, but cut the portion by a quarter or have it fewer times, and see the swaps below.' })
  // protein
  if (goals.protein > 0 && base.avgProtein < goals.protein * 0.8) add({ id: 'protein', severity: 'medium', title: `Protein is low (${base.avgProtein} g against ${goals.protein} g)`, detail: 'Low protein makes you hungrier, and on a deficit you lose more muscle and less fat.', fix: 'Add a protein source to each meal: eggs, paneer, dal, curd, chicken, fish, tofu or whey.' })
  // activity
  const prev = entries.filter((e) => e.kind === 'exercise' && e.date >= addDays(from, -7) && e.date < from)
  const prevBurn = sum(prev.map((e) => e.calories))
  const thisBurn = sum(days.map((d) => d.burned))
  if (prevBurn > 300 && thisBurn < prevBurn * 0.6) add({ id: 'activity-drop', severity: 'low', title: 'You moved less than last week', detail: `Logged exercise fell from ${round(prevBurn)} to ${round(thisBurn)} kcal.`, fix: 'Even a 20-minute walk after dinner adds up to about 700 kcal a week.' })
  // few weigh-ins
  if (trend.points < 3) add({ id: 'few-weighins', severity: 'medium', title: 'Too few weigh-ins to see a trend', detail: `${trend.points} reading${trend.points === 1 ? '' : 's'} in two weeks. Day to day your weight naturally swings 1–2 kg with water, salt and food in your gut.`, fix: 'Weigh yourself on at least 3 mornings a week, same conditions, and judge the trend over 2–3 weeks.' })

  // ------- when the scale and the food log disagree
  if (trend.reliable && expectedKgPerWeek !== null && trend.kgPerWeek !== null) {
    const gap = trend.kgPerWeek - expectedKgPerWeek
    if (gap > 0.35 && impliedMaintenance !== null) {
      add({ id: 'scale-vs-log', severity: 'high', title: 'The scale is higher than your log predicts', detail: `Your log says ${expectedKgPerWeek > 0 ? '+' : ''}${expectedKgPerWeek} kg a week, but you are at ${trend.kgPerWeek > 0 ? '+' : ''}${trend.kgPerWeek}. Either some food is not being logged, or you burn less than the ${ref} kcal estimated. The scale suggests your real maintenance is nearer ${impliedMaintenance}.`, fix: `Use ${impliedMaintenance} as your maintenance for now, and weigh your portions (a food scale) for a week to find what is missing.` })
    }
  }

  // ------- weight went up: separate real fat gain from water
  if (trend.reliable && trend.status === 'gaining' && trend.changeKg !== null && trend.changeKg > 0 && perDay !== null) {
    const surplusKcal = Math.max(0, perDay * 7)
    const needed = trend.changeKg * KCAL_PER_KG
    if (surplusKcal < needed * 0.5) {
      add({ id: 'water-not-fat', severity: 'info', title: `+${trend.changeKg} kg is mostly not fat`, detail: `Gaining ${trend.changeKg} kg of fat takes about ${round(needed)} kcal over your maintenance. Your log shows only ${round(surplusKcal)}. The rest is most likely water (salt, carbs, a hard workout, hormones) or food still in your gut, or untracked eating.`, fix: 'Do not cut hard because of one jump. Weigh daily for a week and look at the 7-day trend instead.' })
    } else {
      add({ id: 'real-surplus', severity: 'high', title: 'This gain matches a real calorie surplus', detail: `Your log shows about ${round(surplusKcal)} kcal over maintenance in the week, close to the ${round(needed)} kcal that ${trend.changeKg} kg needs.`, fix: 'The fix is the same as for stalling: close the daily gap with the changes below.' })
    }
    const salty = food.filter((e) => SALTY_OR_REFINED.test(e.name))
    if (salty.length >= 4) add({ id: 'salty-refined', severity: 'low', title: 'Several salty or refined meals', detail: `${salty.length} items like ${[...new Set(salty.slice(0, 3).map((e) => normalizeName(e.name)))].join(', ')}. Salt and refined carbs make the body hold water for a few days, which shows up as quick weight gain.`, fix: 'Drink more water, add vegetables, and give it 3–4 days before judging.' })
  }
  if (trend.reliable && direction === 'lose' && trend.status === 'flat' && perDay !== null && perDay < -300) {
    add({ id: 'water-masking', severity: 'info', title: 'You may be losing fat that the scale is hiding', detail: `Your log shows a real deficit (${perDay} kcal a day) but the scale is flat. Weight often stays flat for 1–2 weeks while the body holds extra water, especially after changing food or exercise.`, fix: 'Give it two more weeks and keep logging. Waist measurement is a good second check.' })
  }

  // ------- swaps from your own food
  const swapInput = ranked.slice(0, 8).map((r) => {
    const main = [...r.meals.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return { name: r.name, meal: main, avgKcal: r.kcal / r.count, avgProtein: r.protein / r.count, count: r.count }
  })
  const swaps = findSwaps(swapInput, diet)

  // ------- a target that would work
  const maintenance = impliedMaintenance ?? ref
  let targetKcal: number | null = null
  if (maintenance !== null && direction !== 'maintain') {
    const pace = input.pace ?? 0.5
    const raw = direction === 'lose' ? maintenance - (pace * KCAL_PER_KG) / 7 : maintenance + (Math.min(pace, 0.5) * KCAL_PER_KG) / 7
    targetKcal = Math.round(Math.max(direction === 'lose' ? input.minKcal ?? 1400 : 0, raw) / 10) * 10
  } else if (maintenance !== null) targetKcal = Math.round(maintenance / 10) * 10

  // ------- the short list: what to do first
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])
  const actions: string[] = []
  for (const f of findings.filter((x) => x.severity === 'high' || x.severity === 'medium').slice(0, 3)) actions.push(f.fix)
  if (swaps[0]) actions.push(`Swap ${swaps[0].from} for ${swaps[0].to}: saves about ${swaps[0].savesPerWeek} kcal a week.`)
  if (targetKcal !== null && direction !== 'maintain' && Math.abs(targetKcal - goals.calories) >= 100) actions.push(`Try ${targetKcal} kcal a day (your goal is set to ${goals.calories}). Re-check in two weeks.`)

  return { ...base, ready: true, verdict, balance: { perDay, expectedKgPerWeek, impliedMaintenance }, topItems, findings, swaps, actions: [...new Set(actions)], targetKcal }
}
