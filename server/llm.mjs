// Provider adapters (Gemini, Anthropic, Groq) with automatic fallback.
// messages: [{ role: 'user' | 'model', text, image? }] where image is a data URL.
//
// Order: AI_PROVIDER first, then each name in AI_FALLBACKS (comma separated).
// Providers without an API key are skipped. Any failure moves on to the next one.

const TIMEOUT_MS = 45000

const KEY_ENV = { gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', groq: 'GROQ_API_KEY' }

export function modelFor(provider, { vision = false } = {}) {
  if (provider === 'anthropic') return process.env.ANTHROPIC_MODEL || ''
  if (provider === 'groq') {
    return vision
      ? process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'
      : process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  }
  return process.env.GEMINI_MODEL || 'gemini-3.5-flash'
}

export const hasKey = (provider) => Boolean(process.env[KEY_ENV[provider]])

export function providerChain(override) {
  if (override) return [override.toLowerCase()]
  const primary = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
  const extra = (process.env.AI_FALLBACKS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return [...new Set([primary, ...extra])].filter((p) => p in KEY_ENV)
}

export function providerInfo(override) {
  const chain = providerChain(override)
  const provider = chain[0] || 'gemini'
  return { provider, model: modelFor(provider), chain: chain.filter(hasKey) }
}

function splitDataUrl(dataUrl) {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '')
  if (!m) throw new Error('Invalid image data')
  return { mime: m[1], data: m[2] }
}

async function gemini({ system, messages, json, model }) {
  const contents = messages.map((m) => {
    const parts = []
    if (m.image) {
      const { mime, data } = splitDataUrl(m.image)
      parts.push({ inline_data: { mime_type: mime, data } })
    }
    parts.push({ text: m.text })
    return { role: m.role, parts }
  })
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { ...(json ? { responseMimeType: 'application/json' } : {}), temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message || `Gemini error ${res.status}`)
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('')
  if (!text) throw new Error('Empty response from Gemini')
  return text
}

async function anthropic({ system, messages, model, maxTokens }) {
  const mapped = messages.map((m) => {
    const content = []
    if (m.image) {
      const { mime, data } = splitDataUrl(m.image)
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data } })
    }
    content.push({ type: 'text', text: m.text })
    return { role: m.role === 'model' ? 'assistant' : 'user', content }
  })
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: mapped }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message || `Anthropic error ${res.status}`)
  const text = body?.content?.map((c) => c.text || '').join('')
  if (!text) throw new Error('Empty response from Anthropic')
  return text
}

// Groq exposes an OpenAI-compatible chat completions API.
async function groq({ system, messages, json, model, maxTokens }) {
  const mapped = messages.map((m) => {
    const role = m.role === 'model' ? 'assistant' : 'user'
    if (!m.image) return { role, content: m.text }
    return { role, content: [{ type: 'image_url', image_url: { url: m.image } }, { type: 'text', text: m.text }] }
  })
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...mapped],
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message || `Groq error ${res.status}`)
  const text = body?.choices?.[0]?.message?.content
  if (!text) throw new Error('Empty response from Groq')
  return text
}

const ADAPTERS = { gemini, anthropic, groq }

export async function generate({ system, messages, json = true, maxTokens = 1500, provider: override }) {
  if ((process.env.LLM_LAYER || '').toLowerCase() === 'langchain') {
    // Loaded lazily so the default path never needs the LangChain packages.
    const { generateWithLangChain } = await import('./llm.langchain.mjs')
    return generateWithLangChain({ system, messages, maxTokens, provider: override })
  }
  const chain = providerChain(override).filter(hasKey)
  if (!chain.length) {
    const wanted = providerChain(override)[0] || 'gemini'
    throw new Error(`${KEY_ENV[wanted] || 'An API key'} is not set in .env`)
  }
  const vision = messages.some((m) => m.image)
  const failures = []

  for (const provider of chain) {
    const model = modelFor(provider, { vision })
    const started = Date.now()
    try {
      const text = await ADAPTERS[provider]({ system, messages, json, model, maxTokens })
      if (failures.length) console.warn(`fallback: ${failures.map((f) => f.provider).join(', ')} failed, answered by ${provider}`)
      return { text, ms: Date.now() - started, provider, model, fellBackFrom: failures.map((f) => f.provider) }
    } catch (e) {
      const reason = e.name === 'TimeoutError' ? 'timed out' : e.message
      failures.push({ provider, reason })
      console.warn(`${provider} failed: ${String(reason).slice(0, 140)}`)
    }
  }
  const summary = failures.map((f) => `${f.provider}: ${String(f.reason).slice(0, 120)}`).join(' | ')
  throw new Error(failures.length === 1 ? failures[0].reason : `All AI providers failed. ${summary}`)
}
