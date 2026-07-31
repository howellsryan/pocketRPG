import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1 } from './helpers/d1'

// Real schema, real SQL; only the JWT verify is stubbed. Identity 7 owns
// character 42 — identity 999 owns nothing, which is what the ownership test
// leans on.
let authIdentityId = 7
vi.mock('../functions/_lib/auth.js', () => ({
  requireAuth: async () => ({ identity: { id: authIdentityId } }),
  json: (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))
import { isHardModeEnabled, listHardModeTargets, setHardModeTarget } from '../functions/_lib/game/hardMode.js'
import { rollMonsterRewardsById } from '../functions/_lib/game/monsterRewards.js'
import { rollRaidRewardsById } from '../functions/_lib/game/raidRewards.js'
import { makeCompletionHandler } from '../functions/api/actions/_completeShared.js'
import { onRequestPost as hardModePost, onRequestGet as hardModeGet } from '../functions/api/hard-mode.js'
import monstersData from '../src/data/monsters.json'
import raidsData from '../src/data/raids.json'

const anyMonsters = monstersData as Record<string, any>
const HARD_BOSS = Object.keys(anyMonsters).find((id) => anyMonsters[id].hardMode === true)!

let env: any

function seedCharacter(raw: any, id = 42, ownerId = 7) {
  raw.exec(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_level, combat_level, is_bot)
     VALUES (${id}, ${ownerId}, 'tester', 1, 0, 0, 0, 100, 3, 0)`,
  )
}

beforeEach(() => {
  authIdentityId = 7
  const d = makeD1()
  seedCharacter(d.raw)
  env = { DB: d.DB }
})

function request(body: any, method = 'POST') {
  return new Request('https://example.com/api/hard-mode', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
}

describe('hard mode state is the server’s', () => {
  it('stores and clears a switch, and lists what is on', async () => {
    expect(await isHardModeEnabled(env, 42, 'monsters', HARD_BOSS)).toBe(false)
    await setHardModeTarget(env, 42, 'monsters', HARD_BOSS, true)
    await setHardModeTarget(env, 42, 'monsters', HARD_BOSS, true)
    expect(await isHardModeEnabled(env, 42, 'monsters', HARD_BOSS)).toBe(true)
    expect(await listHardModeTargets(env, 42)).toEqual([{ sourceType: 'monsters', sourceId: HARD_BOSS }])
    await setHardModeTarget(env, 42, 'monsters', HARD_BOSS, false)
    expect(await isHardModeEnabled(env, 42, 'monsters', HARD_BOSS)).toBe(false)
  })

  it('refuses a target that has no authored hard mode', async () => {
    await setHardModeTarget(env, 42, 'monsters', 'field_chicken', true)
    expect(await isHardModeEnabled(env, 42, 'monsters', 'field_chicken')).toBe(false)
    expect(await listHardModeTargets(env, 42)).toEqual([])
  })
})

describe('/api/hard-mode', () => {
  it('rejects an unauthored target and accepts a real one', async () => {
    const bad = await hardModePost({ request: request({ sourceType: 'monsters', sourceId: 'field_chicken', enabled: true }), env } as any)
    expect(bad.status).toBe(400)

    const ok = await hardModePost({ request: request({ sourceType: 'monsters', sourceId: HARD_BOSS, enabled: true }), env } as any)
    expect(ok.status).toBe(200)
    expect(await isHardModeEnabled(env, 42, 'monsters', HARD_BOSS)).toBe(true)

    const listed = await hardModeGet({ request: request(null, 'GET'), env } as any)
    expect(await listed.json()).toEqual({ entries: [{ sourceType: 'monsters', sourceId: HARD_BOSS }] })
  })

  it('refuses a character the caller does not own', async () => {
    authIdentityId = 999
    const res = await hardModePost({
      request: request({ sourceType: 'monsters', sourceId: HARD_BOSS, enabled: true }),
      env,
    } as any)
    expect(res.status).toBe(404)
  })
})

describe('doubled drop rates come from server state, never the request', () => {
  // A roll that lands just above the authored chance and just below the doubled
  // one: it drops in hard mode and nowhere else.
  function rollerAt(value: number) {
    return () => value
  }

  it('doubles a monster drop chance only when the flag is set', () => {
    const drop = anyMonsters[HARD_BOSS].drops.find((d: any) => d.chance > 0 && d.chance < 0.5)
    const between = drop.chance * 1.5
    expect(rollMonsterRewardsById(HARD_BOSS, rollerAt(between), false, false).some((l: any) => l.itemId === drop.itemId)).toBe(false)
    expect(rollMonsterRewardsById(HARD_BOSS, rollerAt(between), false, true).some((l: any) => l.itemId === drop.itemId)).toBe(true)
  })

  it('doubles a raid unique’s odds only when the flag is set', () => {
    const raids = raidsData as Record<string, any>
    const raidId = Object.keys(raids).find((id) => raids[id]?.rewards?.unique?.chance > 0)!
    const chance = raids[raidId].rewards.unique.chance
    const between = chance * 1.5
    const normal = rollRaidRewardsById(raidId, rollerAt(between), false)
    const hard = rollRaidRewardsById(raidId, rollerAt(between), true)
    expect(hard.length).toBeGreaterThan(normal.length)
  })

  it('a completion handler ignores a hardMode field in the request body', async () => {
    const rewardCalls: boolean[] = []
    const handler = makeCompletionHandler('monsters', {
      requireAuth: async () => ({ identity: { id: 7 } }),
      assertNotInActiveMatch: async () => null,
      assertNotInCoopSession: async () => null,
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [] }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
      resolveRewards: async ({ env: handlerEnv, characterId, sourceId }: any) => {
        rewardCalls.push(await isHardModeEnabled(handlerEnv, characterId, 'monsters', sourceId))
        return []
      },
    })
    const post = (body: any) => handler({
      request: new Request('https://example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
        body: JSON.stringify(body),
      }),
      env,
    } as any)

    await post({ sourceId: HARD_BOSS, actionNonce: 'n1', hardMode: true })
    expect(rewardCalls[0]).toBe(false)

    await setHardModeTarget(env, 42, 'monsters', HARD_BOSS, true)
    await post({ sourceId: HARD_BOSS, actionNonce: 'n2', hardMode: false })
    expect(rewardCalls[1]).toBe(true)
  })
})

describe('skipping a hard fight', () => {
  it('charges double, because a skip buys the doubled reward roll', async () => {
    const { onRequestPost: skipHour } = await import('../functions/api/skip-hour.js')
    env.DB.prepare('UPDATE characters SET credits = 100 WHERE id = 42').run()
    const post = (body: any) => skipHour({
      request: new Request('https://example.com/api/skip-hour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
        body: JSON.stringify(body),
      }),
      env,
    } as any)

    const base = Math.max(1, Math.floor(Number(anyMonsters[HARD_BOSS].skipCost) || 1))
    const normal = await (await post({ bossId: HARD_BOSS })).json()
    expect(normal.cost).toBe(base)

    await setHardModeTarget(env, 42, 'monsters', HARD_BOSS, true)
    const hard = await (await post({ bossId: HARD_BOSS })).json()
    expect(hard.cost).toBe(base * 2)
    expect(hard.credits_remaining).toBe(100 - base - base * 2)
  })

  it('leaves an ordinary hour skip at one credit', async () => {
    const { onRequestPost: skipHour } = await import('../functions/api/skip-hour.js')
    env.DB.prepare('UPDATE characters SET credits = 5 WHERE id = 42').run()
    await setHardModeTarget(env, 42, 'monsters', HARD_BOSS, true)
    const res = await skipHour({
      request: new Request('https://example.com/api/skip-hour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
        body: JSON.stringify({}),
      }),
      env,
    } as any)
    expect((await res.json()).cost).toBe(1)
  })
})
