import { describe, it, expect, vi, afterEach } from 'vitest'
import { runAiChat, ChatTimeoutError } from '../functions/api/chat.js'
import { CHAT_MAX_TOOL_ROUNDS } from '../functions/_lib/chat/prompt.js'

afterEach(() => {
  vi.useRealTimers()
})

const USAGE = { prompt_tokens: 100, completion_tokens: 50 }

function aiResponse(content: string | null, toolCalls?: any[], usage: any = USAGE) {
  return { choices: [{ message: { content, tool_calls: toolCalls } }], usage }
}

function newStats() {
  return { milliNeurons: 0, usageUnknown: false }
}

function opts(overrides: Record<string, any> = {}) {
  return {
    authorization: 'Bearer t',
    identity: { id: 1 },
    characterId: 7,
    stats: newStats(),
    deadline: Date.now() + 30_000,
    ...overrides,
  }
}

function baseMessages() {
  return [
    { role: 'system', content: 's' },
    { role: 'user', content: 'q' },
  ]
}

describe('runAiChat', () => {
  it('returns the answer with <think> reasoning stripped', async () => {
    const run = vi.fn().mockResolvedValue(aiResponse('<think>hmm</think>Use a rune scimitar.'))
    const stats = newStats()
    const answer = await runAiChat({ AI: { run } } as any, baseMessages(), opts({ stats }))
    expect(answer).toBe('Use a rune scimitar.')
    expect(run).toHaveBeenCalledTimes(1)
    expect(stats.usageUnknown).toBe(false)
    expect(stats.milliNeurons).toBeGreaterThan(0)
  })

  it('returns "" (never a hardcoded apology) when the model gives no usable answer', async () => {
    const run = vi.fn().mockResolvedValue(aiResponse(''))
    const answer = await runAiChat({ AI: { run } } as any, baseMessages(), opts())
    expect(answer).toBe('')
    // Empty first response breaks the tool loop, then one final no-tools call.
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('feeds a disallowed tool call back as a tool error and keeps going', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        aiResponse(null, [{ type: 'function', function: { name: 'buy_item', arguments: '{}' } }]),
      )
      .mockResolvedValueOnce(aiResponse('Done anyway.'))
    const messages = baseMessages()
    const answer = await runAiChat({ AI: { run } } as any, messages, opts())
    expect(answer).toBe('Done anyway.')
    const toolMsg = messages.find((m: any) => m.role === 'tool') as any
    expect(toolMsg.content).toContain("Tool error: 'buy_item' is not available.")
  })

  it('a throwing allowlisted tool becomes a tool error message, not a failed request', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        // env has no DB, so callTool for get_character_state fails internally.
        aiResponse(null, [{ type: 'function', function: { name: 'get_character_state', arguments: '{}' } }]),
      )
      .mockResolvedValueOnce(aiResponse('Answered from context instead.'))
    const messages = baseMessages()
    const answer = await runAiChat({ AI: { run } } as any, messages, opts())
    expect(answer).toBe('Answered from context instead.')
    const toolMsg = messages.find((m: any) => m.role === 'tool') as any
    expect(toolMsg.content).toMatch(/^Tool error: /)
  })

  it('stops at CHAT_MAX_TOOL_ROUNDS then forces a final no-tools answer', async () => {
    const run = vi.fn().mockImplementation((_model: string, payload: any) => {
      if (payload.tools) {
        return Promise.resolve(
          aiResponse(null, [{ type: 'function', function: { name: 'nope', arguments: '{}' } }]),
        )
      }
      return Promise.resolve(aiResponse('Final answer.'))
    })
    const answer = await runAiChat({ AI: { run } } as any, baseMessages(), opts())
    expect(answer).toBe('Final answer.')
    expect(run).toHaveBeenCalledTimes(CHAT_MAX_TOOL_ROUNDS + 1)
    expect(run.mock.calls[CHAT_MAX_TOOL_ROUNDS][1].tools).toBeUndefined()
  })

  it('throws ChatTimeoutError past the deadline and marks usage unknown (keeps full reserve)', async () => {
    vi.useFakeTimers()
    const run = vi.fn(() => new Promise(() => {})) // model call that never returns
    const stats = newStats()
    const promise = runAiChat({ AI: { run } } as any, baseMessages(), opts({ stats, deadline: Date.now() + 5000 }))
    const assertion = expect(promise).rejects.toThrow(ChatTimeoutError)
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
    expect(stats.usageUnknown).toBe(true)
  })

  it('refuses to start a model call with (almost) no budget left', async () => {
    const run = vi.fn()
    await expect(
      runAiChat({ AI: { run } } as any, baseMessages(), opts({ deadline: Date.now() + 100 })),
    ).rejects.toThrow(ChatTimeoutError)
    expect(run).not.toHaveBeenCalled()
  })

  it('marks usage unknown when a call reports no token counts', async () => {
    const run = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Answer.' } }] })
    const stats = newStats()
    await runAiChat({ AI: { run } } as any, baseMessages(), opts({ stats }))
    expect(stats.usageUnknown).toBe(true)
  })
})
