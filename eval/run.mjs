// Benchmarks the analysis pipeline against eval/dataset.json.
// Usage: node --env-file=.env eval/run.mjs [--provider gemini|anthropic] [--no-grounding] [--limit N] [--label name]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { analyzeInput } from '../server/analyze.mjs'
import { providerInfo } from '../server/llm.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)

// Benchmarks must measure one model, so disable silent fallback unless asked.
if (!flag('allow-fallback')) process.env.AI_FALLBACKS = ''
const provider = opt('provider')
const grounding = !flag('no-grounding')
const limit = Number(opt('limit', 0)) || undefined
const label = opt('label', grounding ? 'grounded' : 'ungrounded')
const CONCURRENCY = 3

const dataset = JSON.parse(await readFile(new URL('./dataset.json', import.meta.url), 'utf8')).slice(0, limit)
const info = providerInfo(provider)

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0
}

async function runCase(c) {
  const t0 = Date.now()
  try {
    const r = await analyzeInput({ text: c.text, provider, grounding })
    const kcal = r.items.reduce((s, i) => s + i.calories, 0)
    const [lo, hi] = c.kcal
    const mid = (lo + hi) / 2
    const within = kcal >= lo && kcal <= hi
    const outside = within ? 0 : kcal < lo ? lo - kcal : kcal - hi
    return {
      id: c.id, cuisine: c.cuisine, text: c.text, expected: c.kcal, kcal, within,
      apePct: Math.abs(kcal - mid) / mid * 100,
      missPct: (outside / mid) * 100,
      ms: Date.now() - t0, repaired: r.meta.repaired, grounded: r.meta.grounded, foodItems: r.meta.foodItems, error: null,
    }
  } catch (e) {
    return { id: c.id, cuisine: c.cuisine, text: c.text, expected: c.kcal, error: e.message, ms: Date.now() - t0 }
  }
}

const results = []
let next = 0
let stopped = false
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < dataset.length && !stopped) {
      const c = dataset[next++]
      const r = await runCase(c)
      results.push(r)
      if (r.error && /quota|rate limit|429|api key|not set/i.test(r.error)) {
        stopped = true
        console.error(`\nStopping early: ${r.error}`)
      }
      console.log(`${r.error ? 'ERR ' : r.within ? 'ok  ' : 'MISS'} #${String(c.id).padStart(2)} ${c.text.slice(0, 46).padEnd(46)} ${r.error ? r.error.slice(0, 50) : `${r.kcal} kcal (expected ${c.kcal[0]}-${c.kcal[1]})`}`)
    }
  }),
)
results.sort((a, b) => a.id - b.id)

const ok = results.filter((r) => !r.error)
const summary = {
  label, provider: info.provider, model: info.model, grounding, date: new Date().toISOString().slice(0, 10),
  cases: results.length, failures: results.length - ok.length,
  withinRangePct: +((ok.filter((r) => r.within).length / (ok.length || 1)) * 100).toFixed(1),
  mapePct: +(ok.reduce((s, r) => s + r.apePct, 0) / (ok.length || 1)).toFixed(1),
  medianMissPct: +pct(ok.map((r) => r.missPct), 50).toFixed(1),
  p50Ms: pct(ok.map((r) => r.ms), 50), p95Ms: pct(ok.map((r) => r.ms), 95),
  repairedPct: +((ok.filter((r) => r.repaired).length / (ok.length || 1)) * 100).toFixed(1),
  groundedPct: +((ok.reduce((s, r) => s + r.grounded, 0) / (ok.reduce((s, r) => s + r.foodItems, 0) || 1)) * 100).toFixed(1),
}

console.log('\n' + JSON.stringify(summary, null, 2))
if (summary.failures > Math.ceil(dataset.length * 0.1)) {
  console.error(`\n${summary.failures}/${dataset.length} cases failed, so these numbers are not meaningful. Results were NOT saved.`)
  process.exit(1)
}
await mkdir(new URL('./results/', import.meta.url), { recursive: true })
await writeFile(new URL(`./results/${label}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 2))
