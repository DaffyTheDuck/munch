// @ts-nocheck server modules are plain JS
import { describe, expect, it, vi } from 'vitest'
import { geminiCap, hedge } from '../server/llm.mjs'

const ok = (provider, ms, text = provider) => ({ name: provider, run: () => new Promise((r) => setTimeout(() => r({ text, provider, model: 'm', ms }), ms)) })
const bad = (provider, ms, message = 'boom') => ({ name: provider, run: () => new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms)) })

describe('hedged provider calls', () => {
  it('uses the first provider when it answers quickly, and never starts the second', async () => {
    const second = vi.fn()
    const r = await hedge([ok('gemini', 20), { name: 'groq', run: second }], 200)
    expect(r.provider).toBe('gemini')
    expect(second).not.toHaveBeenCalled()
  })

  it('falls over immediately when the first fails', async () => {
    const t0 = Date.now()
    const r = await hedge([bad('gemini', 10), ok('groq', 10)], 5000)
    expect(r.provider).toBe('groq')
    expect(r.fellBackFrom).toEqual(['gemini'])
    expect(Date.now() - t0).toBeLessThan(1000) // did not wait for the hedge delay
  })

  it('asks the next provider too when the first is slow, and takes whichever answers first', async () => {
    const t0 = Date.now()
    const r = await hedge([ok('gemini', 1500), ok('groq', 30)], 100)
    expect(r.provider).toBe('groq')
    expect(Date.now() - t0).toBeLessThan(800) // ~ hedge delay + groq, not gemini's 1.5 s
  })

  it('still lets a slow first answer win if the second is slower', async () => {
    const r = await hedge([ok('gemini', 150), ok('groq', 1000)], 50)
    expect(r.provider).toBe('gemini')
  })

  it('fails with a clear, redacted message when everything fails', async () => {
    await expect(hedge([bad('gemini', 5, 'bad key AIzaSyABCDEFGHIJKLMNOPQRSTUV'), bad('groq', 5, 'down')], 50)).rejects.toThrow(/All AI providers failed/)
    try {
      await hedge([bad('gemini', 5, 'bad key AIzaSyABCDEFGHIJKLMNOPQRSTUV'), bad('groq', 5)], 50)
    } catch (e) {
      expect(e.message).not.toContain('AIzaSyABCDEFGHIJKLMNOPQRSTUV')
    }
  })

  it('a single provider just runs once', async () => {
    const run = vi.fn(async () => ({ text: 'x', provider: 'gemini', model: 'm', ms: 1 }))
    await hedge([{ name: 'gemini', run }], 10)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('output caps', () => {
  it('leaves room for thinking normally, and is tight when thinking is off', () => {
    expect(geminiCap(1500)).toBe(6000)
    expect(geminiCap(1500, true)).toBe(3000)
    expect(geminiCap(200, true)).toBe(2000)
  })
})
