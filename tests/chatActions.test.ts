import { describe, expect, it } from 'vitest'
import monstersData from '../src/data/monsters.json'
import {
  CHAT_ACTION_FEE,
  CHAT_WRITE_TOOLS,
  actionCreditCost,
  actionLabel,
  actionSkipCost,
  isWriteTool,
  signPendingAction,
  verifyPendingAction,
} from '../functions/_lib/chat/actions.js'

const SECRET = 'test-secret'

describe('chat write-tool detection', () => {
  it('flags state-mutating tools as writes and read tools as not', () => {
    expect(isWriteTool('sell_item')).toBe(true)
    expect(isWriteTool('assign_slayer_task')).toBe(true)
    expect(isWriteTool('kill_boss')).toBe(true)
    expect(isWriteTool('get_character_state')).toBe(false)
    expect(isWriteTool('inspect_item')).toBe(false)
    expect(CHAT_WRITE_TOOLS.has('buy_item')).toBe(true)
    expect(CHAT_WRITE_TOOLS.has('list_items')).toBe(false)
  })
})

describe('pending-action token', () => {
  it('round-trips a signed action bound to its character', async () => {
    const token = await signPendingAction(
      { tool: 'sell_item', args: { item_id: 'oak_logs', quantity: 5, character_id: 42 }, characterId: 42 },
      SECRET,
    )
    const payload = await verifyPendingAction(token, SECRET, 42)
    expect(payload?.tool).toBe('sell_item')
    expect(payload?.args).toEqual({ item_id: 'oak_logs', quantity: 5, character_id: 42 })
  })

  it('rejects a token for a different character, a bad secret, or a non-write tool', async () => {
    const token = await signPendingAction({ tool: 'sell_item', args: { character_id: 42 }, characterId: 42 }, SECRET)
    expect(await verifyPendingAction(token, SECRET, 99)).toBeNull()
    expect(await verifyPendingAction(token, 'wrong-secret', 42)).toBeNull()
    // A token that names a read tool must not be executable as an action.
    const readToken = await signPendingAction({ tool: 'get_character_state', args: {}, characterId: 42 }, SECRET)
    expect(await verifyPendingAction(readToken, SECRET, 42)).toBeNull()
  })
})

describe('action credit cost', () => {
  it('is the flat fee for a plain write, with no skip', () => {
    expect(actionCreditCost('sell_item', { item_id: 'oak_logs' })).toEqual({
      fee: CHAT_ACTION_FEE,
      skip: 0,
      total: CHAT_ACTION_FEE,
    })
    expect(actionSkipCost('equip_item', { item_id: 'rune_scimitar' })).toBe(0)
  })

  it('adds the skip credits for skip-based actions', () => {
    expect(actionSkipCost('skip_slayer_task', {})).toBe(1)
    expect(actionSkipCost('skip_hour', {})).toBe(1)
    // Unknown boss id falls back to 1 credit.
    expect(actionSkipCost('kill_boss', { monster_id: 'not_a_boss' })).toBe(1)
    expect(actionCreditCost('skip_slayer_task', {})).toEqual({ fee: 1, skip: 1, total: 2 })
  })

  it("reads a real boss's skipCost from the data", () => {
    const entry = Object.entries(monstersData as Record<string, any>).find(
      ([, m]) => Number.isFinite(m?.skipCost) && m.skipCost > 1,
    )
    if (entry) {
      const [monsterId, m] = entry
      expect(actionSkipCost('kill_boss', { monster_id: monsterId })).toBe(Math.floor(m.skipCost))
    }
  })
})

describe('action label', () => {
  it('reads as a short human summary of tool + subject', () => {
    expect(actionLabel('sell_item', { item_id: 'oak_logs', quantity: 100 })).toBe('Sell item: 100 × Oak Logs')
    expect(actionLabel('assign_slayer_task', { master_id: 'turael' })).toBe('Assign slayer task: Turael')
    expect(actionLabel('harvest_all', {})).toBe('Harvest all crops')
  })
})
