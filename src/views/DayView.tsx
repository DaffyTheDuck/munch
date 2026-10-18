import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCountUp } from '../hooks'
import { db, deleteEntries, getHints, loadGoals, useSettingsVersion } from '../db'
import { analyze, fetchUsage, type Usage } from '../api'
import { resolveLocally } from '../../shared/resolve'
import { buildHistory } from '../../shared/recommend'
import { MEALS, addDays, autoMeal, fileToResizedDataUrl, longDate, makeThumb, prettyDate, todayStr } from '../util'
import type { AiItem, Entry, Meal } from '../types'
import Icon from '../components/Icon'
import EntryDialog from '../components/EntryDialog'
import { useToast } from '../components/Toast'

const EXAMPLES = ['two eggs on toast with coffee', 'dos tacos de carnitas', 'a bowl of ramen', 'ek plate poha aur chai', '30 min run']
const PHASES = ['Reading what you wrote…', 'Estimating portions…', 'Checking nutrition data…', 'Almost there…']

type Totals = { calories: number; protein: number; carbs: number; fat: number }
const sumOf = (list: Entry[]): Totals =>
  list.reduce(
    (s, e) => ({ calories: s.calories + e.calories, protein: s.protein + e.protein, carbs: s.carbs + e.carbs, fat: s.fat + e.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )

export default function DayView({ date, setDate, onGoals }: { date: string; setDate: (d: string) => void; onGoals: () => void }) {
  const toast = useToast()
  useSettingsVersion() // re-render when goals change (e.g. edited on another device)
  const goals = loadGoals()
  const entries = useLiveQuery(() => db.entries.where('date').equals(date).sortBy('createdAt'), [date]) ?? []
  const recentRaw = useLiveQuery(() => db.entries.orderBy('createdAt').reverse().limit(120).toArray(), []) ?? []
  const weekStart = addDays(date, -6)
  const weekEntries = useLiveQuery(() => db.entries.where('date').between(weekStart, date, true, true).toArray(), [date]) ?? []

  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  // The meal comes from the user's clock. A "+ Add" slot overrides it for the next entry only.
  const [mealOverride, setMealOverride] = useState<Meal | null>(null)
  const [, setClock] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setClock((c) => c + 1), 15000)
    return () => clearInterval(id)
  }, [])
  const mealNow = mealOverride ?? autoMeal()
  const mealLabel = MEALS.find((m) => m.id === mealNow)?.label ?? ''
  const timeLabel = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) // user's local time
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [usage, setUsage] = useState<Usage | null>(null)
  useEffect(() => {
    void fetchUsage().then(setUsage)
  }, [])
  const [hint, setHint] = useState('')
  const [editing, setEditing] = useState<Entry | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overGroup, setOverGroup] = useState<string | null>(null)
  const [onboardOff, setOnboardOff] = useState(() => !!localStorage.getItem('onboardDismissed') || !!localStorage.getItem('goals'))
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)

  // Keyboard: "/" jumps to the box, arrows change day, "t" goes to today.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        inputRef.current?.focus()
      } else if (e.key === 'ArrowLeft') setDate(addDays(date, -1))
      else if (e.key === 'ArrowRight' && date < todayStr()) setDate(addDays(date, 1))
      else if (e.key.toLowerCase() === 't') setDate(todayStr())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [date, setDate])

  // Rotate progress messages while the AI works.
  useEffect(() => {
    if (!busy) return
    setPhase(0)
    const id = setInterval(() => setPhase((p) => Math.min(p + 1, PHASES.length - 1)), 1600)
    return () => clearInterval(id)
  }, [busy])

  const food = entries.filter((e) => e.kind === 'food')
  const activity = entries.filter((e) => e.kind === 'exercise')
  const eaten = sumOf(food)
  const burned = sumOf(activity).calories
  const net = eaten.calories - burned
  const remaining = goals.calories - net
  const over = remaining < 0
  const ringPct = Math.max(0, Math.min(1, goals.calories ? net / goals.calories : 0))
  const remainingShown = useCountUp(Math.abs(Math.round(remaining)))
  const eatenShown = useCountUp(eaten.calories)
  const burnedShown = useCountUp(burned)

  const recent = useMemo(() => {
    const seen = new Set<string>()
    const out: Entry[] = []
    for (const e of recentRaw) {
      if (e.kind !== 'food') continue
      const k = e.name.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(e)
      if (out.length >= 8) break
    }
    return out
  }, [recentRaw])

  async function submit(override?: string) {
    const msg = (override ?? text).trim()
    if ((!msg && !image) || busy) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      // Resolution ladder: recognise what we can from your history and the catalog (free, instant, offline),
      // and send only the rest to the AI. Photos always go to the AI.
      const rows = await db.entries.where('date').aboveOrEqual(addDays(todayStr(), -120)).toArray()
      const local = image ? { items: [] as AiItem[], rest: msg } : resolveLocally(msg, buildHistory(rows, todayStr()))
      let result: { items: AiItem[]; note: string }
      if (image || local.rest) {
        try {
          const ai = await analyze(local.rest || msg, image ?? undefined, await getHints(local.rest || msg))
          result = { items: [...local.items, ...ai.items], note: ai.note }
        } catch (e) {
          if (!local.items.length) throw e
          // the AI is unavailable (offline, out of quota): still log what we recognised
          result = { items: local.items, note: `Added what I recognised. I could not understand “${local.rest}”: ${(e as Error).message}` }
        }
      } else {
        result = { items: local.items, note: `Matched ${local.items.length} item${local.items.length > 1 ? 's' : ''} from your history and the catalog. No AI used.` }
      }
      if (!result.items.length) {
        setNote(result.note || 'Nothing found to log. Try describing what you ate or did.')
        return
      }
      const thumb = image ? await makeThumb(image) : undefined
      const now = Date.now()
      const meal = mealOverride ?? autoMeal() // read the clock at the moment of logging
      const keys = await db.entries.bulkAdd(
        result.items.map((it, i) => ({
          date,
          createdAt: now + i,
          kind: it.type,
          meal: it.type === 'food' ? meal : undefined,
          name: it.name,
          quantity: it.quantity,
          grams: it.grams,
          source: it.source,
          match: it.match,
          calories: Math.round(it.calories),
          protein: Math.round(it.protein_g),
          carbs: Math.round(it.carbs_g),
          fat: Math.round(it.fat_g),
          photo: i === 0 ? thumb : undefined,
        })),
        { allKeys: true },
      )
      setNote(result.note)
      setText('')
      setImage(null)
      setHint('')
      setMealOverride(null)
      toast(`Added ${result.items.length} item${result.items.length > 1 ? 's' : ''}`, {
        label: 'Undo',
        run: () => void deleteEntries(keys),
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      void fetchUsage().then(setUsage)
    }
  }

  async function relog(e: Entry) {
    const key = await db.entries.add({ ...e, id: undefined, cid: undefined, updatedAt: undefined, dirty: undefined, date, meal: mealOverride ?? autoMeal(), createdAt: Date.now() })
    toast(`Added ${e.name}`, { label: 'Undo', run: () => void deleteEntries([key]) })
  }

  async function duplicate(e: Entry) {
    const key = await db.entries.add({ ...e, id: undefined, cid: undefined, updatedAt: undefined, dirty: undefined, createdAt: Date.now() })
    toast(`Duplicated ${e.name}`, { label: 'Undo', run: () => void deleteEntries([key]) })
  }

  async function remove(e: Entry) {
    await deleteEntries([e.id!])
    toast(`Deleted ${e.name}`, { label: 'Undo', run: () => void db.entries.add({ ...e, id: undefined }) })
  }

  // Portion stepper: scales calories, macros and grams together. Does not count as a correction.
  async function rescale(e: Entry, dir: 1 | -1) {
    const cur = e.servings ?? 1
    const next = Math.max(0.5, cur + dir * 0.5)
    if (next === cur) return
    const r = next / cur
    await db.entries.update(e.id!, {
      servings: next,
      calories: Math.round(e.calories * r),
      protein: Math.round(e.protein * r),
      carbs: Math.round(e.carbs * r),
      fat: Math.round(e.fat * r),
      grams: e.grams ? Math.round(e.grams * r) : e.grams,
    })
  }

  async function moveTo(target: Meal, label: string) {
    const id = dragId
    setDragId(null)
    setOverGroup(null)
    const e = entries.find((x) => x.id === id)
    if (!e || e.kind !== 'food' || (e.meal ?? 'snack') === target) return
    const prev = e.meal
    await db.entries.update(e.id!, { meal: target })
    toast(`Moved to ${label}`, { label: 'Undo', run: () => void db.entries.update(e.id!, { meal: prev }) })
  }

  function startAdd(target: Meal | 'activity') {
    if (target === 'activity') setHint('e.g. “30 min run” or “1 hour yoga”')
    else {
      setMealOverride(target)
      setHint('')
    }
    inputRef.current?.focus()
  }

  async function takeFile(f?: File | null) {
    if (f && f.type.startsWith('image/')) setImage(await fileToResizedDataUrl(f))
  }

  const MEAL_COLOR: Record<string, string> = { breakfast: '#f59e0b', lunch: '#38bdf8', snack: '#f472b6', dinner: '#a78bfa', activity: '#fb923c' }
  const groups = [
    ...MEALS.map((m) => ({ id: m.id as string, label: m.label, meal: m.id as Meal | null, items: food.filter((e) => (e.meal ?? 'snack') === m.id) })),
    { id: 'activity', label: 'Activity', meal: null, items: activity },
  ]

  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const vals = days.map((d) => weekEntries.filter((e) => e.date === d).reduce((s, e) => s + (e.kind === 'food' ? e.calories : -e.calories), 0))
    const logged = vals.filter((v) => v > 0)
    return { days, vals, avg: logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : 0 }
  }, [weekEntries, weekStart])
  const weekMax = Math.max(goals.calories * 1.15, ...week.vals)

  const R = 64
  const C = 2 * Math.PI * R

  return (
    <div
      className="page"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const s = touch.current
        touch.current = null
        if (!s) return
        const dx = e.changedTouches[0].clientX - s.x
        const dy = e.changedTouches[0].clientY - s.y
        if (Math.abs(dx) > 80 && Math.abs(dy) < 40) {
          if (dx > 0) setDate(addDays(date, -1))
          else if (date < todayStr()) setDate(addDays(date, 1))
        }
      }}
    >
      <header className="page-head">
        <div>
          <h1>{prettyDate(date)}</h1>
          <p className="muted">{longDate(date)}</p>
        </div>
        <div className="date-nav">
          <button className="ghost icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" title="Previous day (←)">
            <Icon name="left" />
          </button>
          <label className="date-pick" title="Pick a date">
            <Icon name="calendar" size={16} />
            <input type="date" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <button className="ghost icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={date >= todayStr()} aria-label="Next day" title="Next day (→)">
            <Icon name="right" />
          </button>
          {date !== todayStr() && (
            <button className="btn small" onClick={() => setDate(todayStr())} title="Jump to today (T)">
              Today
            </button>
          )}
        </div>
      </header>

      {!onboardOff && (
        <div className="onboard card">
          <div>
            <b>Set your daily goal</b>
            <p className="muted small-text">Enter your target weight and get calories and macros calculated for you. Takes about 20 seconds.</p>
          </div>
          <div className="onboard-actions">
            <button className="btn primary" onClick={onGoals}>
              Set up goals
            </button>
            <button
              className="btn"
              onClick={() => {
                localStorage.setItem('onboardDismissed', '1')
                setOnboardOff(true)
              }}
            >
              Later
            </button>
          </div>
        </div>
      )}

      <div className="dash">
        <div className="col-left">
          <section className="card summary">
            <div className="ring-wrap">
              <svg viewBox="0 0 160 160" className="ring" role="img" aria-label={`${Math.abs(Math.round(remaining))} kcal ${over ? 'over' : 'remaining'}`}>
                <defs>
                  <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" style={{ stopColor: 'var(--accent)' }} />
                    <stop offset="100%" style={{ stopColor: 'var(--accent-2)' }} />
                  </linearGradient>
                </defs>
                <circle cx="80" cy="80" r={R} className="ring-bg" />
                <circle cx="80" cy="80" r={R} className={`ring-fg ${over ? 'over' : ''}`} strokeDasharray={`${C * ringPct} ${C}`} transform="rotate(-90 80 80)" />
              </svg>
              <div className="ring-center">
                <div className={`ring-num ${over ? 'over' : ''}`}>{remainingShown.toLocaleString()}</div>
                <div className="muted small-text">kcal {over ? 'over' : 'left'}</div>
              </div>
            </div>
            <div className="stat-row">
              <div>
                <b>{eatenShown.toLocaleString()}</b>
                <span>Eaten</span>
              </div>
              <div>
                <b>{burnedShown.toLocaleString()}</b>
                <span>Burned</span>
              </div>
              <div>
                <b>{goals.calories.toLocaleString()}</b>
                <span>Goal</span>
              </div>
            </div>
            <div className="macros">
              {(
                [
                  ['Protein', eaten.protein, goals.protein, 'var(--protein)'],
                  ['Carbs', eaten.carbs, goals.carbs, 'var(--carbs)'],
                  ['Fat', eaten.fat, goals.fat, 'var(--fat)'],
                ] as const
              ).map(([label, v, goal, color]) => (
                <div key={label} className="macro">
                  <div className="macro-top">
                    <span>{label}</span>
                    <span className="muted">
                      {v} / {goal}g
                    </span>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${Math.min(100, goal ? (v / goal) * 100 : 0)}%`, background: color }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card week">
            <div className="card-title">
              <h3>Last 7 days</h3>
              <span className="muted small-text">{week.avg ? `avg ${week.avg.toLocaleString()} kcal` : 'tap a bar to open a day'}</span>
            </div>
            <div className="bars">
              <div className="goal-line" style={{ bottom: `${(goals.calories / weekMax) * 100}%` }} />
              {week.days.map((d, i) => (
                <button key={d} className={`col ${d === date ? 'sel' : ''}`} onClick={() => setDate(d)} title={`${d}: ${Math.round(week.vals[i])} kcal`}>
                  <span className="col-bar">
                    <i className={week.vals[i] > goals.calories ? 'over' : ''} style={{ height: `${Math.max(0, (week.vals[i] / weekMax) * 100)}%` }} />
                  </span>
                  <small>{new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="col-right">
          <section
            className={`card composer ${dragging ? 'drag' : ''}`}
            onDragOver={(e) => {
              if (dragId != null) return
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              if (dragId != null) return
              e.preventDefault()
              setDragging(false)
              void takeFile(e.dataTransfer.files?.[0])
            }}
          >
            {image && (
              <div className="preview">
                <img src={image} alt="Selected food" />
                <button onClick={() => setImage(null)} aria-label="Remove photo">
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              disabled={busy}
              placeholder={hint || 'What did you eat or do? Any language or cuisine, or paste a photo…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submit()
                } else if (e.key === 'Escape') {
                  setText('')
                  setImage(null)
                  e.currentTarget.blur()
                }
              }}
              onPaste={(e) => {
                const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith('image/'))
                if (f) {
                  e.preventDefault()
                  void takeFile(f)
                }
              }}
            />
            <div className="composer-bar">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = '' }} />
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Icon name="camera" size={16} /> Photo
              </button>
              <span className={`meal-caption ${mealOverride ? 'custom' : ''}`} title={mealOverride ? 'Chosen from the meal slot. Click × to use your local time again.' : `Chosen automatically from your local time (${timeLabel})`}>
                <i className="meal-dot" style={{ '--meal': MEAL_COLOR[mealNow] } as React.CSSProperties} />
                {mealOverride ? `Adding to ${mealLabel}` : mealLabel}
                <span className="meal-time">{timeLabel}</span>
                {mealOverride && (
                  <button className="icon-btn sm" onClick={() => setMealOverride(null)} aria-label="Use my time instead" title="Use my time instead">
                    <Icon name="x" size={12} />
                  </button>
                )}
              </span>
              <span className="spacer" />
              <button className="btn primary" onClick={() => void submit()} disabled={busy || (!text.trim() && !image)}>
                {busy ? (
                  <>
                    <span className="spinner" /> Analyzing…
                  </>
                ) : (
                  <>
                    <Icon name="sparkle" size={16} /> Log it
                  </>
                )}
              </button>
            </div>
            <div className="composer-hint muted">
              <kbd>Enter</kbd> to log · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · paste or drop a photo · <kbd>/</kbd> to focus
              {usage?.enabled && !usage.unlimited && (
                <span className={`usage-chip ${(usage.remaining ?? 1) <= 5 ? 'low' : ''}`} title={usage.resetAt ? `Resets ${new Date(usage.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}>
                  <Icon name="sparkle" size={11} /> AI today {usage.used}/{usage.limit}
                </span>
              )}
            </div>
            {error && <div className="msg error">{error}</div>}
            {note && !error && <div className="msg">{note}</div>}
          </section>

          {recent.length > 0 && (
            <div className="recent">
              <span className="muted small-text">
                <Icon name="repeat" size={13} /> Log again · adds to {mealLabel.toLowerCase()}
              </span>
              <div className="chips">
                {recent.map((e) => (
                  <button key={e.id} className="chip" onClick={() => void relog(e)} title={`${e.quantity} · ${e.calories} kcal`}>
                    <Icon name="plus" size={12} />
                    {e.name.replace(/\s*\(.*\)/, '')}
                    <small>{e.calories}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {busy && (
            <div className="group">
              <div className="thinking">
                <Icon name="sparkle" size={14} /> <span key={phase}>{PHASES[phase]}</span>
              </div>
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          )}

          {entries.length === 0 && !busy && (
            <div className="empty card">
              <div className="empty-icon">
                <Icon name="sparkle" size={26} />
              </div>
              <h3>Nothing logged yet</h3>
              <p className="muted">Describe a meal in any language or cuisine, or drop in a photo. Try one of these:</p>
              <div className="chips center">
                {EXAMPLES.map((x) => (
                  <button
                    key={x}
                    className="chip"
                    onClick={() => {
                      setText(x)
                      inputRef.current?.focus()
                    }}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
          )}

          {groups.map((g) => {
            const total = g.items.reduce((s, e) => s + e.calories, 0)
            const droppable = g.meal !== null && dragId != null
            return (
              <section
                key={g.id}
                className={`group ${overGroup === g.id && droppable ? 'drop-target' : ''}`}
                style={{ '--meal': MEAL_COLOR[g.id] } as React.CSSProperties}
                onDragOver={(ev) => {
                  if (!droppable) return
                  ev.preventDefault()
                  setOverGroup(g.id)
                }}
                onDragLeave={(ev) => {
                  if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setOverGroup(null)
                }}
                onDrop={(ev) => {
                  ev.preventDefault()
                  if (g.meal) void moveTo(g.meal, g.label)
                }}
              >
                <div className="group-head">
                  <h3>
                    <i className="meal-dot" />
                    {g.label}
                  </h3>
                  <span className="group-meta">
                    {g.items.length > 0 && (
                      <span className="muted">
                        {g.id === 'activity' ? '−' : ''}
                        {total} kcal
                      </span>
                    )}
                    <button className="icon-btn add-btn" onClick={() => startAdd((g.meal ?? 'activity') as Meal | 'activity')} aria-label={`Add to ${g.label}`} title={`Add to ${g.label}`}>
                      <Icon name="plus" size={16} />
                    </button>
                  </span>
                </div>

                {g.items.length === 0 && (
                  <button className="add-row" onClick={() => startAdd((g.meal ?? 'activity') as Meal | 'activity')}>
                    <Icon name="plus" size={14} /> {g.meal ? `Add ${g.label.toLowerCase()}` : 'Add activity'}
                  </button>
                )}

                {g.items.map((e, idx) => (
                  <div
                    key={e.id}
                    style={{ '--i': idx } as React.CSSProperties}
                    className={`entry ${e.kind} ${Date.now() - e.createdAt < 4000 ? 'fresh' : ''} ${dragId === e.id ? 'dragging' : ''}`}
                    draggable={e.kind === 'food'}
                    onDragStart={(ev) => {
                      setDragId(e.id!)
                      ev.dataTransfer.effectAllowed = 'move'
                      ev.dataTransfer.setData('text/plain', String(e.id))
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverGroup(null)
                    }}
                    onClick={() => setEditing(e)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => ev.key === 'Enter' && setEditing(e)}
                  >
                    {e.photo ? (
                      <img src={e.photo} alt="" draggable={false} />
                    ) : (
                      <span className="entry-ico">
                        <Icon name={e.kind === 'exercise' ? 'flame' : 'log'} size={18} />
                      </span>
                    )}
                    <div className="entry-info">
                      <div className="entry-name">
                        {e.name}
                        {e.servings && e.servings !== 1 && <span className="badge serv">×{e.servings}</span>}
                        {e.source === 'usda' && (
                          <span className="badge verified" title={`Matched to USDA: ${e.match}`}>
                            USDA
                          </span>
                        )}
                        {e.source === 'edited' && (
                          <span className="badge edited" title="You corrected this entry">
                            edited
                          </span>
                        )}
                        {e.source === 'local' && (
                          <span className="badge verified" title="Matched from your history or the built-in catalog (no AI used)">
                            match
                          </span>
                        )}
                        {e.source === 'ai' && (
                          <span className="badge" title="AI estimate, click to correct">
                            est.
                          </span>
                        )}
                      </div>
                      <div className="muted small-text">
                        {e.quantity}
                        {e.kind === 'food' && (
                          <>
                            {' · '}
                            <span className="dot p" />P {e.protein}g <span className="dot c" />C {e.carbs}g <span className="dot f" />F {e.fat}g
                          </>
                        )}
                      </div>
                    </div>
                    <div className="entry-actions" onClick={(ev) => ev.stopPropagation()}>
                      <button className="icon-btn sm" onClick={() => void rescale(e, -1)} disabled={(e.servings ?? 1) <= 0.5} aria-label="Smaller portion" title="Smaller portion (−½)">
                        <Icon name="minus" size={14} />
                      </button>
                      <button className="icon-btn sm" onClick={() => void rescale(e, 1)} aria-label="Bigger portion" title="Bigger portion (+½)">
                        <Icon name="plus" size={14} />
                      </button>
                      <button className="icon-btn sm" onClick={() => void duplicate(e)} aria-label="Duplicate" title="Duplicate">
                        <Icon name="copy" size={14} />
                      </button>
                      <button className="icon-btn sm danger-hover" onClick={() => void remove(e)} aria-label="Delete" title="Delete">
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                    <div className="entry-kcal">
                      {e.kind === 'exercise' ? '−' : ''}
                      {e.calories}
                      <small>kcal</small>
                    </div>
                  </div>
                ))}
              </section>
            )
          })}
          {entries.some((e) => e.kind === 'food') && <p className="muted small-text tip">Tip: drag a food onto another meal to move it. Click any entry to edit it.</p>}
        </div>
      </div>

      {editing && <EntryDialog entry={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
