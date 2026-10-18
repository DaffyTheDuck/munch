import { useEffect, useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { addDays, todayStr } from '@shared/dates'
import { ACTIVITY, PACES, buildPlan, type Profile } from '@shared/nutrition'
import type { Goals } from '@shared/types'
import { font, radius, useTheme } from '@/theme'
import { DEFAULT_GOALS, loadDiet, loadGoals, loadProfile, saveDiet, saveGoals, saveProfile, useLive } from '@/lib/db'
import { feel } from '@/lib/feel'
import { Card, Chip, IconButton, PrimaryButton, T } from '@/components/ui'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { useToast } from '@/components/Toast'
import { DietEditor } from '@/components/DietEditor'
import { summarizeDiet, DEFAULT_DIET } from '@shared/diet'

function NumField({ label, value, onChange, unit, decimal }: { label: string; value: number; onChange: (n: number) => void; unit?: string; decimal?: boolean }) {
  const t = useTheme()
  const [focus, setFocus] = useState(false)
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <T variant="caption" muted style={{ fontFamily: font.semibold }}>
        {label}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: radius.md, backgroundColor: t.card2, borderWidth: 1.5, borderColor: focus ? t.accent : 'transparent', paddingHorizontal: 14 }}>
        <TextInput
          value={raw ?? (value ? String(value) : '')}
          onChangeText={(s) => {
            setRaw(s)
            const n = Number(s.replace(',', '.'))
            onChange(Number.isFinite(n) ? n : 0)
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false)
            setRaw(null)
          }}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          selectTextOnFocus
          selectionColor={t.accent}
          cursorColor={t.accent}
          style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: t.text, paddingVertical: 10 }}
        />
        {unit ? (
          <T variant="caption" muted>
            {unit}
          </T>
        ) : null}
      </View>
    </View>
  )
}

const shortActivity = (label: string) => label.split(' (')[0]
const shortPace = (label: string) => label.split(' (')[0]

export default function GoalsScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const diet = useLive(loadDiet, [], DEFAULT_DIET)
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS)
  const [saved, setSaved] = useState<Goals>(DEFAULT_GOALS)
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    void loadGoals().then((g) => {
      setGoals(g)
      setSaved(g)
    })
    void loadProfile().then(setProfile)
  }, [])

  const plan = useMemo(() => (profile ? buildPlan(profile, goals.targetKg) : null), [profile, goals.targetKg])
  if (!profile || !plan) return <View style={{ flex: 1, backgroundColor: t.bg }} />

  const setP = <K extends keyof Profile>(k: K, v: Profile[K]) => setProfile({ ...profile, [k]: v })
  const dirty = JSON.stringify(goals) !== JSON.stringify(saved)
  const validProfile = profile.age > 0 && profile.heightCm > 0 && profile.weightKg > 0 && goals.targetKg > 0
  const finish = plan.weeks > 0 ? addDays(todayStr(), plan.weeks * 7) : ''
  const finishLabel = finish ? new Date(finish + 'T12:00:00').toDateString().slice(4) : ''

  async function apply() {
    const next = { ...goals, ...plan!.goals }
    setGoals(next)
    setSaved(next)
    await saveGoals(next)
    await saveProfile(profile!)
    feel.success()
    toast('Goals updated from your plan')
  }

  async function saveTargets() {
    await saveGoals(goals)
    await saveProfile(profile!)
    setSaved(goals)
    feel.success()
    toast('Goals saved')
  }

  return (
    <KeyboardScroll
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 48, gap: 16 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ gap: 4, flex: 1 }}>
          <T variant="largeTitle">Goals</T>
          <T variant="callout" muted>
            Daily targets and food preferences.
          </T>
        </View>
        <IconButton name="settings-outline" label="Settings" haptic="select" onPress={() => router.push('/settings')} />
      </View>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="restaurant" size={16} color={t.accent} />
          <T variant="headline">Food preferences</T>
        </View>
        <T variant="caption" muted>
          {summarizeDiet(diet)}
        </T>
        <DietEditor
          key={JSON.stringify(diet)}
          initial={diet}
          saveLabel="Save preferences"
          onSave={(p) => {
            void saveDiet(p)
            feel.success()
            toast('Food preferences saved')
          }}
        />
      </Card>

      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles" size={16} color={t.accent} />
          <T variant="headline">Auto-calculate from my target weight</T>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Male" selected={profile.sex === 'male'} onPress={() => { feel.select(); setP('sex', 'male') }} />
          <Chip label="Female" selected={profile.sex === 'female'} onPress={() => { feel.select(); setP('sex', 'female') }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <NumField label="Age" value={profile.age} onChange={(n) => setP('age', n)} />
          <NumField label="Height" unit="cm" value={profile.heightCm} onChange={(n) => setP('heightCm', n)} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <NumField label="Current weight" unit="kg" decimal value={profile.weightKg} onChange={(n) => setP('weightKg', n)} />
          <NumField label="Target weight" unit="kg" decimal value={goals.targetKg} onChange={(n) => setGoals({ ...goals, targetKg: n })} />
        </View>

        <View style={{ gap: 8 }}>
          <T variant="caption" muted style={{ fontFamily: font.semibold }}>
            Pace
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: plan.direction === 'maintain' ? 0.4 : 1 }}>
            {PACES.map((p) => (
              <Chip key={p.value} label={shortPace(p.label)} trailing={`${p.value} kg/wk`} selected={profile.pace === p.value} onPress={() => { feel.select(); setP('pace', p.value) }} />
            ))}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <T variant="caption" muted style={{ fontFamily: font.semibold }}>
            Activity level
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ACTIVITY.map((a) => (
              <Chip key={a.value} label={shortActivity(a.label)} selected={profile.activity === a.value} onPress={() => { feel.select(); setP('activity', a.value) }} />
            ))}
          </View>
        </View>

        {validProfile && (
          <View style={{ backgroundColor: t.accentSoft, borderRadius: radius.lg, padding: 16, gap: 12 }}>
            <View style={{ gap: 2 }}>
              <T variant="headline">{plan.direction === 'lose' ? 'Fat-loss plan' : plan.direction === 'gain' ? 'Weight-gain plan' : 'Maintenance plan'}</T>
              <T variant="caption" muted>
                You burn about {plan.tdee.toLocaleString()} kcal/day
                {plan.weeks > 0 ? ` · reach ${goals.targetKg} kg in ~${plan.weeks} weeks (${finishLabel})` : ''}
              </T>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(
                [
                  [plan.goals.calories.toLocaleString(), 'kcal', t.text],
                  [`${plan.goals.protein}g`, 'protein', t.protein],
                  [`${plan.goals.carbs}g`, 'carbs', t.carbs],
                  [`${plan.goals.fat}g`, 'fat', t.fat],
                ] as const
              ).map(([v, label, color]) => (
                <View key={label} style={{ flex: 1, backgroundColor: t.card, borderRadius: radius.md, alignItems: 'center', paddingVertical: 10 }}>
                  <T variant="headline" style={{ color, fontVariant: ['tabular-nums'] }}>
                    {v}
                  </T>
                  <T variant="caption" muted style={{ fontSize: 11 }}>
                    {label}
                  </T>
                </View>
              ))}
            </View>
            {plan.floorHit && (
              <T variant="caption" color="over">
                That pace would go below a safe minimum, so calories are held at the floor. Choose a slower pace or a closer target.
              </T>
            )}
            <T variant="caption" muted>
              An estimate using the Mifflin-St Jeor formula. Adjust after 2–3 weeks based on your actual weight trend.
            </T>
            <PrimaryButton title="Use these numbers" onPress={() => void apply()} />
          </View>
        )}
      </Card>

      <Card style={{ gap: 14 }}>
        <T variant="headline">Daily targets</T>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <NumField label="Calories" unit="kcal" value={goals.calories} onChange={(n) => setGoals({ ...goals, calories: n })} />
          <NumField label="Target weight" unit="kg" decimal value={goals.targetKg} onChange={(n) => setGoals({ ...goals, targetKg: n })} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <NumField label="Protein" unit="g" value={goals.protein} onChange={(n) => setGoals({ ...goals, protein: n })} />
          <NumField label="Carbs" unit="g" value={goals.carbs} onChange={(n) => setGoals({ ...goals, carbs: n })} />
          <NumField label="Fat" unit="g" value={goals.fat} onChange={(n) => setGoals({ ...goals, fat: n })} />
        </View>
        <PrimaryButton title="Save goals" disabled={!dirty} onPress={() => void saveTargets()} />
      </Card>

    </KeyboardScroll>
  )
}
