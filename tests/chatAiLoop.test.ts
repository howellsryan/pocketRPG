import { describe, it, expect, vi, afterEach } from 'vitest'
import { runAiChat, ChatTimeoutError, chatAttempts, geminiChatBinding, openaiChatBinding } from '../functions/api/chat.js'
import {
  CHAT_MAX_TOOL_ROUNDS,
  CHAT_MODEL,
  CHAT_OPENAI_MODEL,
  CHAT_FALLBACK_MODEL,
  CHAT_OPENAI_REASONING_EFFORT,
  ALWAYS_ON_TOOL_NAMES,
  SEARCH_TOOL_NAME,
  SEARCH_TOOLS_DEF,
} from '../functions/_lib/chat/prompt.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const USAGE = { prompt_tokens: 100, completion_tokens: 50 }

function aiResponse(content: string | null, toolCalls?: any[], usage: any = USAGE) {
  return { choices: [{ message: { content, tool_calls: toolCalls } }], usage }
}

function newStats() {
  return { promptTokens: 0, completionTokens: 0, usageUnknown: false }
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
    const { answer, pendingWrite } = await runAiChat({ AI: { run } } as any, baseMessages(), opts({ stats }))
    expect(answer).toBe('Use a rune scimitar.')
    expect(pendingWrite).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
    expect(stats.usageUnknown).toBe(false)
    expect(stats.promptTokens).toBe(100)
    expect(stats.completionTokens).toBe(50)
  })

  it('returns "" (never a hardcoded apology) when the model gives no usable answer', async () => {
    const run = vi.fn().mockResolvedValue(aiResponse(''))
    const { answer } = await runAiChat({ AI: { run } } as any, baseMessages(), opts())
    expect(answer).toBe('')
    // Empty first response breaks the tool loop, then one final no-tools call.
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('captures a write tool as a pending action instead of executing it', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        aiResponse(null, [
          { type: 'function', function: { name: 'sell_item', arguments: JSON.stringify({ item_id: 'oak_logs', quantity: 100 }) } },
        ]),
      )
      .mockResolvedValueOnce(aiResponse("I'll sell 100 Oak Logs — confirm?"))
    const messages = baseMessages()
    // No DB needed: a write is intercepted before any tool runs.
    const { answer, pendingWrite } = await runAiChat({ AI: { run } } as any, messages, opts())
    expect(pendingWrite).toEqual({ tool: 'sell_item', args: { item_id: 'oak_logs', quantity: 100, character_id: 7 } })
    expect(answer).toBe("I'll sell 100 Oak Logs — confirm?")
    const toolMsg = messages.find((m: any) => m.role === 'tool') as any
    expect(toolMsg.content).toContain('PENDING_CONFIRMATION')
    expect(run).toHaveBeenCalledTimes(2) // tool round + the phrasing call
  })

  it('feeds an invalid write back as an error instead of capturing it for confirmation', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        aiResponse(null, [
          { type: 'function', function: { name: 'start_skilling', arguments: JSON.stringify({ skill: 'thieving', action_id: 'pickpocket_elf' }) } },
        ]),
      )
      .mockResolvedValueOnce(aiResponse('Let me check the valid thieving options.'))
    const messages = baseMessages()
    const { answer, pendingWrite } = await runAiChat({ AI: { run } } as any, messages, opts())
    expect(pendingWrite).toBeNull() // invalid id is NOT turned into a confirmable action
    expect(answer).toBe('Let me check the valid thieving options.')
    const toolMsg = messages.find((m: any) => m.role === 'tool') as any
    expect(toolMsg.content).toMatch(/Tool error:/)
    expect(toolMsg.content).toMatch(/pickpocket_elf|list_skill_actions/)
  })

  it('does not gate writes when allowWrites is false (used for the summary call)', async () => {
    const run = vi.fn().mockResolvedValue(aiResponse('Sold.'))
    const { answer, pendingWrite } = await runAiChat({ AI: { run } } as any, baseMessages(), opts({ withTools: false }))
    expect(answer).toBe('Sold.')
    expect(pendingWrite).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][1].tools).toBeUndefined()
  })

  it('feeds an unknown tool call back as a tool error and keeps going', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        aiResponse(null, [{ type: 'function', function: { name: 'made_up_tool', arguments: '{}' } }]),
      )
      .mockResolvedValueOnce(aiResponse('Done anyway.'))
    const messages = baseMessages()
    const { answer } = await runAiChat({ AI: { run } } as any, messages, opts())
    expect(answer).toBe('Done anyway.')
    const toolMsg = messages.find((m: any) => m.role === 'tool') as any
    expect(toolMsg.content).toContain("Tool error: 'made_up_tool' is not available.")
  })

  it('a throwing allowlisted read tool becomes a tool error message, not a failed request', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        // env has no DB, so callTool for get_character_state fails internally.
        aiResponse(null, [{ type: 'function', function: { name: 'get_character_state', arguments: '{}' } }]),
      )
      .mockResolvedValueOnce(aiResponse('Answered from context instead.'))
    const messages = baseMessages()
    const { answer } = await runAiChat({ AI: { run } } as any, messages, opts())
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
    const { answer } = await runAiChat({ AI: { run } } as any, baseMessages(), opts())
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

  it('only declares the always-on tools plus search_tools on the first round', async () => {
    const run = vi.fn().mockResolvedValue(aiResponse('Hi.'))
    await runAiChat({ AI: { run } } as any, baseMessages(), opts())
    const names = run.mock.calls[0][1].tools.map((t: any) => t.function.name)
    expect(names).toEqual(expect.arrayContaining([SEARCH_TOOL_NAME, ...ALWAYS_ON_TOOL_NAMES]))
    expect(names.length).toBe(ALWAYS_ON_TOOL_NAMES.length + 1)
  })

  it('search_tools reveals a matched tool so a later round in the same request can call it', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        aiResponse(null, [
          { type: 'function', function: { name: 'search_tools', arguments: JSON.stringify({ query: 'sell an item' }) } },
        ]),
      )
      .mockResolvedValueOnce(
        aiResponse(null, [
          { type: 'function', function: { name: 'sell_item', arguments: JSON.stringify({ item_id: 'oak_logs', quantity: 5 }) } },
        ]),
      )
      .mockResolvedValueOnce(aiResponse("I'll sell 5 Oak Logs — confirm?"))
    const messages = baseMessages()
    const { pendingWrite } = await runAiChat({ AI: { run } } as any, messages, opts())
    expect(pendingWrite).toEqual({ tool: 'sell_item', args: { item_id: 'oak_logs', quantity: 5, character_id: 7 } })
    // Round 0 tool result names sell_item; round 1's declared tools now include it.
    const round0Result = messages.find((m: any) => m.role === 'tool' && m.tool_call_id?.includes('call_0'))
    expect(round0Result.content).toContain('sell_item')
    const round1Tools = run.mock.calls[1][1].tools.map((t: any) => t.function.name)
    expect(round1Tools).toContain('sell_item')
  })

  it('marks usage unknown when a call reports no token counts', async () => {
    const run = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Answer.' } }] })
    const stats = newStats()
    await runAiChat({ AI: { run } } as any, baseMessages(), opts({ stats }))
    expect(stats.usageUnknown).toBe(true)
  })
})

describe('chatAttempts / geminiChatBinding', () => {
  it('orders attempts openai → workers-ai (free) → gemini (paid), skipping unconfigured providers', () => {
    const AI = { run: vi.fn() }
    const full = chatAttempts({ GEMINI_API_KEY: 'test-key', OPENAI_API_KEY: 'test-key', AI } as any)
    // OpenAI primary, then the free Workers AI failover, then paid Gemini last.
    expect(full.map((a) => a.model)).toEqual([CHAT_OPENAI_MODEL, CHAT_FALLBACK_MODEL, CHAT_MODEL])
    // Pool routing: OpenAI its token pool, Workers AI the free neuron budget,
    // Gemini its own paid token pool.
    expect(full.map((a) => a.pool)).toEqual(['openai', 'neuron', 'gemini'])
    expect(full[1].ai).toBe(AI) // Workers AI failover runs on env.AI
    expect(full[2].ai).not.toBe(AI) // Gemini uses its own binding
    // No OpenAI key → Workers AI then Gemini.
    expect(chatAttempts({ GEMINI_API_KEY: 'test-key', AI } as any).map((a) => a.model)).toEqual([
      CHAT_FALLBACK_MODEL,
      CHAT_MODEL,
    ])
    // No Gemini key → OpenAI then Workers AI (Gemini skipped); nothing → no AI.
    expect(chatAttempts({ OPENAI_API_KEY: 'test-key', AI } as any).map((a) => a.model)).toEqual([
      CHAT_OPENAI_MODEL,
      CHAT_FALLBACK_MODEL,
    ])
    expect(chatAttempts({ AI } as any).map((a) => a.model)).toEqual([CHAT_FALLBACK_MODEL])
    expect(chatAttempts({} as any)).toEqual([])
  })

  it('runAiChat sends the per-attempt model override to the binding', async () => {
    const run = vi.fn().mockResolvedValue(aiResponse('Hi.'))
    await runAiChat({ AI: { run } } as any, baseMessages(), opts({ model: CHAT_FALLBACK_MODEL }))
    expect(run.mock.calls[0][0]).toBe(CHAT_FALLBACK_MODEL)
  })

  it("calls Google's OpenAI-compatible endpoint with the payload passed through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => aiResponse('Hi.') })
    vi.stubGlobal('fetch', fetchMock)
    const binding = geminiChatBinding({ GEMINI_API_KEY: 'test-key' } as any)
    const res = await binding.run('gemini-2.5-flash-lite', {
      messages: baseMessages(),
      max_tokens: 5000,
      temperature: 0.6,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gemini-2.5-flash-lite')
    expect(body.max_tokens).toBe(5000)
    expect(body.temperature).toBe(0.6)
    expect(body.messages).toHaveLength(2)
    expect(res.choices[0].message.content).toBe('Hi.')
  })

  it('throws on a non-2xx response so the endpoint degrades to retrieval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'quota exceeded' }),
    )
    const binding = geminiChatBinding({ GEMINI_API_KEY: 'test-key' } as any)
    await expect(binding.run('gemini-2.5-flash-lite', { messages: [] })).rejects.toThrow(
      'Gemini 429: quota exceeded',
    )
  })

  it("calls OpenAI's Responses endpoint, translating to/from the chat-completions shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi.' }] }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const binding = openaiChatBinding({ OPENAI_API_KEY: 'test-key' } as any)
    const res = await binding.run('gpt-5.4-mini', {
      messages: baseMessages(),
      max_tokens: 5000,
      temperature: 0.6,
    })
    const [url, init] = fetchMock.mock.calls[0]
    // Function tools + reasoning_effort 400 on /v1/chat/completions for
    // reasoning models; OpenAI's own error points at /v1/responses instead.
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-5.4-mini')
    expect(body.max_output_tokens).toBe(5000)
    expect(body.temperature).toBeUndefined()
    expect(body.reasoning).toEqual({ effort: CHAT_OPENAI_REASONING_EFFORT })
    expect(body.input).toHaveLength(2)
    expect(res.choices[0].message.content).toBe('Hi.')
    expect(res.usage).toEqual(USAGE)
  })

  it('translates OpenAI function_call output items into chat-completions tool_calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ type: 'function_call', call_id: 'call_1', name: 'get_character', arguments: '{}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const binding = openaiChatBinding({ OPENAI_API_KEY: 'test-key' } as any)
    const res = await binding.run('gpt-5.4-mini', { messages: baseMessages(), tools: [SEARCH_TOOLS_DEF] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.tools).toEqual([
      { type: 'function', name: SEARCH_TOOLS_DEF.function.name, description: SEARCH_TOOLS_DEF.function.description, parameters: SEARCH_TOOLS_DEF.function.parameters },
    ])
    expect(res.choices[0].message.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'get_character', arguments: '{}' } },
    ])
  })

  it('throws on a non-2xx OpenAI response so the endpoint degrades further', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'quota exceeded' }),
    )
    const binding = openaiChatBinding({ OPENAI_API_KEY: 'test-key' } as any)
    await expect(binding.run('gpt-4.1-mini', { messages: [] })).rejects.toThrow('OpenAI 429: quota exceeded')
  })
})
