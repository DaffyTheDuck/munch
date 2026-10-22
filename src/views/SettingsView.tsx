import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, exportAll, importAll, loadDiet, loadGoals, loadProfile, saveDiet, saveGoals, saveProfile, useSettingsVersion } from '../db'
import { aiStatus, checkOwnKey, fetchUsage } from '../api'
import { useUsage } from '../lib/usage'
import { PROVIDER_INFO, clearOwnKey, getOwnKey, maskKey, saveOwnKey, type OwnKey, type Provider } from '../lib/aikey'
import { ACTIVITY, PACES, buildPlan, type Profile } from '../nutrition'
import { addDays, todayStr } from '../util'
import type { Goals } from '../types'
import Icon from '../components/Icon'
import ThemeSwitch from '../components/ThemeSwitch'
import AccountCard from '../components/AccountCard'
import DietEditor from '../components/DietEditor'
import { summarizeDiet } from '../../shared/diet'
import { useToast } from '../components/Toast'

const FIELDS: { key: keyof Goals; label: string; unit: string }[] = [
  { key: 'calories', label: 'Daily calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'targetKg', label: 'Target weight', unit: 'kg' },
]

export default function SettingsView() {
  const toast = useToast()
  const settingsVersion = useSettingsVersion()
  const [goals, setGoals] = useState<Goals>(loadGoals())
  const [profile, setProfile] = useState<Profile>(loadProfile())
  const [ai, setAi] = useState<Awaited<ReturnType<typeof aiStatus>> | null>(null)
  const usage = useUsage()
  const [own, setOwn] = useState<OwnKey | null>(getOwnKey())
  const [provider, setProvider] = useState<Provider>(getOwnKey()?.provider ?? 'gemini')
  const [keyText, setKeyText] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const latest = useLiveQuery(() => db.weights.orderBy('date').last(), [])

  useEffect(() => {
    void aiStatus().then(setAi)
    void fetchUsage()
  }, [])

  async function saveKey() {
    const k = keyText.trim()
    if (k.length < 20) return setKeyMsg({ ok: false, text: 'That key looks too short. Paste the whole key.' })
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      saveOwnKey({ provider, key: k })
      setOwn({ provider, key: k })
      setKeyText('')
      const r = await checkOwnKey()
      setKeyMsg({ ok: true, text: `Key works (${PROVIDER_INFO[r.provider as Provider]?.label ?? r.provider}). AI now uses your key.` })
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message })
    } finally {
      setKeyBusy(false)
      void fetchUsage()
    }
  }

  function removeKey() {
    clearOwnKey()
    setOwn(null)
    setKeyMsg(null)
    toast('Your API key was removed from this browser')
    void fetchUsage()
  }

  // Pre-fill current weight from the latest weigh-in unless the user has typed their own.
  useEffect(() => {
    if (latest && !localStorage.getItem('profile')) setProfile((p) => ({ ...p, weightKg: latest.kg }))
  }, [latest])

  const plan = useMemo(() => buildPlan(profile, goals.targetKg), [profile, goals.targetKg])
  const dirty = JSON.stringify(goals) !== JSON.stringify(loadGoals())
  const setP = <K extends keyof Profile>(k: K, v: Profile[K]) => setProfile((p) => ({ ...p, [k]: v }))
  const validProfile = profile.age > 0 && profile.heightCm > 0 && profile.weightKg > 0 && goals.targetKg > 0

  const finishDate =
    plan.weeks > 0
      ? new Date(addDays(todayStr(), plan.weeks * 7) + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : ''

  function apply() {
    const next = { ...goals, ...plan.goals }
    setGoals(next)
    saveGoals(next)
    saveProfile(profile)
    toast('Goals updated from your plan')
  }

  async function doExport() {
    const url = URL.createObjectURL(new Blob([await exportAll()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `journable-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function doImport(file: File) {
    if (!confirm('This replaces all current data. Continue?')) return
    await importAll(await file.text())
    location.reload()
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Goals</h1>
          <p className="muted">Used for the daily ring, macro bars and calendar colours.</p>
        </div>
      </header>

      <AccountCard />

      <section className="card">
        <div className="card-title">
          <h3>
            <Icon name="utensils" size={15} /> Food preferences
          </h3>
        </div>
        <p className="muted small-text" style={{ marginBottom: 14 }}>
          {summarizeDiet(loadDiet())}
        </p>
        <DietEditor
          key={settingsVersion}
          initial={loadDiet()}
          saveLabel="Save preferences"
          onSave={(p) => {
            saveDiet(p)
            toast('Food preferences saved')
          }}
        />
      </section>

      <section className="card">
        <div className="card-title">
          <h3>
            <Icon name="sparkle" size={15} /> Auto-calculate from my target weight
          </h3>
        </div>
        <div className="auto-grid">
          <label className="fld">
            <span>Sex</span>
            <select value={profile.sex} onChange={(e) => setP('sex', e.target.value as Profile['sex'])}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
          <label className="fld">
            <span>Age</span>
            <input type="number" inputMode="numeric" value={profile.age || ''} onChange={(e) => setP('age', Number(e.target.value))} />
          </label>
          <label className="fld">
            <span>Height (cm)</span>
            <input type="number" inputMode="numeric" value={profile.heightCm || ''} onChange={(e) => setP('heightCm', Number(e.target.value))} />
          </label>
          <label className="fld">
            <span>Current weight (kg)</span>
            <input type="number" step="0.1" inputMode="decimal" value={profile.weightKg || ''} onChange={(e) => setP('weightKg', Number(e.target.value))} />
          </label>
          <label className="fld">
            <span>Target weight (kg)</span>
            <input type="number" step="0.1" inputMode="decimal" value={goals.targetKg || ''} onChange={(e) => setGoals({ ...goals, targetKg: Number(e.target.value) })} />
          </label>
          <label className="fld">
            <span>Pace</span>
            <select value={profile.pace} onChange={(e) => setP('pace', Number(e.target.value))} disabled={plan.direction === 'maintain'}>
              {PACES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="fld wide">
            <span>Activity level</span>
            <select value={profile.activity} onChange={(e) => setP('activity', Number(e.target.value))}>
              {ACTIVITY.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {validProfile && (
          <div className="plan">
            <div className="plan-head">
              <b>
                {plan.direction === 'lose' ? 'Fat-loss plan' : plan.direction === 'gain' ? 'Weight-gain plan' : 'Maintenance plan'}
              </b>
              <span className="muted small-text">
                You burn about {plan.tdee.toLocaleString()} kcal/day
                {plan.weeks > 0 && ` · reach ${goals.targetKg} kg in ~${plan.weeks} weeks (${finishDate})`}
              </span>
            </div>
            <div className="plan-stats">
              <div>
                <b>{plan.goals.calories.toLocaleString()}</b>
                <span>kcal</span>
              </div>
              <div>
                <b style={{ color: 'var(--protein)' }}>{plan.goals.protein}g</b>
                <span>protein</span>
              </div>
              <div>
                <b style={{ color: 'var(--carbs)' }}>{plan.goals.carbs}g</b>
                <span>carbs</span>
              </div>
              <div>
                <b style={{ color: 'var(--fat)' }}>{plan.goals.fat}g</b>
                <span>fat</span>
              </div>
            </div>
            {plan.floorHit && <p className="msg error">That pace would go below a safe minimum, so calories are held at the floor. Choose a slower pace or a closer target.</p>}
            <p className="muted small-text">Estimate only, using the Mifflin-St Jeor formula. Protein is ~{plan.direction === 'lose' ? '2.0' : plan.direction === 'gain' ? '1.8' : '1.6'} g per kg, fat is 25% of calories, carbs fill the rest. Adjust after 2-3 weeks based on your actual weight trend.</p>
            <div className="dialog-actions">
              <span className="spacer" />
              <button className="btn primary" onClick={apply}>
                Use these numbers
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Daily targets</h3>
        </div>
        <div className="goal-list">
          {FIELDS.map((f) => (
            <label key={f.key} className="goal-row">
              <span>{f.label}</span>
              <span className="goal-input">
                <input type="number" inputMode="numeric" value={goals[f.key] || ''} onChange={(e) => setGoals({ ...goals, [f.key]: Number(e.target.value) })} />
                <em>{f.unit}</em>
              </span>
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <span className="spacer" />
          <button
            className="btn primary"
            disabled={!dirty}
            onClick={() => {
              saveGoals(goals)
              saveProfile(profile)
              toast('Goals saved')
            }}
          >
            Save goals
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Appearance</h3>
          <ThemeSwitch />
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>AI engine</h3>
          <span className={`pill ${ai?.ok ? 'ok' : 'bad'}`}>{ai === null ? 'Checking…' : ai.ok ? `Connected · ${ai.provider}` : 'Server not reachable'}</span>
        </div>
        {ai?.ok && (
          <p className="small-text">
            {ai.chain && ai.chain.length > 1
              ? `Fallback order: ${ai.chain.join(' → ')}. If one is busy or out of quota, the next one answers.`
              : 'No fallback configured. Add GROQ_API_KEY to .env so requests still work when the main model is busy.'}
          </p>
        )}
        {ai?.ok && (
          <p className="muted small-text">
            Model layer: {ai.llmLayer === 'langchain' ? 'LangChain' : 'native adapters'} · Coach: {ai.coachEngine === 'langgraph' ? 'LangGraph agent' : 'classic loop'}
          </p>
        )}
        {usage.enabled && !usage.unlimited && usage.limit ? (
          <p className="small-text">{own ? 'Your own key is in use, so requests do not count against the shared allowance.' : `Daily AI allowance: ${usage.used}/${usage.limit} used.`}</p>
        ) : null}
        <div className="ai-key">
          <h4>{own ? `Using your own ${PROVIDER_INFO[own.provider].label} key (${maskKey(own.key)})` : 'Use your own API key'}</h4>
          <p className="muted small-text">For unlimited use on your own account. The key stays in this browser, is never stored on the server, and is sent with each AI request over HTTPS.</p>
          <div className="chips">
            {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => (
              <button key={p} type="button" aria-pressed={provider === p} className={`chip ${provider === p ? 'on' : ''}`} onClick={() => setProvider(p)}>
                {PROVIDER_INFO[p].label}
              </button>
            ))}
          </div>
          <label className="fld">
            <span>
              API key · {PROVIDER_INFO[provider].hint} · get one at {PROVIDER_INFO[provider].url}
            </span>
            <input type="password" autoComplete="off" spellCheck={false} placeholder="Paste your key" value={keyText} onChange={(e) => setKeyText(e.target.value)} />
          </label>
          <div className="ai-key-actions">
            <button type="button" className="btn primary" disabled={!keyText.trim() || keyBusy} onClick={() => void saveKey()}>
              {keyBusy ? 'Testing…' : 'Save & test'}
            </button>
            {own && (
              <button type="button" className="btn" onClick={removeKey}>
                Remove
              </button>
            )}
          </div>
          {keyMsg && <p className={`small-text ${keyMsg.ok ? 'key-ok' : 'key-bad'}`}>{keyMsg.text}</p>}
        </div>
        <p className="muted small-text">Providers and models for the shared server are set in the .env file next to the app.</p>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Backup</h3>
        </div>
        <p className="muted small-text">Everything is stored in this browser. Export a file to back it up or move it to another device.</p>
        <div className="dialog-actions left">
          <button className="btn" onClick={() => void doExport()}>
            <Icon name="download" size={16} /> Export data
          </button>
          <label className="btn">
            <Icon name="upload" size={16} /> Import data
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
          </label>
        </div>
      </section>
    </div>
  )
}
