import { useMemo, useState } from 'react'
import { CUISINES, DIETS, WEEKDAYS, cuisinesForRegion, detectRegion, dietLabel, normalizeDiet, type DietPrefs, type DietType } from '../../shared/diet'
import Icon from './Icon'

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
  const [text, setText] = useState('')
  const add = (t: string) => {
    const v = t.trim().toLowerCase()
    if (v && !value.includes(v) && value.length < 20) onChange([...value, v])
    setText('')
  }
  return (
    <div className="fld">
      <span>{label}</span>
      <div className="tag-box">
        {value.map((t) => (
          <button key={t} type="button" className="tag" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
            {t} <Icon name="x" size={12} />
          </button>
        ))}
        <input
          value={text}
          placeholder={value.length ? '' : hint}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => add(text)}
        />
      </div>
      {suggestions && (
        <div className="chips">
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <button key={s} type="button" className="chip" onClick={() => add(s)}>
                <Icon name="plus" size={12} /> {s}
              </button>
            ))}
        </div>
      )}
    </div>
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
  /** pre-select cuisines from the user's location (for first-time setup) */
  prefillCuisines?: boolean
}

// Edits food preferences: diet, different diets on chosen weekdays, allergies, dislikes and cuisines.
export default function DietEditor({ initial, saveLabel, onSave, prefillCuisines }: Props) {
  const region = useMemo(() => detectRegion(navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone), [])
  const suggested = useMemo(() => cuisinesForRegion(region), [region])

  const [base, setBase] = useState<DietType>(initial.base)
  const [rules, setRules] = useState<Rule[]>(toRules(initial))
  const [allergies, setAllergies] = useState(initial.allergies)
  const [dislikes, setDislikes] = useState(initial.dislikes)
  const [cuisines, setCuisines] = useState<string[]>(initial.cuisines.length || !prefillCuisines ? initial.cuisines : suggested)

  const otherDiets = DIETS.filter((d) => d.id !== base)

  const toggleDay = (ruleIdx: number, day: number) =>
    setRules((rs) =>
      rs.map((r, i) =>
        i === ruleIdx
          ? { ...r, days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day].sort((a, b) => a - b) }
          : { ...r, days: r.days.filter((d) => d !== day) }, // a day can only follow one rule
      ),
    )

  const draft = (): DietPrefs =>
    normalizeDiet({ base, overrides: fromRules(rules.filter((r) => r.diet !== base)), allergies, dislikes, cuisines })

  return (
    <div className="diet-editor">
      <div className="fld">
        <span>How do you usually eat?</span>
        <div className="diet-grid" role="radiogroup" aria-label="Diet">
          {DIETS.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={base === d.id} className={`diet-card ${base === d.id ? 'on' : ''}`} onClick={() => setBase(d.id)}>
              <b>{d.label}</b>
              <small>{d.blurb}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="fld">
        <span>Different on some days?</span>
        <p className="muted small-text">For example vegetarian most days but non-veg on Mon and Wed, or non-veg but vegetarian on Tue and Thu. Each day follows one rule.</p>
        {rules.map((r, i) => (
          <div key={i} className="rule">
            <div className="rule-head">
              <label className="rule-pick">
                <span className="muted small-text">On these days I eat</span>
                <select value={r.diet} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, diet: e.target.value as DietType } : x)))}>
                  {otherDiets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                  {!otherDiets.some((d) => d.id === r.diet) && <option value={r.diet}>{dietLabel(r.diet)}</option>}
                </select>
              </label>
              <button type="button" className="ghost icon-btn" aria-label="Remove rule" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                <Icon name="trash" size={16} />
              </button>
            </div>
            <div className="days" role="group" aria-label="Days">
              {WEEKDAYS.map((w, d) => (
                <button key={w} type="button" aria-pressed={r.days.includes(d)} className={`day ${r.days.includes(d) ? 'on' : ''}`} onClick={() => toggleDay(i, d)}>
                  {w}
                </button>
              ))}
            </div>
          </div>
        ))}
        {rules.length < 3 && (
          <button type="button" className="btn small add-rule" onClick={() => setRules((rs) => [...rs, { diet: otherDiets[0].id, days: [] }])}>
            <Icon name="plus" size={14} /> {rules.length ? 'Add another rule' : 'Add days'}
          </button>
        )}
      </div>

      <TagInput label="Allergies (never suggested)" hint="Type and press Enter, e.g. peanuts" value={allergies} onChange={setAllergies} suggestions={ALLERGY_SUGGESTIONS} />
      <TagInput label="Foods you dislike" hint="e.g. mushroom, bitter gourd" value={dislikes} onChange={setDislikes} />

      <div className="fld">
        <span>Cuisines you like</span>
        {suggested.length > 0 && !suggested.every((c) => cuisines.includes(c)) && (
          <p className="muted small-text">
            Based on your location ({regionName(region)}):{' '}
            <button type="button" className="link" onClick={() => setCuisines([...new Set([...cuisines, ...suggested])])}>
              add {suggested.map((c) => CUISINES.find((x) => x.id === c)?.label ?? c).join(' + ')}
            </button>
          </p>
        )}
        <div className="chips">
          {CUISINES.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={cuisines.includes(c.id)}
              className={`chip ${cuisines.includes(c.id) ? 'on' : ''}`}
              onClick={() => setCuisines((cs) => (cs.includes(c.id) ? cs.filter((x) => x !== c.id) : [...cs, c.id]))}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="muted small-text">Leave empty for anything. These only guide suggestions; you can still log any food.</p>
      </div>

      <div className="dialog-actions">
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={() => onSave(draft())}>
          {saveLabel}
        </button>
      </div>
    </div>
  )
}
