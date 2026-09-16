import { describe, expect, it, vi, afterEach } from 'vitest'
import { TOOL_NAMES } from '../functions/_lib/mcp/schema.js'
import {
  buildJevToolRoutingRequest,
  isJevToolRoutingEnabled,
  JEV_TOOL_ROUTING_MAX_QUERY_CHARS,
  routeToolsForChat,
  routeToolsWithJev,
} from '../functions/_lib/chat/toolRouting.js'
import { searchToolsByQuery } from '../functions/_lib/chat/prompt.js'
import { CHAT_TOOL_ROUTING_CASES } from '../scripts/fixtures/chatToolRoutingCases.mjs'

afterEach(() => {
  vi.restoreAllMocks()
})

function jevResponse({
  choice = 'sell_item',
  confidence = 0.9,
  probabilities = { sell_item: 0.7, buy_item: 0.2, __no_match__: 0.1 },
} = {}) {
  return {
    ok: true,
    json: async () => ({
      model: 'jev-latest',
      answers: {
        tool: {
          type: 'choice',
          choice,
          confidence,
          probabilities,
        },
      },
      usage: { input_tokens: 40, output_tokens: 5 },
    }),
  }
}

describe('Jev chat tool routing', () => {
  it('keeps the benchmark corpus valid and focused on hidden-tool discovery', () => {
    const hidden = CHAT_TOOL_ROUTING_CASES.filter((entry) => entry.scope === 'hidden')
    expect(hidden.length).toBeGreaterThanOrEqual(45)
    expect(hidden.filter((entry) => entry.expectedTool === null).length).toBeGreaterThanOrEqual(5)
    for (const entry of CHAT_TOOL_ROUTING_CASES) {
      if (entry.expectedTool !== null) {
        expect(TOOL_NAMES, `unknown expected tool for: ${entry.query}`).toContain(entry.expectedTool)
      }
    }
  })

  it('sends only the routing phrase as dynamic state and defines every tool as a bounded choice', () => {
    const body = buildJevToolRoutingRequest('sell these logs')
    expect(body.state).toEqual({ query: 'sell these logs' })
    expect(Object.keys(body.state)).toEqual(['query'])
    expect(body.model).toBe('jev-latest')
    expect(body.questions.tool.type).toBe('choice')
    expect(Object.keys(body.questions.tool.criteria)).toEqual(expect.arrayContaining(['sell_item', 'buy_item', '__no_match__']))
    expect(Object.values(body.questions.tool.criteria).every((value) => typeof value === 'string')).toBe(true)
    const longBody = buildJevToolRoutingRequest('x'.repeat(JEV_TOOL_ROUTING_MAX_QUERY_CHARS + 100))
    expect(longBody.state.query).toHaveLength(JEV_TOOL_ROUTING_MAX_QUERY_CHARS)
  })

  it('ranks Jev probabilities into the same progressive-reveal shape used by search_tools', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jevResponse({
        choice: 'sell_item',
        probabilities: { buy_item: 0.15, sell_item: 0.7, deposit_to_bank: 0.1, __no_match__: 0.05 },
      }),
    )

    const result = await routeToolsWithJev('get rid of these logs for shop value', {
      apiKey: 'test-key',
      fetchImpl,
      limit: 3,
    })

    expect(result.names).toEqual(['sell_item', 'buy_item', 'deposit_to_bank'])
    expect(result.text).toContain('sell_item')
    expect(result.provider).toBe('jev')
    expect(result.confidence).toBe(0.9)
    expect(result.usage).toEqual({ input_tokens: 40, output_tokens: 5 })

    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.state).toEqual({ query: 'get rid of these logs for shop value' })
  })

  it('treats an explicit Jev no-match as a real result rather than silently changing it to lexical', async () => {
    const result = await routeToolsWithJev('tell me a joke', {
      apiKey: 'test-key',
      fetchImpl: vi.fn().mockResolvedValue(
        jevResponse({ choice: '__no_match__', probabilities: { __no_match__: 0.95, sell_item: 0.05 } }),
      ),
    })
    expect(result.names).toEqual([])
    expect(result.text).toMatch(/No tool matched/)
    expect(result.provider).toBe('jev')
  })

  it('does not waste progressive-reveal slots on tools that are already always-on', () => {
    const lexical = searchToolsByQuery('how many dragon bones are in my bank?')
    expect(lexical.names).not.toContain('get_bank')

    const body = buildJevToolRoutingRequest('how many dragon bones are in my bank?')
    expect(body.questions.tool.criteria).not.toHaveProperty('get_bank')
    expect(body.questions.tool.criteria).toHaveProperty('withdraw_from_bank')
  })

  it('does not make a TypeSafe request when the experiment flag is off', async () => {
    const fetchImpl = vi.fn()
    const result = await routeToolsForChat('sell an item', { CHAT_JEV_TOOL_ROUTING: 'false', TYPESAFE_API_KEY: 'test-key' }, { fetchImpl })
    expect(result.names).toEqual(searchToolsByQuery('sell an item').names)
    expect(result.provider).toBe('lexical')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses Jev only when both the flag and server-side API key are present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jevResponse())
    const result = await routeToolsForChat('sell an item', { CHAT_JEV_TOOL_ROUTING: 'true', TYPESAFE_API_KEY: 'test-key' }, { fetchImpl })
    expect(result.provider).toBe('jev')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back to lexical routing when the feature is enabled but no key is configured', async () => {
    const result = await routeToolsForChat('sell an item', { CHAT_JEV_TOOL_ROUTING: 'true' })
    expect(result.provider).toBe('lexical')
    expect(result.fallbackReason).toBe('missing_key')
    expect(result.names).toEqual(searchToolsByQuery('sell an item').names)
  })

  it('falls back to lexical routing when Jev fails without leaking the player query into logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const query = 'sell my extremely-secretly-named test item'
    const result = await routeToolsForChat(
      query,
      { CHAT_JEV_TOOL_ROUTING: 'true', TYPESAFE_API_KEY: 'test-key' },
      { fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'down' }) },
    )
    expect(result.provider).toBe('lexical')
    expect(result.fallbackReason).toBe('jev_error')
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(' ')).not.toContain(query)
  })

  it('rejects malformed Jev answers so callers can use the deterministic fallback', async () => {
    await expect(
      routeToolsWithJev('sell an item', {
        apiKey: 'test-key',
        fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answers: {} }) }),
      }),
    ).rejects.toThrow(/invalid/i)
  })

  it('rejects out-of-range Jev probabilities instead of routing from corrupt confidence data', async () => {
    await expect(
      routeToolsWithJev('sell an item', {
        apiKey: 'test-key',
        fetchImpl: vi.fn().mockResolvedValue(
          jevResponse({ confidence: 0.9, probabilities: { sell_item: 1.2, __no_match__: 0 } }),
        ),
      }),
    ).rejects.toThrow(/probability/i)
  })

  it('parses the feature flag strictly', () => {
    expect(isJevToolRoutingEnabled({ CHAT_JEV_TOOL_ROUTING: true })).toBe(true)
    expect(isJevToolRoutingEnabled({ CHAT_JEV_TOOL_ROUTING: 'true' })).toBe(true)
    expect(isJevToolRoutingEnabled({ CHAT_JEV_TOOL_ROUTING: 'TRUE' })).toBe(true)
    expect(isJevToolRoutingEnabled({ CHAT_JEV_TOOL_ROUTING: '1' })).toBe(false)
    expect(isJevToolRoutingEnabled({})).toBe(false)
  })
})
