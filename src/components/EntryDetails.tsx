import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, loadProfile } from '../db'
import { fetchActivityDetails, fetchFoodDetails, type ActivityDetails, type FoodDetails } from '../api'
import { activityReport } from '../../shared/activity'
import { foodFacts } from '../../shared/foodinfo'
import type { Entry } from '../types'
import Icon from './Icon'

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim()

/** Fetches a breakdown on demand, then keeps it in this browser so the same food or activity never costs again. */
function useCachedDetails<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    try {
      const v = localStorage.getItem(key)
      setData(v ? (JSON.parse(v) as T) : null)
    } catch {
      setData(null)
    }
  }, [key])
  async function run() {
    setBusy(true)
    setError('')
    try {
      const d = await load()
      setData(d)
      try {
        localStorage.setItem(key, JSON.stringify(d))
      } catch {
        /* storage full or unavailable: it still shows */
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { data, busy, error, run }
}

const Pill = ({ children, tone = '' }: { children: string; tone?: string }) => <span className={`dpill ${tone}`}>{children}</span>

function Bullets({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null
  return (
    <div className="dsec">
      <h4>{title}</h4>
      <ul className={`dlist ${tone}`}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  )
}

function FoodBreakdown({ e }: { e: Entry }) {
  const facts = useMemo(() => foodFacts(e), [e])
  const ai = useCachedDetails<FoodDetails>(`food:${norm(e.name)}`, async () => (await fetchFoodDetails({ name: e.name, quantity: e.quantity, calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat })).details)
  const chips = [...new Set([...facts.labels, ...facts.tags])]
  const parts = [
    { k: 'Protein', g: e.protein, pct: facts.split.protein, cls: 'p' },
    { k: 'Carbs', g: e.carbs, pct: facts.split.carbs, cls: 'c' },
    { k: 'Fat', g: e.fat, pct: facts.split.fat, cls: 'f' },
  ]
  return (
    <div className="details">
      <div className="dsec">
        <h4>Where the {e.calories} kcal come from</h4>
        <div className="splitbar" role="img" aria-label={parts.map((p) => `${p.k} ${p.pct}%`).join(', ')}>
          {parts.map((p) => (
            <i key={p.k} className={p.cls} style={{ flex: Math.max(p.pct, 0.0001) }} />
          ))}
        </div>
        <div className="splitlegend">
          {parts.map((p) => (
            <span key={p.k} className={p.cls}>
              <b>{p.g}g</b> {p.k} · {p.pct}%
            </span>
          ))}
        </div>
        {chips.length > 0 && (
          <div className="dpills">
            {chips.map((c) => (
              <Pill key={c} tone="accent">
                {c}
              </Pill>
            ))}
          </div>
        )}
        {facts.fiber !== null && <p className="muted small-text">Fibre: about {facts.fiber} g per serving</p>}
        {facts.contains.length > 0 && <p className="muted small-text">Contains: {facts.contains.join(', ')}</p>}
        {facts.allergens.length > 0 && <p className="small-text bad-text">Allergens: {facts.allergens.join(', ')}</p>}
        {facts.ingredients.length > 0 && !ai.data && <p className="muted small-text">Main ingredients: {facts.ingredients.join(', ')}</p>}
      </div>

      {ai.data ? (
        <>
          {ai.data.summary && <p>{ai.data.summary}</p>}
          <div className="dsec">
            <h4>What is in it</h4>
            <ul className="ingredients">
              {ai.data.ingredients.map((g, i) => (
                <li key={i}>
                  <span>{g.item}</span>
                  <span className="muted small-text">{g.amount}</span>
                </li>
              ))}
            </ul>
            <p className="muted small-text">Typical amounts, estimated. Your recipe may differ.</p>
          </div>
          <Bullets title="Good for" items={ai.data.benefits} tone="good" />
          {ai.data.nutrients.length > 0 && (
            <div className="dsec">
              <h4>Notable nutrients</h4>
              <ul className="dlist">
                {ai.data.nutrients.map((n) => (
                  <li key={n.name}>
                    <b>{n.name}</b>: {n.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Bullets title="Keep in mind" items={ai.data.watchouts} tone="warn" />
          {ai.data.lighter && (
            <div className="lighter">
              <b>Make it lighter</b>
              <span>{ai.data.lighter}</span>
            </div>
          )}
          <p className="muted small-text">AI-written, general information, not medical advice.</p>
        </>
      ) : (
        <div className="dsec ask">
          <h4>
            <Icon name="sparkle" size={15} /> Ingredients and benefits
          </h4>
          <p className="muted small-text">See what is typically in this dish, what it is good for, and what to watch. Costs one AI action, and is saved so it never costs again for the same food.</p>
          {ai.error && <p className="small-text bad-text">{ai.error}</p>}
          <button type="button" className="btn primary" disabled={ai.busy} onClick={() => void ai.run()}>
            {ai.busy ? 'Looking it up…' : 'Show breakdown'}
          </button>
        </div>
      )}
    </div>
  )
}

function ActivityBreakdown({ e }: { e: Entry }) {
  const latest = useLiveQuery(() => db.weights.orderBy('date').last(), [])
  const weightKg = latest?.kg ?? loadProfile().weightKg ?? null
  const r = useMemo(() => activityReport({ name: e.name, quantity: e.quantity, calories: e.calories, weightKg }), [e, weightKg])
  const ai = useCachedDetails<ActivityDetails>(`activity:${norm(e.name)}`, async () => (await fetchActivityDetails({ name: e.name, quantity: e.quantity, calories: e.calories })).details)
  const info = r.info
  const intensity = info?.intensity ?? ai.data?.intensity
  const muscles = info?.muscles ?? ai.data?.muscles ?? []
  const benefits = info?.benefits ?? ai.data?.benefits ?? []
  const tips = info?.tips ?? ai.data?.tips ?? []
  const stats: [string, string][] = [
    [`${e.calories}`, 'kcal logged'],
    ...(r.minutes ? ([[r.minutes >= 60 ? `${Math.floor(r.minutes / 60)}h ${r.minutes % 60}m` : `${r.minutes} min`, 'duration']] as [string, string][]) : []),
    ...(r.kcalPerMinute !== null ? ([[`${r.kcalPerMinute}`, 'kcal / min']] as [string, string][]) : []),
    ...(r.paceMinPerKm !== null ? ([[`${r.paceMinPerKm}`, 'min / km']] as [string, string][]) : []),
  ]
  return (
    <div className="details">
      <div className="dsec">
        <h4>
          {info?.label ?? e.name} {intensity && <Pill tone={intensity === 'vigorous' ? 'warn' : 'accent'}>{intensity === 'vigorous' ? 'Vigorous' : intensity === 'moderate' ? 'Moderate' : 'Light'}</Pill>}
        </h4>
        <div className="dstats">
          {stats.map(([v, l]) => (
            <div key={l}>
              <b>{v}</b>
              <span>{l}</span>
            </div>
          ))}
        </div>
        {r.note && <p className={`dnote ${r.verdict}`}>{r.note}</p>}
        {r.equivalents.length > 0 && <p className="muted small-text">Equal to about {r.equivalents.map((q) => `${q.count} ${q.label}`).join(' or ')} in calories.</p>}
      </div>

      {info || ai.data ? (
        <>
          {ai.data?.summary && !info && <p>{ai.data.summary}</p>}
          {muscles.length > 0 && (
            <div className="dsec">
              <h4>Works</h4>
              <div className="dpills">
                {muscles.map((m) => (
                  <Pill key={m} tone="accent">
                    {m}
                  </Pill>
                ))}
              </div>
            </div>
          )}
          <Bullets title="Benefits" items={benefits} tone="good" />
          <Bullets title="Tips" items={tips} tone="warn" />
          <p className="muted small-text">Calories use the standard MET formula (intensity × your weight × time). Real burn varies with fitness and effort. General information, not medical advice.</p>
        </>
      ) : (
        <div className="dsec ask">
          <h4>
            <Icon name="sparkle" size={15} /> About this activity
          </h4>
          <p className="muted small-text">This one is not in the built-in list. Ask the AI what it works and how to do it well. Costs one AI action and is saved.</p>
          {ai.error && <p className="small-text bad-text">{ai.error}</p>}
          <button type="button" className="btn primary" disabled={ai.busy} onClick={() => void ai.run()}>
            {ai.busy ? 'Looking it up…' : 'Learn about it'}
          </button>
        </div>
      )}
    </div>
  )
}

// The "Details" view of the entry dialog: a breakdown of a logged food, or what an activity involves.
export default function EntryDetails({ entry }: { entry: Entry }) {
  return entry.kind === 'food' ? <FoodBreakdown e={entry} /> : <ActivityBreakdown e={entry} />
}
