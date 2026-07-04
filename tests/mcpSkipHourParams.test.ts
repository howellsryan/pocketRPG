import { describe, expect, it, vi } from 'vitest'

// skip_hour's MCP-facing params are boss_id/raid_id (snake_case, consistent
// with every other tool's item_id/monster_id/raid_id) even though the
// underlying /api/skip-hour endpoint's own wire format is camelCase
// bossId/raidId. Mock both bridged handlers to assert the tools.js dispatch
// translates at that boundary instead of leaking the inconsistency to the
// model.
vi.mock('../functions/api/characters/index.js', () => ({
  onRequestGet: vi.fn(async () =>
    new Response(JSON.stringify({ characters: [{ id: 7, username: 'Hero' }] }), { status: 200 }),
  ),
}))

let capturedBody: any = null
const postSkipHour = vi.fn(async ({ request }: any) => {
  capturedBody = await request.json()
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})
vi.mock('../functions/api/skip-hour.js', () => ({ onRequestPost: postSkipHour }))

const { callTool } = await import('../functions/_lib/mcp/tools.js')

describe('skip_hour param translation', () => {
  it('forwards boss_id as bossId to /api/skip-hour', async () => {
    capturedBody = null
    await callTool('skip_hour', { boss_id: 'deepmaw_kraken', character_id: 7 }, { env: {}, authorization: 'Bearer t' } as any)
    expect(capturedBody).toEqual({ bossId: 'deepmaw_kraken', raidId: undefined })
  })

  it('forwards raid_id as raidId to /api/skip-hour', async () => {
    capturedBody = null
    await callTool('skip_hour', { raid_id: 'chambers_of_xeric', character_id: 7 }, { env: {}, authorization: 'Bearer t' } as any)
    expect(capturedBody).toEqual({ bossId: undefined, raidId: 'chambers_of_xeric' })
  })
})
