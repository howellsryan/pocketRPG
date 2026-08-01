import { describe, expect, it } from 'vitest'
import { rollClueRewardsByLevel, VALID_CLUE_REWARD_ITEMS } from '../functions/_lib/game/clueRewards.js'
import { makeCompletionHandler } from '../functions/api/actions/_completeShared.js'

function seqRandom(values: number[]) {
  let i = 0
  return () => {
    const v = values[i]
    i += 1
    return v ?? 0
  }
}

describe('rollClueRewardsByLevel', () => {
  it('returns empty for an unknown clue level', () => {
    expect(rollClueRewardsByLevel('not_a_level', seqRandom([0]))).toEqual([])
  })

  it('rolls items only from the configured clue table', () => {
    const rewards = rollClueRewardsByLevel('medium', Math.random)
    const validIds = VALID_CLUE_REWARD_ITEMS.get('medium')
    expect(rewards.length).toBeGreaterThan(0)
    for (const r of rewards) expect(validIds?.has(r.itemId)).toBe(true)
  })

  it('exposes every clue table item as a valid reward source', () => {
    expect(VALID_CLUE_REWARD_ITEMS.get('medium')?.has('pathfinder_boots')).toBe(true)
    expect(VALID_CLUE_REWARD_ITEMS.get('master')?.has('2nd_age_druidic_staff')).toBe(true)
    expect(VALID_CLUE_REWARD_ITEMS.get('hard')?.has('air_rune')).toBe(true)
  })
})

describe('clue completion endpoint', () => {
  function makeBaseDeps() {
    return {
      requireAuth: async () => ({ identity: { id: 1 } }),
      claimActionNonce: async () => {},
      loadCharacterWithSave: async () => ({ saveObject: { inventory: [], bank: {} }, saveRevision: 0 }),
      writeSave: async () => ({ updatedAt: 1, saveRevision: 1 }),
    }
  }

  it('accepts common clue rewards (e.g. air_rune) rolled server-side', async () => {
    const handler = makeCompletionHandler('clues', {
      ...makeBaseDeps(),
      resolveRewards: () => [{ itemId: 'air_rune', quantity: 100 }],
    })
    const req = new Request('https://example.com/api/actions/clue/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'medium', actionNonce: 'n_air' }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(200)
  })

  it('accepts unique clue rewards (e.g. pathfinder_boots) rolled server-side', async () => {
    const handler = makeCompletionHandler('clues', {
      ...makeBaseDeps(),
      resolveRewards: () => [{ itemId: 'pathfinder_boots', quantity: 1 }],
    })
    const req = new Request('https://example.com/api/actions/clue/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'medium', actionNonce: 'n_path' }),
    })
    const res = await handler({ request: req, env: {} as any })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.granted).toEqual([{ itemId: 'pathfinder_boots', quantity: 1, destination: 'inventory' }])
  })

  it('rejects items not in the clue reward table for the given level', async () => {
    const handler = makeCompletionHandler('clues', {
      ...makeBaseDeps(),
      resolveRewards: () => [{ itemId: 'twisted_longbow', quantity: 1 }],
    })
    const req = new Request('https://example.com/api/actions/clue/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'medium', actionNonce: 'n_bad' }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(403)
  })

  it('rejects unknown clue level source ids', async () => {
    const handler = makeCompletionHandler('clues', makeBaseDeps())
    const req = new Request('https://example.com/api/actions/clue/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Character-Id': '42' },
      body: JSON.stringify({ sourceId: 'not_a_level', actionNonce: 'n_bad_src' }),
    })
    const res = await handler({ request: req, env: {} as any })
    expect(res.status).toBe(403)
  })
})
