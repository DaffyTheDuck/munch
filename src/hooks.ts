import { useEffect, useRef, useState } from 'react'

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Smoothly animates a number from its previous value to the new target.
export function useCountUp(target: number, ms = 750) {
  const [v, setV] = useState(reduced() ? target : 0)
  const from = useRef(reduced() ? target : 0)

  useEffect(() => {
    if (reduced()) {
      setV(target)
      from.current = target
      return
    }
    const start = performance.now()
    const f = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      const val = f + (target - f) * eased
      from.current = val
      setV(val)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])

  return Math.round(v)
}
