import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { addDays, todayStr } from '@shared/dates'
import { DEFAULT_DIET } from '@shared/diet'
import { buildPlan } from '@shared/nutrition'
import { weeklyReport, type Finding, type Severity, type WeeklyReport } from '@shared/insights'
import type { Entry, WeightEntry } from '@shared/types'
import { radius, useTheme } from '@/theme'
import { allWeights, entriesBetween, getSetting, loadDiet, loadProfile, setSetting, useGoals, useLive } from '@/lib/db'
import { explainReport } from '@/lib/api'
import { feel } from '@/lib/feel'
import { Card, PrimaryButton, T } from './ui'

const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h >>> 0)
}

function useSeverityColor() {
  const t = useTheme()
  return (s: Severity) => (s === 'high' ? t.over : s === 'medium' ? t.carbs : s === 'info' ? t.accent : t.muted)
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  const t = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: t.card2 }}>
      <T variant="headline" style={{ fontVariant: ['tabular-nums'], color: color ?? t.text }}>
        {value}
      </T>
      <T variant="caption" muted style={{ fontSize: 11, textAlign: 'center' }}>
        {label}
      </T>
    </View>
  )
}

function WeekBars({ report }: { report: WeeklyReport }) {
  const t = useTheme()
  const max = Math.max(report.goalKcal * 1.3, ...report.days.map((d) => d.eaten), 1)
  return (
    <View style={{ flexDirection: 'row', gap: 6, height: 84 }}>
      {report.days.map((d) => {
        const incomplete = d.entries > 0 && d.eaten < 800
        const over = d.eaten > report.goalKcal
        return (
          <View key={d.date} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={{ flex: 1, width: '100%', borderRadius: 8, backgroundColor: t.card2, justifyContent: 'flex-end', overflow: 'hidden' }}>
              <View style={{ height: `${Math.min(100, (d.eaten / max) * 100)}%`, backgroundColor: incomplete ? t.muted : over ? t.over : t.accent, opacity: d.entries ? 1 : 0.2, borderRadius: 8 }} />
            </View>
            <T variant="caption" muted style={{ fontSize: 11 }}>
              {new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}
            </T>
          </View>
        )
      })}
    </View>
  )
}

function FindingCard({ f }: { f: Finding }) {
  const t = useTheme()
  const color = useSeverityColor()(f.severity)
  return (
    <Card style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: color }}>
      <T variant="headline">{f.title}</T>
      <T variant="body" muted>
        {f.detail}
      </T>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 2 }}>
        <Ionicons name="arrow-forward-circle" size={16} color={t.accentStrong} style={{ marginTop: 2 }} />
        <T variant="body" style={{ flex: 1 }}>
          {f.fix}
        </T>
      </View>
    </Card>
  )
}

// The weekly analysis: what happened to your weight and why, from your own logs. Free and instant (no AI);
// an optional button asks the AI to phrase it in plain words.
export function Analysis() {
  const t = useTheme()
  const goals = useGoals()
  const today = todayStr()
  const entries = useLive(() => entriesBetween(addDays(today, -20), today), [today], [] as Entry[])
  const weights = useLive(allWeights, [], [] as WeightEntry[])
  const profile = useLive(loadProfile, [], null)
  const diet = useLive(loadDiet, [], DEFAULT_DIET)

  const report = useMemo(() => {
    const valid = profile && profile.age > 0 && profile.heightCm > 0 && profile.weightKg > 0
    const tdee = valid ? buildPlan(profile, goals.targetKg).tdee : null
    return weeklyReport({ today, entries, weights, goals, tdee, diet, pace: profile?.pace })
  }, [today, entries, weights, goals, profile, diet])

  const [story, setStory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reportKey = useMemo(() => `insight:${report.to}:${hash(JSON.stringify([report.verdict, report.findings.map((f) => f.id), report.avgEaten]))}`, [report])

  useEffect(() => {
    setStory('')
    setError('')
    void getSetting(reportKey).then((v) => v && setStory(v))
  }, [reportKey])

  async function explain() {
    setBusy(true)
    setError('')
    try {
      const body = {
        direction: report.direction,
        verdict: report.verdict,
        avgEaten: report.avgEaten,
        goalKcal: report.goalKcal,
        tdee: report.tdee,
        weight: { kgPerWeek: report.weight.kgPerWeek, changeKg: report.weight.changeKg, status: report.weight.status },
        balance: report.balance,
        findings: report.findings.slice(0, 8),
        swaps: report.swaps.map((s) => ({ from: s.from, to: s.to, savesPerWeek: s.savesPerWeek })),
        topItems: report.topItems.map((i) => ({ name: i.name, kcal: i.kcal })),
        targetKcal: report.targetKcal,
      }
      const r = await explainReport(body)
      setStory(r.text)
      await setSetting(reportKey, r.text)
      feel.success()
    } catch (e) {
      feel.error()
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!report.ready) {
    return (
      <Card style={{ gap: 8, alignItems: 'center', paddingVertical: 28 }}>
        <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="analytics" size={26} color={t.accent} />
        </View>
        <T variant="title">Your weekly analysis</T>
        <T variant="body" muted style={{ textAlign: 'center' }}>
          {report.notice}
        </T>
      </Card>
    )
  }

  const vColor = report.verdict.status === 'on-track' ? t.good : report.verdict.status === 'wrong-way' ? t.over : report.verdict.status === 'stalled' ? t.carbs : t.muted
  const vs = report.avgEaten - report.goalKcal
  const rate = report.weight.kgPerWeek
  const range = `${new Date(report.from + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(report.to + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`

  return (
    <>
      <Card style={{ gap: 12 }}>
        <T variant="caption" muted>
          {range}
        </T>
        <T variant="title" style={{ color: vColor }}>
          {report.verdict.headline}
        </T>
        <T variant="body" muted>
          {report.verdict.summary}
        </T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat value={report.avgEaten.toLocaleString()} label="avg kcal / day" />
          <Stat value={`${vs > 0 ? '+' : ''}${vs}`} label="vs your goal" color={vs > 0 ? t.over : t.good} />
          <Stat value={rate === null ? '–' : `${rate > 0 ? '+' : ''}${rate}`} label="kg / week" color={rate === null ? undefined : (report.direction === 'lose' ? rate < 0 : rate > 0) ? t.good : undefined} />
        </View>
        <WeekBars report={report} />
        {report.tdee !== null && report.balance.perDay !== null ? (
          <T variant="caption" muted>
            You burn about {report.balance.impliedMaintenance ?? report.tdee} kcal a day{report.balance.impliedMaintenance ? ' (worked out from your weight trend)' : ' (estimated)'}. Your gap was {report.balance.perDay > 0 ? '+' : ''}
            {report.balance.perDay} kcal a day.
          </T>
        ) : (
          <T variant="caption" muted>
            Fill in your age, height and weight in Goals to see how your intake compares with what you burn.
          </T>
        )}
      </Card>

      {report.actions.length > 0 && (
        <Card style={{ gap: 10, backgroundColor: t.accentSoft, borderColor: t.accent + '55' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="checkmark-done-circle" size={18} color={t.accentStrong} />
            <T variant="headline">What to do this week</T>
          </View>
          {report.actions.map((a, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <T variant="body" color="accentStrong" style={{ width: 18 }}>
                {i + 1}.
              </T>
              <T variant="body" style={{ flex: 1 }}>
                {a}
              </T>
            </View>
          ))}
        </Card>
      )}

      {report.findings.length > 0 && (
        <View style={{ gap: 10 }}>
          <T variant="label" muted style={{ paddingHorizontal: 4 }}>
            WHY
          </T>
          {report.findings.map((f) => (
            <FindingCard key={f.id} f={f} />
          ))}
        </View>
      )}

      {report.swaps.length > 0 && (
        <Card style={{ gap: 10 }}>
          <T variant="headline">Easy swaps from your own food</T>
          {report.swaps.map((s) => (
            <View key={s.from} style={{ gap: 2 }}>
              <T variant="callout" style={{ fontWeight: '600' }}>
                {s.from} → {s.to}
              </T>
              <T variant="caption" muted>
                {s.fromKcal} → {s.toKcal} kcal each, {s.timesPerWeek}× this week: saves about {s.savesPerWeek.toLocaleString()} kcal.
              </T>
            </View>
          ))}
        </Card>
      )}

      {report.topItems.length > 0 && (
        <Card style={{ gap: 8 }}>
          <T variant="headline">Where your calories came from</T>
          {report.topItems.map((i) => (
            <View key={i.name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <T variant="body" style={{ flex: 1 }} numberOfLines={1}>
                {i.name}
              </T>
              <T variant="caption" muted style={{ fontVariant: ['tabular-nums'] }}>
                {i.kcal.toLocaleString()} kcal · {Math.round(i.share * 100)}%
              </T>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles" size={16} color={t.accent} />
          <T variant="headline">In plain words</T>
        </View>
        {story ? (
          <T variant="body">{story}</T>
        ) : (
          <T variant="caption" muted>
            Ask the AI to explain this week in a few friendly sentences. It uses only the numbers above, and costs one AI action.
          </T>
        )}
        {error ? (
          <T variant="caption" color="over">
            {error}
          </T>
        ) : null}
        {!story && <PrimaryButton title={busy ? 'Thinking…' : 'Explain this week'} icon="sparkles" loading={busy} onPress={() => void explain()} />}
      </Card>

      <T variant="caption" muted style={{ textAlign: 'center' }}>
        Estimates from your own logs, not medical advice. Body weight naturally moves 1–2 kg day to day, so judge changes over 2–3 weeks.
      </T>
    </>
  )
}
