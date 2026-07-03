import { describe, it, expect, vi, afterEach } from 'vitest'
import { onRequestPost } from '../functions/api/chat.js'
import { signJWT } from '../functions/_lib/jwt.js'

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
