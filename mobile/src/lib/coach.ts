import { addDays, todayStr } from '@shared/dates'
import type { Entry } from '@shared/types'
import { allWeights, entriesBetween, entriesForDate, loadGoals } from './db'
import { coachChat, coachResume, coachStep, health, type ToolCall } from './api'

type Args = Record<string, unknown>
type Tool = (args: Args) => Promise<unknown>

const isDate = (v: unknown, d: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d)
const int = (v: unknown, d: number, max: number) => Math.min(max, Math.max(1, Math.round(Number(v)) || d))

const slim = (e: Entry) => ({ type: e.kind, meal: e.meal, name: e.name, quantity: e.quantity, kcal: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat })

// Everything the coach can see. Read-only, runs on the phone against local data.
export const TOOLS: Record<string, Tool> = {
  async get_day_log({ date }) {
    const d = isDate(date, todayStr())
    return { date: d, entries: (await entriesForDate(d)).map(slim) }
  },
  async get_range_summary({ start, end }) {
    const e = isDate(end, todayStr())
    const s = isDate(start, addDays(e, -6))
    const days: Record<string, { eaten: number; burned: number; protein: number; carbs: number; fat: number; entries: number }> = {}
    for (const r of await entriesBetween(s, e)) {
      const d = (days[r.date] ||= { eaten: 0, burned: 0, protein: 0, carbs: 0, fat: 0, entries: 0 })
      d.entries++
      if (r.kind === 'food') {
        d.eaten += r.calories
        d.protein += r.protein
        d.carbs += r.carbs
        d.fat += r.fat
      } else d.burned += r.calories
    }
    return { start: s, end: e, days }
  },
  async get_weights({ days }) {
    const from = addDays(todayStr(), -int(days, 30, 365))
    return (await allWeights()).filter((w) => w.date >= from).map((w) => ({ date: w.date, kg: w.kg }))
  },
  async get_goals() {
    return loadGoals()
  },
  async top_foods({ days, limit }) {
    const rows = (await entriesBetween(addDays(todayStr(), -int(days, 30, 365)), todayStr())).filter((r) => r.kind === 'food')
    const agg: Record<string, { count: number; kcal: number }> = {}
    for (const r of rows) {
      const a = (agg[r.name] ||= { count: 0, kcal: 0 })
      a.count++
      a.kcal += r.calories
    }
    return Object.entries(agg)
      .map(([name, a]) => ({ name, count: a.count, avgKcal: Math.round(a.kcal / a.count) }))
      .sort((x, y) => y.count - x.count)
      .slice(0, int(limit, 8, 20))
  },
}

export interface Turn {
  role: 'user' | 'coach'
  text: string
  tools?: string[]
}

const describe = (name: string, args: Args) => {
  const a = Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(', ')
  return a ? `${name} (${a})` : name
}

async function runCalls(calls: ToolCall[], onTool: (label: string) => void) {
  const results: unknown[] = []
  for (const c of calls) {
    onTool(describe(c.name, c.args))
    try {
      results.push(TOOLS[c.name] ? await TOOLS[c.name](c.args) : { error: `Unknown tool ${c.name}` })
    } catch (e) {
      results.push({ error: (e as Error).message })
    }
  }
  return results
}

let engine: 'classic' | 'langgraph' | undefined
export async function coachEngine() {
  if (!engine) engine = (await health()).coachEngine ?? 'classic'
  return engine
}

// LangGraph engine: the server graph pauses at each tool call; we run the tools on local data and resume it.
async function askGraph(message: string, thread: string, onTool: (label: string) => void) {
  const goals = await loadGoals()
  const today = todayStr()
  let res = await coachChat(thread, message, today, goals)
  for (let i = 0; i < 6; i++) {
    if (res.status === 'answer') return res.text
    res = await coachResume(thread, await runCalls(res.calls, onTool), today, goals)
  }
  throw new Error('The coach needed too many steps. Try a narrower question.')
}

// Classic engine: the model replies with JSON asking for a tool or giving an answer.
async function askClassic(history: Turn[], onTool: (label: string) => void) {
  const goals = await loadGoals()
  const messages: { role: 'user' | 'model'; text: string }[] = history.map((t) => ({
    role: t.role === 'user' ? 'user' : 'model',
    text: t.role === 'user' ? t.text : JSON.stringify({ action: 'answer', text: t.text }),
  }))
  for (let step = 0; step < 5; step++) {
    const reply = await coachStep(messages, todayStr(), goals)
    if (reply.action === 'answer') return reply.text
    const [result] = await runCalls([{ id: String(step), name: reply.name, args: reply.args }], onTool)
    messages.push({ role: 'model', text: JSON.stringify(reply) })
    messages.push({ role: 'user', text: `TOOL_RESULT ${reply.name}: ${JSON.stringify(result).slice(0, 8000)}` })
  }
  messages.push({ role: 'user', text: 'Tool limit reached. Answer now with what you have.' })
  const last = await coachStep(messages, todayStr(), goals)
  return last.action === 'answer' ? last.text : 'I could not finish that analysis. Try a narrower question.'
}

export async function askCoach(history: Turn[], onTool: (label: string) => void, thread: string) {
  return (await coachEngine()) === 'langgraph' ? askGraph(history[history.length - 1].text, thread, onTool) : askClassic(history, onTool)
}
