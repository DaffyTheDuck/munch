// @ts-nocheck server modules are plain JS
import { describe, expect, it, vi } from 'vitest'
import { applyCandidate, groundItem, parseCandidates, pickCandidate, searchFdc } from '../server/grounding.mjs'

const fdcBody = {
  foods: [
    {
      fdcId: 1,
      description: 'Rice, white, long-grain, cooked',
      foodNutrients: [
        { nutrientNumber: '208', nutrientId: 1008, value: 130 },
        { nutrientNumber: '203', nutrientId: 1003, value: 2.7 },
        { nutrientNumber: '204', nutrientId: 1004, value: 0.3 },
        { nutrientNumber: '205', nutrientId: 1005, value: 28 },
      ],
    },
    { fdcId: 2, description: 'No energy listed', foodNutrients: [{ nutrientNumber: '203', value: 5 }] },
    {
      fdcId: 3,
      description: 'Rice, brown, cooked (Foundation uses Atwater energy id)',
      foodNutrients: [
        { nutrientId: 2047, value: 123 },
        { nutrientNumber: '203', value: 2.7 },
        { nutrientNumber: '204', value: 1 },
        { nutrientNumber: '205', value: 25.6 },
      ],
    },
  ],
}

describe('parseCandidates', () => {
  it('extracts per-100g nutrients and drops foods with no energy', () => {
    const c = parseCandidates(fdcBody)
    expect(c).toHaveLength(2)
    expect(c[0].per100).toEqual({ kcal: 130, protein: 2.7, fat: 0.3, carbs: 28 })
    expect(c[1].per100.kcal).toBe(123)
  })
})

describe('pickCandidate', () => {
  const cands = parseCandidates(fdcBody)
  const rice = (kcal) => ({ kcal, protein: 2.7, carbs: 27, fat: 0.5, lookup: 'rice white cooked' })

  it('picks the candidate closest in energy among valid matches', () => {
    expect(pickCandidate(cands, rice(124)).id).toBe(3)
    expect(pickCandidate(cands, rice(133)).id).toBe(1)
  })
  it('rejects matches outside the energy tolerance', () => {
    expect(pickCandidate(cands, rice(300))).toBeNull()
  })
  it('rejects a similar-energy food with different macros (beer vs cola)', () => {
    const cola = parseCandidates({
      foods: [{ fdcId: 9, description: 'Beverages, carbonated, cola, regular', foodNutrients: [{ nutrientNumber: '208', value: 41 }, { nutrientNumber: '203', value: 0 }, { nutrientNumber: '204', value: 0 }, { nutrientNumber: '205', value: 10.6 }] }],
    })
    expect(pickCandidate(cola, { kcal: 42, protein: 0.4, carbs: 3.6, fat: 0, lookup: 'beer regular' })).toBeNull()
  })
  it('rejects a candidate whose name does not match the lookup', () => {
    const taco = parseCandidates({
      foods: [{ fdcId: 7, description: 'TACO BELL, Soft Taco with steak', foodNutrients: [{ nutrientNumber: '208', value: 215 }, { nutrientNumber: '203', value: 11 }, { nutrientNumber: '204', value: 11 }, { nutrientNumber: '205', value: 17 }] }],
    })
    expect(pickCandidate(taco, { kcal: 225, protein: 12, carbs: 17, fat: 12, lookup: 'pork carnitas tacos' })).toBeNull()
  })
  it('handles empty input', () => {
    expect(pickCandidate([], rice(130))).toBeNull()
    expect(pickCandidate(cands, rice(0))).toBeNull()
  })
})

describe('applyCandidate', () => {
  it('scales per-100g values to the portion', () => {
    const cand = parseCandidates(fdcBody)[0]
    const out = applyCandidate({ grams: 200, calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }, cand)
    expect(out).toMatchObject({ calories: 260, protein_g: 5, carbs_g: 56, fat_g: 1, source: 'usda' })
  })
})

describe('groundItem', () => {
  const item = { type: 'food', name: 'Rice', grams: 200, calories: 270, protein_g: 5, carbs_g: 56, fat_g: 1, lookup: 'rice white cooked' }

  it('keeps the AI estimate for exercise and for items without a lookup', async () => {
    expect((await groundItem({ ...item, type: 'exercise' })).source).toBe('ai')
    expect((await groundItem({ ...item, lookup: '' })).source).toBe('ai')
  })

  it('falls back to the AI estimate when the database call fails', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    expect((await groundItem({ ...item, lookup: 'fail-case' })).source).toBe('ai')
    spy.mockRestore()
  })

  it('uses the database value when it agrees with the estimate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => fdcBody })
    const cands = await searchFdc('unique-query', { fetchImpl })
    expect(cands).toHaveLength(2)
    const out = await groundItem(item, { fetchImpl })
    expect(out.source).toBe('usda')
    expect(out.calories).toBe(260)
  })
})
