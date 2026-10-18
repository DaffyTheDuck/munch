// Pure date and meal helpers shared by the web and mobile apps (no DOM or React Native APIs).
import type { Meal } from './types'

export function todayStr(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function addDays(date: string, n: number) {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return todayStr(d)
}

export const MEALS: { id: Meal; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'snack', label: 'Snack' },
  { id: 'dinner', label: 'Dinner' },
]

// Picks the meal from the user's local clock.
// 04-11 breakfast, 11-15 lunch, 15-18 snack, 18-23 dinner, late night counts as a snack.
export function autoMeal(now = new Date()): Meal {
  const h = now.getHours()
  if (h < 4 || h >= 23) return 'snack'
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 18) return 'snack'
  return 'dinner'
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// "Sunday, October 18th" (fixed English names so it does not depend on Intl support on every device)
export function longDate(date: string) {
  const d = new Date(date + 'T12:00:00')
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}`
}

export function prettyDate(date: string) {
  if (date === todayStr()) return 'Today'
  if (date === addDays(todayStr(), -1)) return 'Yesterday'
  const d = new Date(date + 'T12:00:00')
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}
