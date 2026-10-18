// @ts-nocheck server modules are plain JS
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AIMessage } from '@langchain/core/messages'

// Script the model: each invoke() pops the next reply and records what it was shown.
const script = vi.hoisted(() => ({ replies: [], seen: [] }))
vi.mock('../server/llm.langchain.mjs', () => ({
  contentToText: (c) => (typeof c === 'string' ? c : ''),
  fallbackRunnable: () => ({
    trace: {},
    runnable: {
      invoke: async (msgs) => {
        script.seen.push(msgs)
        return script.replies.shift()
      },
    },
  }),
}))

import { coachChat, coachResume, coachTools, systemPrompt } from '../server/coach.graph.mjs'

const base = { today: '2026-10-18', goals: { calories: 2000 } }
const toolCall = (id, name, args = {}) => ({ id, name, args, type: 'tool_call' })

beforeEach(() => {
  script.replies = []
  script.seen = []
})

describe('coach graph', () => {
  it('pauses on a tool call, then answers after the browser resumes it', async () => {
    script.replies = [new AIMessage({ content: '', tool_calls: [toolCall('c1', 'get_goals')] }), new AIMessage('Your goal is 2000 kcal.')]

    const first = await coachChat({ ...base, thread: 'a', message: 'what is my goal?' })
    expect(first).toEqual({ status: 'tool', calls: [{ id: 'c1', name: 'get_goals', args: {} }] })

    const second = await coachResume({ ...base, thread: 'a', results: [{ calories: 2000 }] })
    expect(second).toEqual({ status: 'answer', text: 'Your goal is 2000 kcal.' })

    // The model's second turn must have seen the tool result.
    const history = script.seen[1]
    const toolMsg = history.find((m) => m._getType() === 'tool')
    expect(toolMsg.content).toContain('2000')
    expect(toolMsg.tool_call_id).toBe('c1')
  })

  it('handles parallel tool calls and keeps results aligned', async () => {
    script.replies = [
      new AIMessage({ content: '', tool_calls: [toolCall('p1', 'get_goals'), toolCall('p2', 'get_weights', { days: 7 })] }),
      new AIMessage('done'),
    ]
    const first = await coachChat({ ...base, thread: 'b', message: 'overview' })
    expect(first.calls.map((c) => c.name)).toEqual(['get_goals', 'get_weights'])

    await coachResume({ ...base, thread: 'b', results: [{ goal: 1 }, [{ kg: 70 }]] })
    const tools = script.seen[1].filter((m) => m._getType() === 'tool')
    expect(tools.map((t) => [t.tool_call_id, t.name])).toEqual([['p1', 'get_goals'], ['p2', 'get_weights']])
    expect(tools[1].content).toContain('70')
  })

  it('keeps conversation memory across questions on one thread', async () => {
    script.replies = [new AIMessage('first answer'), new AIMessage('second answer')]
    await coachChat({ ...base, thread: 'c', message: 'q1' })
    await coachChat({ ...base, thread: 'c', message: 'q2' })
    const texts = script.seen[1].map((m) => String(m.content))
    expect(texts).toContain('q1')
    expect(texts).toContain('first answer')
    expect(texts).toContain('q2')
  })

  it('refuses a new question while a tool call is still pending', async () => {
    script.replies = [new AIMessage({ content: '', tool_calls: [toolCall('d1', 'get_goals')] })]
    await coachChat({ ...base, thread: 'd', message: 'q' })
    await expect(coachChat({ ...base, thread: 'd', message: 'again' })).rejects.toThrow('thread_busy')
  })

  it('keeps separate threads isolated', async () => {
    script.replies = [new AIMessage('x'), new AIMessage('y')]
    await coachChat({ ...base, thread: 'e1', message: 'only in e1' })
    await coachChat({ ...base, thread: 'e2', message: 'only in e2' })
    const e2 = script.seen[1].map((m) => String(m.content))
    expect(e2).not.toContain('only in e1')
  })
})

describe('coach definitions', () => {
  it('declares every tool the browser implements', () => {
    expect(coachTools.map((t) => t.name).sort()).toEqual(['get_day_log', 'get_goals', 'get_range_summary', 'get_weights', 'top_foods'])
  })
  it('puts the date and goals in the system prompt', () => {
    const p = systemPrompt({ today: '2026-10-18', goals: { calories: 1800 } })
    expect(p).toContain('2026-10-18')
    expect(p).toContain('1800')
  })
})
