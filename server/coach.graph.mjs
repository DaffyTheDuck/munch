// LangGraph implementation of the coach (enable with COACH_ENGINE=langgraph).
//
//   START → agent ──(tool calls?)──▶ tools ──▶ agent … ──▶ END
//
// The model uses native tool calling (bindTools). The user's data lives in the browser, so the
// "tools" node does not run anything itself: it pauses the graph with interrupt(), the browser runs
// the tools locally, and the results come back through Command({ resume }). A MemorySaver
// checkpointer keeps each conversation (thread) between requests.
import { StateGraph, Annotation, START, END, MemorySaver, interrupt, Command } from '@langchain/langgraph'
import { tool } from '@langchain/core/tools'
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { fallbackRunnable, contentToText } from './llm.langchain.mjs'

const MAX_STEPS = 5
const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD')

// Declarations only: the functions run in the browser (see src/coach.ts).
const clientSide = async () => 'runs in the browser'
export const coachTools = [
  tool(clientSide, { name: 'get_day_log', description: 'Every food and exercise entry logged on one day.', schema: z.object({ date: date() }) }),
  tool(clientSide, {
    name: 'get_range_summary',
    description: 'Per-day totals (eaten kcal, burned kcal, protein, carbs, fat, entry count) between two dates, inclusive.',
    schema: z.object({ start: date(), end: date() }),
  }),
  tool(clientSide, { name: 'get_weights', description: 'Weigh-ins from the last N days.', schema: z.object({ days: z.number().int().min(1).max(365) }) }),
  tool(clientSide, { name: 'get_goals', description: "The user's calorie, macro and target-weight goals.", schema: z.object({}) }),
  tool(clientSide, {
    name: 'top_foods',
    description: 'Most frequently logged foods in the last N days with their average calories.',
    schema: z.object({ days: z.number().int().min(1).max(365), limit: z.number().int().min(1).max(20).optional() }),
  }),
]

export function systemPrompt({ today, goals }) {
  return `You are a concise, practical nutrition and habit coach inside a food-tracking app. Today is ${today}.
The user's goals: ${JSON.stringify(goals || {})}.
Use the tools to look at the user's real logged data before making any claim about their habits. Never invent numbers.
Call independent tools together when you can. Then answer in plain text: short paragraphs or "-" bullets, specific numbers from the data, and one clear suggestion.
You are not a doctor; for medical concerns, suggest seeing a professional.`
}

const State = Annotation.Root({
  messages: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
  steps: Annotation({ reducer: (_, b) => b, default: () => 0 }),
})

async function agent(state, config) {
  const { today, goals } = config.configurable
  const out = state.steps >= MAX_STEPS
  const { runnable } = fallbackRunnable({ maxTokens: 1200, prepare: (m) => (out ? m : m.bindTools(coachTools)) })
  const msgs = [new SystemMessage(systemPrompt({ today, goals })), ...state.messages]
  if (out) msgs.push(new HumanMessage('Tool limit reached. Answer now using what you already have.'))
  const reply = await runnable.invoke(msgs)
  return { messages: [reply], steps: state.steps + 1 }
}

function route(state) {
  const last = state.messages.at(-1)
  return last?.tool_calls?.length && state.steps <= MAX_STEPS ? 'tools' : END
}

function tools(state) {
  const calls = state.messages.at(-1).tool_calls.map((c) => ({ id: c.id, name: c.name, args: c.args }))
  const results = interrupt({ calls }) // pauses here until the browser resumes with one result per call
  return {
    messages: calls.map((c, i) => new ToolMessage({ tool_call_id: c.id, name: c.name, content: JSON.stringify(results?.[i] ?? { error: 'no result' }).slice(0, 8000) })),
  }
}

export function buildCoachGraph(checkpointer = new MemorySaver()) {
  return new StateGraph(State)
    .addNode('agent', agent)
    .addNode('tools', tools)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', route, { tools: 'tools', [END]: END })
    .addEdge('tools', 'agent')
    .compile({ checkpointer })
}

const graph = buildCoachGraph()

function shape(result) {
  const pending = result.__interrupt__?.[0]?.value
  if (pending) return { status: 'tool', calls: pending.calls }
  const text = contentToText(result.messages.at(-1)?.content).trim()
  return { status: 'answer', text: text || 'I could not put together an answer. Try rephrasing.' }
}

const cfg = (thread, today, goals) => ({ configurable: { thread_id: String(thread), today, goals } })

export async function coachChat({ thread, message, today, goals }) {
  const config = cfg(thread, today, goals)
  const state = await graph.getState(config)
  if (state.next?.length) throw new Error('thread_busy') // an earlier question was never finished
  return shape(await graph.invoke({ messages: [new HumanMessage(message)], steps: 0 }, config))
}

export async function coachResume({ thread, results, today, goals }) {
  return shape(await graph.invoke(new Command({ resume: results }), cfg(thread, today, goals)))
}
