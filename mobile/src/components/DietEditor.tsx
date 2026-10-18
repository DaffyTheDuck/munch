import { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { CUISINES, DIETS, WEEKDAYS, cuisinesForRegion, detectRegion, dietLabel, normalizeDiet, type DietPrefs, type DietType } from '@shared/diet'
import { font, radius, useTheme } from '@/theme'
import { feel } from '@/lib/feel'
import { Chip, IconButton, Press, PrimaryButton, SecondaryButton, T } from './ui'

interface Rule {
  diet: DietType
  days: number[]
}

const toRules = (p: DietPrefs): Rule[] => {
  const by = new Map<DietType, number[]>()
  for (const [k, v] of Object.entries(p.overrides)) by.set(v as DietType, [...(by.get(v as DietType) ?? []), Number(k)])
  return [...by].map(([diet, days]) => ({ diet, days: days.sort((a, b) => a - b) }))
}

const fromRules = (rules: Rule[]): Partial<Record<number, DietType>> => {
  const out: Partial<Record<number, DietType>> = {}
  for (const r of rules) for (const d of r.days) out[d] = r.diet
  return out
}

const ALLERGY_SUGGESTIONS = ['nuts', 'peanuts', 'dairy', 'eggs', 'gluten', 'soy', 'shellfish', 'sesame']

function TagInput({ label, hint, value, onChange, suggestions }: { label: string; hint: string; value: string[]; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const t = useTheme()
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(false)
  const add = (raw: string) => {
    const v = raw.trim().toLowerCase()
    if (v && !value.includes(v) && value.length < 20) {
      feel.select()
      onChange([...value, v])
    }
    setText('')
  }
  return (
    <View style={{ gap: 8 }}>
      <T variant="caption" muted style={{ fontFamily: font.semibold }}>
        {label}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 8, minHeight: 48, borderRadius: radius.md, backgroundColor: t.card2, borderWidth: 1.5, borderColor: focus ? t.accent : 'transparent' }}>
        {value.map((x) => (
          <Press key={x} onPress={() => onChange(value.filter((y) => y !== x))} accessibilityLabel={`Remove ${x}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 30, borderRadius: radius.pill, backgroundColor: t.accentSoft }}>
            <T variant="callout" color="accentStrong">
              {x}
            </T>
            <Ionicons name="close" size={13} color={t.accentStrong} />
          </Press>
        ))}
        <TextInput
          value={text}
          onChangeText={(s) => (s.endsWith(',') ? add(s.slice(0, -1)) : setText(s))}
          onSubmitEditing={() => add(text)}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false)
            add(text)
          }}
          blurOnSubmit={false}
          placeholder={value.length ? '' : hint}
          placeholderTextColor={t.muted}
          selectionColor={t.accent}
          cursorColor={t.accent}
          autoCapitalize="none"
          style={{ flex: 1, minWidth: 130, fontFamily: font.regular, fontSize: 15, color: t.text, paddingVertical: 6 }}
        />
      </View>
      {suggestions && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <Chip key={s} icon="add" label={s} onPress={() => add(s)} />
            ))}
        </View>
      )}
    </View>
  )
}

function regionName(code: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

interface Props {
  initial: DietPrefs
  saveLabel: string
  onSave: (p: DietPrefs) => void
  /** pre-select cuisines from the user's location (first-time setup) */
  prefillCuisines?: boolean
}

// Edits food preferences: diet, different diets on chosen weekdays, allergies, dislikes and cuisines.
export function DietEditor({ initial, saveLabel, onSave, prefillCuisines }: Props) {
  const t = useTheme()
  const opts = Intl.DateTimeFormat().resolvedOptions()
  const region = useMemo(() => detectRegion(opts.locale, opts.timeZone), [opts.locale, opts.timeZone])
  const suggested = useMemo(() => cuisinesForRegion(region), [region])

  const [base, setBase] = useState<DietType>(initial.base)
  const [rules, setRules] = useState<Rule[]>(toRules(initial))
  const [allergies, setAllergies] = useState(initial.allergies)
  const [dislikes, setDislikes] = useState(initial.dislikes)
  const [cuisines, setCuisines] = useState<string[]>(initial.cuisines.length || !prefillCuisines ? initial.cuisines : suggested)

  const otherDiets = DIETS.filter((d) => d.id !== base)

  const toggleDay = (ruleIdx: number, day: number) => {
    feel.select()
    setRules((rs) =>
      rs.map((r, i) =>
        i === ruleIdx
          ? { ...r, days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day].sort((a, b) => a - b) }
          : { ...r, days: r.days.filter((d) => d !== day) }, // a day can only follow one rule
      ),
    )
  }

  const draft = (): DietPrefs => normalizeDiet({ base, overrides: fromRules(rules.filter((r) => r.diet !== base)), allergies, dislikes, cuisines })

  return (
    <View style={{ gap: 22 }}>
      <View style={{ gap: 10 }}>
        <T variant="caption" muted style={{ fontFamily: font.semibold }}>
          How do you usually eat?
        </T>
        <View style={{ gap: 8 }}>
          {DIETS.map((d) => {
            const on = base === d.id
            return (
              <Press
                key={d.id}
                onPress={() => {
                  feel.select()
                  setBase(d.id)
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                haptic={false}
                style={{ padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accentSoft : t.card, gap: 2 }}
              >
                <T variant="headline">{d.label}</T>
                <T variant="caption" muted>
                  {d.blurb}
                </T>
              </Press>
            )
          })}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <T variant="caption" muted style={{ fontFamily: font.semibold }}>
          Different on some days?
        </T>
        <T variant="caption" muted>
          For example vegetarian most days but non-veg on Mon and Wed, or non-veg but vegetarian on Tue and Thu. Each day follows one rule.
        </T>
        {rules.map((r, i) => (
          <View key={i} style={{ gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: t.card2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T variant="callout">On these days I eat</T>
              <IconButton name="trash-outline" size={18} label="Remove rule" onPress={() => setRules((rs) => rs.filter((_, j) => j !== i))} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[...otherDiets, ...(otherDiets.some((d) => d.id === r.diet) ? [] : [{ id: r.diet, label: dietLabel(r.diet) }])].map((d) => (
                <Chip key={d.id} label={d.label} selected={r.diet === d.id} onPress={() => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, diet: d.id as DietType } : x)))} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {WEEKDAYS.map((w, d) => {
                const on = r.days.includes(d)
                return (
                  <Press key={w} onPress={() => toggleDay(i, d)} haptic={false} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={w} style={{ flex: 1, height: 42, borderRadius: radius.sm, borderWidth: 1.5, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : t.card, alignItems: 'center', justifyContent: 'center' }}>
                    <T variant="caption" style={{ fontFamily: font.semibold, color: on ? '#fff' : t.text, fontSize: 12 }}>
                      {w}
                    </T>
                  </Press>
                )
              })}
            </View>
          </View>
        ))}
        {rules.length < 3 && (
          <View style={{ alignSelf: 'flex-start' }}>
            <SecondaryButton title={rules.length ? 'Add another rule' : 'Add days'} icon="add" onPress={() => setRules((rs) => [...rs, { diet: otherDiets[0].id, days: [] }])} />
          </View>
        )}
      </View>

      <TagInput label="Allergies (never suggested)" hint="Type and press enter, e.g. peanuts" value={allergies} onChange={setAllergies} suggestions={ALLERGY_SUGGESTIONS} />
      <TagInput label="Foods you dislike" hint="e.g. mushroom, bitter gourd" value={dislikes} onChange={setDislikes} />

      <View style={{ gap: 10 }}>
        <T variant="caption" muted style={{ fontFamily: font.semibold }}>
          Cuisines you like
        </T>
        {suggested.length > 0 && !suggested.every((c) => cuisines.includes(c)) && (
          <Press onPress={() => setCuisines([...new Set([...cuisines, ...suggested])])} accessibilityRole="button">
            <T variant="caption" color="accentStrong" style={{ textDecorationLine: 'underline' }}>
              Based on your location ({regionName(region)}): add {suggested.map((c) => CUISINES.find((x) => x.id === c)?.label ?? c).join(' + ')}
            </T>
          </Press>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CUISINES.map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              selected={cuisines.includes(c.id)}
              onPress={() => {
                feel.select()
                setCuisines((cs) => (cs.includes(c.id) ? cs.filter((x) => x !== c.id) : [...cs, c.id]))
              }}
            />
          ))}
        </View>
        <T variant="caption" muted>
          Leave empty for anything. These only guide suggestions; you can still log any food.
        </T>
      </View>

      <PrimaryButton title={saveLabel} onPress={() => onSave(draft())} />
    </View>
  )
}
