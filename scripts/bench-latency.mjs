// Measures where the time goes when logging a meal, so speed-ups are based on numbers.
// Usage: node --env-file=.env scripts/bench-latency.mjs [runs]
import { SYSTEM } from '../server/analyze.mjs'

const RUNS = Number(process.argv[2]) || 3
const TEXT = 'two idli with sambar and a cup of filter coffee'
const KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash'
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

async function call(label, generationConfig) {
  const times = []
  let detail = ''
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: TEXT }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2, ...generationConfig } }),
    })
    const body = await res.json()
    times.push(Math.round(performance.now() - t0))
    if (!res.ok) {
      detail = body?.error?.message?.slice(0, 90) ?? `HTTP ${res.status}`
      break
    }
    const u = body.usageMetadata ?? {}
    detail = `out ${u.candidatesTokenCount ?? '?'} tok, thinking ${u.thoughtsTokenCount ?? 0} tok`
  }
  console.log(`${label.padEnd(34)} ${times.join(' / ').padEnd(24)} ms  ${detail}`)
}

console.log(`model ${MODEL}, ${RUNS} run(s) each\n`)
await call('default (as in production)', { maxOutputTokens: 6000 })
await call('thinkingBudget 0', { maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 } })
await call('thinkingLevel minimal', { maxOutputTokens: 2000, thinkingConfig: { thinkingLevel: 'minimal' } })
await call('thinkingLevel low', { maxOutputTokens: 2000, thinkingConfig: { thinkingLevel: 'low' } })
