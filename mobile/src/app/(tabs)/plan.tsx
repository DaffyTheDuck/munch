import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { MEALS, addDays, longDate, todayStr } from '@shared/dates'
import { PLAN_MEALS, dietLabel, dietOn, remainingMeals, remainingTarget, splitTargets, summarizeDiet, DEFAULT_DIET, type Macros, type PlanMeal, type PlanResponse } from '@shared/diet'
import { buildHistory, recommendPlan, updateTaste } from '@shared/recommend'
import type { Entry, Meal } from '@shared/types'
import { mealColor, radius, useTheme } from '@/theme'
import { addEntries, deleteEntries, entriesBetween, entriesForDate, getSetting, hasSavedDiet, loadDiet, loadTaste, saveDiet, saveTaste, setSetting, useGoals, useLive } from '@/lib/db'
import { requestPlan } from '@/lib/api'
import { feel } from '@/lib/feel'
import { Card, Chip, Dot, PrimaryButton, SecondaryButton, T } from '@/components/ui'
import { DietEditor } from '@/components/DietEditor'
import { Skeleton } from '@/components/Skeleton'
import { useToast } from '@/components/Toast'

const PHASES = ['Looking at your goals…', 'Choosing dishes for your diet…', 'Balancing the macros…', 'Checking nothing breaks your rules…']
const label = (m: Meal) => MEALS.find((x) => x.id === m)?.label ?? m

type Mode = 'day' | 'rest'
const cacheKey = (date: string, mode: Mode) => `plan:v2:${date}:${mode}`

const sumOf = (meals: PlanMeal[]): Macros => {
  const all = meals.flatMap((m) => m.items)
  return { calories: all.reduce((s, i) => s + i.calories, 0), protein: all.reduce((s, i) => s + i.protein_g, 0), carbs: all.reduce((s, i) => s + i.carbs_g, 0), fat: all.reduce((s, i) => s + i.fat_g, 0) }
}

const engineName = (e?: string) => (e === 'catalog' ? 'Recommendation engine' : e === 'hybrid' ? 'Engine + AI' : e === 'llm' ? 'AI suggestions' : 'Plan')

function Bar({ name, value, goal, color, unit = 'g' }: { name: string; value: number; goal: number; color: string; unit?: string }) {
  const t = useTheme()
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T variant="callout">{name}</T>
        <T variant="caption" muted>
          {value} / {goal}
          {unit}
        </T>
      </View>
      <View style={{ height: 7, borderRadius: 4, backgroundColor: t.card2, overflow: 'hidden' }}>
        <View style={{ height: 7, width: `${Math.min(100, goal ? (value / goal) * 100 : 0)}%`, borderRadius: 4, backgroundColor: color }} />
      </View>
    </View>
  )
}

export default function PlanScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const date = todayStr()

  const goals = useGoals()
  const diet = useLive(loadDiet, [], DEFAULT_DIET)
  const saved = useLive(hasSavedDiet, [], true)
  const entries = useLive(() => entriesForDate(date), [date], [] as Entry[])

  const eatenFood = entries.filter((e) => e.kind === 'food')
  const burned = entries.filter((e) => e.kind === 'exercise').reduce((s, e) => s + e.calories, 0)
  const eaten: Macros = {
    calories: eatenFood.reduce((s, e) => s + e.calories, 0),
    protein: eatenFood.reduce((s, e) => s + e.protein, 0),
    carbs: eatenFood.reduce((s, e) => s + e.carbs, 0),
    fat: eatenFood.reduce((s, e) => s + e.fat, 0),
  }
  const goal: Macros = { calories: goals.calories, protein: goals.protein, carbs: goals.carbs, fat: goals.fat }

  const [mode, setMode] = useState<Mode>('day')
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [swapping, setSwapping] = useState<Meal | null>(null)
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)

  const todaysDiet = dietOn(diet, date)
  const isOverride = todaysDiet !== diet.base
  const loggedMeals = new Set(eatenFood.map((e) => e.meal ?? 'snack'))
  const mealsToPlan: Meal[] = mode === 'rest' ? remainingMeals(new Date(), loggedMeals) : PLAN_MEALS
  const target: Macros = mode === 'rest' ? remainingTarget(goal, eaten, burned) : goal
  const inputsKey = JSON.stringify({ diet: todaysDiet, a: diet.allergies, d: diet.dislikes, c: diet.cuisines, t: target, m: mealsToPlan })

  useEffect(() => {
    let on = true
    setError('')
    setNotice('')
    void getSetting(cacheKey(date, mode)).then((raw) => {
      if (!on) return
      try {
        const c = raw ? (JSON.parse(raw) as { key: string; plan: PlanResponse }) : null
        setPlan(c && c.key === inputsKey ? c.plan : null)
      } catch {
        setPlan(null)
      }
    })
    return () => {
      on = false
    }
  }, [date, mode, inputsKey])

  useEffect(() => {
    if (!busy) return
    setPhase(0)
    const id = setInterval(() => setPhase((p) => Math.min(p + 1, PHASES.length - 1)), 1700)
    return () => clearInterval(id)
  }, [busy])

  const aiBody = (meals: Meal[], tgt: Macros, avoid: string[]) => ({ diet: todaysDiet, allergies: diet.allergies, dislikes: diet.dislikes, cuisines: diet.cuisines, meals, target: tgt, avoid })
  const remember = (p: PlanResponse) => void setSetting(cacheKey(date, mode), JSON.stringify({ key: inputsKey, plan: p }))

  // The recommendation engine runs on the phone: no network, no cost, no waiting.
  async function engine(meals: Meal[], tgt: Macros, avoid: string[]) {
    const rows = await entriesBetween(addDays(todayStr(), -120), todayStr())
    return recommendPlan({ prefs: diet, date, meals, target: tgt, history: buildHistory(rows, todayStr()), taste: await loadTaste(), avoid, seed: Math.floor(Math.random() * 2 ** 31) })
  }

  // If the catalog cannot fill a meal within the rules, ask the AI for just those meals.
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
      remember(r)
      feel.success()
    } catch (e) {
      setError((e as Error).message)
      feel.error()
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
      const p: PlanResponse = { ...r, meta: { ...r.meta, engine: 'llm' } }
      setPlan(p)
      remember(p)
      feel.success()
    } catch (e) {
      setError((e as Error).message)
      feel.error()
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
      if (!fresh) fresh = (await requestPlan(aiBody([m.meal], m.target, avoid))).meals[0]
      if (!fresh) throw new Error('No alternative found. Try again.')
      const ids = m.items.map((i) => i.foodId).filter((x): x is string => !!x)
      if (ids.length) void saveTaste(updateTaste(await loadTaste(), ids, 'swapped'))
      const meals = plan.meals.map((x) => (x.meal === m.meal ? fresh! : x))
      const totals = sumOf(meals)
      const next: PlanResponse = { ...plan, meals, totals, onTarget: Math.abs(totals.calories - plan.target.calories) / Math.max(1, plan.target.calories) <= 0.1 }
      setPlan(next)
      remember(next)
      feel.select()
    } catch (e) {
      setError((e as Error).message)
      feel.error()
    } finally {
      setSwapping(null)
    }
  }

  async function logMeals(meals: PlanMeal[]) {
    if (!meals.length) return
    const now = Date.now()
    const ids = await addEntries(
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
    )
    const liked = meals.flatMap((m) => m.items.map((i) => i.foodId)).filter((x): x is string => !!x)
    if (liked.length) void saveTaste(updateTaste(await loadTaste(), liked, 'liked'))
    feel.success()
    toast(`Logged ${meals.length > 1 ? 'the plan' : label(meals[0].meal)}`, { label: 'Undo', run: () => void deleteEntries(ids) })
  }

  const loggedNow = useMemo(() => new Set(eatenFood.map((e) => e.meal ?? 'snack')), [eatenFood])

  const shell = (children: React.ReactNode) => (
    <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false} style={{ backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 40, gap: 16 }}>
      {children}
    </ScrollView>
  )

  if (!saved || editing) {
    return shell(
      <>
        <View style={{ gap: 4 }}>
          <T variant="largeTitle">{saved ? 'Preferences' : 'How do you eat?'}</T>
          <T variant="callout" muted>
            {saved ? 'Changes apply to new plans.' : 'Tell me your diet and I will plan each day to match your calories and macros.'}
          </T>
        </View>
        <Card>
          <DietEditor
            initial={diet}
            prefillCuisines={!saved}
            saveLabel={saved ? 'Save preferences' : 'Save and plan my day'}
            onSave={(p) => {
              void saveDiet(p)
              setEditing(false)
              feel.success()
            }}
          />
        </Card>
        {saved && <SecondaryButton title="Cancel" onPress={() => setEditing(false)} />}
      </>,
    )
  }

  return shell(
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="largeTitle">Meal plan</T>
          <T variant="callout" muted>
            Today · {longDate(date)}
          </T>
        </View>
        <Chip icon="options-outline" label="Preferences" onPress={() => setEditing(true)} />
      </View>

      <Card style={{ gap: 14 }}>
        <View style={{ gap: 6 }}>
          <View style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: isOverride ? t.card2 : t.accentSoft }}>
            <T variant="callout" color={isOverride ? 'text' : 'accentStrong'}>
              {dietLabel(todaysDiet)} {isOverride ? 'day' : ''}
            </T>
          </View>
          <T variant="caption" muted>
            {summarizeDiet(diet)}
            {diet.allergies.length ? `  ·  Avoiding: ${diet.allergies.join(', ')}` : ''}
          </T>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Whole day" selected={mode === 'day'} onPress={() => { feel.select(); setMode('day') }} />
          <Chip label="Rest of today" selected={mode === 'rest'} onPress={() => { feel.select(); setMode('rest') }} />
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(
            [
              [target.calories.toLocaleString(), mode === 'rest' ? 'kcal left' : 'kcal goal'],
              [`${target.protein}g`, 'protein'],
              [`${target.carbs}g`, 'carbs'],
              [`${target.fat}g`, 'fat'],
            ] as const
          ).map(([v, l]) => (
            <View key={l} style={{ flex: 1, backgroundColor: t.card2, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' }}>
              <T variant="headline" style={{ fontVariant: ['tabular-nums'] }}>
                {v}
              </T>
              <T variant="caption" muted style={{ fontSize: 11 }}>
                {l}
              </T>
            </View>
          ))}
        </View>

        {mealsToPlan.length === 0 ? (
          <T variant="body" muted>
            No meals left to plan today. Switch to “Whole day”, or check back tomorrow.
          </T>
        ) : (
          <View style={{ gap: 10 }}>
            <PrimaryButton title={plan ? 'Plan again' : mode === 'rest' ? 'Plan the rest of today' : 'Plan my day'} icon="sparkles" loading={busy} disabled={swapping !== null} onPress={() => void generate()} />
            <SecondaryButton title="Try AI suggestions" icon="chatbubble-ellipses-outline" onPress={() => void generateWithAi()} />
            {mode === 'rest' && (
              <T variant="caption" muted>
                Planning: {mealsToPlan.map(label).join(', ')}
              </T>
            )}
          </View>
        )}
      </Card>

      {error ? (
        <T variant="callout" color="over">
          {error}
        </T>
      ) : null}
      {notice ? (
        <T variant="caption" muted>
          {notice}
        </T>
      ) : null}

      {busy && (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="sparkles" size={14} color={t.accent} />
            <T variant="callout" color="accentStrong">
              {PHASES[phase]}
            </T>
          </View>
          <Skeleton />
          <Skeleton />
        </View>
      )}

      {plan && !busy && (
        <>
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T variant="headline">Plan totals</T>
              <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: plan.onTarget ? t.accentSoft : t.card2 }}>
                <T variant="caption" style={{ color: plan.onTarget ? t.good : t.over }}>
                  {plan.onTarget ? 'On target' : `${plan.totals.calories - plan.target.calories > 0 ? '+' : ''}${plan.totals.calories - plan.target.calories} kcal vs target`}
                </T>
              </View>
            </View>
            <Bar name="Calories" value={plan.totals.calories} goal={plan.target.calories} color={t.accent} unit="" />
            <Bar name="Protein" value={plan.totals.protein} goal={plan.target.protein} color={t.protein} />
            <Bar name="Carbs" value={plan.totals.carbs} goal={plan.target.carbs} color={t.carbs} />
            <Bar name="Fat" value={plan.totals.fat} goal={plan.target.fat} color={t.fat} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name={plan.meta.engine === 'llm' ? 'chatbubble-ellipses-outline' : 'sparkles'} size={12} color={t.muted} />
              <T variant="caption" muted>
                {engineName(plan.meta.engine)}
                {plan.meta.engine === 'catalog' || plan.meta.engine === 'hybrid' ? ` · built on your phone in ${Math.max(1, Math.round(plan.meta.ms))} ms` : ''}
              </T>
            </View>
            <PrimaryButton title="Log everything" icon="add" onPress={() => void logMeals(plan.meals.filter((m) => !loggedNow.has(m.meal)))} />
          </Card>

          {plan.meals.map((m) => (
            <Card key={m.meal} style={{ gap: 4, borderLeftWidth: 4, borderLeftColor: mealColor[m.meal] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Dot color={mealColor[m.meal]} />
                  <T variant="headline">{label(m.meal)}</T>
                </View>
                <T variant="caption" muted>
                  {m.totals.calories} kcal · P {m.totals.protein} · C {m.totals.carbs} · F {m.totals.fat}
                </T>
              </View>
              {m.items.map((it, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line }}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <T variant="callout" style={{ fontWeight: '600' }}>
                      {it.name}
                    </T>
                    <T variant="caption" muted>
                      {it.quantity}
                    </T>
                    {it.reasons && it.reasons.length > 0 ? (
                      <T variant="caption" color="accentStrong" style={{ fontSize: 12 }}>
                        {it.reasons.join(' · ')}
                      </T>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <T variant="callout" style={{ fontVariant: ['tabular-nums'] }}>
                      {it.calories}
                    </T>
                    <T variant="caption" muted style={{ fontSize: 11 }}>
                      P {it.protein_g} · C {it.carbs_g} · F {it.fat_g}
                    </T>
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <PrimaryButton title="Log this meal" icon="add" onPress={() => void logMeals([m])} style={{ flex: 1 }} />
                <SecondaryButton title={swapping === m.meal ? 'Swapping…' : 'Swap'} icon="swap-horizontal" onPress={() => void swap(m)} />
              </View>
            </Card>
          ))}

          {plan.tips.length > 0 && (
            <Card style={{ gap: 8 }}>
              <T variant="headline">Good to know</T>
              {plan.tips.map((tip, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                  <T variant="body" muted>
                    •
                  </T>
                  <T variant="body" style={{ flex: 1 }}>
                    {tip}
                  </T>
                </View>
              ))}
              <T variant="caption" muted>
                Numbers are estimates, and this is not medical advice. Always check ingredients against your allergies.
              </T>
            </Card>
          )}
        </>
      )}

      {!plan && !busy && mealsToPlan.length > 0 && !error && (
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
          <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="restaurant" size={26} color={t.accent} />
          </View>
          <T variant="title">Ready when you are</T>
          <T variant="body" muted style={{ textAlign: 'center' }}>
            I will suggest meals that match your {dietLabel(todaysDiet).toLowerCase()} diet and hit your calories and macros.
          </T>
        </Card>
      )}
    </>,
  )
}
