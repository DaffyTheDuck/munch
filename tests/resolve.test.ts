import { describe, expect, it } from 'vitest'
import { parseSegment, parseServing, phraseKey, resolveLocally, servingsFor } from '../shared/resolve'
import { CATALOG } from '../shared/recommend/catalog'
import type { HistoryFood } from '../shared/recommend/types'

const names = (r: ReturnType<typeof resolveLocally>) => r.items.map((i) => i.name)
const hist = (over: Partial<HistoryFood>): HistoryFood => ({ name: 'Khari puff', meal: 'snack', kcal: 170, protein: 3, carbs: 18, fat: 10, quantity: '2 pieces', count: 3, daysAgo: 1, ...over })

describe('parsing quantities', () => {
  it('reads numbers, number words, fractions and Hindi numerals', () => {
    expect(parseSegment('2 idli')).toMatchObject({ qty: 2, unit: null, phrase: 'idli' })
    expect(parseSegment('Two Idlis')).toMatchObject({ qty: 2, unit: null, phrase: 'idli' })
    expect(parseSegment('half a banana')).toMatchObject({ qty: 0.5, unit: null, phrase: 'banana' })
    expect(parseSegment('1/2 cup rice')).toMatchObject({ qty: 0.5, unit: 'cup', phrase: 'rice' })
    expect(parseSegment('1 1/2 cups rice')).toMatchObject({ qty: 1.5, unit: 'cup', phrase: 'rice' })
    expect(parseSegment('ek roti')).toMatchObject({ qty: 1, unit: null, phrase: 'roti' })
    expect(parseSegment('do idli')).toMatchObject({ qty: 2, unit: null, phrase: 'idli' })
    expect(parseSegment('a glass of milk')).toMatchObject({ qty: 1, unit: 'glass', phrase: 'milk' })
  })
  it('reads weights and volumes, attached or separate', () => {
    expect(parseSegment('200g paneer tikka')).toMatchObject({ qty: 200, unit: 'g', phrase: 'paneer tikka' })
    expect(parseSegment('150 grams rice')).toMatchObject({ qty: 150, unit: 'g', phrase: 'rice' })
    expect(parseSegment('1 kg rice')).toMatchObject({ qty: 1000, unit: 'g', phrase: 'rice' })
    expect(parseSegment('250 ml milk')).toMatchObject({ qty: 250, unit: 'ml', phrase: 'milk' })
  })
  it('treats a bare food name as one', () => {
    expect(parseSegment('banana')).toMatchObject({ qty: 1, unit: null, phrase: 'banana', explicit: false })
    expect(parseSegment('1 banana')).toMatchObject({ explicit: true })
    expect(parseSegment('')).toBeNull()
    expect(parseSegment('   ')).toBeNull()
  })
  it('normalises names (case, plurals, filler words)', () => {
    expect(phraseKey('Idlis')).toBe(phraseKey('idli'))
    expect(phraseKey('Glass of Milk')).toBe('glass milk')
    expect(phraseKey('Boiled Eggs')).toBe(phraseKey('boiled egg'))
  })
})

describe('reading serving labels', () => {
  it('finds the count and unit', () => {
    expect(parseServing('2 pieces (80 g)')).toMatchObject({ count: 2, unit: 'piece' })
    expect(parseServing('1 cup cooked (160 g)')).toMatchObject({ count: 1, unit: 'cup' })
    expect(parseServing('1/4 cup (60 g)')).toMatchObject({ count: 0.25, unit: 'cup' })
    expect(parseServing('2 rotis (80 g)')).toMatchObject({ count: 2, unit: null })
    expect(parseServing('120 g')).toMatchObject({ gramBased: true })
    expect(parseServing('2-egg omelette (130 g)')).toMatchObject({ count: 1 }) // one omelette, not two
  })
})

describe('how many servings a typed quantity is', () => {
  const rotis = { label: '2 rotis (80 g)', grams: 80 }
  const rice = { label: '1 cup cooked (160 g)', grams: 160 }
  it('counts plain numbers against the serving count', () => {
    expect(servingsFor({ qty: 3, unit: null }, rotis)).toBe(1.5)
    expect(servingsFor({ qty: 1, unit: null }, rotis)).toBe(0.5)
  })
  it('matches units only when the serving is measured in that unit', () => {
    expect(servingsFor({ qty: 2, unit: 'cup' }, rice)).toBe(2)
    expect(servingsFor({ qty: 2, unit: 'bowl' }, rice)).toBeNull()
  })
  it('uses grams when given', () => {
    expect(servingsFor({ qty: 200, unit: 'g' }, rice)).toBe(1.25)
    expect(servingsFor({ qty: 200, unit: 'g' }, { label: 'x', grams: 0 })).toBeNull()
  })
  it('refuses absurd or tiny amounts', () => {
    expect(servingsFor({ qty: 20, unit: null }, rotis)).toBeNull() // 10 servings
    expect(servingsFor({ qty: 5, unit: 'g' }, rice)).toBeNull()
  })
  it('does not guess a count for a weight-based serving', () => {
    expect(servingsFor({ qty: 2, unit: null }, { label: '120 g', grams: 120 })).toBeNull()
  })
})

describe('resolving text from the catalog', () => {
  it('resolves common foods and scales the numbers', () => {
    const r = resolveLocally('2 idli')
    expect(names(r)).toEqual(['Idli (2 pieces)'])
    expect(r.items[0]).toMatchObject({ type: 'food', calories: 109, source: 'local' })
    expect(r.rest).toBe('')

    const roti = resolveLocally('3 roti').items[0]
    expect(roti.calories).toBe(320) // 213 kcal per 2 rotis x 1.5
    expect(roti.quantity).toBe('1.5 × 2 rotis (80 g)')
  })

  it('handles several foods in one message, in several styles', () => {
    expect(names(resolveLocally('1 banana and 2 apples'))).toEqual(['Banana', 'Apple'])
    expect(names(resolveLocally('2 Idlis, 1 Banana!'))).toEqual(['Idli (2 pieces)', 'Banana'])
    expect(names(resolveLocally('banana aur chai'))).toEqual(['Banana', 'Masala chai'])
    expect(resolveLocally('banana + apple').items).toHaveLength(2)
  })

  it('understands units that match the serving', () => {
    expect(resolveLocally('2 cups rice').items[0].calories).toBe(402) // 201 x 2
    expect(resolveLocally('200 g rice').items[0].calories).toBe(251) // 201 x 1.25
    expect(resolveLocally('a glass of milk').items[0].name).toBe('Milk')
    expect(resolveLocally('half a banana').items[0].calories).toBe(59) // 117 kcal x 0.5, rounded
    expect(resolveLocally('ek roti').items[0].calories).toBe(107)
  })

  it('accepts aliases and regional names', () => {
    expect(names(resolveLocally('2 chapati'))).toEqual(['Whole-wheat roti (2)'])
    expect(names(resolveLocally('1 dahi'))).toEqual(['Curd (yogurt)'])
    expect(names(resolveLocally('chole'))).toEqual(['Chana masala'])
    expect(names(resolveLocally('2 boiled eggs'))).toEqual(['Boiled eggs (2)'])
    expect(resolveLocally('1 boiled egg').items[0].calories).toBe(76) // half of the 151 kcal two-egg serving
    expect(names(resolveLocally('3 anda'))).toEqual(['Boiled egg'])
  })

  it('does not guess when a bare name is ambiguous about how many', () => {
    expect(resolveLocally('idli').items).toHaveLength(0) // 1 idli or the 2-piece serving?
    expect(resolveLocally('roti').items).toHaveLength(0)
    expect(resolveLocally('banana').items).toHaveLength(1) // a single item is clear
    expect(resolveLocally('rice').items).toHaveLength(1) // one cup
  })

  it('leaves unclear things to the AI', () => {
    for (const t of ['30 min run', 'chicken', 'dal', 'pasta', 'egg', 'some fancy restaurant dish', '2 bowls roti', '20 idli', 'tea or coffee']) {
      const r = resolveLocally(t)
      expect(r.items, t).toHaveLength(0)
      expect(r.rest, t).toBe(t)
    }
  })

  it('splits a message into what it knows and what it does not (original wording kept)', () => {
    const r = resolveLocally('2 idli and Truffle Risotto, 1 banana')
    expect(names(r)).toEqual(['Idli (2 pieces)', 'Banana'])
    expect(r.rest).toBe('Truffle Risotto')
  })

  it('returns nothing for empty input', () => {
    expect(resolveLocally('')).toEqual({ items: [], rest: '' })
    expect(resolveLocally(' , ; ')).toEqual({ items: [], rest: '' })
  })

  it('every alias resolves to a real catalog food', () => {
    for (const probe of ['2 idli', 'rice', '2 roti', 'banana', 'rajma', 'sambar', 'poha', '3 tbsp hummus']) {
      const r = resolveLocally(probe)
      expect(r.items.length, probe).toBe(1)
      expect(CATALOG.some((f) => f.name === r.items[0].name), probe).toBe(true)
    }
  })
})

describe('resolving from your own history', () => {
  it('uses your logged numbers, and they beat the catalog', () => {
    const r = resolveLocally('khari puff', [hist({})])
    expect(r.items[0]).toMatchObject({ name: 'Khari puff', calories: 170, source: 'local', match: 'Matched from your history' })
    expect(resolveLocally('2 khari puff', [hist({})]).items[0].calories).toBe(170) // "2 pieces" is the serving
    expect(resolveLocally('1 khari puff', [hist({})]).items[0].calories).toBe(85)

    const mine = hist({ name: 'Banana', kcal: 90, quantity: '1 medium' })
    expect(resolveLocally('banana', [mine]).items[0].calories).toBe(90)
  })

  it('ignores history names that are ambiguous with each other', () => {
    const r = resolveLocally('chai', [hist({ name: 'Chai (tea)', kcal: 60, quantity: '1 cup' }), hist({ name: 'Chai', kcal: 120, quantity: '1 cup' })])
    // two different foods share the key "chai": the first (own history) is kept deterministically, never mixed
    expect(r.items).toHaveLength(1)
  })

  it('does not use history grams it does not have', () => {
    expect(resolveLocally('200 g khari puff', [hist({})]).items).toHaveLength(0)
  })

  it('never splits an unrelated phrase into a false match', () => {
    const r = resolveLocally('puff pastry', [hist({})])
    expect(r.items).toHaveLength(0)
  })
})

describe('the catalog index', () => {
  it('has no accidentally ambiguous names among the aliases the tests rely on', () => {
    // names claimed by two different foods are dropped on purpose; make sure the common ones survived
    for (const probe of ['2 idli', '2 roti', 'banana', 'apple', 'rice', 'curd', 'milk', 'chai', 'poha', '2 boiled eggs', 'rajma', 'sambar']) {
      expect(resolveLocally(probe).items.length, probe).toBe(1)
    }
  })
})
