import { describe, expect, it, vi, afterEach } from 'vitest'
import { runAiChat } from '../functions/api/chat.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const USAGE = { prompt_tokens: 100, completion_tokens: 50 }

function aiResponse(content, toolCalls) {
  return { choices: [{ message: { content, tool_calls: toolCalls } }], usage: USAGE }
}

function opts() {
  return {
    authorization: 'Bearer t',
    identity: { id: 1 },
    characterId: 7,
    stats: { promptTokens: 0, completionTokens: 0, usageUnknown: false },
    deadline: Date.now() + 30_000,
  }
}

describe('Jev progressive tool reveal', () => {
  it('can reveal a semantically selected write tool while preserving the normal confirmation gate', async () => {
    const jevFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-latest',
        answers: {
          tool: {
            type: 'choice',
            choice: 'sell_item',
            confidence: 0.96,
            probabilities: { sell_item: 0.96, buy_item: 0.02, __no_match__: 0.02 },
          },
        },
        usage: { input_tokens: 45, output_tokens: 5 },
      }),
    })
    vi.stubGlobal('fetch', jevFetch)

    const run = vi
      .fn()
      .mockResolvedValueOnce(
        aiResponse(null, [
          {
            id: 'search',
            type: 'function',
            function: { name: 'search_tools', arguments: JSON.stringify({ query: 'turn these spare logs into shop coins' }) },
          },
        ]),
      )
      .mockResolvedValueOnce(
        aiResponse(null, [
          {
            id: 'sell',
            type: 'function',
            function: { name: 'sell_item', arguments: JSON.stringify({ item_id: 'oak_logs', quantity: 5 }) },
          },
        ]),
      )
      .mockResolvedValueOnce(aiResponse('Selling 5 Oak Logs — confirm below.'))

    const env = {
      AI: { run },
      CHAT_JEV_TOOL_ROUTING: 'true',
      TYPESAFE_API_KEY: 'test-key',
    }
    const messages = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'q' },
    ]

    const result = await runAiChat(env, messages, opts())

    expect(result.pendingWrite).toEqual({
      tool: 'sell_item',
      args: { item_id: 'oak_logs', quantity: 5, character_id: 7 },
    })
    expect(jevFetch).toHaveBeenCalledTimes(1)
    const secondRoundTools = run.mock.calls[1][1].tools.map((tool) => tool.function.name)
    expect(secondRoundTools).toContain('sell_item')
    expect(result.answer).toContain('confirm')
  })
})
