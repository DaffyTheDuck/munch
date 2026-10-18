import { useMemo, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Defs, G, Line, LinearGradient, Polygon, Polyline, Stop, Text as SvgText } from 'react-native-svg'
import { addDays, todayStr } from '@shared/dates'
import type { WeightEntry } from '@shared/types'
import { font, radius, useTheme } from '@/theme'
import { allWeights, deleteWeight, saveWeight, useGoals, useLive } from '@/lib/db'
import { feel } from '@/lib/feel'
import { Card, Chip, IconButton, PrimaryButton, T } from '@/components/ui'
import { useToast } from '@/components/Toast'

const RANGES = [
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
  { id: 0, label: 'All time' },
]

const W = 340
const H = 220
const L = 36
const B = 26

export default function Weight() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const goals = useGoals()
  const all = useLive(allWeights, [], [] as WeightEntry[])
  const [kg, setKg] = useState('')
  const [range, setRange] = useState(90)

  const current = all.length ? all[all.length - 1].kg : undefined
  const weights = useMemo(() => (range ? all.filter((w) => w.date >= addDays(todayStr(), -range)) : all), [all, range])
  const change = weights.length > 1 ? weights[weights.length - 1].kg - weights[0].kg : 0
  const toGo = current !== undefined ? current - goals.targetKg : undefined

  const step = (d: number) => {
    const base = kg !== '' ? Number(kg) : current ?? 70
    feel.tap()
    setKg((Math.round((base + d) * 10) / 10).toFixed(1))
  }

  async function add() {
    const n = Number(kg)
    if (!n || n <= 0) return
    await saveWeight(todayStr(), n)
    feel.success()
    setKg('')
    toast(`Saved ${n} kg for today`)
  }

  // chart geometry
  const vals = weights.map((w) => w.kg).concat(goals.targetKg)
  const lo = Math.floor(Math.min(...vals) - 1)
  const hi = Math.ceil(Math.max(...vals) + 1)
  const x = (i: number) => (weights.length < 2 ? (L + W) / 2 : L + (i * (W - L - 12)) / (weights.length - 1))
  const y = (v: number) => 12 + (1 - (v - lo) / (hi - lo || 1)) * (H - B - 12)
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  const line = weights.map((w, i) => `${x(i)},${y(w.kg)}`).join(' ')
  const area = weights.length > 1 ? `${x(0)},${H - B} ${line} ${x(weights.length - 1)},${H - B}` : ''

  const tiles: [string, string, string?][] = [
    [current !== undefined ? String(current) : '–', 'current kg'],
    [String(goals.targetKg), 'target kg'],
    [weights.length > 1 ? `${change > 0 ? '+' : ''}${change.toFixed(1)}` : '–', `change (${range ? range + 'd' : 'all'})`, change < 0 ? t.good : change > 0 ? t.over : undefined],
    [toGo !== undefined ? Math.abs(toGo).toFixed(1) : '–', toGo !== undefined && toGo < 0 ? 'kg below target' : 'kg to go'],
  ]

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 40, gap: 16 }}
    >
      <View style={{ gap: 4 }}>
        <T variant="largeTitle">Weight</T>
        <T variant="callout" muted>
          Log once a day. Mornings give the cleanest trend.
        </T>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {tiles.map(([value, label, color]) => (
          <Card key={label} style={{ width: '48%', flexGrow: 1, padding: 14, gap: 2 }}>
            <T variant="title" style={{ fontSize: 26, lineHeight: 32, fontVariant: ['tabular-nums'], color: color ?? t.text }}>
              {value}
            </T>
            <T variant="caption" muted>
              {label}
            </T>
          </Card>
        ))}
      </View>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {RANGES.map((r) => (
            <Chip
              key={r.id}
              label={r.label}
              selected={range === r.id}
              onPress={() => {
                feel.select()
                setRange(r.id)
              }}
            />
          ))}
        </View>
        {weights.length === 0 ? (
          <T variant="body" muted style={{ textAlign: 'center', paddingVertical: 28 }}>
            No weigh-ins in this range yet. Add today’s weight below.
          </T>
        ) : (
          <Svg width="100%" height={undefined} viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: W / H }}>
            <Defs>
              <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={t.accent} stopOpacity={0.3} />
                <Stop offset="1" stopColor={t.accent} stopOpacity={0} />
              </LinearGradient>
              <LinearGradient id="line" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={t.accent2} />
                <Stop offset="1" stopColor={t.accent} />
              </LinearGradient>
            </Defs>
            {ticks.map((v) => (
              <G key={v}>
                <Line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke={t.line} strokeWidth={1} />
                <SvgText x={L - 6} y={y(v) + 4} fontSize={10} fill={t.muted} textAnchor="end">
                  {v.toFixed(0)}
                </SvgText>
              </G>
            ))}
            <Line x1={L} x2={W} y1={y(goals.targetKg)} y2={y(goals.targetKg)} stroke={t.good} strokeWidth={1.5} strokeDasharray="5 5" />
            <SvgText x={W - 2} y={y(goals.targetKg) - 6} fontSize={10} fill={t.good} textAnchor="end">
              target
            </SvgText>
            {area ? <Polygon points={area} fill="url(#area)" /> : null}
            <Polyline points={line} fill="none" stroke="url(#line)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {weights.map((w, i) => (
              <Circle key={w.id} cx={x(i)} cy={y(w.kg)} r={4} fill={t.card} stroke={t.accent} strokeWidth={2.5} />
            ))}
            <SvgText x={x(0)} y={H - 8} fontSize={10} fill={t.muted} textAnchor={weights.length > 1 ? 'start' : 'middle'}>
              {weights[0].date.slice(5)}
            </SvgText>
            {weights.length > 1 && (
              <SvgText x={x(weights.length - 1)} y={H - 8} fontSize={10} fill={t.muted} textAnchor="end">
                {weights[weights.length - 1].date.slice(5)}
              </SvgText>
            )}
          </Svg>
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <T variant="callout" muted>
          Today’s weight (kg)
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton name="remove" label="Decrease by 0.1" onPress={() => step(-0.1)} haptic={false} color={t.text} style={{ backgroundColor: t.card2, borderRadius: 22 }} />
          <TextInput
            value={kg}
            onChangeText={setKg}
            keyboardType="decimal-pad"
            placeholder={current !== undefined ? String(current) : 'e.g. 72.4'}
            placeholderTextColor={t.muted}
            selectionColor={t.accent}
            cursorColor={t.accent}
            style={{ flex: 1, textAlign: 'center', fontFamily: font.bold, fontSize: 24, color: t.text, minHeight: 52, borderRadius: radius.md, backgroundColor: t.card2 }}
          />
          <IconButton name="add" label="Increase by 0.1" onPress={() => step(0.1)} haptic={false} color={t.text} style={{ backgroundColor: t.card2, borderRadius: 22 }} />
        </View>
        <PrimaryButton title="Save" icon="checkmark" onPress={() => void add()} disabled={!kg} />
      </Card>

      {all.length > 0 && (
        <Card style={{ gap: 4, paddingVertical: 8 }}>
          <T variant="headline" style={{ paddingVertical: 8 }}>
            History
          </T>
          {[...all].reverse().map((w, i, arr) => (
            <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line }}>
              <T variant="callout" muted style={{ flex: 1 }}>
                {new Date(w.date + 'T12:00:00').toDateString()}
              </T>
              <T variant="headline" style={{ fontVariant: ['tabular-nums'] }}>
                {w.kg} kg
              </T>
              <IconButton
                name="trash-outline"
                size={18}
                label={`Delete ${w.date}`}
                haptic="press"
                onPress={() => {
                  const { id: _id, ...rest } = w
                  void deleteWeight(w.id!)
                  toast('Weigh-in deleted', { label: 'Undo', run: () => void saveWeight(rest.date, rest.kg) })
                }}
              />
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  )
}
