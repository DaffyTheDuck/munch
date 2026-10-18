import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteWeight, loadGoals, useSettingsVersion } from '../db'
import { addDays, todayStr } from '../util'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'

const RANGES: { id: number; label: string }[] = [
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
  { id: 0, label: 'All time' },
]

export default function WeightView() {
  const toast = useToast()
  useSettingsVersion()
  const all = useLiveQuery(() => db.weights.orderBy('date').toArray(), []) ?? []
  const goals = loadGoals()
  const [kg, setKg] = useState('')
  const [range, setRange] = useState(90)

  async function add() {
    const n = Number(kg)
    if (!n || n <= 0) return
    const date = todayStr()
    const existing = await db.weights.where('date').equals(date).first()
    if (existing) await db.weights.update(existing.id!, { kg: n })
    else await db.weights.add({ date, kg: n })
    setKg('')
    toast(`Saved ${n} kg for today`)
  }

  // +/- start from what you typed, or from your last weigh-in.
  const step = (d: number) => {
    const base = kg !== '' ? Number(kg) : all.at(-1)?.kg ?? 70
    setKg((Math.round((base + d) * 10) / 10).toFixed(1))
  }

  const weights = range ? all.filter((w) => w.date >= addDays(todayStr(), -range)) : all
  const current = all.at(-1)?.kg
  const change = weights.length > 1 ? weights.at(-1)!.kg - weights[0].kg : 0
  const toGo = current !== undefined ? current - goals.targetKg : undefined

  const W = 640
  const H = 240
  const L = 44
  const B = 28
  const vals = weights.map((w) => w.kg).concat(goals.targetKg)
  const lo = Math.floor(Math.min(...vals) - 1)
  const hi = Math.ceil(Math.max(...vals) + 1)
  const x = (i: number) => (weights.length < 2 ? (L + W) / 2 : L + (i * (W - L - 12)) / (weights.length - 1))
  const y = (v: number) => 12 + (1 - (v - lo) / (hi - lo || 1)) * (H - B - 12)
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  const line = weights.map((w, i) => `${x(i)},${y(w.kg)}`).join(' ')
  const area = weights.length > 1 ? `${x(0)},${H - B} ${line} ${x(weights.length - 1)},${H - B}` : ''

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Weight</h1>
          <p className="muted">Log once a day. Same time each morning gives the cleanest trend.</p>
        </div>
      </header>

      <div className="tiles">
        <div className="card tile">
          <b>{current ?? '–'}</b>
          <span>current kg</span>
        </div>
        <div className="card tile">
          <b>{goals.targetKg}</b>
          <span>target kg</span>
        </div>
        <div className="card tile">
          <b className={change < 0 ? 'good' : change > 0 ? 'bad' : ''}>{weights.length > 1 ? `${change > 0 ? '+' : ''}${change.toFixed(1)}` : '–'}</b>
          <span>change ({range ? `${range}d` : 'all'})</span>
        </div>
        <div className="card tile">
          <b>{toGo !== undefined ? Math.abs(toGo).toFixed(1) : '–'}</b>
          <span>{toGo !== undefined && toGo < 0 ? 'kg below target' : 'kg to go'}</span>
        </div>
      </div>

      <section className="card">
        <div className="card-title">
          <h3>Trend</h3>
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {weights.length === 0 ? (
          <p className="muted pad">No weigh-ins in this range yet. Add today’s weight below.</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Weight over time">
            <defs>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" style={{ stopColor: 'var(--accent-2)' }} />
                <stop offset="100%" style={{ stopColor: 'var(--accent)' }} />
              </linearGradient>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.28 }} />
                <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W} y1={y(t)} y2={y(t)} className="grid-line" />
                <text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">
                  {t.toFixed(0)}
                </text>
              </g>
            ))}
            <line x1={L} x2={W} y1={y(goals.targetKg)} y2={y(goals.targetKg)} className="target" />
            <text x={W - 4} y={y(goals.targetKg) - 6} textAnchor="end" className="axis tgt">
              target
            </text>
            {area && <polygon points={area} className="area" />}
            <polyline fill="none" className="line" points={line} pathLength={1} />
            {weights.map((w, i) => (
              <circle key={w.id} cx={x(i)} cy={y(w.kg)} r="4" className="dot" style={{ animationDelay: `${0.5 + Math.min(i, 30) * 0.02}s` }}>
                <title>{`${w.date}: ${w.kg} kg`}</title>
              </circle>
            ))}
            <text x={x(0)} y={H - 8} className="axis" textAnchor={weights.length > 1 ? 'start' : 'middle'}>
              {weights[0].date.slice(5)}
            </text>
            {weights.length > 1 && (
              <text x={x(weights.length - 1)} y={H - 8} className="axis" textAnchor="end">
                {weights.at(-1)!.date.slice(5)}
              </text>
            )}
          </svg>
        )}
      </section>

      <section className="card add-weight">
        <label className="fld">
          <span>Today’s weight (kg)</span>
          <span className="stepper">
            <button type="button" className="icon-btn" aria-label="Decrease by 0.1" onClick={() => step(-0.1)}>
              <Icon name="minus" size={16} />
            </button>
            <input type="number" step="0.1" inputMode="decimal" placeholder={current ? String(current) : 'e.g. 72.4'} value={kg} onChange={(e) => setKg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
            <button type="button" className="icon-btn" aria-label="Increase by 0.1" onClick={() => step(0.1)}>
              <Icon name="plus" size={16} />
            </button>
          </span>
        </label>
        <button className="btn primary" onClick={() => void add()} disabled={!kg}>
          <Icon name="plus" size={16} /> Save
        </button>
      </section>

      {all.length > 0 && (
        <section className="card">
          <div className="card-title">
            <h3>History</h3>
          </div>
          <div className="history">
            {[...all].reverse().map((w) => (
              <div key={w.id} className="hist-row">
                <span>{new Date(w.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <b>{w.kg} kg</b>
                <button className="ghost icon-btn" aria-label="Delete" onClick={() => void deleteWeight(w.id!)}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
