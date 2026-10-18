// Learning what the user likes, with Thompson sampling.
//
// Every food has a Beta(a, b) belief about "would this person like to eat it?". Logging a suggested meal counts as a
// success, swapping it away counts as a failure. When ranking candidates we draw one sample from each belief, so
// well-liked foods win most of the time while uncertain ones still get tried (the explore/exploit balance of a
// Bernoulli bandit; see Chapelle & Li 2011, and Li et al. 2010 for the contextual version).
//
// Old evidence slowly fades (decay), so tastes can change.

export interface Beta {
  a: number
  b: number
}

export type Taste = Record<string, Beta>

/** Mild prior: we start unsure, but not completely ignorant. */
export const PRIOR: Beta = { a: 2, b: 2 }

export type Feedback = 'liked' | 'swapped'

const DECAY = 0.985
const MAX_ENTRIES = 600

export function updateTaste(taste: Taste, ids: string[], kind: Feedback): Taste {
  const next: Taste = {}
  for (const [id, v] of Object.entries(taste)) {
    // shrink old evidence toward the prior
    next[id] = { a: PRIOR.a + (v.a - PRIOR.a) * DECAY, b: PRIOR.b + (v.b - PRIOR.b) * DECAY }
  }
  for (const id of ids) {
    const cur = next[id] ?? { ...PRIOR }
    next[id] = kind === 'liked' ? { a: cur.a + 1, b: cur.b } : { a: cur.a, b: cur.b + 1 }
  }
  const entries = Object.entries(next)
  if (entries.length > MAX_ENTRIES) {
    // keep the foods with the most evidence
    entries.sort((x, y) => y[1].a + y[1].b - (x[1].a + x[1].b))
    return Object.fromEntries(entries.slice(0, MAX_ENTRIES))
  }
  return next
}

/** Posterior mean (no randomness), handy for explanations and tests. */
export const meanOf = (b: Beta) => b.a / (b.a + b.b)

// ---------------------------------------------------------------- seeded randomness

/** Small, fast, seedable PRNG (mulberry32), so plans are reproducible in tests. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(rand: () => number): number {
  // Box-Muller
  const u = Math.max(rand(), 1e-12)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Marsaglia & Tsang (2000) gamma sampler
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) return gamma(shape + 1, rand) * Math.pow(Math.max(rand(), 1e-12), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = normal(rand)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rand()
    if (u < 1 - 0.0331 * x ** 4) return d * v
    if (Math.log(Math.max(u, 1e-12)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

export function sampleBeta(b: Beta, rand: () => number): number {
  const x = gamma(b.a, rand)
  const y = gamma(b.b, rand)
  return x / (x + y)
}
