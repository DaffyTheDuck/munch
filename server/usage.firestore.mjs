// Keeps the daily AI usage counts in Firestore so a Cloud Run restart does not reset them.
//
// No SDK and no key file: on Cloud Run the server asks the metadata server for a short-lived token for its own
// service account and calls the Firestore REST API. Document: serverUsage/{YYYY-MM-DD} with a map of counts.
// Clients cannot read or write it (firestore.rules only opens users/{uid}); the server's IAM role is what allows it.
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'

export class FirestoreUsageBackend {
  constructor({ projectId = process.env.FIREBASE_PROJECT_ID, fetchImpl = (...a) => fetch(...a) } = {}) {
    this.projectId = projectId
    this.fetch = fetchImpl
    this.token = null
    this.tokenExpires = 0
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpires - 60000) return this.token
    const res = await this.fetch(METADATA, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`metadata token ${res.status}`)
    const body = await res.json()
    this.token = body.access_token
    this.tokenExpires = Date.now() + (body.expires_in ?? 600) * 1000
    return this.token
  }

  url(day) {
    return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/serverUsage/${encodeURIComponent(day)}`
  }

  /** Returns { counts, refunds } for the day, or null when there is none yet. */
  async load(day) {
    const res = await this.fetch(this.url(day), { headers: { Authorization: `Bearer ${await this.accessToken()}` }, signal: AbortSignal.timeout(5000) })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`firestore load ${res.status}`)
    const doc = await res.json()
    return { counts: fromMap(doc.fields?.counts), refunds: fromMap(doc.fields?.refunds) }
  }

  async save(day, { counts, refunds }) {
    const body = { fields: { counts: toMap(counts), refunds: toMap(refunds ?? {}), updatedAt: { timestampValue: new Date().toISOString() } } }
    const res = await this.fetch(this.url(day), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`firestore save ${res.status}`)
  }
}

const toMap = (obj) => ({ mapValue: { fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { integerValue: String(Math.max(0, Math.round(Number(v) || 0))) }])) } })
const fromMap = (m) => Object.fromEntries(Object.entries(m?.mapValue?.fields ?? {}).map(([k, v]) => [k, Number(v.integerValue ?? 0)]))
