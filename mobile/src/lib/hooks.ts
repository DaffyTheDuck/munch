import { useEffect, useRef, useState, type RefObject } from 'react'
import { AccessibilityInfo, Keyboard, Platform, type View } from 'react-native'

// Smoothly counts a number up/down to its new value. Respects the system "reduce motion" setting.
export function useCountUp(target: number, ms = 700) {
  const [value, setValue] = useState(0)
  const from = useRef(0)
  const reduce = useRef(false)

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => (reduce.current = r))
  }, [])

  useEffect(() => {
    if (reduce.current) {
      from.current = target
      setValue(target)
      return
    }
    const start = Date.now()
    const f = from.current
    let raf = 0
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = f + (target - f) * eased
      from.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])

  return Math.round(value)
}

// How far a view must move up so it is not covered by the keyboard.
// It measures the view's real position, so it is correct whether or not the OS already resized the window.
export function useKeyboardLift(ref: RefObject<View | null>) {
  const [lift, setLift] = useState(0)
  const current = useRef(0)

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, (e) => {
      ref.current?.measureInWindow((_x, y, _w, h) => {
        const restingBottom = y + h + current.current // where the view would sit with no lift
        const next = Math.max(0, restingBottom - e.endCoordinates.screenY)
        current.current = next
        setLift(next)
      })
    })
    const hide = Keyboard.addListener(hideEvt, () => {
      current.current = 0
      setLift(0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [ref])

  return lift
}

// Re-renders every `ms` so time-based labels (like the current meal) stay fresh.
export function useTicker(ms = 15000) {
  const [, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}
