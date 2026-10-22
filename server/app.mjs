import express from 'express'
import { analyzeInput } from './analyze.mjs'
import { coachStep } from './coach.mjs'
import { planMeals } from './plan.mjs'
import { makeRecipe } from './recipe.mjs'
import { explainReport } from './insights.mjs'
import { generate, providerInfo } from './llm.mjs'
import { allowedEmails, authEnabled, requireAuth } from './auth.mjs'
import { meterAI, usageHandler } from './usage.mjs'
import {
  HttpError, bodyFor, cleanDate, cleanGoals, cleanHints, cleanImage, cleanMessages, cleanText, cors, errorHandler, guardAI, ipLimiter, securityHeaders, sendError, threadFor, userKey,
} from './security.mjs'

const SMALL = '100kb'
const WITH_PHOTO = '6mb'

/** Builds the API. `authKeys` and `usageStore` exist so tests can run it without the network or the real files. */
export function createApp({ authKeys, usageStore = null } = {}) {
  const app = express()
  app.disable('x-powered-by')
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1) // behind Cloud Run: use the real client address
  app.use(securityHeaders)
  app.use(cors())
  app.use('/api', ipLimiter())

  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      ...providerInfo(),
      authRequired: authEnabled(),
      llmLayer: (process.env.LLM_LAYER || '').toLowerCase() === 'langchain' ? 'langchain' : 'native',
      coachEngine: (process.env.COACH_ENGINE || '').toLowerCase() === 'langgraph' ? 'langgraph' : 'classic',
    }),
  )

  // Everything else needs a signed-in Google account (when auth is enabled). Auth runs BEFORE any body is read.
  const auth = requireAuth({ keys: authKeys })
  app.use(['/api/analyze', '/api/coach', '/api/plan', '/api/usage', '/api/recipe', '/api/insights', '/api/key'], auth)

  // Everything an AI route needs, in order: parse the body, optional own key, burst/parallel guard, daily allowance.
  // (The own-key step comes after the body is read: its request-scoped context must wrap the handler.)
  const ai = (cost, limit = SMALL) => [bodyFor(limit), userKey, guardAI(), meterAI(cost, usageStore)]

  app.get('/api/usage', userKey, usageHandler(usageStore))

  // Checks a person's own API key with a tiny request (their key, their quota; nothing of ours is spent).
  app.post('/api/key/check', bodyFor(SMALL), userKey, guardAI({ perMin: 6 }), async (req, res) => {
    try {
      if (!req.ownKey) throw new HttpError(400, 'Add an API key first.')
      await generate({ system: 'Reply with the single word OK.', messages: [{ role: 'user', text: 'ping' }], json: false, maxTokens: 8 })
      res.json({ ok: true, provider: req.ownKey.provider })
    } catch (e) {
      sendError(res, e, { ownKey: true })
    }
  })

  app.post('/api/analyze', ...ai(1, WITH_PHOTO), async (req, res) => {
    try {
      const body = req.body || {}
      const text = cleanText(body.text, { max: 1500 })
      const image = cleanImage(body.image)
      if (!text && !image) throw new HttpError(400, 'Provide text or an image')
      const result = await analyzeInput({ text, image, hints: cleanHints(body.hints) })
      console.log(`analyze via ${result.meta.provider} ${result.meta.ms}ms grounded ${result.meta.grounded}/${result.meta.foodItems}${req.ownKey ? ' own-key' : ''}`)
      res.json(result)
    } catch (e) {
      sendError(res, e, { ownKey: Boolean(req.ownKey) })
    }
  })

  app.post('/api/coach', ...ai(1), async (req, res) => {
    try {
      const { messages, today, goals } = req.body || {}
      res.json(await coachStep({ messages: cleanMessages(messages), today: cleanDate(today), goals: cleanGoals(goals) }))
    } catch (e) {
      sendError(res, e, { ownKey: Boolean(req.ownKey) })
    }
  })

  app.post('/api/plan', ...ai(2), async (req, res) => {
    try {
      const plan = await planMeals(req.body || {})
      console.log(`plan ${plan.meta.ms}ms via ${plan.meta.provider || '-'}${req.ownKey ? ' own-key' : ''}`)
      res.json(plan)
    } catch (e) {
      sendError(res, e, { ownKey: Boolean(req.ownKey) })
    }
  })

  app.post('/api/recipe', ...ai(1), async (req, res) => {
    try {
      res.json(await makeRecipe(req.body || {}))
    } catch (e) {
      sendError(res, e, { ownKey: Boolean(req.ownKey) })
    }
  })

  // Friendly wording for the weekly analysis. The analysis itself is computed on the device.
  app.post('/api/insights/explain', ...ai(1), async (req, res) => {
    try {
      res.json(await explainReport(req.body || {}))
    } catch (e) {
      sendError(res, e, { ownKey: Boolean(req.ownKey) })
    }
  })

  // LangGraph coach: the graph pauses on tool calls; the app runs them and posts the results to /resume.
  const useGraph = () => (process.env.COACH_ENGINE || '').toLowerCase() === 'langgraph'

  app.post('/api/coach/chat', ...ai(2), async (req, res) => {
    try {
      if (!useGraph()) throw new HttpError(404, 'COACH_ENGINE is not langgraph')
      const { thread, message, today, goals } = req.body || {}
      const { coachChat } = await import('./coach.graph.mjs')
      res.json(
        await coachChat({
          thread: threadFor(req.user?.uid, thread),
          message: cleanText(message, { max: 2000, required: true, name: 'message' }),
          today: cleanDate(today),
          goals: cleanGoals(goals),
        }),
      )
    } catch (e) {
      sendError(res, e, { ownKey: Boolean(req.ownKey) })
    }
  })

  // Free to call, but it only continues a question that is already waiting, and it is still rate limited.
  app.post('/api/coach/resume', bodyFor(SMALL), userKey, guardAI(), async (req, res) => {
    try {
      if (!useGraph()) throw new HttpError(404, 'COACH_ENGINE is not langgraph')
      const { thread, results, today, goals } = req.body || {}
      if (!Array.isArray(results) || results.length > 8) throw new HttpError(400, 'results required')
      const { coachResume } = await import('./coach.graph.mjs')
      res.json(await coachResume({ thread: threadFor(req.user?.uid, thread), results, today: cleanDate(today), goals: cleanGoals(goals) }))
    } catch (e) {
      sendError(res, e, { ownKey: Boolean(req.ownKey) })
    }
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))
  app.use(errorHandler)
  return app
}

export { allowedEmails, authEnabled }
