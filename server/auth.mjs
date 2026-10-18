// Verifies Firebase ID tokens on the API without needing the Firebase Admin SDK or a service account.
//
// Enabled when FIREBASE_PROJECT_ID is set; otherwise the API stays open exactly as before (local development).
//   ALLOWED_EMAILS     optional, comma separated. When set, only these Google accounts may use the API.
//   RATE_LIMIT_PER_MIN optional, requests per user per minute (default 60).
import { createRemoteJWKSet, jwtVerify } from 'jose'

const FIREBASE_JWKS = new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
let remoteKeys

export const authEnabled = () => Boolean(process.env.FIREBASE_PROJECT_ID)

export const allowedEmails = () =>
  (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

/** Verifies a Firebase ID token and returns the signed-in user. Throws if the token is invalid or expired. */
export async function verifyFirebaseToken(token, { projectId = process.env.FIREBASE_PROJECT_ID, keys } = {}) {
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set')
  const jwks = keys ?? (remoteKeys ??= createRemoteJWKSet(FIREBASE_JWKS))
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ['RS256'],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  })
  if (!payload.sub) throw new Error('Token has no subject')
  return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email.toLowerCase() : '', emailVerified: payload.email_verified === true }
}

// Simple per-user sliding-window limiter (in memory; fine for a single small server).
function createLimiter(limit, windowMs = 60000) {
  const hits = new Map()
  return (key, now = Date.now()) => {
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

/** Express middleware. Pass `keys` (a JWKS function) in tests to avoid network calls. */
export function requireAuth({ keys } = {}) {
  const limiter = createLimiter(Number(process.env.RATE_LIMIT_PER_MIN) || 60)
  return async (req, res, next) => {
    if (!authEnabled()) return next() // open mode, as before

    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'Please sign in to use the AI features.' })

    let user
    try {
      user = await verifyFirebaseToken(token, { keys })
    } catch {
      return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' })
    }

    const allowed = allowedEmails()
    if (allowed.length && !(user.emailVerified && allowed.includes(user.email))) {
      return res.status(403).json({ error: 'This Google account is not allowed to use this server.' })
    }
    if (!limiter(user.uid)) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' })

    req.user = user
    next()
  }
}
