import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, loadDiet, loadGoals, loadProfile, useSettingsVersion } from '../db'
import { explainReport } from '../api'
import { weeklyReport, type Finding } from '../../shared/insights'
import { buildPlan } from '../../shared/nutrition'
import { addDays, todayStr } from '../util'
import Icon from './Icon'

const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h >>> 0)
}
const short = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

function FindingCard({ f }: { f: Finding }) {
  return (
    <article className={`finding sev-${f.severity}`}>
      <h4>{f.title}</h4>
      <p>{f.detail}</p>
      <p className="fix">
        <Icon name="right" size={14} /> {f.fix}
      </p>
    </article>
  )
}

// The weekly analysis: what happened to your weight and why, from your own logs. Free and instant (no AI);
// an optional button asks the AI to phrase it in plain words.
export default function Analysis() {
  useSettingsVersion()
  const today = todayStr()
  const entries = useLiveQuery(() => db.entries.where('date').between(addDays(today, -20), today, true, true).toArray(), [today]) ?? []
  const weights = useLiveQuery(() => db.weights.orderBy('date').toArray(), []) ?? []
  const goals = loadGoals()
  const profile = loadProfile()
  const diet = loadDiet()

  const report = useMemo(() => {
    const valid = profile.age > 0 && profile.heightCm > 0 && profile.weightKg > 0
    return weeklyReport({ today, entries, weights, goals, tdee: valid ? buildPlan(profile, goals.targetKg).tdee : null, diet, pace: profile.pace })
  }, [today, entries, weights, goals, profile, diet])

  const reportKey = useMemo(() => `insight:${report.to}:${hash(JSON.stringify([report.verdict, report.findings.map((f) => f.id), report.avgEaten]))}`, [report])
  const [story, setStory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    try {
      setStory(localStorage.getItem(reportKey) ?? '')
    } catch {
      setStory('')
    }
  }, [reportKey])

  async function explain() {
    setBusy(true)
    setError('')
    try {
      const r = await explainReport({
        direction: report.direction,
        verdict: report.verdict,
        avgEaten: report.avgEaten,
        goalKcal: report.goalKcal,
        tdee: report.tdee,
        weight: { kgPerWeek: report.weight.kgPerWeek, changeKg: report.weight.changeKg, status: report.weight.status },
        balance: report.balance,
        findings: report.findings.slice(0, 8),
        swaps: report.swaps.map((s) => ({ from: s.from, to: s.to, savesPerWeek: s.savesPerWeek })),
        topItems: report.topItems.map((i) => ({ name: i.name, kcal: i.kcal })),
        targetKcal: report.targetKcal,
      })
      setStory(r.text)
      try {
        localStorage.setItem(reportKey, r.text)
      } catch {
        /* storage unavailable: the text still shows */
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!report.ready) {
    return (
      <section className="card analysis-empty">
        <Icon name="weight" size={26} />
        <h3>Your weekly analysis</h3>
        <p className="muted">{report.notice}</p>
      </section>
    )
  }

  const vs = report.avgEaten - report.goalKcal
  const rate = report.weight.kgPerWeek
  const max = Math.max(report.goalKcal * 1.3, ...report.days.map((d) => d.eaten), 1)

  return (
    <>
      <section className="card">
        <p className="muted small-text">
          {short(report.from)} – {short(report.to)}
        </p>
        <h2 className={`verdict v-${report.verdict.status}`}>{report.verdict.headline}</h2>
        <p className="muted">{report.verdict.summary}</p>
        <div className="tiles inline">
          <div className="tile">
            <b>{report.avgEaten.toLocaleString()}</b>
            <span>avg kcal / day</span>
          </div>
          <div className="tile">
            <b className={vs > 0 ? 'bad' : 'good'}>
              {vs > 0 ? '+' : ''}
              {vs}
            </b>
            <span>vs your goal</span>
          </div>
          <div className="tile">
            <b>{rate === null ? '–' : `${rate > 0 ? '+' : ''}${rate}`}</b>
            <span>kg / week</span>
          </div>
        </div>
        <div className="mini-bars" aria-label="Calories per day">
          {report.days.map((d) => (
            <div key={d.date} className="mini-col" title={`${d.date}: ${Math.round(d.eaten)} kcal`}>
              <span className="mini-bar">
                <i className={d.eaten > report.goalKcal ? 'over' : d.entries && d.eaten < 800 ? 'incomplete' : ''} style={{ height: `${Math.min(100, (d.eaten / max) * 100)}%`, opacity: d.entries ? 1 : 0.2 }} />
              </span>
              <small>{new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
            </div>
          ))}
        </div>
        <p className="muted small-text">
          {report.tdee !== null && report.balance.perDay !== null
            ? `You burn about ${report.balance.impliedMaintenance ?? report.tdee} kcal a day${report.balance.impliedMaintenance ? ' (worked out from your weight trend)' : ' (estimated)'}. Your gap was ${report.balance.perDay > 0 ? '+' : ''}${report.balance.perDay} kcal a day.`
            : 'Fill in your age, height and weight in Goals to compare your intake with what you burn.'}
        </p>
      </section>

      {report.actions.length > 0 && (
        <section className="card actions-card">
          <h3>What to do this week</h3>
          <ol>
            {report.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </section>
      )}

      {report.findings.length > 0 && (
        <section className="findings">
          <h3 className="section-label">Why</h3>
          {report.findings.map((f) => (
            <FindingCard key={f.id} f={f} />
          ))}
        </section>
      )}

      {report.swaps.length > 0 && (
        <section className="card">
          <h3>Easy swaps from your own food</h3>
          <ul className="plain-list">
            {report.swaps.map((s) => (
              <li key={s.from}>
                <b>
                  {s.from} → {s.to}
                </b>
                <span className="muted small-text">
                  {s.fromKcal} → {s.toKcal} kcal each, {s.timesPerWeek}× this week: saves about {s.savesPerWeek.toLocaleString()} kcal.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.topItems.length > 0 && (
        <section className="card">
          <h3>Where your calories came from</h3>
          <ul className="plain-list">
            {report.topItems.map((i) => (
              <li key={i.name} className="row-between">
                <span>{i.name}</span>
                <span className="muted small-text">
                  {i.kcal.toLocaleString()} kcal · {Math.round(i.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3>
          <Icon name="sparkle" size={15} /> In plain words
        </h3>
        {story ? (
          <p className="story">{story}</p>
        ) : (
          <p className="muted small-text">Ask the AI to explain this week in a few friendly sentences. It uses only the numbers above, and costs one AI action.</p>
        )}
        {error && <p className="small-text bad-text">{error}</p>}
        {!story && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void explain()}>
            {busy ? 'Thinking…' : 'Explain this week'}
          </button>
        )}
      </section>

      <p className="muted small-text center">Estimates from your own logs, not medical advice. Body weight naturally moves 1–2 kg day to day, so judge changes over 2–3 weeks.</p>
    </>
  )
}
