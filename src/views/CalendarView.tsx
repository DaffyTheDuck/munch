import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, loadGoals, useSettingsVersion } from '../db'
import { todayStr } from '../util'
import Icon from '../components/Icon'

export default function CalendarView({ selected, onPick }: { selected: string; onPick: (d: string) => void }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(selected + 'T12:00:00')
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  useSettingsVersion()
  const goals = loadGoals()
  const all = useLiveQuery(() => db.entries.toArray(), []) ?? []

  const net = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of all) map[e.date] = (map[e.date] || 0) + (e.kind === 'food' ? e.calories : -e.calories)
    return map
  }, [all])

  const first = new Date(cursor.y, cursor.m, 1)
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells: (string | null)[] = Array(first.getDay()).fill(null)
  for (let d = 1; d <= days; d++) cells.push(todayStr(new Date(cursor.y, cursor.m, d)))

  const monthDays = cells.filter((d): d is string => !!d && net[d] !== undefined)
  const withinGoal = monthDays.filter((d) => net[d] <= goals.calories).length
  const avg = monthDays.length ? Math.round(monthDays.reduce((s, d) => s + net[d], 0) / monthDays.length) : 0

  const shift = (n: number) => {
    const d = new Date(cursor.y, cursor.m + n, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h1>
          <p className="muted">Tap a day to open its log.</p>
        </div>
        <div className="date-nav">
          <button className="ghost icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
            <Icon name="left" />
          </button>
          <button className="btn small" onClick={() => setCursor({ y: new Date().getFullYear(), m: new Date().getMonth() })}>
            This month
          </button>
          <button className="ghost icon-btn" onClick={() => shift(1)} aria-label="Next month">
            <Icon name="right" />
          </button>
        </div>
      </header>

      <div className="tiles">
        <div className="card tile">
          <b>{monthDays.length}</b>
          <span>days logged</span>
        </div>
        <div className="card tile">
          <b>{withinGoal}</b>
          <span>within goal</span>
        </div>
        <div className="card tile">
          <b>{avg ? avg.toLocaleString() : '–'}</b>
          <span>avg kcal / day</span>
        </div>
      </div>

      <section className="card">
        <div className="cal-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="dow">
              {d}
            </div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />
            const v = net[d]
            const cls = v === undefined ? '' : v > goals.calories ? 'over' : 'ok'
            return (
              <button
                key={d}
                disabled={d > todayStr()}
                style={{ '--i': i } as React.CSSProperties}
                className={`cell ${cls} ${d === todayStr() ? 'today' : ''} ${d === selected ? 'sel' : ''}`}
                onClick={() => onPick(d)}
              >
                <span className="cell-day">{Number(d.slice(8))}</span>
                {v !== undefined && <small>{Math.round(v).toLocaleString()}</small>}
              </button>
            )
          })}
        </div>
        <div className="legend muted small-text">
          <span><i className="sw ok" /> within goal</span>
          <span><i className="sw over" /> over goal</span>
          <span>Numbers are net kcal (eaten − burned).</span>
        </div>
      </section>
    </div>
  )
}
