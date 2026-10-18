// @ts-nocheck server modules are plain JS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fake chat models: each provider's behaviour is set per test.
const { behave, fake } = vi.hoisted(() => {
  const behave = { gemini: null, groq: null, anthropic: null, last: {} }
  const fake = (name) =>
    class {
      constructor(opts) {
        behave.last[name] = opts
      }
      async invoke(input) {
        behave.last[`${name}Input`] = input
        return behave[name](input)
      }
    }
  return { behave, fake }
})
vi.mock('@langchain/google-genai', () => ({ ChatGoogleGenerativeAI: fake('gemini') }))
vi.mock('@langchain/groq', () => ({ ChatGroq: fake('groq') }))
vi.mock('@langchain/anthropic', () => ({ ChatAnthropic: fake('anthropic') }))

import { generateWithLangChain, toLangChainMessages } from '../server/llm.langchain.mjs'
import { generate } from '../server/llm.mjs'

const ENV = ['AI_PROVIDER', 'AI_FALLBACKS', 'LLM_LAYER', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY']
const saved = {}
const ok = (content) => async () => ({ content })
const boom = (msg) => async () => {
  throw new Error(msg)
}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_FALLBACKS: 'groq', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' })
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.LLM_LAYER
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  vi.restoreAllMocks()
})

const args = (extra = {}) => ({ system: 'sys', messages: [{ role: 'user', text: 'hi' }], ...extra })

describe('generateWithLangChain', () => {
  it('answers from the primary provider and reports it', async () => {
    behave.gemini = ok('{"a":1}')
    const r = await generateWithLangChain(args())
    expect(r).toMatchObject({ provider: 'gemini', text: '{"a":1}', fellBackFrom: [] })
  })

  it('falls back through withFallbacks and records who failed', async () => {
    behave.gemini = boom('503 high demand')
    behave.groq = ok('from groq')
    const r = await generateWithLangChain(args())
    expect(r).toMatchObject({ provider: 'groq', text: 'from groq', fellBackFrom: ['gemini'] })
  })

  it('joins array content parts into text', async () => {
    behave.gemini = ok([{ type: 'text', text: 'foo' }, { type: 'text', text: 'bar' }])
    expect((await generateWithLangChain(args())).text).toBe('foobar')
  })

  it('reports every failure when all providers fail', async () => {
    behave.gemini = boom('quota')
    behave.groq = boom('rate limit')
    await expect(generateWithLangChain(args())).rejects.toThrow(/All AI providers failed.*gemini.*quota.*groq.*rate limit/s)
  })

  it('surfaces the original error when only one provider is configured', async () => {
    process.env.GROQ_API_KEY = ''
    behave.gemini = boom('bad request')
    await expect(generateWithLangChain(args())).rejects.toThrow('bad request')
  })

  it('uses the vision model on Groq when an image is attached', async () => {
    process.env.GEMINI_API_KEY = ''
    behave.groq = ok('{}')
    await generateWithLangChain(args({ messages: [{ role: 'user', text: 'what is this', image: 'data:image/jpeg;base64,AAAA' }] }))
    expect(behave.last.groq.model).toMatch(/llama-4/)
  })
})

describe('toLangChainMessages', () => {
  it('maps roles and image parts', () => {
    const m = toLangChainMessages('sys', [
      { role: 'user', text: 'a', image: 'data:image/png;base64,Zm9v' },
      { role: 'model', text: 'b' },
    ])
    expect(m.map((x) => x._getType())).toEqual(['system', 'human', 'ai'])
    expect(m[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,Zm9v' } })
  })
})

describe('LLM_LAYER switch', () => {
  it('generate() routes through LangChain when enabled', async () => {
    process.env.LLM_LAYER = 'langchain'
    behave.gemini = ok('via langchain')
    const r = await generate(args())
    expect(r.text).toBe('via langchain')
    expect(behave.last.geminiInput).toBeDefined()
  })
})
