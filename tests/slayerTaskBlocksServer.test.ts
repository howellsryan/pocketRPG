import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'

let authIdentityId = 7
vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: authIdentityId } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

import {
  SLAYER_TASK_BLOCK_COST, SLAYER_TASK_BLOCK_MAX,
  listSlayerTaskBlocks, activeBlockedMonsterIds, insertSlayerTaskBlock, setSlayerTaskBlockActive, removeSlayerTaskBlock,
} from '../functions/_lib/game/slayerTaskBlocks.js'
import { onRequestGet as blocksGet, onRequestPost as blocksPost, onRequestPatch as blocksPatch, onRequestDelete as blocksDelete } from '../functions/api/slayer/blocks.js'
import { allBlockableSlayerTaskIds } from '../src/engine/slayerMasters.js'

const [MONSTER_A, MONSTER_B, ...REST] = allBlockableSlayerTaskIds()

let env: any

function seedCharacter(raw: any, id = 42, ownerId = 7, credits = 100) {
  raw.exec(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_level, combat_level, is_bot)
     VALUES (${id}, ${ownerId}, 'tester', 1, 0, 0, ${credits}, 100, 3, 0)`,
  )
}

beforeEach(() => {
  authIdentityId = 7
  const d = makeD1()
  seedCharacter(d.raw)
  env = { DB: d.DB }
})

function request(body: any, method: string) {
  return new Request('https://example.com/api/slayer/blocks', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  })
}

describe('slayer_task_blocks storage', () => {
  it('inserts, lists, and reports only active blocks as blocking', async () => {
    expect(await listSlayerTaskBlocks(env, 42)).toEqual([])
    expect(await insertSlayerTaskBlock(env, 42, MONSTER_A)).toBe(true)
    expect(await listSlayerTaskBlocks(env, 42)).toEqual([{ monsterId: MONSTER_A, active: true }])
    expect(await activeBlockedMonsterIds(env, 42)).toEqual(new Set([MONSTER_A]))

    await setSlayerTaskBlockActive(env, 42, MONSTER_A, false)
    expect(await listSlayerTaskBlocks(env, 42)).toEqual([{ monsterId: MONSTER_A, active: false }])
    expect(await activeBlockedMonsterIds(env, 42)).toEqual(new Set())
  })

  it('refuses a duplicate insert for the same monster', async () => {
    expect(await insertSlayerTaskBlock(env, 42, MONSTER_A)).toBe(true)
    expect(await insertSlayerTaskBlock(env, 42, MONSTER_A)).toBe(false)
  })

  it('refuses an insert past the cap', async () => {
    const ids = allBlockableSlayerTaskIds().slice(0, SLAYER_TASK_BLOCK_MAX)
    expect(ids.length).toBe(SLAYER_TASK_BLOCK_MAX)
    for (const id of ids) expect(await insertSlayerTaskBlock(env, 42, id)).toBe(true)
    expect(await listSlayerTaskBlocks(env, 42)).toHaveLength(SLAYER_TASK_BLOCK_MAX)

    const overflow = allBlockableSlayerTaskIds()[SLAYER_TASK_BLOCK_MAX]
    expect(await insertSlayerTaskBlock(env, 42, overflow)).toBe(false)
    expect(await listSlayerTaskBlocks(env, 42)).toHaveLength(SLAYER_TASK_BLOCK_MAX)
  })

  it('removes a block outright', async () => {
    await insertSlayerTaskBlock(env, 42, MONSTER_A)
    expect(await removeSlayerTaskBlock(env, 42, MONSTER_A)).toBe(true)
    expect(await listSlayerTaskBlocks(env, 42)).toEqual([])
    expect(await removeSlayerTaskBlock(env, 42, MONSTER_A)).toBe(false)
  })
})

describe('/api/slayer/blocks', () => {
  it('purchases a block, debiting exactly the cost', async () => {
    const res = await blocksPost({ request: request({ monsterId: MONSTER_A }, 'POST'), env } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, monsterId: MONSTER_A, active: true, credits_remaining: 100 - SLAYER_TASK_BLOCK_COST })

    const listed = await blocksGet({ request: request(null, 'GET'), env } as any)
    expect(await listed.json()).toEqual({ entries: [{ monsterId: MONSTER_A, active: true }], cost: SLAYER_TASK_BLOCK_COST, max: SLAYER_TASK_BLOCK_MAX })
  })

  it('refuses with 402 and takes no credits when the balance is short', async () => {
    env.DB.prepare('UPDATE characters SET credits = ? WHERE id = 42').bind(SLAYER_TASK_BLOCK_COST - 1).run()
    const res = await blocksPost({ request: request({ monsterId: MONSTER_A }, 'POST'), env } as any)
    expect(res.status).toBe(402)
    const row = await env.DB.prepare('SELECT credits FROM characters WHERE id = 42').first()
    expect(row.credits).toBe(SLAYER_TASK_BLOCK_COST - 1)
    expect(await listSlayerTaskBlocks(env, 42)).toEqual([])
  })

  it('refunds the debit when the purchase is refused past the cap', async () => {
    for (const id of allBlockableSlayerTaskIds().slice(0, SLAYER_TASK_BLOCK_MAX)) {
      expect(await insertSlayerTaskBlock(env, 42, id)).toBe(true)
    }
    const before = (await env.DB.prepare('SELECT credits FROM characters WHERE id = 42').first()).credits
    const overflow = allBlockableSlayerTaskIds()[SLAYER_TASK_BLOCK_MAX]
    const res = await blocksPost({ request: request({ monsterId: overflow }, 'POST'), env } as any)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('BLOCK_LIST_FULL')
    const after = (await env.DB.prepare('SELECT credits FROM characters WHERE id = 42').first()).credits
    expect(after).toBe(before)
  })

  it('refuses an unknown monster id', async () => {
    const res = await blocksPost({ request: request({ monsterId: 'not_a_real_monster' }, 'POST'), env } as any)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('UNKNOWN_MONSTER')
  })

  it('toggles active for free without touching credits', async () => {
    await insertSlayerTaskBlock(env, 42, MONSTER_A)
    const before = (await env.DB.prepare('SELECT credits FROM characters WHERE id = 42').first()).credits
    const res = await blocksPatch({ request: request({ monsterId: MONSTER_A, active: false }, 'PATCH'), env } as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, monsterId: MONSTER_A, active: false })
    const after = (await env.DB.prepare('SELECT credits FROM characters WHERE id = 42').first()).credits
    expect(after).toBe(before)
    expect(await activeBlockedMonsterIds(env, 42)).toEqual(new Set())
  })

  it('404s toggling a monster that was never blocked', async () => {
    const res = await blocksPatch({ request: request({ monsterId: MONSTER_B, active: true }, 'PATCH'), env } as any)
    expect(res.status).toBe(404)
  })

  it('removes a block for free, permanently', async () => {
    await insertSlayerTaskBlock(env, 42, MONSTER_A)
    const res = await blocksDelete({ request: request({ monsterId: MONSTER_A }, 'DELETE'), env } as any)
    expect(res.status).toBe(200)
    expect(await listSlayerTaskBlocks(env, 42)).toEqual([])
  })

  it('refuses a character the caller does not own', async () => {
    authIdentityId = 999
    const res = await blocksPost({ request: request({ monsterId: MONSTER_A }, 'POST'), env } as any)
    expect(res.status).toBe(404)
  })
})
