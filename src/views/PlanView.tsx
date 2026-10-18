import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteEntries, hasSavedDiet, loadDiet, loadGoals, loadTaste, saveDiet, saveTaste, useSettingsVersion } from '../db'
import { requestPlan } from '../api'
import { PLAN_MEALS, dietLabel, dietOn, remainingMeals, remainingTarget, splitTargets, summarizeDiet, type Macros, type PlanMeal, type PlanResponse } from '../../shared/diet'
import { buildHistory, recommendPlan, updateTaste } from '../../shared/recommend'
import { MEALS, addDays, longDate, prettyDate, todayStr } from '../util'
import type { Meal } from '../types'
import Icon from '../components/Icon'
import DietEditor from '../components/DietEditor'
import { useToast } from '../components/Toast'

const MEAL_COLOR: Record<string, string> = { breakfast: '#f59e0b', lunch: '#38bdf8', snack: '#f472b6', dinner: '#a78bfa' }
const PHASES = ['Looking at your goals…', 'Choosing dishes for your diet…', 'Balancing the macros…', 'Checking nothing breaks your rules…']
const label = (m: Meal) => MEALS.find((x) => x.id === m)?.label ?? m

type Mode = 'day' | 'rest'

interface Cached {
  key: string
  plan: PlanResponse
}

const cacheKey = (date: string, mode: Mode) => `plan:v2:${date}:${mode}`
const loadCached = (date: string, mode: Mode): Cached | null => {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(date, mode)) || 'null')
  } catch {
    return null
  }
}
const saveCached = (date: string, mode: Mode, c: Cached) => {
  try {
    localStorage.setItem(cacheKey(date, mode), JSON.stringify(c))
  } catch {
    /* storage full: skip caching */
  }
}

const sumOf = (meals: PlanMeal[]): Macros => {
  const all = meals.flatMap((m) => m.items)
  return { calories: all.reduce((s, i) => s + i.calories, 0), protein: all.reduce((s, i) => s + i.protein_g, 0), carbs: all.reduce((s, i) => s + i.carbs_g, 0), fat: all.reduce((s, i) => s + i.fat_g, 0) }
}

const engineName = (e?: string) => (e === 'catalog' ? 'Recommendation engine' : e === 'hybrid' ? 'Engine + AI' : e === 'llm' ? 'AI suggestions' : 'Plan')

function Bar({ label: l, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  return (
    <div className="macro">
      <div className="macro-top">
        <span>{l}</span>
        <span className="muted">
          {value} / {goal}
          {l === 'Calories' ? '' : 'g'}
        </span>
      </div>
      <div className="bar">
        <span style={{ width: `${Math.min(100, goal ? (value / goal) * 100 : 0)}%`, background: color }} />
      </div>
    </div>
  )
}

export default function PlanView({ date }: { date: string }) {
  const toast = useToast()
  useSettingsVersion()
  const goals = loadGoals()
  const diet = loadDiet()
  const saved = hasSavedDiet()
  const isToday = date === todayStr()

  const entries = useLiveQuery(() => db.entries.where('date').equals(date).toArray(), [date]) ?? []
  const eatenFood = entries.filter((e) => e.kind === 'food')
  const burned = entries.filter((e) => e.kind === 'exercise').reduce((s, e) => s + e.calories, 0)
  const eaten: Macros = {
    calories: eatenFood.reduce((s, e) => s + e.calories, 0),
    protein: eatenFood.reduce((s, e) => s + e.protein, 0),
    carbs: eatenFood.reduce((s, e) => s + e.carbs, 0),
    fat: eatenFood.reduce((s, e) => s + e.fat, 0),
  }
  const goal: Macros = { calories: goals.calories, protein: goals.protein, carbs: goals.carbs, fat: goals.fat }

  const [mode, setMode] = useState<Mode>(() => (isToday && eatenFood.length > 0 ? 'rest' : 'day'))
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [swapping, setSwapping] = useState<Meal | null>(null)
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)

  const effectiveMode: Mode = isToday ? mode : 'day'
  const todaysDiet = dietOn(diet, date)
  const isOverride = todaysDiet !== diet.base

  const loggedMeals = new Set(eatenFood.map((e) => e.meal ?? 'snack'))
  const mealsToPlan: Meal[] = effectiveMode === 'rest' ? remainingMeals(new Date(), loggedMeals) : PLAN_MEALS
  const target: Macros = effectiveMode === 'rest' ? remainingTarget(goal, eaten, burned) : goal
  const inputsKey = JSON.stringify({ diet: todaysDiet, a: diet.allergies, d: diet.dislikes, c: diet.cuisines, t: target, m: mealsToPlan })

  useEffect(() => {
    const c = loadCached(date, effectiveMode)
    setPlan(c && c.key === inputsKey ? c.plan : null)
    setError('')
    setNotice('')
  }, [date, effectiveMode, inputsKey])

  useEffect(() => {
    if (!busy) return
    setPhase(0)
    const id = setInterval(() => setPhase((p) => Math.min(p + 1, PHASES.length - 1)), 1700)
    return () => clearInterval(id)
  }, [busy])

  const aiBody = (meals: Meal[], t: Macros, avoid: string[]) => ({ diet: todaysDiet, allergies: diet.allergies, dislikes: diet.dislikes, cuisines: diet.cuisines, meals, target: t, avoid })

  // The recommendation engine runs right here on the device: no network, no cost, no waiting.
  async function engine(meals: Meal[], tgt: Macros, avoid: string[]) {
    const rows = await db.entries.where('date').aboveOrEqual(addDays(todayStr(), -120)).toArray()
    return recommendPlan({ prefs: diet, date, meals, target: tgt, history: buildHistory(rows, todayStr()), taste: loadTaste(), avoid, seed: Math.floor(Math.random() * 2 ** 31) })
  }

  // If the catalog cannot fill a meal within the rules (an unusual diet and cuisine mix), ask the AI for just those meals.
  async function fillGaps(out: Awaited<ReturnType<typeof engine>>, meals: Meal[], tgt: Macros): Promise<PlanResponse> {
    const base: PlanResponse = { ...out, meta: { ...out.meta } }
    if (!out.unfilled.length) return base
    const shares = splitTargets(tgt, meals)
    const gap = out.unfilled.reduce<Macros>((a, m) => ({ calories: a.calories + shares[m].calories, protein: a.protein + shares[m].protein, carbs: a.carbs + shares[m].carbs, fat: a.fat + shares[m].fat }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
    try {
      const ai = await requestPlan(aiBody(out.unfilled, gap, []))
      const merged = [...base.meals, ...ai.meals].sort((a, b) => PLAN_MEALS.indexOf(a.meal) - PLAN_MEALS.indexOf(b.meal))
      const totals = sumOf(merged)
      return { ...base, meals: merged, totals, onTarget: Math.abs(totals.calories - tgt.calories) / Math.max(1, tgt.calories) <= 0.1, tips: [...base.tips, ...ai.tips].slice(0, 4), meta: { ...base.meta, engine: 'hybrid' } }
    } catch {
      setNotice(`The catalog could not fill ${out.unfilled.map(label).join(', ')} for this diet and cuisine mix, and the AI helper is not reachable.`)
      return base
    }
  }

  async function generate() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const out = await engine(mealsToPlan, target, [])
      const r = await fillGaps(out, mealsToPlan, target)
      setPlan(r)
      saveCached(date, effectiveMode, { key: inputsKey, plan: r })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function generateWithAi() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await requestPlan(aiBody(mealsToPlan, target, []))
      const withEngine: PlanResponse = { ...r, meta: { ...r.meta, engine: 'llm' } }
      setPlan(withEngine)
      saveCached(date, effectiveMode, { key: inputsKey, plan: withEngine })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function swap(m: PlanMeal) {
    if (!plan) return
    setSwapping(m.meal)
    setError('')
    try {
      const avoid = plan.meals.flatMap((x) => x.items.map((i) => i.name))
      const out = await engine([m.meal], m.target, avoid)
      let fresh: PlanMeal | undefined = out.meals[0]
      if (!fresh) {
        const ai = await requestPlan(aiBody([m.meal], m.target, avoid)) // the catalog has nothing else for this meal
        fresh = ai.meals[0]
      }
      if (!fresh) throw new Error('No alternative found. Try again.')
      // swapping away is a (weak) signal that the user did not want those dishes
      const ids = m.items.map((i) => i.foodId).filter((x): x is string => !!x)
      if (ids.length) saveTaste(updateTaste(loadTaste(), ids, 'swapped'))
      const meals = plan.meals.map((x) => (x.meal === m.meal ? fresh : x))
      const totals = sumOf(meals)
      const next: PlanResponse = { ...plan, meals, totals, onTarget: Math.abs(totals.calories - plan.target.calories) / Math.max(1, plan.target.calories) <= 0.1 }
      setPlan(next)
      saveCached(date, effectiveMode, { key: inputsKey, plan: next })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSwapping(null)
    }
  }

  async function logMeals(meals: PlanMeal[]) {
    const now = Date.now()
    const keys = await db.entries.bulkAdd(
      meals.flatMap((m, mi) =>
        m.items.map((it, i) => ({
          date,
          createdAt: now + mi * 100 + i,
          kind: 'food' as const,
          meal: m.meal,
          name: it.name,
          quantity: it.quantity,
          grams: it.grams,
          source: 'ai' as const,
          calories: it.calories,
          protein: it.protein_g,
          carbs: it.carbs_g,
          fat: it.fat_g,
        })),
      ),
      { allKeys: true },
    )
    // logging a suggested meal is the positive signal the recommender learns from
    const ids = meals.flatMap((m) => m.items.map((i) => i.foodId)).filter((x): x is string => !!x)
    if (ids.length) saveTaste(updateTaste(loadTaste(), ids, 'liked'))
    toast(`Logged ${meals.length > 1 ? 'the plan' : label(meals[0].meal)}`, { label: 'Undo', run: () => void deleteEntries(keys) })
  }

  const todayMealsNow = useMemo(() => new Set(eatenFood.map((e) => e.meal ?? 'snack')), [eatenFood])

  // first time: ask how they eat
  if (!saved || editing) {
    return (
      <div className="page narrow">
        <header className="page-head">
          <div>
            <h1>{saved ? 'Food preferences' : 'How do you eat?'}</h1>
            <p className="muted">{saved ? 'Changes apply to new plans.' : 'Tell me your diet and I will plan each day to match your calories and macros.'}</p>
          </div>
        </header>
        <section className="card">
          <DietEditor
            initial={diet}
            prefillCuisines={!saved}
            saveLabel={saved ? 'Save preferences' : 'Save and plan my day'}
            onSave={(p) => {
              saveDiet(p)
              setEditing(false)
            }}
          />
        </section>
        {saved && (
          <button className="btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    )
  }

  const remainingLabel = effectiveMode === 'rest' ? 'left for today' : 'daily goal'

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Meal plan</h1>
          <p className="muted">
            {prettyDate(date)} · {longDate(date)}
          </p>
        </div>
        <button className="btn small" onClick={() => setEditing(true)}>
          <Icon name="utensils" size={14} /> Preferences
        </button>
      </header>

      <section className="card plan-head">
        <div className="plan-diet">
          <span className={`pill ${isOverride ? '' : 'ok'}`}>
            {dietLabel(todaysDiet)} {isOverride ? 'day' : ''}
          </span>
          <span className="muted small-text">{summarizeDiet(diet)}</span>
          {diet.allergies.length > 0 && <span className="muted small-text">Avoiding: {diet.allergies.join(', ')}</span>}
        </div>

        {isToday && (
          <div className="seg" role="radiogroup" aria-label="Plan scope">
            <button role="radio" aria-checked={mode === 'day'} className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
              Whole day
            </button>
            <button role="radio" aria-checked={mode === 'rest'} className={mode === 'rest' ? 'on' : ''} onClick={() => setMode('rest')}>
              Rest of today
            </button>
          </div>
        )}

        <div className="plan-target">
          <div>
            <b>{target.calories.toLocaleString()}</b>
            <span className="muted small-text">kcal {remainingLabel}</span>
          </div>
          <div>
            <b>{target.protein}g</b>
            <span className="muted small-text">protein</span>
          </div>
          <div>
            <b>{target.carbs}g</b>
            <span className="muted small-text">carbs</span>
          </div>
          <div>
            <b>{target.fat}g</b>
            <span className="muted small-text">fat</span>
          </div>
        </div>

        {mealsToPlan.length === 0 ? (
          <p className="muted">No meals left to plan today. Switch to “Whole day” to plan a full day, or check tomorrow.</p>
        ) : (
          <div className="plan-actions">
            <button className="btn primary plan-go" onClick={() => void generate()} disabled={busy || swapping !== null}>
              {busy ? (
                <>
                  <span className="spinner" /> Planning…
                </>
              ) : (
                <>
                  <Icon name="sparkle" size={16} /> {plan ? 'Plan again' : effectiveMode === 'rest' ? 'Plan the rest of today' : 'Plan my day'}
                </>
              )}
            </button>
            <button className="btn" onClick={() => void generateWithAi()} disabled={busy || swapping !== null} title="Ask the AI for ideas instead of using the recommendation engine">
              <Icon name="coach" size={16} /> Try AI suggestions
            </button>
          </div>
        )}
        {effectiveMode === 'rest' && mealsToPlan.length > 0 && <p className="muted small-text">Planning: {mealsToPlan.map(label).join(', ')}</p>}
        {target.calories < 80 && <p className="muted small-text">You have already reached your goal for today.</p>}
      </section>

      {error && <div className="msg error">{error}</div>}
      {notice && <div className="msg">{notice}</div>}

      {busy && (
        <div className="group">
          <div className="thinking">
            <Icon name="sparkle" size={14} /> <span key={phase}>{PHASES[phase]}</span>
          </div>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {plan && !busy && (
        <>
          <section className="card plan-summary">
            <div className="card-title">
              <h3>Plan totals</h3>
              <span className={`pill ${plan.onTarget ? 'ok' : 'bad'}`}>{plan.onTarget ? 'On target' : `${plan.totals.calories - plan.target.calories > 0 ? '+' : ''}${plan.totals.calories - plan.target.calories} kcal vs target`}</span>
            </div>
            <div className="macros plan-macros">
              <Bar label="Calories" value={plan.totals.calories} goal={plan.target.calories} color="var(--accent)" />
              <Bar label="Protein" value={plan.totals.protein} goal={plan.target.protein} color="var(--protein)" />
              <Bar label="Carbs" value={plan.totals.carbs} goal={plan.target.carbs} color="var(--carbs)" />
              <Bar label="Fat" value={plan.totals.fat} goal={plan.target.fat} color="var(--fat)" />
            </div>
            <p className="muted small-text engine-note">
              <Icon name={plan.meta.engine === 'llm' ? 'coach' : 'sparkle'} size={12} /> {engineName(plan.meta.engine)}
              {plan.meta.engine === 'catalog' || plan.meta.engine === 'hybrid' ? ` · built on your device in ${Math.max(1, Math.round(plan.meta.ms))} ms` : ''}
            </p>
            <div className="dialog-actions left">
              <button className="btn primary" onClick={() => void logMeals(plan.meals.filter((m) => !todayMealsNow.has(m.meal) || !isToday))}>
                <Icon name="plus" size={16} /> Log everything
              </button>
            </div>
          </section>

          {plan.meals.map((m) => (
            <section key={m.meal} className="card plan-meal" style={{ ['--meal' as string]: MEAL_COLOR[m.meal] }}>
              <div className="card-title">
                <h3>
                  <i className="meal-dot" />
                  {label(m.meal)}
                </h3>
                <span className="muted small-text">
                  {m.totals.calories} kcal · P {m.totals.protein} · C {m.totals.carbs} · F {m.totals.fat}
                </span>
              </div>
              <ul className="plan-items">
                {m.items.map((it, i) => (
                  <li key={i}>
                    <div>
                      <b>{it.name}</b>
                      <span className="muted small-text">{it.quantity}</span>
                      {it.reasons && it.reasons.length > 0 && <span className="why small-text">{it.reasons.join(' · ')}</span>}
                    </div>
                    <div className="plan-item-nums">
                      <b>{it.calories}</b>
                      <span className="muted small-text">
                        P {it.protein_g} · C {it.carbs_g} · F {it.fat_g}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="dialog-actions left">
                <button className="btn small primary" onClick={() => void logMeals([m])}>
                  <Icon name="plus" size={14} /> Log this meal
                </button>
                <button className="btn small" onClick={() => void swap(m)} disabled={swapping !== null || busy}>
                  {swapping === m.meal ? <span className="spinner" /> : <Icon name="repeat" size={14} />} Swap
                </button>
              </div>
            </section>
          ))}

          {plan.tips.length > 0 && (
            <section className="card plan-tips">
              <div className="card-title">
                <h3>Good to know</h3>
              </div>
              <ul>
                {plan.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              <p className="muted small-text">Numbers are estimates, and this is not medical advice. Always check ingredients against your allergies.</p>
            </section>
          )}
        </>
      )}

      {!plan && !busy && mealsToPlan.length > 0 && !error && (
        <div className="empty card">
          <div className="empty-icon">
            <Icon name="utensils" size={26} />
          </div>
          <h3>Ready when you are</h3>
          <p className="muted">I will suggest meals that match your {dietLabel(todaysDiet).toLowerCase()} diet and hit your calories and macros.</p>
        </div>
      )}
    </div>
  )
}
