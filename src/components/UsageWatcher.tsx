import { useEffect, useRef } from 'react'
import { useUsage, warningFor } from '../lib/usage'
import { useToast } from './Toast'

// Shows a single heads-up when the daily AI allowance is almost used up, and again when it runs out.
// The number itself lives only in Settings.
export default function UsageWatcher() {
  const usage = useUsage()
  const toast = useToast()
  const warned = useRef<string>('')
  useEffect(() => {
    const w = warningFor(usage)
    if (!w) return
    const key = `${usage.resetAt ?? ''}:${w.level}`
    if (warned.current === key) return
    warned.current = key
    toast(w.text)
  }, [usage, toast])
  return null
}
