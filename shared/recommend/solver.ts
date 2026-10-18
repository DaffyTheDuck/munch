// Portion optimiser: a small bounded least-squares solver.
//
// Given a fixed set of foods, find how many servings of each to eat so that the totals land as close as possible to
// the calorie and macro targets, without drifting far from a normal portion. This is the continuous core of the
// classic "diet problem" (Stigler 1945; Dantzig 1990), solved as a convex quadratic program by cyclic coordinate
// descent with box constraints. Each coordinate update has a closed form, so it needs no external solver.

export interface Row {
  /** the total we want: sum_i a[i] * x[i] */
  target: number
  /** how much this row matters relative to the others */
  weight: number
  /** per-serving contribution of each variable to this row */
  a: number[]
}

export interface Variable {
  min: number
  max: number
  /** the portion we would like to stay near (usually 1 serving) */
  prior: number
  /** strength of that pull */
  priorWeight: number
}

export interface Solution {
  x: number[]
  cost: number
}

/** Weighted squared relative error of the rows, plus a pull towards each variable's prior. */
export function cost(rows: Row[], vars: Variable[], x: number[]): number {
  let c = 0
  for (const r of rows) {
    let s = 0
    for (let i = 0; i < x.length; i++) s += r.a[i] * x[i]
    const scale = Math.max(Math.abs(r.target), 1)
    c += r.weight * ((s - r.target) / scale) ** 2
  }
  for (let i = 0; i < x.length; i++) c += vars[i].priorWeight * (x[i] - vars[i].prior) ** 2
  return c
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Minimises `cost` over the box constraints. Convex, so coordinate descent converges to the global optimum. */
export function solve(rows: Row[], vars: Variable[], maxIter = 80): Solution {
  const n = vars.length
  const x = vars.map((v) => clamp(v.prior, v.min, v.max))
  const scale2 = rows.map((r) => Math.max(Math.abs(r.target), 1) ** 2)

  for (let it = 0; it < maxIter; it++) {
    let moved = 0
    for (let i = 0; i < n; i++) {
      let A = vars[i].priorWeight
      let B = -vars[i].priorWeight * vars[i].prior
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k]
        let rest = -r.target
        for (let j = 0; j < n; j++) if (j !== i) rest += r.a[j] * x[j]
        const w = r.weight / scale2[k]
        A += w * r.a[i] * r.a[i]
        B += w * r.a[i] * rest
      }
      const next = A > 1e-12 ? clamp(-B / A, vars[i].min, vars[i].max) : x[i]
      moved = Math.max(moved, Math.abs(next - x[i]))
      x[i] = next
    }
    if (moved < 1e-5) break
  }
  return { x, cost: cost(rows, vars, x) }
}

const snapTo = (v: number, step: number, lo: number, hi: number) => clamp(Math.round(v / step) * step, lo, hi)

/**
 * Real portions have to be countable ("1.5 cups", "3 rotis"), so snap each variable to its step, then try nudging
 * each one a step up or down while that lowers the cost.
 */
export function snapAndPolish(rows: Row[], vars: Variable[], steps: number[], x0: number[], passes = 3): Solution {
  const x = x0.map((v, i) => snapTo(v, steps[i], vars[i].min, vars[i].max))
  let best = cost(rows, vars, x)
  for (let p = 0; p < passes; p++) {
    let improved = false
    for (let i = 0; i < x.length; i++) {
      for (const dir of [-1, 1]) {
        const cand = clamp(x[i] + dir * steps[i], vars[i].min, vars[i].max)
        if (cand === x[i]) continue
        const old = x[i]
        x[i] = cand
        const c = cost(rows, vars, x)
        if (c < best - 1e-12) {
          best = c
          improved = true
        } else x[i] = old
      }
    }
    if (!improved) break
  }
  return { x, cost: best }
}
