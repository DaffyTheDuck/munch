import { useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { MEALS } from '@shared/dates'
import type { Entry, Meal } from '@shared/types'
import { font, mealColor, radius, useTheme } from '@/theme'
import { addCorrection, addEntry, deleteEntries, getEntry, updateEntry } from '@/lib/db'
import { feel } from '@/lib/feel'
import { Chip, IconButton, Press, PrimaryButton, SecondaryButton, T } from '@/components/ui'
import { useToast } from '@/components/Toast'

function Field({ label, value, onChange, numeric, flex = 1 }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean; flex?: number }) {
  const t = useTheme()
  const [focus, setFocus] = useState(false)
  return (
    <View style={{ flex, gap: 6 }}>
      <T variant="caption" muted style={{ fontFamily: font.semibold }}>
        {label}
      </T>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        selectTextOnFocus
        selectionColor={t.accent}
        cursorColor={t.accent}
        style={{
          fontFamily: font.medium,
          fontSize: 16,
          color: t.text,
          minHeight: 48,
          paddingHorizontal: 14,
          borderRadius: radius.md,
          backgroundColor: t.card2,
          borderWidth: 1.5,
          borderColor: focus ? t.accent : 'transparent',
        }}
      />
    </View>
  )
}

const num = (v: string) => Math.max(0, Math.round(Number(v) || 0))

export default function EditEntry() {
  const t = useTheme()
  const toast = useToast()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [f, setF] = useState({ name: '', quantity: '', calories: '', protein: '', carbs: '', fat: '' })
  const [meal, setMeal] = useState<Meal>('snack')
  const [servings, setServings] = useState(1)
  const [manual, setManual] = useState(false) // true once you type into the calorie or macro fields

  useEffect(() => {
    void getEntry(Number(id)).then((e) => {
      if (!e) return router.back()
      setEntry(e)
      setServings(e.servings ?? 1)
      setMeal(e.meal ?? 'snack')
      setF({ name: e.name, quantity: e.quantity, calories: String(e.calories), protein: String(e.protein), carbs: String(e.carbs), fat: String(e.fat) })
    })
  }, [id])

  if (!entry) return <View style={{ flex: 1, backgroundColor: t.card }} />
  const isFood = entry.kind === 'food'
  const set = (k: keyof typeof f, nutrition = false) => (v: string) => {
    if (nutrition) setManual(true)
    setF((s) => ({ ...s, [k]: v }))
  }

  // The portion stepper rescales the numbers together. It is not a "correction", so the AI doesn't learn from it.
  function step(dir: 1 | -1) {
    const next = Math.max(0.5, servings + dir * 0.5)
    if (next === servings) return
    const r = next / servings
    feel.tap()
    setServings(next)
    setF((s) => ({
      ...s,
      calories: String(Math.round(num(s.calories) * r)),
      protein: String(Math.round(num(s.protein) * r)),
      carbs: String(Math.round(num(s.carbs) * r)),
      fat: String(Math.round(num(s.fat) * r)),
    }))
  }

  async function save() {
    const e = entry!
    const next = { name: f.name.trim() || e.name, quantity: f.quantity.trim(), calories: num(f.calories), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat) }
    const corrected = manual && (next.calories !== e.calories || next.protein !== e.protein || next.carbs !== e.carbs || next.fat !== e.fat)
    const ratio = servings / (e.servings ?? 1)
    await updateEntry(e.id!, {
      ...next,
      meal: isFood ? meal : e.meal,
      servings: servings === 1 ? undefined : servings,
      grams: e.grams ? Math.round(e.grams * ratio) : e.grams,
      ...(corrected ? { source: 'edited' as const } : {}),
    })
    if (isFood && corrected) {
      await addCorrection(next) // next time this food comes up, your numbers are used as a hint
      toast('Saved. I’ll remember this for next time.')
    }
    feel.success()
    router.back()
  }

  async function remove() {
    const { id: eid, ...rest } = entry!
    await deleteEntries([eid!])
    feel.press()
    router.back()
    toast(`Deleted ${entry!.name}`, { label: 'Undo', run: () => void addEntry(rest) })
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.card }}>
      <KeyboardScroll keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T variant="title">Edit {isFood ? 'food' : 'activity'}</T>
          <IconButton name="close" label="Close" onPress={() => router.back()} style={{ backgroundColor: t.card2, borderRadius: 22 }} />
        </View>

        <Field label="Name" value={f.name} onChange={set('name')} />
        <Field label="Quantity" value={f.quantity} onChange={set('quantity')} />

        {/* Portion stepper */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.card2, borderRadius: radius.md, padding: 6, paddingLeft: 16 }}>
          <View>
            <T variant="callout">Portion</T>
            <T variant="caption" muted>
              scales everything together
            </T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton name="remove" label="Smaller portion" onPress={() => step(-1)} haptic={false} disabled={servings <= 0.5} color={t.text} style={{ backgroundColor: t.card, borderRadius: 22 }} />
            <T variant="headline" style={{ minWidth: 56, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
              ×{servings}
            </T>
            <IconButton name="add" label="Bigger portion" onPress={() => step(1)} haptic={false} color={t.text} style={{ backgroundColor: t.card, borderRadius: 22 }} />
          </View>
        </View>

        <Field label={isFood ? 'Calories' : 'Calories burned'} value={f.calories} onChange={set('calories', true)} numeric />
        {isFood && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="Protein (g)" value={f.protein} onChange={set('protein', true)} numeric />
            <Field label="Carbs (g)" value={f.carbs} onChange={set('carbs', true)} numeric />
            <Field label="Fat (g)" value={f.fat} onChange={set('fat', true)} numeric />
          </View>
        )}

        {isFood && (
          <View style={{ gap: 8 }}>
            <T variant="caption" muted style={{ fontFamily: font.semibold }}>
              Meal
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {MEALS.map((m) => (
                <Chip
                  key={m.id}
                  label={m.label}
                  selected={meal === m.id}
                  onPress={() => {
                    feel.select()
                    setMeal(m.id)
                  }}
                />
              ))}
            </View>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
          <SecondaryButton title="Delete" icon="trash-outline" danger onPress={() => void remove()} />
          <PrimaryButton title="Save" onPress={() => void save()} style={{ flex: 1 }} />
        </View>
      </KeyboardScroll>
    </View>
  )
}
