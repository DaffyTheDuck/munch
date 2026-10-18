// @ts-nocheck server modules are plain JS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate, providerChain, providerInfo } from '../server/llm.mjs'

const ENV = ['AI_PROVIDER', 'AI_FALLBACKS', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY']
const saved = {}

const geminiOk = (text) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) })
const groqOk = (text) => ({ ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) })
const fail = (status, message) => ({ ok: false, status, json: async () => ({ error: { message } }) })

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.AI_PROVIDER = 'gemini'
  process.env.AI_FALLBACKS = 'groq'
  process.env.GEMINI_API_KEY = 'g'
  process.env.GROQ_API_KEY = 'q'
  delete process.env.ANTHROPIC_API_KEY
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  vi.restoreAllMocks()
})

const call = (extra = {}) => generate({ system: 's', messages: [{ role: 'user', text: 'hi' }], ...extra })

describe('providerChain', () => {
  it('puts the primary first and removes duplicates and unknown names', () => {
    process.env.AI_FALLBACKS = 'groq, gemini, nonsense'
    expect(providerChain()).toEqual(['gemini', 'groq'])
  })
  it('uses only the override when given (no fallback)', () => {
    expect(providerChain('anthropic')).toEqual(['anthropic'])
  })
  it('providerInfo lists only providers that have keys', () => {
    expect(providerInfo().chain).toEqual(['gemini', 'groq'])
    delete process.env.GROQ_API_KEY
    expect(providerInfo().chain).toEqual(['gemini'])
  })
})

describe('generate fallback', () => {
  it('uses the primary when it works', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiOk('{"ok":1}'))
    const r = await call()
    expect(r).toMatchObject({ provider: 'gemini', text: '{"ok":1}', fellBackFrom: [] })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('falls back to groq when gemini is overloaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('groq.com') ? groqOk('{"from":"groq"}') : fail(503, 'This model is currently experiencing high demand.'),
    )
    const r = await call()
    expect(r.provider).toBe('groq')
    expect(r.fellBackFrom).toEqual(['gemini'])
    expect(r.text).toBe('{"from":"groq"}')
  })

  it('falls back when the primary times out', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('groq.com')) return groqOk('{}')
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    })
    expect((await call()).provider).toBe('groq')
  })

  it('skips providers without a key', async () => {
    process.env.GEMINI_API_KEY = ''
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(groqOk('{}'))
    expect((await call()).provider).toBe('groq')
    expect(String(f.mock.calls[0][0])).toContain('groq.com')
  })

  it('switches groq to the vision model when an image is attached', async () => {
    process.env.GEMINI_API_KEY = ''
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(groqOk('{}'))
    await call({ messages: [{ role: 'user', text: 'what is this', image: 'data:image/jpeg;base64,AAAA' }] })
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body.model).toMatch(/llama-4|vision/)
    expect(body.messages[1].content[0].type).toBe('image_url')
  })

  it('reports every failure when all providers fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fail(429, 'quota exceeded'))
    await expect(call()).rejects.toThrow(/All AI providers failed.*gemini.*groq/)
  })

  it('does not fall back when a specific provider is requested', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fail(503, 'busy'))
    await expect(call({ provider: 'gemini' })).rejects.toThrow('busy')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('explains a missing key', async () => {
    process.env.GEMINI_API_KEY = ''
    process.env.GROQ_API_KEY = ''
    await expect(call()).rejects.toThrow(/GEMINI_API_KEY is not set/)
  })
})
