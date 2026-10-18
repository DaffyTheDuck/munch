import { z } from 'zod'

const num = z.coerce
  .number()
  .finite()
  .transform((n) => Math.min(Math.max(n, 0), 10000))

const Item = z.object({
  type: z.enum(['food', 'exercise']),
  name: z.string().trim().min(1).max(120),
  quantity: z.string().trim().max(120).default(''),
  grams: num.default(0),
  calories: num,
  protein_g: num.default(0),
  carbs_g: num.default(0),
  fat_g: num.default(0),
  lookup: z.string().trim().max(120).default(''),
})

export const AnalyzeResult = z.object({
  items: z.array(Item).max(30),
  note: z.string().default(''),
})

export const CoachAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('tool'), name: z.string(), args: z.record(z.any()).default({}) }),
  z.object({ action: z.literal('answer'), text: z.string().min(1) }),
])

// Models sometimes wrap JSON in prose or code fences, so slice out the outermost object.
export function extractJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('No JSON object in model output')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export function validate(schema, text) {
  try {
    const r = schema.safeParse(extractJson(text))
    return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
