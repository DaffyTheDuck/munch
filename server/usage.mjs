// Daily AI-action limits.
//
// Every request that calls a language model costs "AI actions". Each signed-in person gets a daily allowance
// (DAILY_AI_LIMIT, default 40; 0 = unlimited), and an optional global cap (GLOBAL_DAILY_AI_LIMIT, default off)
// can switch AI off for everyone when a daily budget is spent. The day rolls over at midnight in QUOTA_TIMEZONE
// (default UTC). Counts are kept in memory and mirrored to a small JSON file so a restart does not reset them.
//
// Costs: logging a meal = 1, a meal plan = 2, a new coach question = 2 (its tool follow-ups cost 0), classic coach step = 1.
// Foods resolved on the device (history / catalog) and the on-device recommendation engine cost nothing.
import fs from 'node:fs'
import path from 'node:path'
import { FirestoreUsageBackend } from './usage.firestore.mjs'

export const GLOBAL_KEY = '*'

export function dayKey(now = new Date(), tz = 'UTC') {
  return now.toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD in that time zone
}

/** The next moment the day key changes (to the minute). */
export function nextReset(now = new Date(), tz = 'UTC') {
  const today = dayKey(now, tz)
  const t = new Date(now)
  t.setSeconds(0, 0)
  for (let i = 0; i < 60 * 26; i++) {
    t.setMinutes(t.getMinutes() + 1)
    if (dayKey(t, tz) !== today) return t
  }
  return new Date(now.getTime() + 24 * 3600 * 1000)
}

export class UsageStore {
  constructor({ file = null, now = () => new Date(), tz = 'UTC', backend = null } = {}) {
    this.file = file
    this.backend = backend
    this.now = now
    this.tz = tz
    this.data = { day: dayKey(now(), tz), counts: {}, refunds: {} }
    this.timer = null
    if (file) this.load()
  }

  /** Loads today's counts from the durable backend (Firestore). Call once before serving requests. */
  async init() {
    if (!this.backend) return
    try {
      const saved = await this.backend.load(this.data.day)
      if (saved) this.data = { day: this.data.day, counts: saved.counts, refunds: saved.refunds }
    } catch (e) {
      console.warn(`usage: could not load saved counts (${String(e.message).slice(0, 80)}); starting from this server's memory`)
    }
  }

  /** Writes immediately (used on shutdown). */
  async flush() {
    clearTimeout(this.timer)
    this.timer = null
    await this.persist()
  }

  async persist() {
    try {
      if (this.file) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        fs.writeFileSync(this.file, JSON.stringify(this.data))
      }
      if (this.backend) await this.backend.save(this.data.day, this.data)
    } catch (e) {
      console.warn(`usage: could not save counts (${String(e.message).slice(0, 80)})`) // never blocks a request
    }
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (raw?.day === this.data.day && raw.counts && typeof raw.counts === 'object') this.data = { refunds: {}, ...raw }
    } catch {
      /* no file yet, or unreadable: start fresh */
    }
  }

  save() {
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.persist()
    }, 300)
    this.timer.unref?.()
  }

  /** Starts a new day's counts when the date has changed. */
  roll() {
    const today = dayKey(this.now(), this.tz)
    if (this.data.day !== today) this.data = { day: today, counts: {}, refunds: {} }
  }

  used(key) {
    this.roll()
    return this.data.counts[key] ?? 0
  }

  /**
   * Try to spend `cost` actions. `perUser` and `global` are limits (0 = unlimited).
   * Returns { ok, reason?, used, limit, remaining }. Nothing is spent when it is refused.
   */
  consume(uid, cost, { perUser = 0, global = 0 } = {}) {
    this.roll()
    const mine = this.used(uid)
    const all = this.used(GLOBAL_KEY)
    if (global > 0 && all + cost > global) return { ok: false, reason: 'global', used: mine, limit: perUser, remaining: Math.max(0, perUser - mine) }
    if (perUser > 0 && mine + cost > perUser) return { ok: false, reason: 'user', used: mine, limit: perUser, remaining: Math.max(0, perUser - mine) }
    this.data.counts[uid] = mine + cost
    this.data.counts[GLOBAL_KEY] = all + cost
    this.save()
    return { ok: true, used: mine + cost, limit: perUser, remaining: perUser > 0 ? perUser - mine - cost : null }
  }

  /** Gives actions back after a failure on our side. Capped per person per day so errors cannot be farmed for free AI. */
  refund(uid, cost, maxPerDay = 5) {
    this.roll()
    const n = (this.data.refunds[uid] ?? 0) + 1
    if (n > maxPerDay) return
    this.data.refunds[uid] = n
    this.data.counts[uid] = Math.max(0, this.used(uid) - cost)
    this.data.counts[GLOBAL_KEY] = Math.max(0, this.used(GLOBAL_KEY) - cost)
    this.save()
  }

  resetAt() {
    return nextReset(this.now(), this.tz)
  }
}

// ---------------------------------------------------------------- configuration and middleware

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))

export function limitsFor(user) {
  const unlimited = (process.env.UNLIMITED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return {
    perUser: user?.email && unlimited.includes(user.email) ? 0 : num(process.env.DAILY_AI_LIMIT, 40),
    // on a hosted server a missing global cap would mean no ceiling at all, so default to a conservative one
    global: num(process.env.GLOBAL_DAILY_AI_LIMIT, process.env.NODE_ENV === 'production' ? 500 : 0),
  }
}

let shared = null
export function defaultStore() {
  // Hosted servers restart often and lose their disk, so keep the counts in Firestore there.
  const durable = process.env.USAGE_BACKEND === 'firestore' || (process.env.NODE_ENV === 'production' && Boolean(process.env.FIREBASE_PROJECT_ID) && process.env.USAGE_BACKEND !== 'memory')
  return (shared ??= new UsageStore({
    file: durable ? null : process.env.USAGE_FILE || 'server/.data/usage.json',
    backend: durable ? new FirestoreUsageBackend() : null,
    tz: process.env.QUOTA_TIMEZONE || 'UTC',
  }))
}

const human = (d, tz) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })

/** Express middleware: spend `cost` AI actions for the signed-in user, or refuse with a clear message. */
export function meterAI(cost, store = null) {
  return (req, res, next) => {
    const s = store ?? defaultStore()
    if (!cost || !req.user) return next() // free actions, and open (unauthenticated) local mode, are not metered
    if (req.ownKey) {
      res.set('X-AI-Key', 'own') // the person's own API key pays for this, so it does not use the shared allowance
      return next()
    }
    const lim = limitsFor(req.user)
    const r = s.consume(req.user.uid, cost, lim)
    const reset = s.resetAt()
    if (lim.perUser > 0) {
      res.set('X-AI-Limit', String(lim.perUser))
      res.set('X-AI-Used', String(r.ok ? r.used : s.used(req.user.uid)))
      res.set('X-AI-Reset', reset.toISOString())
    }
    if (!r.ok) {
      const paused = r.reason === 'global'
      return res.status(paused ? 503 : 429).json({
        error: paused
          ? 'AI is paused for today to keep costs under control. Foods you have logged before and meal plans still work, and AI returns tomorrow.'
          : `You have used all ${lim.perUser} AI actions for today. Foods you have logged before and meal plans still work, and your allowance resets at ${human(reset, s.tz)}.`,
        code: paused ? 'ai_paused' : 'daily_limit',
        used: r.used,
        limit: lim.perUser,
        resetAt: reset.toISOString(),
      })
    }
    // a request that fails on our side should not use up the allowance
    res.on('finish', () => {
      if (res.statusCode >= 500) s.refund(req.user.uid, cost)
    })
    next()
  }
}

/** Handler for GET /api/usage */
export function usageHandler(store = null) {
  return (req, res) => {
    const s = store ?? defaultStore()
    if (!req.user) return res.json({ enabled: false })
    const lim = limitsFor(req.user)
    const used = s.used(req.user.uid)
    res.json({
      enabled: true,
      unlimited: lim.perUser === 0,
      ownKey: Boolean(req.ownKey),
      used,
      limit: lim.perUser,
      remaining: lim.perUser > 0 ? Math.max(0, lim.perUser - used) : null,
      resetAt: s.resetAt().toISOString(),
    })
  }
}
