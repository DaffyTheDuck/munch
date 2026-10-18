import express from 'express'
import { analyzeInput } from './analyze.mjs'
import { coachStep } from './coach.mjs'
import { planMeals } from './plan.mjs'
import { providerInfo } from './llm.mjs'
import { allowedEmails, authEnabled, requireAuth } from './auth.mjs'
import { meterAI, usageHandler } from './usage.mjs'

const app = express()
app.use(express.json({ limit: '15mb' }))

// AI endpoints require a signed-in Google account when FIREBASE_PROJECT_ID is set (see server/auth.mjs).
app.use(['/api/analyze', '/api/coach', '/api/plan', '/api/usage'], requireAuth())

// How many AI actions you have used today (the limits themselves are enforced per route below).
app.get('/api/usage', usageHandler())

app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    ...providerInfo(),
    authRequired: authEnabled(),
    llmLayer: (process.env.LLM_LAYER || '').toLowerCase() === 'langchain' ? 'langchain' : 'native',
    coachEngine: (process.env.COACH_ENGINE || '').toLowerCase() === 'langgraph' ? 'langgraph' : 'classic',
  }),
)

app.post('/api/analyze', meterAI(1), async (req, res) => {
  try {
    const { text, image, hints } = req.body || {}
    if (!text && !image) return res.status(400).json({ error: 'Provide text or an image' })
    const result = await analyzeInput({ text, image, hints: Array.isArray(hints) ? hints.slice(0, 8).map(String) : [] })
    console.log(`analyze via ${result.meta.provider} ${result.meta.ms}ms (llm ${result.meta.llmMs}ms) grounded ${result.meta.grounded}/${result.meta.foodItems}${result.meta.repaired ? ' repaired' : ''}`)
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message || 'Analysis failed' })
  }
})

app.post('/api/coach', meterAI(1), async (req, res) => {
  try {
    const { messages, today, goals } = req.body || {}
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' })
    const clean = messages.slice(-24).map((m) => ({ role: m.role === 'model' ? 'model' : 'user', text: String(m.text || '').slice(0, 12000) }))
    res.json(await coachStep({ messages: clean, today: String(today || ''), goals: goals || {} }))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message || 'Coach failed' })
  }
})

// Meal plans that respect diet, allergies and a calorie/macro target (see server/plan.mjs).
app.post('/api/plan', meterAI(2), async (req, res) => {
  try {
    const plan = await planMeals(req.body || {})
    console.log(`plan ${plan.meta.ms}ms via ${plan.meta.provider || '-'}${plan.meta.repaired ? ' repaired' : ''}${plan.removed.length ? ` removed ${plan.removed.length}` : ''}`)
    res.json(plan)
  } catch (e) {
    console.error(e)
    res.status(e.message?.startsWith('Invalid plan request') ? 400 : 500).json({ error: e.message || 'Planning failed' })
  }
})

// LangGraph coach: the graph pauses on tool calls; the browser runs them and posts the results to /resume.
const useGraph = () => (process.env.COACH_ENGINE || '').toLowerCase() === 'langgraph'

app.post('/api/coach/chat', meterAI(2), async (req, res) => {
  try {
    if (!useGraph()) return res.status(404).json({ error: 'COACH_ENGINE is not langgraph' })
    const { thread, message, today, goals } = req.body || {}
    if (!thread || !message) return res.status(400).json({ error: 'thread and message required' })
    const { coachChat } = await import('./coach.graph.mjs')
    res.json(await coachChat({ thread, message: String(message).slice(0, 4000), today: String(today || ''), goals }))
  } catch (e) {
    console.error(e)
    res.status(e.message === 'thread_busy' ? 409 : 500).json({ error: e.message || 'Coach failed' })
  }
})

app.post('/api/coach/resume', async (req, res) => {
  try {
    if (!useGraph()) return res.status(404).json({ error: 'COACH_ENGINE is not langgraph' })
    const { thread, results, today, goals } = req.body || {}
    if (!thread || !Array.isArray(results)) return res.status(400).json({ error: 'thread and results required' })
    const { coachResume } = await import('./coach.graph.mjs')
    res.json(await coachResume({ thread, results, today: String(today || ''), goals }))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message || 'Coach failed' })
  }
})

const port = Number(process.env.PORT) || 8787
app.listen(port, () => {
  const { provider, model, chain } = providerInfo()
  console.log(`Journable API on http://localhost:${port}`)
  console.log(
    authEnabled()
      ? `Auth: Google sign-in required (Firebase project ${process.env.FIREBASE_PROJECT_ID})${allowedEmails().length ? `, restricted to ${allowedEmails().length} account(s)` : ', any Google account allowed (set ALLOWED_EMAILS to restrict)'}`
      : 'Auth: OFF (set FIREBASE_PROJECT_ID to require Google sign-in)',
  )
  console.log(`AI: ${provider}/${model}${chain.length > 1 ? `, fallbacks: ${chain.slice(1).join(' → ')}` : ', no fallback configured'}`)
})
