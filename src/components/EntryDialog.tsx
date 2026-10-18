import { useEffect, useState } from 'react'
import { addCorrection, db, deleteEntries } from '../db'
import { MEALS } from '../util'
import type { Entry, Meal } from '../types'
import Icon from './Icon'
import { useToast } from './Toast'

export default function EntryDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({
    name: entry.name,
    quantity: entry.quantity,
    calories: String(entry.calories),
    protein: String(entry.protein),
    carbs: String(entry.carbs),
    fat: String(entry.fat),
    meal: (entry.meal ?? 'snack') as Meal,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0))
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }))
  const isFood = entry.kind === 'food'

  async function save() {
    const next = {
      name: f.name.trim() || entry.name,
      quantity: f.quantity.trim(),
      calories: num(f.calories),
      protein: num(f.protein),
      carbs: num(f.carbs),
      fat: num(f.fat),
    }
    const nutritionChanged =
      next.calories !== entry.calories || next.protein !== entry.protein || next.carbs !== entry.carbs || next.fat !== entry.fat
    await db.entries.update(entry.id!, { ...next, meal: f.meal, ...(nutritionChanged ? { source: 'edited' as const } : {}) })
    // Teach the AI: next time this food shows up, your numbers are used as a hint.
    if (isFood && nutritionChanged) {
      await addCorrection(next)
      toast('Saved. I’ll remember this for next time.')
    }
    onClose()
  }

  async function remove() {
    const copy = { ...entry }
    await deleteEntries([entry.id!])
    onClose()
    toast('Entry deleted', { label: 'Undo', run: () => void db.entries.add({ ...copy, id: undefined }) })
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Edit entry">
        <div className="dialog-head">
          <h2>Edit {isFood ? 'food' : 'activity'}</h2>
          <button className="ghost icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {entry.photo && <img className="dialog-photo" src={entry.photo} alt="" />}
        <label className="fld">
          <span>Name</span>
          <input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </label>
        <label className="fld">
          <span>Quantity</span>
          <input value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </label>
        <div className="fld-row">
          <label className="fld">
            <span>{isFood ? 'Calories' : 'Calories burned'}</span>
            <input type="number" inputMode="numeric" value={f.calories} onChange={(e) => set('calories', e.target.value)} />
          </label>
          {isFood && (
            <label className="fld">
              <span>Meal</span>
              <select value={f.meal} onChange={(e) => set('meal', e.target.value)}>
                {MEALS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {isFood && (
          <div className="fld-row three">
            <label className="fld">
              <span>Protein (g)</span>
              <input type="number" inputMode="numeric" value={f.protein} onChange={(e) => set('protein', e.target.value)} />
            </label>
            <label className="fld">
              <span>Carbs (g)</span>
              <input type="number" inputMode="numeric" value={f.carbs} onChange={(e) => set('carbs', e.target.value)} />
            </label>
            <label className="fld">
              <span>Fat (g)</span>
              <input type="number" inputMode="numeric" value={f.fat} onChange={(e) => set('fat', e.target.value)} />
            </label>
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn danger" onClick={remove}>
            <Icon name="trash" size={16} /> Delete
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
