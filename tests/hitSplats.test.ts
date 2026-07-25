// Hit-splat event mapping — the contract between the PvE combat tick events
// and the floating splats rendered by <HitSplatLayer> (Phase 4 combat
// feedback). Damage the player deals shows over the monster's HP bar; damage
// the player takes shows over the player's; misses are 0-value splats.

import { describe, it, expect } from 'vitest'
import { splatsFromCombatEvents, splatsFromPvpEvents, splatsFromCoopEvents, HIT_SPLAT_DURATION_MS } from '../src/utils/hitSplats.js'

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

  it('maps a summonHit to an orange-variant monster splat', () => {
    const { monster, player } = splatsFromCombatEvents([
      { type: 'summonHit', creatureId: 'dragon', damage: 14, monsterHP: 40 },
    ])
    expect(monster).toHaveLength(1)
    expect(monster[0].value).toBe(14)
    expect(monster[0].variant).toBe('summon')
    expect(player).toHaveLength(0)
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

describe('splatsFromPvpEvents', () => {
  it('routes damage you deal to the opponent side and damage you take to self', () => {
    const { self, opp } = splatsFromPvpEvents([
      { type: 'attack', attackerCharacterId: 1, defenderCharacterId: 2, damage: 14 },
      { type: 'attack', attackerCharacterId: 2, defenderCharacterId: 1, damage: 9 },
    ], 1)
    expect(opp.map((s) => s.value)).toEqual([14])
    expect(self.map((s) => s.value)).toEqual([9])
  })

  it('splats each hit of a multi-hit special separately', () => {
    const { opp } = splatsFromPvpEvents([
      { type: 'attack', attackerCharacterId: 1, defenderCharacterId: 2, damage: 18, hits: [10, 0, 8] },
    ], 1)
    expect(opp.map((s) => s.value)).toEqual([10, 0, 8])
  })

  it('shows misses as 0-value splats', () => {
    const { self } = splatsFromPvpEvents([
      { type: 'attack', attackerCharacterId: 2, defenderCharacterId: 1, damage: 0, hit: false },
    ], 1)
    expect(self.map((s) => s.value)).toEqual([0])
  })

  it('handles string vs number character id comparison', () => {
    const { self } = splatsFromPvpEvents([
      { type: 'attack', attackerCharacterId: 2, defenderCharacterId: '1', damage: 5 },
    ], 1)
    expect(self.map((s) => s.value)).toEqual([5])
  })

  it('ignores non-attack events', () => {
    const { self, opp } = splatsFromPvpEvents([
      { type: 'eat', characterId: 1, itemId: 'shark', heal: 20 },
      { type: 'drink', characterId: 2, itemId: 'attack_potion' },
      { type: 'no_ammo', characterId: 1 },
      { type: 'forfeit', characterId: 2 },
      null,
    ], 1)
    expect(self).toHaveLength(0)
    expect(opp).toHaveLength(0)
  })
})

describe('splatsFromCoopEvents', () => {
  it('splats every member\'s damage on the shared boss bar', () => {
    const { boss } = splatsFromCoopEvents([
      { type: 'playerHit', characterId: 1, damage: 12 },
      { type: 'playerHit', characterId: 2, damage: 30 },
    ], 1)
    expect(boss.map((s) => s.value)).toEqual([12, 30])
  })

  it('only splats incoming damage on the member the boss actually swung at', () => {
    const events = [
      { type: 'monsterHit', characterId: 1, damage: 25, isTarget: true },
      { type: 'monsterHit', characterId: 2, damage: 25, isTarget: true },
    ]
    expect(splatsFromCoopEvents(events, 1).player.map((s) => s.value)).toEqual([25])
    expect(splatsFromCoopEvents(events, 2).player.map((s) => s.value)).toEqual([25])
    expect(splatsFromCoopEvents(events, 3).player).toHaveLength(0)
  })

  it('ignores an incoming hit tagged for a member who was not the target', () => {
    const { player } = splatsFromCoopEvents([
      { type: 'monsterHit', characterId: 1, damage: 25, isTarget: false },
    ], 1)
    expect(player).toHaveLength(0)
  })

  it('routes add damage away from the boss bar', () => {
    const { boss, add } = splatsFromCoopEvents([
      { type: 'playerHit', characterId: 1, damage: 9, toAdd: true },
      { type: 'playerHit', characterId: 2, damage: 4 },
    ], 1)
    expect(add.map((s) => s.value)).toEqual([9])
    expect(boss.map((s) => s.value)).toEqual([4])
  })

  it('splats each hit of a special separately', () => {
    const { boss } = splatsFromCoopEvents([
      { type: 'specialHit', characterId: 2, hits: [11, 0, 7] },
    ], 1)
    expect(boss.map((s) => s.value)).toEqual([11, 0, 7])
  })

  it('shows a miss against you as a 0-value splat', () => {
    const { player } = splatsFromCoopEvents([
      { type: 'monsterMiss', characterId: 1, isTarget: true },
    ], 1)
    expect(player.map((s) => s.value)).toEqual([0])
  })

  it('splats bolt-proc recoil on the shooter regardless of who is targeted', () => {
    const { player } = splatsFromCoopEvents([
      { type: 'boltProc', characterId: 1, selfDamage: 6, isTarget: false },
    ], 1)
    expect(player.map((s) => s.value)).toEqual([6])
  })

  it('matches character ids across string/number forms', () => {
    const { player } = splatsFromCoopEvents([
      { type: 'monsterHit', characterId: '7', damage: 3, isTarget: true },
    ], 7)
    expect(player.map((s) => s.value)).toEqual([3])
  })

  it('ignores non-combat events', () => {
    const { boss, add, player } = splatsFromCoopEvents([
      { type: 'eat', characterId: 1, itemId: 'shark', heal: 20 },
      { type: 'memberDeath', characterId: 1 },
      { type: 'bossRespawned', bossId: 'warlord_grondar' },
      null,
    ], 1)
    expect(boss).toHaveLength(0)
    expect(add).toHaveLength(0)
    expect(player).toHaveLength(0)
  })
})
