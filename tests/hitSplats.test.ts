// Hit-splat event mapping — the contract between the PvE combat tick events
// and the floating splats rendered by <HitSplatLayer> (Phase 4 combat
// feedback). Damage the player deals shows over the monster's HP bar; damage
// the player takes shows over the player's; misses are 0-value splats.

import { describe, it, expect } from 'vitest'
import { splatsFromCombatEvents, HIT_SPLAT_DURATION_MS } from '../src/utils/hitSplats.js'

describe('splatsFromCombatEvents', () => {
  it('maps playerHit damage to a monster splat', () => {
    const { monster, player } = splatsFromCombatEvents([
      { type: 'playerHit', damage: 12, monsterHP: 30 },
    ])
    expect(monster).toHaveLength(1)
    expect(monster[0].value).toBe(12)
    expect(player).toHaveLength(0)
  })

  it('maps a playerHit miss to a 0-value monster splat', () => {
    const { monster } = splatsFromCombatEvents([
      { type: 'playerHit', damage: 0, monsterHP: 30 },
    ])
    expect(monster).toHaveLength(1)
    expect(monster[0].value).toBe(0)
  })

  it('maps each specialHit hit to its own monster splat', () => {
    const { monster } = splatsFromCombatEvents([
      { type: 'specialHit', hits: [8, 0, 15], totalDamage: 23, specType: 'double_hit' },
    ])
    expect(monster.map((s) => s.value)).toEqual([8, 0, 15])
  })

  it('maps monsterHit and dragonfireHit damage to player splats', () => {
    const { player, monster } = splatsFromCombatEvents([
      { type: 'monsterHit', damage: 7, playerHP: 40 },
      { type: 'dragonfireHit', damage: 22, playerHP: 18 },
    ])
    expect(player.map((s) => s.value)).toEqual([7, 22])
    expect(monster).toHaveLength(0)
  })

  it('maps monsterMiss to a 0-value player splat', () => {
    const { player } = splatsFromCombatEvents([
      { type: 'monsterMiss', playerHP: 40 },
    ])
    expect(player).toHaveLength(1)
    expect(player[0].value).toBe(0)
  })

  it('ignores non-damage events', () => {
    const { monster, player } = splatsFromCombatEvents([
      { type: 'xp', xpSkills: { attack: 48 } },
      { type: 'monsterDeath', monster: { id: 'field_chicken' }, loot: [] },
      { type: 'dragonfireBlocked' },
      null,
    ])
    expect(monster).toHaveLength(0)
    expect(player).toHaveLength(0)
  })

  it('assigns unique ids and clamped horizontal offsets', () => {
    const { monster } = splatsFromCombatEvents([
      { type: 'playerHit', damage: 3 },
      { type: 'playerHit', damage: 4 },
    ])
    expect(monster[0].id).not.toBe(monster[1].id)
    for (const splat of monster) {
      expect(splat.left).toBeGreaterThanOrEqual(25)
      expect(splat.left).toBeLessThanOrEqual(75)
    }
  })

  it('floors fractional damage values', () => {
    const { monster } = splatsFromCombatEvents([
      { type: 'playerHit', damage: 4.9 },
    ])
    expect(monster[0].value).toBe(4)
  })

  it('exposes a positive splat lifetime', () => {
    expect(HIT_SPLAT_DURATION_MS).toBeGreaterThan(0)
  })
})
