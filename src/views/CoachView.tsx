import { useEffect, useRef, useState } from 'react'
import { askCoach, coachEngine, type Turn } from '../coach'
import Icon from '../components/Icon'

const SUGGESTIONS = [
  'How did my last 7 days go?',
  'Am I hitting my protein goal?',
  'What do I eat most often?',
  'Suggest a dinner for what I have left today',
  'Is my weight trending the right way?',
]

export default function CoachView() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<string[]>([])
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const thread = useRef(crypto.randomUUID())
  const [engine, setEngine] = useState<string>('')

  useEffect(() => {
    void coachEngine().then(setEngine)
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, live, busy])

  async function send(q?: string) {
    const msg = (q ?? text).trim()
    if (!msg || busy) return
    const next: Turn[] = [...turns, { role: 'user', text: msg }]
    setTurns(next)
    setText('')
    setBusy(true)
    setError('')
    setLive([])
    const used: string[] = []
    try {
      const answer = await askCoach(
        next,
        (label) => {
          used.push(label)
          setLive([...used])
        },
        thread.current,
      )
      setTurns([...next, { role: 'coach', text: answer, tools: used }])
    } catch (e) {
      // A failed request can leave the server-side conversation mid-step, so start a fresh thread.
      thread.current = crypto.randomUUID()
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setLive([])
    }
  }

  return (
    <div className="page narrow coach">
      <header className="page-head">
        <div>
          <h1>Coach</h1>
          <p className="muted">Ask about your own data. The coach looks at your log with tools, so answers use your real numbers.</p>
          {engine === 'langgraph' && (
            <span className="pill ok engine-pill">
              <Icon name="sparkle" size={11} /> LangGraph agent
            </span>
          )}
        </div>
      </header>

      <div className="thread">
        {turns.length === 0 && (
          <div className="card empty">
            <div className="empty-icon">
              <Icon name="coach" size={26} />
            </div>
            <h3>Ask anything about your eating</h3>
            <div className="chips center">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            {t.tools && t.tools.length > 0 && (
              <div className="tool-trace">
                {t.tools.map((x, j) => (
                  <span key={j} className="tool-chip">
                    <Icon name="sparkle" size={11} /> {x}
                  </span>
                ))}
              </div>
            )}
            <div className="bubble-text">{t.text}</div>
          </div>
        ))}
        {busy && (
          <div className="bubble coach">
            <div className="tool-trace">
              {live.map((x, j) => (
                <span key={j} className="tool-chip">
                  <Icon name="sparkle" size={11} /> {x}
                </span>
              ))}
            </div>
            <div className="typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        {error && <div className="msg error">{error}</div>}
        <div ref={endRef} />
      </div>

      <div className="coach-input card">
        <input
          value={text}
          placeholder="Ask your coach…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          disabled={busy}
        />
        <button className="btn primary" onClick={() => void send()} disabled={busy || !text.trim()}>
          <Icon name="send" size={16} /> Ask
        </button>
      </div>
    </div>
  )
}
