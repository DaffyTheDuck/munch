// Optional LangChain implementation of the provider layer (enable with LLM_LAYER=langchain).
// Same contract as generate() in llm.mjs, but built on LangChain chat models and
// Runnable.withFallbacks() instead of hand-written adapters.
import { RunnableLambda } from '@langchain/core/runnables'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatGroq } from '@langchain/groq'
import { ChatAnthropic } from '@langchain/anthropic'
import { geminiCap, hasKey, keyFor, modelFor, providerChain, redact } from './llm.mjs'

const TIMEOUT_MS = 45000

export function makeChatModel(provider, { vision = false, maxTokens = 1500, temperature = 0.2 } = {}) {
  const model = modelFor(provider, { vision })
  if (provider === 'anthropic') return new ChatAnthropic({ model, apiKey: keyFor('anthropic'), temperature, maxTokens })
  if (provider === 'groq') return new ChatGroq({ model, apiKey: keyFor('groq'), temperature, maxTokens })
  return new ChatGoogleGenerativeAI({ model, apiKey: keyFor('gemini'), temperature, maxOutputTokens: geminiCap(maxTokens) })
}

export function toLangChainMessages(system, messages) {
  const out = [new SystemMessage(system)]
  for (const m of messages) {
    if (m.role === 'model') out.push(new AIMessage(m.text))
    else if (m.image) out.push(new HumanMessage({ content: [{ type: 'text', text: m.text }, { type: 'image_url', image_url: { url: m.image } }] }))
    else out.push(new HumanMessage(m.text))
  }
  return out
}

export const contentToText = (content) =>
  typeof content === 'string' ? content : (content || []).map((c) => (typeof c === 'string' ? c : c.text || '')).join('')

// Wrap a model so we learn which provider answered, and which ones failed before it.
function tracked(provider, model, trace) {
  return RunnableLambda.from(async (input, config) => {
    const started = Date.now()
    try {
      const r = await model.invoke(input, { ...config, signal: AbortSignal.timeout(TIMEOUT_MS) })
      trace.answered = provider
      trace.ms = Date.now() - started
      return r
    } catch (e) {
      trace.failed.push({ provider, reason: e.name === 'TimeoutError' ? 'timed out' : redact(e.message), status: e.status })
      console.warn(`${provider} failed: ${redact(e.message).slice(0, 140)}`)
      throw e
    }
  })
}

// A runnable that tries each configured provider in order. `prepare` can adapt each model (e.g. bindTools).
export function fallbackRunnable({ vision = false, maxTokens = 1500, provider: override, prepare = (m) => m } = {}) {
  const chain = providerChain(override).filter(hasKey)
  if (!chain.length) {
    const wanted = providerChain(override)[0] || 'gemini'
    throw new Error(`${{ gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }[wanted]} is not set in .env`)
  }
  const trace = { answered: '', ms: 0, failed: [] }
  const runnables = chain.map((p) => tracked(p, prepare(makeChatModel(p, { vision, maxTokens })), trace))
  const [first, ...rest] = runnables
  return { runnable: rest.length ? first.withFallbacks({ fallbacks: rest }) : first, trace, chain }
}

export async function generateWithLangChain({ system, messages, maxTokens = 1500, provider }) {
  const vision = messages.some((m) => m.image)
  const { runnable, trace, chain } = fallbackRunnable({ vision, maxTokens, provider })
  try {
    const reply = await runnable.invoke(toLangChainMessages(system, messages))
    const text = contentToText(reply.content)
    if (!text) throw new Error(`Empty response from ${trace.answered}`)
    return {
      text,
      ms: trace.ms,
      provider: trace.answered,
      model: modelFor(trace.answered, { vision }),
      fellBackFrom: trace.failed.map((f) => f.provider),
    }
  } catch (e) {
    if (trace.failed.length > 1) {
      throw new Error(`All AI providers failed. ${trace.failed.map((f) => `${f.provider}: ${String(f.reason).slice(0, 120)}`).join(' | ')}`)
    }
    if (chain.length === 1 || trace.failed.length === 1) throw new Error(trace.failed[0]?.reason || e.message)
    throw e
  }
}
