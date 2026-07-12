// Save payload serialization (client-trusted blob, §14). The build step must
// normalise Sets to arrays and strip the server-authoritative kill counts that
// must never ride the save blob (migration 0019 — riding it clobbered KC).
import { describe, it, expect } from 'vitest'
import { buildSavePayloadFromSnapshot, buildSavePayloadFromState } from '../src/db/saveload.js'

describe('buildSavePayloadFromSnapshot', () => {
  it('normalises Set-valued settings to arrays so the blob is JSON-safe', () => {
    const payload = buildSavePayloadFromSnapshot({
      player: { name: 'A' }, stats: {}, inventory: [], bank: {}, equipment: {},
      settings: {
        unlockedFeatures: new Set(['money_purse', 'gather_autobank']),
        completedQuests: new Set(['q1']),
        unlockedMinigameItems: new Set(['m1']),
      },
    })
    expect(Array.isArray(payload.settings.unlockedFeatures)).toBe(true)
    expect(payload.settings.unlockedFeatures).toContain('money_purse')
    expect(Array.isArray(payload.settings.completedQuests)).toBe(true)
    expect(Array.isArray(payload.settings.unlockedMinigameItems)).toBe(true)
    // No Set survives into the serialized form.
    expect(JSON.stringify(payload)).toContain('money_purse')
  })

  it('strips server-authoritative kill counts from the blob', () => {
    const payload = buildSavePayloadFromSnapshot({
      player: {}, stats: {}, inventory: [], bank: {}, equipment: {},
      settings: { bossKillCounts: { boss: 5 }, raidKillCounts: { raid: 2 }, combatStance: 'aggressive' },
    })
    expect(payload.settings.bossKillCounts).toBeUndefined()
    expect(payload.settings.raidKillCounts).toBeUndefined()
    expect(payload.settings.combatStance).toBe('aggressive') // unrelated settings survive
  })

  it('preserves core state and stamps version + timestamp', () => {
    const inventory = [{ itemId: 'coins', quantity: 10 }]
    const stats = { attack: { xp: 1234 } }
    const payload = buildSavePayloadFromSnapshot({ player: { name: 'B' }, stats, inventory, bank: { shrimps: { itemId: 'shrimps', quantity: 3 } }, equipment: {}, settings: {} })
    expect(payload.stats).toBe(stats)
    expect(payload.inventory).toBe(inventory)
    expect(typeof payload.version).toBe('number')
    expect(payload.timestamp).toBeGreaterThan(0)
  })

  it('tolerates a null snapshot without throwing', () => {
    const payload = buildSavePayloadFromSnapshot(null)
    expect(payload.settings).toEqual({})
    expect(typeof payload.version).toBe('number')
  })
})

describe('buildSavePayloadFromState (legacy positional wrapper)', () => {
  it('routes positional settings args into the settings object', () => {
    const payload = buildSavePayloadFromState(
      { name: 'C' }, { attack: { xp: 5 } }, [], {}, {},
      /* bankConfig */ { tab: 0 }, /* homeShortcuts */ ['a'], /* bossKillCounts */ { boss: 9 },
      /* completedQuests */ new Set(['q']), /* questQueue */ [], /* combatStance */ 'controlled',
      /* unlockedFeatures */ new Set(['money_purse']),
    )
    expect(payload.settings.combatStance).toBe('controlled')
    expect(payload.settings.unlockedFeatures).toContain('money_purse')
    expect(payload.settings.bossKillCounts).toBeUndefined() // stripped even via the legacy path
  })
})
