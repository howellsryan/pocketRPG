import { describe, it, expect, vi, afterEach } from 'vitest'
import { onRequestPost } from '../functions/api/chat.js'
import { signJWT } from '../functions/_lib/jwt.js'
import { signPendingAction } from '../functions/_lib/chat/actions.js'
import { callTool } from '../functions/_lib/mcp/tools.js'

// Control what a confirmed write action does without hitting the real bridge.
vi.mock('../functions/_lib/mcp/tools.js', () => ({ callTool: vi.fn() }))

const TEST_SECRET = 'test-jwt-secret'

async function authHeader(identityId = 'identity-1') {
  return `Bearer ${await signJWT({ sub: identityId, provider: 'test' }, TEST_SECRET)}`
}

async function makeRequest() {
  return new Request('https://example.test/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Character-Id': '42',
      Authorization: await authHeader(),
    },
    body: JSON.stringify({ message: 'How do I train mining?' }),
  })
}

// D1 stand-in routing by SQL. Records whether the neuron reserve was settled
// (UPDATE chat_neuron_usage) and whether the reserve was granted.
function mockEnv(extra: Record<string, unknown> = {}) {
  const calls = { settle: 0, reserve: 0 }
  const prepare = vi.fn((sql: string) => ({
    bind: (..._args: unknown[]) => ({
      async run() {
        if (sql.includes('chat_neuron_usage')) {
          if (sql.startsWith('UPDATE')) calls.settle++
          else calls.reserve++
          return { meta: { changes: 1 } }
        }
        return { meta: { changes: 1 } }
      },
      async first() {
        if (sql.includes('FROM characters')) return { id: 42 }
        if (sql.includes('chat_usage')) return { count: 1 }
        return null
      },
      all: vi.fn(),
    }),
  }))
  return { env: { DB: { prepare }, JWT_SECRET: TEST_SECRET, ...extra } as any, calls }
}

afterEach(() => vi.unstubAllGlobals())

describe('POST /api/chat', () => {
  it('degrades with reason "ai_unconfigured" when no provider is available', async () => {
    const { env, calls } = mockEnv()
    const res = await onRequestPost({ request: await makeRequest(), env })
    const body = (await res.json()) as any
    expect(res.status).toBe(200)
    expect(body.mode).toBe('retrieval')
    expect(body.reason).toBe('ai_unconfigured')
    // No provider → no reserve taken, nothing to settle.
    expect(calls.reserve).toBe(0)
    expect(calls.settle).toBe(0)
  })

  it('settles the neuron reserve even when the AI call reports no usage (no budget leak)', async () => {
    // OpenAI-shaped 200 with an empty answer and no `usage` block: this is the
    // case that used to skip settle and permanently burn the reserve.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
        text: async () => '{}',
      }),
    )
    const { env, calls } = mockEnv({ OPENAI_API_KEY: 'sk-test' })
    const res = await onRequestPost({ request: await makeRequest(), env })
    const body = (await res.json()) as any
    expect(body.mode).toBe('retrieval')
    expect(body.reason).toBe('empty')
    expect(calls.reserve).toBe(1)
    expect(calls.settle).toBe(1) // reserve reconciled instead of leaked
  })
})

// D1 stand-in for the confirm path: owner check, the atomic credit debit, and
// the refund. `credits` seeds the RETURNING balance; null = can't afford the fee.
function confirmEnv(credits: number | null) {
  const feeDebits: number[] = []
  const refunds: number[] = []
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      async run() {
        if (sql.includes('credits = credits + ')) refunds.push(Number(args[0]))
        return { meta: { changes: 1 } }
      },
      async first() {
        if (sql.includes('credits = credits - ') && sql.includes('RETURNING')) {
          feeDebits.push(Number(args[0]))
          return credits === null ? null : { credits_remaining: credits }
        }
        if (sql.includes('FROM characters')) return { id: 42 }
        return null
      },
    }),
  }))
  return { env: { DB: { prepare }, JWT_SECRET: TEST_SECRET } as any, feeDebits, refunds }
}

async function confirmRequest(token: string) {
  return new Request('https://example.test/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Character-Id': '42',
      Authorization: await authHeader(),
    },
    body: JSON.stringify({ confirm: token }),
  })
}

describe('POST /api/chat — confirm a write action', () => {
  it('charges the 1-credit fee, then executes the action', async () => {
    ;(callTool as any).mockResolvedValue({ content: [{ type: 'text', text: '{"sold":5}' }] })
    const token = await signPendingAction(
      { tool: 'sell_item', args: { item_id: 'oak_logs', quantity: 5, character_id: 42 }, characterId: 42 },
      TEST_SECRET,
    )
    const { env, feeDebits } = confirmEnv(9)
    const res = await onRequestPost({ request: await confirmRequest(token), env })
    const body = (await res.json()) as any
    expect(body.mode).toBe('action_done')
    expect(body.creditsRemaining).toBe(9)
    expect(feeDebits).toEqual([1]) // fee charged exactly once
    expect(callTool).toHaveBeenCalledWith(
      'sell_item',
      { item_id: 'oak_logs', quantity: 5, character_id: 42 },
      expect.anything(),
    )
  })

  it('refuses (and never touches AI or the action) when the fee is unaffordable', async () => {
    ;(callTool as any).mockClear()
    const token = await signPendingAction(
      { tool: 'sell_item', args: { item_id: 'oak_logs', quantity: 5, character_id: 42 }, characterId: 42 },
      TEST_SECRET,
    )
    const { env } = confirmEnv(null) // debit returns nothing → insufficient
    const res = await onRequestPost({ request: await confirmRequest(token), env })
    const body = (await res.json()) as any
    expect(body.mode).toBe('action_no_credit')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('refunds the fee when the action itself fails', async () => {
    ;(callTool as any).mockResolvedValue({ content: [{ type: 'text', text: 'Error: no such item' }], isError: true })
    const token = await signPendingAction(
      { tool: 'sell_item', args: { item_id: 'bad', quantity: 1, character_id: 42 }, characterId: 42 },
      TEST_SECRET,
    )
    const { env, feeDebits, refunds } = confirmEnv(3)
    const res = await onRequestPost({ request: await confirmRequest(token), env })
    const body = (await res.json()) as any
    expect(body.mode).toBe('action_error')
    expect(feeDebits).toEqual([1])
    expect(refunds).toEqual([1]) // fee returned since the action didn't run
    expect(body.creditsRemaining).toBeUndefined()
  })

  it('rejects an expired/invalid confirm token without charging', async () => {
    ;(callTool as any).mockClear()
    const { env, feeDebits } = confirmEnv(9)
    const res = await onRequestPost({ request: await confirmRequest('not-a-real-token'), env })
    const body = (await res.json()) as any
    expect(body.mode).toBe('action_expired')
    expect(feeDebits).toEqual([])
    expect(callTool).not.toHaveBeenCalled()
  })
})
