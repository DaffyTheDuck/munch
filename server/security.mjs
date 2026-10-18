// Request hardening for the API: input validation, abuse limits, safe errors and per-request user API keys.
//
// Layers, in the order a request meets them:
//   1. securityHeaders / cors      - no wildcard CORS, no sniffing, no framing, no server fingerprint
//   2. ipLimiter                   - cheap flood protection BEFORE any token is verified or body is read
//   3. requireAuth (auth.mjs)      - Google sign-in, optional allow-list, per-user request rate
//   4. bodyFor(...)                - small body limits per route (only now is the body read)
//   5. userKey                     - optional "bring your own key" header, validated, request-scoped
//   6. guardAI                     - per-user AI burst rate and at most N AI requests in flight
//   7. meterAI (usage.mjs)         - the daily allowance
//   8. field validators below      - strict size/shape limits on everything that reaches a prompt
import express from 'express'
import { redact, runWithUserKey } from './llm.mjs'

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
    this.expose = true // safe to show to the caller
  }
}

// ------------------------------------------------------------------ headers and CORS

export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-site',
  })
  next()
}

/** Cross-origin browsers are refused unless the origin is listed in ALLOWED_ORIGINS (comma separated). The phone app needs no CORS. */
export function cors(allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  return (req, res, next) => {
    const origin = req.headers.origin
    if (origin && allowed.includes(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-AI-Key, X-AI-Provider',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
      })
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  }
}

// ------------------------------------------------------------------ rate limits

/** Sliding-window counter with bounded memory. */
export function createWindowLimiter(limit, windowMs = 60000, { maxKeys = 5000 } = {}) {
  const hits = new Map()
  let lastSweep = 0
  return (key, now = Date.now()) => {
    if (now - lastSweep > windowMs) {
      lastSweep = now
      for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k)
    }
    if (!hits.has(key) && hits.size >= maxKeys) return false // under a key-flood, refuse new keys rather than grow
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs)
    if (recent.length >= limit) {
      hits.set(key, recent)
      return false
    }
    recent.push(now)
    hits.set(key, recent)
    return true
  }
}

/** Per-IP limit applied before authentication. Requires `app.set('trust proxy', 1)` behind Cloud Run. */
export function ipLimiter(limit = num(process.env.IP_RATE_LIMIT_PER_MIN, 120)) {
  const allow = createWindowLimiter(limit)
  return (req, res, next) => {
    if (allow(req.ip || 'unknown')) return next()
    res.set('Retry-After', '60')
    res.status(429).json({ error: 'Too many requests. Please slow down.' })
  }
}

/** AI requests: a short-burst rate per user plus a cap on parallel requests (stops "fire 100 at once"). */
export function guardAI({ perMin = num(process.env.AI_RATE_LIMIT_PER_MIN, 12), parallel = num(process.env.AI_MAX_PARALLEL, 2) } = {}) {
  const allow = createWindowLimiter(perMin)
  const inFlight = new Map()
  return (req, res, next) => {
    const id = req.user?.uid || req.ip || 'anon'
    if (!allow(id)) {
      res.set('Retry-After', '30')
      return res.status(429).json({ error: 'You are going a little fast. Please wait a few seconds.', code: 'rate_limited' })
    }
    const n = inFlight.get(id) || 0
    if (n >= parallel) return res.status(429).json({ error: 'Another AI request is still running. Please wait for it to finish.', code: 'busy' })
    inFlight.set(id, n + 1)
    let released = false
    const release = () => {
      if (released) return
      released = true
      const left = (inFlight.get(id) || 1) - 1
      if (left <= 0) inFlight.delete(id)
      else inFlight.set(id, left)
    }
    res.on('finish', release)
    res.on('close', release)
    next()
  }
}

// ------------------------------------------------------------------ bodies

/** JSON body parser with a per-route size limit. Mounted AFTER authentication so strangers cannot make us read big bodies. */
export const bodyFor = (limit) => express.json({ limit, strict: true, type: 'application/json' })

// ------------------------------------------------------------------ field validators

export function cleanText(v, { max = 1500, required = false, name = 'text' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`)
    return ''
  }
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be text`)
  const t = v.replace(/\u0000/g, '').trim()
  if (t.length > max) throw new HttpError(400, `${name} is too long (max ${max} characters)`)
  if (required && !t) throw new HttpError(400, `${name} is required`)
  return t
}

const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/** Only inline jpeg/png/webp photos of a sane size. Never a URL (so nothing can make a provider fetch a link). */
export function cleanImage(v) {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string' || v.length > MAX_IMAGE_BYTES * 1.4) throw new HttpError(413, 'That photo is too large. Try a smaller one.')
  const m = IMAGE_RE.exec(v)
  if (!m) throw new HttpError(400, 'Unsupported image. Use a JPEG, PNG or WebP photo.')
  return v
}

export function cleanHints(v) {
  return Array.isArray(v) ? v.slice(0, 8).map((h) => String(h).replace(/[\r\n\u0000]/g, ' ').slice(0, 160)) : []
}

export function cleanDate(v) {
  const s = typeof v === 'string' ? v : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10)
}

/** The model prompt includes the user's goals, so keep only known numeric fields (no free text reaches the prompt). */
export function cleanGoals(v) {
  const g = v && typeof v === 'object' ? v : {}
  const out = {}
  for (const k of ['calories', 'protein', 'carbs', 'fat', 'targetWeight', 'weight', 'goalWeight', 'height', 'age']) {
    const n = Number(g[k])
    if (Number.isFinite(n) && n >= 0 && n <= 20000) out[k] = n
  }
  if (typeof g.goalType === 'string' && /^[a-z_-]{1,20}$/.test(g.goalType)) out.goalType = g.goalType
  return out
}

export function cleanMessages(v, { maxCount = 16, maxLen = 3000 } = {}) {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'messages required')
  return v.slice(-maxCount).map((m) => ({ role: m?.role === 'model' ? 'model' : 'user', text: cleanText(m?.text ?? '', { max: maxLen, name: 'message' }) }))
}

export const THREAD_RE = /^[A-Za-z0-9_-]{8,64}$/

/** A conversation id is namespaced by user, so nobody can read or continue someone else's chat by guessing an id. */
export function threadFor(uid, thread) {
  if (typeof thread !== 'string' || !THREAD_RE.test(thread)) throw new HttpError(400, 'invalid thread id')
  return `${String(uid || 'open')}:${thread}`
}

// ------------------------------------------------------------------ bring your own API key

export const PROVIDERS = ['gemini', 'groq', 'anthropic']
const KEY_RE = /^[A-Za-z0-9_\-.]{20,220}$/

/**
 * Optional headers  X-AI-Provider: gemini | groq | anthropic   and   X-AI-Key: <the person's own key>.
 * The key is validated, then held only in this request's async context. It is never logged or stored, and when
 * it is present the server's own keys are never used for that request (so it cannot spend the owner's budget).
 */
export function userKey(req, res, next) {
  const key = req.headers['x-ai-key']
  if (key === undefined) return next()
  const provider = String(req.headers['x-ai-provider'] || '').toLowerCase()
  if (typeof key !== 'string' || !KEY_RE.test(key) || !PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'That API key or provider is not valid.', code: 'bad_key' })
  }
  req.ownKey = { provider } // note: the key itself is not kept on req, so it cannot leak through logging of req
  runWithUserKey({ provider, key }, () => next())
}

// ------------------------------------------------------------------ errors

const SAFE = [/^Invalid plan request/, /^The model returned an unreadable response/]

/** What may be shown to a caller. Provider error text can contain account details, so it is summarised, not passed on. */
export function publicMessage(e, { ownKey = false } = {}) {
  if (e?.expose) return e.message
  const msg = redact(e?.message)
  const status = e?.upstreamStatus ?? e?.status
  if (!e?.expose && (status === 401 || status === 403)) return ownKey ? 'Your API key was rejected by the provider. Check it in Settings.' : 'AI is not available right now.'
  if (!e?.expose && status === 429) return 'The AI service is busy or out of quota right now. Please try again shortly.'
  if (SAFE.some((r) => r.test(msg))) return msg
  if (/api key|api_key|permission|unauthori[sz]ed|invalid.*key|401|403/i.test(msg)) {
    return ownKey ? 'Your API key was rejected by the provider. Check it in Settings.' : 'AI is not available right now.'
  }
  if (/quota|rate|429|exhausted|demand|overloaded|unavailable|503|high demand/i.test(msg)) return 'The AI service is busy or out of quota right now. Please try again shortly.'
  if (/timed? ?out|aborted/i.test(msg)) return 'The AI took too long to respond. Please try again.'
  if (/is not set in \.env|not configured/i.test(msg)) return 'AI is not configured on this server.'
  return 'Something went wrong. Please try again.'
}

export function sendError(res, e, { ownKey = false, log = true } = {}) {
  if (log && !e?.expose) console.error(`[error] ${redact(e?.message || e).slice(0, 300)}`) // message only: never the request body
  const status = e?.expose && e.status >= 400 && e.status < 600 ? e.status : e?.message === 'thread_busy' ? 409 : 500
  res.status(status).json({ error: publicMessage(e, { ownKey }), ...(e?.code ? { code: e.code } : {}) })
}

/** Final error handler: body-parser failures and anything unexpected become small JSON replies, never stack traces. */
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' })
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request.' })
  sendError(res, err)
}
