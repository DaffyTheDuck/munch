// @ts-nocheck server modules are plain JS
import { describe, expect, it } from 'vitest'
import { AnalyzeResult, CoachAction, extractJson, validate } from '../server/schema.mjs'

describe('extractJson', () => {
  it('strips code fences and surrounding prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 })
  })
  it('throws when there is no object', () => {
    expect(() => extractJson('no json here')).toThrow()
  })
})

describe('AnalyzeResult', () => {
  it('coerces numeric strings and fills defaults', () => {
    const r = validate(AnalyzeResult, '{"items":[{"type":"food","name":"Toast","calories":"120"}],"note":""}')
    expect(r.ok).toBe(true)
    expect(r.data.items[0]).toMatchObject({ calories: 120, protein_g: 0, grams: 0, lookup: '', quantity: '' })
  })
  it('clamps negative and absurd values', () => {
    const r = validate(AnalyzeResult, '{"items":[{"type":"food","name":"x","calories":-50,"fat_g":999999}],"note":""}')
    expect(r.data.items[0].calories).toBe(0)
    expect(r.data.items[0].fat_g).toBe(10000)
  })
  it('rejects unknown item types and reports why', () => {
    const r = validate(AnalyzeResult, '{"items":[{"type":"drink","name":"x","calories":1}]}')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/type/)
  })
  it('accepts an empty result with a note', () => {
    expect(validate(AnalyzeResult, '{"items":[],"note":"not food"}').ok).toBe(true)
  })
})

describe('CoachAction', () => {
  it('parses a tool call and an answer', () => {
    expect(validate(CoachAction, '{"action":"tool","name":"get_goals"}').data).toEqual({ action: 'tool', name: 'get_goals', args: {} })
    expect(validate(CoachAction, '{"action":"answer","text":"Eat more protein."}').ok).toBe(true)
  })
  it('rejects an empty answer', () => {
    expect(validate(CoachAction, '{"action":"answer","text":""}').ok).toBe(false)
  })
})
