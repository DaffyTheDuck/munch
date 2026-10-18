import { describe, expect, it } from 'vitest'
import { addDays, autoMeal, longDate } from '../src/util'

describe('longDate', () => {
  it('formats as weekday, month and ordinal day', () => {
    expect(longDate('2026-10-18')).toBe('Sunday, October 18th')
  })
  it.each([
    ['2026-10-01', '1st'],
    ['2026-10-02', '2nd'],
    ['2026-10-03', '3rd'],
    ['2026-10-04', '4th'],
    ['2026-10-11', '11th'],
    ['2026-10-12', '12th'],
    ['2026-10-13', '13th'],
    ['2026-10-21', '21st'],
    ['2026-10-22', '22nd'],
    ['2026-10-23', '23rd'],
    ['2026-10-30', '30th'],
  ])('%s ends in %s', (d, suffix) => {
    expect(longDate(d).endsWith(suffix)).toBe(true)
  })
})

const at = (h: number, m = 0) => new Date(2026, 9, 18, h, m)

describe('autoMeal (local time)', () => {
  it.each([
    [4, 'breakfast'],
    [10, 'breakfast'],
    [11, 'lunch'],
    [14, 'lunch'],
    [15, 'snack'],
    [17, 'snack'],
    [18, 'dinner'],
    [22, 'dinner'],
    [23, 'snack'],
    [2, 'snack'],
  ])('%i:00 is %s', (h, meal) => {
    expect(autoMeal(at(h))).toBe(meal)
  })

  it('switches exactly on the hour', () => {
    expect(autoMeal(at(10, 59))).toBe('breakfast')
    expect(autoMeal(at(11, 0))).toBe('lunch')
  })
})

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
