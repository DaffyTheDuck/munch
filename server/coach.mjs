import { generate } from './llm.mjs'
import { CoachAction, validate } from './schema.mjs'

// The client owns the data (IndexedDB), so the model asks for a tool and the browser runs it.
// Protocol: the model replies with {"action":"tool",...} or {"action":"answer",...}.
const TOOLS = `Tools (call at most one per reply):
- get_day_log {"date":"YYYY-MM-DD"}: every food/exercise entry for that day.
- get_range_summary {"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}: per-day totals (eaten kcal, burned kcal, protein, carbs, fat, entries) between two dates inclusive.
- get_weights {"days":number}: weigh-ins from the last N days.
- get_goals {}: the user's calorie, macro and target-weight goals.
- top_foods {"days":number,"limit":number}: most frequently logged foods with average calories.`

export function coachSystem({ today, goals }) {
  return `You are a concise, practical nutrition and habit coach inside a food-tracking app. Today is ${today}.
User goals: ${JSON.stringify(goals)}.
You can look at the user's real logged data using tools. Always fetch data before making claims about their habits; never invent numbers.
${TOOLS}
Reply with ONLY JSON, one of:
{"action":"tool","name":string,"args":object}
{"action":"answer","text":string}
Tool results arrive as user messages starting with TOOL_RESULT. Use at most 4 tool calls, then answer.
Answers: plain text, short paragraphs or "-" bullets, specific numbers from the data, one clear suggestion. You are not a doctor; for medical concerns suggest seeing a professional.`
}

export async function coachStep({ messages, today, goals }) {
  const system = coachSystem({ today, goals })
  const first = await generate({ system, messages, maxTokens: 1200 })
  let parsed = validate(CoachAction, first.text)
  if (parsed.ok) return parsed.data
  const retry = await generate({
    system,
    messages: [...messages, { role: 'model', text: first.text }, { role: 'user', text: `Invalid reply (${parsed.error}). Respond with ONLY valid JSON in the required shape.` }],
    maxTokens: 1200,
  })
  parsed = validate(CoachAction, retry.text)
  if (!parsed.ok) throw new Error('The coach returned an unreadable response. Please try again.')
  return parsed.data
}
