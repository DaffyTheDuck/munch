import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { activityReport } from '@shared/activity'
import { foodFacts } from '@shared/foodinfo'
import type { Entry } from '@shared/types'
import { radius, useTheme } from '@/theme'
import { allWeights, getSetting, loadProfile, setSetting, useLive } from '@/lib/db'
import { fetchActivityDetails, fetchFoodDetails, type ActivityDetails, type FoodDetails } from '@/lib/api'
import { feel } from '@/lib/feel'
import { Card, PrimaryButton, T } from './ui'

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim()

/** Fetches a breakdown on demand, then keeps it on the phone so the same food or activity never costs again. */
function useCachedDetails<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setData(null)
    setError('')
    void getSetting(key).then((v) => {
      if (!v) return
      try {
        setData(JSON.parse(v) as T)
      } catch {
        /* a bad cache entry is simply ignored */
      }
    })
  }, [key])
  async function run() {
    setBusy(true)
    setError('')
    try {
      const d = await load()
      setData(d)
      await setSetting(key, JSON.stringify(d))
      feel.success()
    } catch (e) {
      feel.error()
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { data, busy, error, run }
}

function Pill({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' | 'warn' | 'good' }) {
  const t = useTheme()
  const bg = tone === 'accent' ? t.accentSoft : tone === 'warn' ? t.carbs + '26' : tone === 'good' ? t.good + '22' : t.card2
  const fg = tone === 'accent' ? t.accentStrong : tone === 'warn' ? t.carbs : tone === 'good' ? t.good : t.muted
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: bg }}>
      <T variant="caption" style={{ color: fg, fontSize: 12 }}>
        {label}
      </T>
    </View>
  )
}

function Bullets({ title, items, icon, color }: { title: string; items: string[]; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  if (!items.length) return null
  return (
    <View style={{ gap: 6 }}>
      <T variant="callout" style={{ fontWeight: '600' }}>
        {title}
      </T>
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Ionicons name={icon} size={15} color={color} style={{ marginTop: 3 }} />
          <T variant="body" style={{ flex: 1 }}>
            {x}
          </T>
        </View>
      ))}
    </View>
  )
}

function SplitBar({ e }: { e: Entry }) {
  const t = useTheme()
  const facts = foodFacts(e)
  const parts = [
    { k: 'Protein', g: e.protein, pct: facts.split.protein, color: t.protein },
    { k: 'Carbs', g: e.carbs, pct: facts.split.carbs, color: t.carbs },
    { k: 'Fat', g: e.fat, pct: facts.split.fat, color: t.fat },
  ]
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: t.card2 }}>
        {parts.map((p) => (
          <View key={p.k} style={{ flex: Math.max(p.pct, 0.0001), backgroundColor: p.color }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {parts.map((p) => (
          <View key={p.k} style={{ alignItems: 'center', flex: 1 }}>
            <T variant="headline" style={{ fontVariant: ['tabular-nums'], color: p.color }}>
              {p.g}g
            </T>
            <T variant="caption" muted style={{ fontSize: 11 }}>
              {p.k} · {p.pct}% of kcal
            </T>
          </View>
        ))}
      </View>
    </View>
  )
}

function FoodBreakdown({ e }: { e: Entry }) {
  const t = useTheme()
  const facts = useMemo(() => foodFacts(e), [e])
  const key = `food:${norm(e.name)}`
  const ai = useCachedDetails<FoodDetails>(key, async () => (await fetchFoodDetails({ name: e.name, quantity: e.quantity, calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat })).details)
  const chips = [...new Set([...facts.labels, ...facts.tags])]

  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 12 }}>
        <T variant="headline">Where the {e.calories} kcal come from</T>
        <SplitBar e={e} />
        {chips.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {chips.map((c) => (
              <Pill key={c} label={c} tone="accent" />
            ))}
          </View>
        )}
        {(facts.contains.length > 0 || facts.allergens.length > 0 || facts.fiber !== null) && (
          <View style={{ gap: 4 }}>
            {facts.fiber !== null && (
              <T variant="caption" muted>
                Fibre: about {facts.fiber} g per serving
              </T>
            )}
            {facts.contains.length > 0 && (
              <T variant="caption" muted>
                Contains: {facts.contains.join(', ')}
              </T>
            )}
            {facts.allergens.length > 0 && (
              <T variant="caption" color="over">
                Allergens: {facts.allergens.join(', ')}
              </T>
            )}
          </View>
        )}
        {facts.ingredients.length > 0 && !ai.data && (
          <T variant="caption" muted>
            Main ingredients: {facts.ingredients.join(', ')}
          </T>
        )}
      </Card>

      {ai.data ? (
        <Card style={{ gap: 14 }}>
          {ai.data.summary ? <T variant="body">{ai.data.summary}</T> : null}
          <View style={{ gap: 6 }}>
            <T variant="callout" style={{ fontWeight: '600' }}>
              What is in it
            </T>
            {ai.data.ingredients.map((g, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
                <T variant="body" style={{ flex: 1 }}>
                  {g.item}
                </T>
                <T variant="caption" muted>
                  {g.amount}
                </T>
              </View>
            ))}
            <T variant="caption" muted style={{ fontSize: 11 }}>
              Typical amounts, estimated. Your recipe may differ.
            </T>
          </View>
          <Bullets title="Good for" items={ai.data.benefits} icon="checkmark-circle" color={t.good} />
          {ai.data.nutrients.length > 0 && (
            <View style={{ gap: 6 }}>
              <T variant="callout" style={{ fontWeight: '600' }}>
                Notable nutrients
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {ai.data.nutrients.map((n) => (
                  <Pill key={n.name} label={n.name} />
                ))}
              </View>
              {ai.data.nutrients.map((n) => (
                <T key={n.name} variant="caption" muted>
                  {n.name}: {n.note}
                </T>
              ))}
            </View>
          )}
          <Bullets title="Keep in mind" items={ai.data.watchouts} icon="alert-circle" color={t.carbs} />
          {ai.data.lighter ? (
            <View style={{ backgroundColor: t.accentSoft, borderRadius: radius.md, padding: 12, gap: 4 }}>
              <T variant="callout" color="accentStrong" style={{ fontWeight: '600' }}>
                Make it lighter
              </T>
              <T variant="body">{ai.data.lighter}</T>
            </View>
          ) : null}
          <T variant="caption" muted style={{ fontSize: 11 }}>
            AI-written, general information, not medical advice.
          </T>
        </Card>
      ) : (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="sparkles" size={16} color={t.accent} />
            <T variant="headline">Ingredients and benefits</T>
          </View>
          <T variant="caption" muted>
            See what is typically in this dish, what it is good for, and what to watch. Costs one AI action, and is saved so it never costs again for the same food.
          </T>
          {ai.error ? (
            <T variant="caption" color="over">
              {ai.error}
            </T>
          ) : null}
          <PrimaryButton title={ai.busy ? 'Looking it up…' : 'Show breakdown'} icon="sparkles" loading={ai.busy} onPress={() => void ai.run()} />
        </Card>
      )}
    </View>
  )
}

function ActivityBreakdown({ e }: { e: Entry }) {
  const t = useTheme()
  const weights = useLive(allWeights, [], [])
  const profile = useLive(loadProfile, [], null)
  const weightKg = weights.length ? weights[weights.length - 1].kg : profile?.weightKg ?? null
  const r = useMemo(() => activityReport({ name: e.name, quantity: e.quantity, calories: e.calories, weightKg }), [e, weightKg])
  const ai = useCachedDetails<ActivityDetails>(`activity:${norm(e.name)}`, async () => (await fetchActivityDetails({ name: e.name, quantity: e.quantity, calories: e.calories })).details)

  const info = r.info
  const intensity = info?.intensity ?? ai.data?.intensity
  const muscles = info?.muscles ?? ai.data?.muscles ?? []
  const benefits = info?.benefits ?? ai.data?.benefits ?? []
  const tips = info?.tips ?? ai.data?.tips ?? []
  const verdictColor = r.verdict === 'high' ? t.carbs : r.verdict === 'plausible' ? t.good : t.muted
  const stats: [string, string][] = [
    [`${e.calories}`, 'kcal logged'],
    ...(r.minutes ? ([[r.minutes >= 60 ? `${Math.floor(r.minutes / 60)}h ${r.minutes % 60}m` : `${r.minutes} min`, 'duration']] as [string, string][]) : []),
    ...(r.kcalPerMinute !== null ? ([[`${r.kcalPerMinute}`, 'kcal / min']] as [string, string][]) : []),
    ...(r.paceMinPerKm !== null ? ([[`${r.paceMinPerKm}`, 'min / km']] as [string, string][]) : []),
  ]

  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <T variant="headline">{info?.label ?? e.name}</T>
          {intensity ? <Pill label={intensity === 'vigorous' ? 'Vigorous' : intensity === 'moderate' ? 'Moderate' : 'Light'} tone={intensity === 'vigorous' ? 'warn' : 'accent'} /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {stats.map(([v, l]) => (
            <View key={l} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: t.card2 }}>
              <T variant="headline" style={{ fontVariant: ['tabular-nums'] }}>
                {v}
              </T>
              <T variant="caption" muted style={{ fontSize: 11 }}>
                {l}
              </T>
            </View>
          ))}
        </View>
        {r.note ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Ionicons name={r.verdict === 'plausible' ? 'checkmark-circle' : r.verdict === 'high' ? 'alert-circle' : 'information-circle'} size={18} color={verdictColor} style={{ marginTop: 1 }} />
            <T variant="body" style={{ flex: 1 }}>
              {r.note}
            </T>
          </View>
        ) : null}
        {r.equivalents.length > 0 && (
          <T variant="caption" muted>
            Equal to about {r.equivalents.map((q) => `${q.count} ${q.label}`).join(' or ')} in calories.
          </T>
        )}
      </Card>

      {info || ai.data ? (
        <Card style={{ gap: 14 }}>
          {ai.data?.summary && !info ? <T variant="body">{ai.data.summary}</T> : null}
          {muscles.length > 0 && (
            <View style={{ gap: 6 }}>
              <T variant="callout" style={{ fontWeight: '600' }}>
                Works
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {muscles.map((m) => (
                  <Pill key={m} label={m} tone="accent" />
                ))}
              </View>
            </View>
          )}
          <Bullets title="Benefits" items={benefits} icon="checkmark-circle" color={t.good} />
          <Bullets title="Tips" items={tips} icon="bulb" color={t.carbs} />
          <T variant="caption" muted style={{ fontSize: 11 }}>
            Calories use the standard MET formula (intensity × your weight × time). Real burn varies with fitness and effort. General information, not medical advice.
          </T>
        </Card>
      ) : (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="sparkles" size={16} color={t.accent} />
            <T variant="headline">About this activity</T>
          </View>
          <T variant="caption" muted>
            This one is not in the built-in list. Ask the AI what it works and how to do it well. Costs one AI action and is saved.
          </T>
          {ai.error ? (
            <T variant="caption" color="over">
              {ai.error}
            </T>
          ) : null}
          <PrimaryButton title={ai.busy ? 'Looking it up…' : 'Learn about it'} icon="sparkles" loading={ai.busy} onPress={() => void ai.run()} />
        </Card>
      )}
    </View>
  )
}

// The "Details" view of the entry sheet: a breakdown of a logged food, or what an activity involves.
export function EntryDetails({ entry }: { entry: Entry }) {
  return entry.kind === 'food' ? <FoodBreakdown e={entry} /> : <ActivityBreakdown e={entry} />
}
