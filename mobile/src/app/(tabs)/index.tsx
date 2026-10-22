import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated'
import { MEALS, addDays, autoMeal, longDate, prettyDate, todayStr } from '@shared/dates'
import type { AiItem, Entry, Meal } from '@shared/types'
import { resolveLocally } from '@shared/resolve'
import { buildHistory } from '@shared/recommend'
import { mealColor, radius, useTheme } from '@/theme'
import { addEntries, addEntry, deleteEntries, entriesBetween, entriesForDate, getHints, getSetting, hasSavedGoals, recentEntries, setSetting, useGoals, useLive } from '@/lib/db'
import { analyze, fetchUsage } from '@/lib/api'
import { feel } from '@/lib/feel'
import { makeThumb, pickImage, type Picked } from '@/lib/image'
import { useKeyboardLift, useCountUp, useTicker } from '@/lib/hooks'
import { Badge, Card, Chip, Dot, IconButton, Press, PrimaryButton, SecondaryButton, T } from '@/components/ui'
import { Ring } from '@/components/Ring'
import { EntryRow } from '@/components/EntryRow'
import { Composer } from '@/components/Composer'
import { Skeleton } from '@/components/Skeleton'
import { useToast } from '@/components/Toast'

const PHASES = ['Reading what you wrote…', 'Estimating portions…', 'Checking nutrition data…', 'Almost there…']
const EXAMPLES = ['two eggs on toast with coffee', 'dos tacos de carnitas', 'a bowl of ramen', 'ek plate poha aur chai', '30 min run']

const minDate = (a: string, b: string) => (a < b ? a : b)
const weekdayLetter = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })
const shortDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

const sum = (list: Entry[], k: 'calories' | 'protein' | 'carbs' | 'fat') => list.reduce((s, e) => s + e[k], 0)

function MacroBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  const t = useTheme()
  const w = useSharedValue(0)
  useEffect(() => {
    w.value = withTiming(Math.min(1, goal ? value / goal : 0), { duration: 800, easing: Easing.out(Easing.cubic) })
  }, [value, goal, w])
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }))
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T variant="callout">{label}</T>
        <T variant="caption" muted>
          {value} / {goal}g
        </T>
      </View>
      <View style={{ height: 7, borderRadius: 4, backgroundColor: t.card2, overflow: 'hidden' }}>
        <Animated.View style={[{ height: 7, borderRadius: 4, backgroundColor: color }, fill]} />
      </View>
    </View>
  )
}

export default function Today() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  useTicker()

  const [date, setDate] = useState(todayStr())
  const goals = useGoals()
  const entries = useLive(() => entriesForDate(date), [date], [] as Entry[])
  const recentRaw = useLive(() => recentEntries(), [], [] as Entry[])
  // The chart shows a fixed 7-day window. Picking a day highlights it; it never moves the window.
  const [weekEnd, setWeekEnd] = useState(todayStr())
  const weekStart = addDays(weekEnd, -6)
  useEffect(() => {
    // the day arrows can move the selected day out of view: bring its week into the window
    if (date < weekStart || date > weekEnd) setWeekEnd(minDate(todayStr(), addDays(date, 3)))
  }, [date, weekStart, weekEnd])
  const weekEntries = useLive(() => entriesBetween(weekStart, weekEnd), [weekStart, weekEnd], [] as Entry[])
  const goalsSaved = useLive(hasSavedGoals, [], true)
  const dismissed = useLive(() => getSetting('onboardDismissed'), [], '1' as string | null)

  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [mealOverride, setMealOverride] = useState<Meal | null>(null)
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [composerH, setComposerH] = useState(160)
  useEffect(() => {
    void fetchUsage() // keeps the shared allowance state (and its low-balance warning) current
  }, [])

  const inputRef = useRef<TextInput>(null)
  const composerWrap = useRef<View>(null)
  const lift = useKeyboardLift(composerWrap)

  useEffect(() => {
    if (!busy) return
    setPhase(0)
    const id = setInterval(() => setPhase((p) => Math.min(p + 1, PHASES.length - 1)), 1600)
    return () => clearInterval(id)
  }, [busy])

  const food = entries.filter((e) => e.kind === 'food')
  const activity = entries.filter((e) => e.kind === 'exercise')
  const eaten = { calories: sum(food, 'calories'), protein: sum(food, 'protein'), carbs: sum(food, 'carbs'), fat: sum(food, 'fat') }
  const burned = sum(activity, 'calories')
  const net = eaten.calories - burned
  const remaining = goals.calories - net
  const eatenShown = useCountUp(eaten.calories)
  const burnedShown = useCountUp(burned)

  const mealNow = mealOverride ?? autoMeal()
  const mealLabel = MEALS.find((m) => m.id === mealNow)?.label ?? ''
  const timeLabel = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const isToday = date === todayStr()

  const recent = useMemo(() => {
    const seen = new Set<string>()
    const out: Entry[] = []
    for (const e of recentRaw) {
      if (e.kind !== 'food') continue
      const k = e.name.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(e)
      if (out.length >= 8) break
    }
    return out
  }, [recentRaw])

  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const vals = days.map((d) => weekEntries.filter((e) => e.date === d).reduce((s, e) => s + (e.kind === 'food' ? e.calories : -e.calories), 0))
    const logged = vals.filter((v) => v > 0)
    return { days, vals, max: Math.max(goals.calories * 1.15, ...vals), avg: logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : 0 }
  }, [weekEntries, weekStart, goals.calories])

  async function submit() {
    const msg = text.trim()
    if ((!msg && !picked) || busy) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      // Resolution ladder: recognise what we can from your history and the catalog (free, instant, offline),
      // and send only the rest to the AI. Photos always go to the AI.
      const rows = await entriesBetween(addDays(todayStr(), -120), todayStr())
      const local = picked ? { items: [] as AiItem[], rest: msg } : resolveLocally(msg, buildHistory(rows, todayStr()))
      let result: { items: AiItem[]; note: string }
      if (picked || local.rest) {
        try {
          const ai = await analyze(local.rest || msg, picked?.dataUrl, await getHints(local.rest || msg))
          result = { items: [...local.items, ...ai.items], note: ai.note }
        } catch (e) {
          if (!local.items.length) throw e
          result = { items: local.items, note: `Added what I recognised. I could not understand “${local.rest}”: ${(e as Error).message}` }
        }
      } else {
        result = { items: local.items, note: `Matched ${local.items.length} item${local.items.length > 1 ? 's' : ''} from your history and the catalog. No AI used.` }
      }
      if (!result.items.length) {
        feel.warning()
        setNote(result.note || 'Nothing found to log. Try describing what you ate or did.')
        return
      }
      const thumb = picked ? await makeThumb(picked.uri) : undefined
      const meal = mealOverride ?? autoMeal() // read the clock at the moment of logging
      const now = Date.now()
      const ids = await addEntries(
        result.items.map((it, i) => ({
          date,
          createdAt: now + i,
          kind: it.type,
          meal: it.type === 'food' ? meal : undefined,
          name: it.name,
          quantity: it.quantity,
          grams: it.grams,
          source: it.source,
          match: it.match,
          calories: Math.round(it.calories),
          protein: Math.round(it.protein_g),
          carbs: Math.round(it.carbs_g),
          fat: Math.round(it.fat_g),
          photo: i === 0 ? thumb : undefined,
        })),
      )
      feel.success()
      setNote(result.note)
      setText('')
      setPicked(null)
      setHint('')
      setMealOverride(null)
      toast(`Added ${ids.length} item${ids.length > 1 ? 's' : ''}`, { label: 'Undo', run: () => void deleteEntries(ids) })
    } catch (e) {
      feel.error()
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function pick(source: 'camera' | 'library') {
    try {
      const p = await pickImage(source)
      if (p) {
        setPicked(p)
        feel.select()
      }
    } catch (e) {
      feel.warning()
      setError((e as Error).message)
    }
  }

  async function duplicate(e: Entry) {
    const { id: _id, ...rest } = e
    const id = await addEntry({ ...rest, createdAt: Date.now() })
    toast(`Duplicated ${e.name}`, { label: 'Undo', run: () => void deleteEntries([id]) })
  }

  async function remove(e: Entry) {
    const { id, ...rest } = e
    await deleteEntries([id!])
    toast(`Deleted ${e.name}`, { label: 'Undo', run: () => void addEntry(rest) })
  }

  async function relog(e: Entry) {
    const { id: _id, ...rest } = e
    const id = await addEntry({ ...rest, date, meal: mealOverride ?? autoMeal(), createdAt: Date.now() })
    feel.success()
    toast(`Added ${e.name}`, { label: 'Undo', run: () => void deleteEntries([id]) })
  }

  function startAdd(target: Meal | 'activity') {
    if (target === 'activity') setHint('e.g. “30 min run” or “1 hour yoga”')
    else {
      setMealOverride(target)
      setHint('')
    }
    inputRef.current?.focus()
  }

  const groups = [
    ...MEALS.map((m) => ({ id: m.id as string, label: m.label, meal: m.id as Meal | null, items: food.filter((e) => (e.meal ?? 'snack') === m.id) })),
    { id: 'activity', label: 'Activity', meal: null as Meal | null, items: activity },
  ]

  const showOnboard = goalsSaved === false && dismissed === null

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: composerH + 28, gap: 16 }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <Press onPress={() => setDate(todayStr())} haptic="select" accessibilityLabel={`${prettyDate(date)}. Tap to jump to today.`} scale={0.98}>
            <T variant="largeTitle">{prettyDate(date)}</T>
            <T variant="callout" muted>
              {longDate(date)}
            </T>
          </Press>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton name="settings-outline" label="Settings" haptic="select" onPress={() => router.push('/settings')} />
            <IconButton name="chevron-back" label="Previous day" haptic="select" onPress={() => setDate(addDays(date, -1))} />
            <IconButton name="chevron-forward" label="Next day" haptic="select" disabled={isToday} onPress={() => setDate(addDays(date, 1))} />
          </View>
        </View>

        {showOnboard && (
          <Card style={{ backgroundColor: t.accentSoft, borderColor: t.accent + '55', gap: 12 }}>
            <View style={{ gap: 4 }}>
              <T variant="headline">Set your daily goal</T>
              <T variant="caption" muted>
                Enter your target weight and get calories and macros worked out for you. About 20 seconds.
              </T>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PrimaryButton title="Set up goals" onPress={() => router.navigate('/goals')} style={{ flex: 1 }} />
              <SecondaryButton title="Later" onPress={() => void setSetting('onboardDismissed', '1')} />
            </View>
          </Card>
        )}

        {/* Summary */}
        <Card style={{ alignItems: 'center', gap: 18, paddingVertical: 22 }}>
          <Ring progress={goals.calories ? net / goals.calories : 0} remaining={remaining} />
          <View style={{ flexDirection: 'row', width: '100%', justifyContent: 'space-around', paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.line }}>
            {(
              [
                ['Eaten', eatenShown],
                ['Burned', burnedShown],
                ['Goal', goals.calories],
              ] as const
            ).map(([label, v]) => (
              <View key={label} style={{ alignItems: 'center' }}>
                <T variant="headline" style={{ fontVariant: ['tabular-nums'] }}>
                  {v.toLocaleString()}
                </T>
                <T variant="caption" muted>
                  {label}
                </T>
              </View>
            ))}
          </View>
          <View style={{ width: '100%', gap: 12 }}>
            <MacroBar label="Protein" value={eaten.protein} goal={goals.protein} color={t.protein} />
            <MacroBar label="Carbs" value={eaten.carbs} goal={goals.carbs} color={t.carbs} />
            <MacroBar label="Fat" value={eaten.fat} goal={goals.fat} color={t.fat} />
          </View>
        </Card>

        {/* Last 7 days */}
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <T variant="headline">{weekEnd === todayStr() ? 'Last 7 days' : `${shortDay(weekStart)} – ${shortDay(weekEnd)}`}</T>
              <T variant="caption" muted>
                {week.avg ? `avg ${week.avg.toLocaleString()} kcal · ` : ''}tap a day to open it
              </T>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <IconButton name="chevron-back" label="Previous week" haptic="select" size={20} onPress={() => setWeekEnd(addDays(weekEnd, -7))} />
              <IconButton name="chevron-forward" label="Next week" haptic="select" size={20} disabled={weekEnd >= todayStr()} onPress={() => setWeekEnd(minDate(todayStr(), addDays(weekEnd, 7)))} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, height: 108 }}>
            {week.days.map((d, i) => {
              const v = Math.max(0, week.vals[i])
              const sel = d === date
              return (
                <Press key={d} onPress={() => setDate(d)} haptic="select" accessibilityLabel={`${prettyDate(d)}, ${Math.round(v)} calories`} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <T variant="caption" style={{ fontSize: 10, fontVariant: ['tabular-nums'], color: sel ? t.text : t.muted }}>
                    {v > 0 ? Math.round(v) : ' '}
                  </T>
                  <View style={{ flex: 1, width: '100%', backgroundColor: t.card2, borderRadius: 8, justifyContent: 'flex-end', overflow: 'hidden' }}>
                    <View style={{ height: `${Math.min(100, (v / week.max) * 100)}%`, backgroundColor: v > goals.calories ? t.over : t.accent, opacity: sel ? 1 : 0.55, borderRadius: 8 }} />
                  </View>
                  <T variant="caption" style={{ fontSize: 11, fontFamily: sel ? 'DMSans_700Bold' : 'DMSans_400Regular', color: sel ? t.text : t.muted }}>
                    {weekdayLetter(d)}
                  </T>
                </Press>
              )
            })}
          </View>
        </Card>

        {/* Log again */}
        {recent.length > 0 && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="repeat" size={14} color={t.muted} />
              <T variant="caption" muted>
                Log again · adds to {mealLabel.toLowerCase()}
              </T>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
              {recent.map((e) => (
                <Chip key={e.id} icon="add" label={e.name.replace(/\s*\(.*\)/, '')} trailing={String(e.calories)} onPress={() => void relog(e)} />
              ))}
            </ScrollView>
          </View>
        )}

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

        {entries.length === 0 && !busy && (
          <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
            <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="sparkles" size={26} color={t.accent} />
            </View>
            <T variant="title">Nothing logged yet</T>
            <T variant="body" muted style={{ textAlign: 'center' }}>
              Describe a meal in any language or cuisine, or snap a photo. Try one of these:
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {EXAMPLES.map((x) => (
                <Chip
                  key={x}
                  label={x}
                  onPress={() => {
                    setText(x)
                    inputRef.current?.focus()
                  }}
                />
              ))}
            </View>
          </Card>
        )}

        {/* Meals */}
        {groups.map((g) => {
          const total = g.items.reduce((s, e) => s + e.calories, 0)
          const color = mealColor[g.id]
          return (
            <View key={g.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Dot color={color} />
                  <T variant="label" muted>
                    {g.label}
                  </T>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {g.items.length > 0 && (
                    <T variant="caption" muted>
                      {g.id === 'activity' ? '−' : ''}
                      {total} kcal
                    </T>
                  )}
                  <IconButton name="add" size={20} color={color} label={`Add to ${g.label}`} onPress={() => startAdd((g.meal ?? 'activity') as Meal | 'activity')} style={{ width: 34, height: 34, backgroundColor: color + '1f' }} />
                </View>
              </View>

              {g.items.length === 0 ? (
                <Press
                  onPress={() => startAdd((g.meal ?? 'activity') as Meal | 'activity')}
                  accessibilityLabel={g.meal ? `Add ${g.label.toLowerCase()}` : 'Add activity'}
                  style={{ height: 52, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color + '66', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
                >
                  <Ionicons name="add" size={16} color={t.muted} />
                  <T variant="callout" muted>
                    {g.meal ? `Add ${g.label.toLowerCase()}` : 'Add activity'}
                  </T>
                </Press>
              ) : (
                g.items.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    color={color}
                    onOpen={() => router.push({ pathname: '/entry/[id]', params: { id: String(e.id) } })}
                    onDuplicate={() => void duplicate(e)}
                    onDelete={() => void remove(e)}
                  />
                ))
              )}
            </View>
          )
        })}

        {food.length > 0 && (
          <T variant="caption" muted style={{ textAlign: 'center' }}>
            Swipe right to duplicate, left to delete. Tap to edit.
          </T>
        )}
      </ScrollView>

      {/* Composer, docked at the bottom and lifted above the keyboard */}
      <View
        ref={composerWrap}
        collapsable={false}
        onLayout={(e) => setComposerH(e.nativeEvent.layout.height)}
        style={{ position: 'absolute', left: 0, right: 0, bottom: lift, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 6 }}
      >
        {(error || note) && !busy ? (
          <T variant="caption" color={error ? 'over' : 'muted'} style={{ paddingHorizontal: 8, paddingBottom: 6 }}>
            {error || note}
          </T>
        ) : null}
        <Composer
          ref={inputRef}
          value={text}
          onChange={setText}
          imageUri={picked?.uri ?? null}
          onClearImage={() => setPicked(null)}
          onPick={(s) => void pick(s)}
          onSubmit={() => void submit()}
          busy={busy}
          placeholder={hint || 'What did you eat or do? Any language, or snap a photo…'}
          mealKey={mealNow}
          mealLabel={mealLabel}
          timeLabel={timeLabel}
          overridden={!!mealOverride}
          onClearMeal={() => setMealOverride(null)}
        />
      </View>
    </View>
  )
}
