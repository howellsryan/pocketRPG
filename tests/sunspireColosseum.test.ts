import { describe, expect, it } from 'vitest'
import raidsData from '../src/data/raids.json'
import monstersData from '../src/data/monsters.json'
import gameIconsData from '../src/data/gameIcons.json'
import { RAID_ART } from '../src/utils/combatArt.js'
import { createCombatState, createRaidCombatState, processCombatTick, setCombatTarget } from '../src/engine/combat.js'
import { activeTarget, liveAdds, prepareAdd } from '../src/engine/bossAdds.js'
import { raidProgress, raidTotalHitpoints } from '../src/engine/coopRaidEngine.js'

const ZERO_DEFENCE = { stab: -200, slash: -200, crush: -200, magic: -200, ranged: -200 }
const TEST_WEAPON: any = {
  test_blade: {
    id: 'test_blade', slot: 'weapon', attackStyle: 'slash', attackSpeed: 1,
    attackBonus: { stab: 0, slash: 10_000, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 10_000 },
  },
}
const PLAYER = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 999 }

function enemy(id: string, hp = 100): any {
  return {
    id, name: id, hitpoints: hp, combatLevel: 100,
    attackSpeed: 99, attackStyle: 'crush', maxHit: 1,
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0, strengthBonus: 0, defenceBonus: ZERO_DEFENCE,
    drops: [], noSeedDrops: true, noCharmDrops: true,
  }
}

describe('Sunspire Colosseum data contract', () => {
  it('authors twelve waves and disables the ordinary raid hard-mode switch', () => {
    const raid: any = (raidsData as any).sunspire_colosseum
    expect(raid).toBeDefined()
    expect(raid?.id).toBe('sunspire_colosseum')
    expect(raid?.name).toBe('Sunspire Colosseum')
    expect(raid?.hardMode).toBe(false)
    expect(raid?.waves).toHaveLength(12)
  })

  it('uses a PocketRPG-owned gladiator-and-spear emblem for the Colosseum', () => {
    expect((RAID_ART as any).sunspire_colosseum?.icon).toBe('gladiator_spear')
    expect((gameIconsData as any).gladiator_spear?.body).toContain('pocketrpg-gladiator-spear')
  })

  it('keeps the final wave as Aurelios alone and gates Twinflare Chakrams to wave seven or later', () => {
    const raid: any = (raidsData as any).sunspire_colosseum
    const finalWave = raid?.waves?.[11]
    expect(finalWave?.primary).toBe('aurelios_the_unbroken')
    expect(finalWave?.initialAdds || []).toEqual([])
    expect(finalWave?.reinforcements || []).toEqual([])
    expect(raid?.sunspireRewards?.uniqueUnlockWave?.twinflare_chakrams).toBe(7)
  })

  it('encodes the current forty-second reinforcement cadence as 67 game ticks', () => {
    const raid: any = (raidsData as any).sunspire_colosseum
    const reinforcementWaves = (raid?.waves || []).filter((wave: any) => (wave.reinforcements || []).length > 0)
    expect(reinforcementWaves.length).toBeGreaterThan(0)
    for (const wave of reinforcementWaves) {
      for (const group of wave.reinforcements) expect(group.afterTicks).toBe(67)
    }
  })

  it('uses the current wave-four-to-twelve unique odds', () => {
    const raid: any = (raidsData as any).sunspire_colosseum
    expect(raid?.sunspireRewards?.uniqueChanceByWave).toEqual({
      '4': 1 / 124, '5': 1 / 110, '6': 1 / 96, '7': 1 / 82, '8': 1 / 68,
      '9': 1 / 54, '10': 1 / 40, '11': 1 / 26, '12': 1 / 12,
    })
  })
})

describe('wave-shaped raids', () => {
  const monsters: any = {
    captain: enemy('captain', 300),
    ally: enemy('ally', 200),
    late: enemy('late', 150),
  }
  const raid: any = {
    id: 'test_wave_raid',
    name: 'Test Wave Raid',
    waves: [{
      id: 'wave_1',
      primary: 'captain',
      initialAdds: ['ally'],
      reinforcements: [{ afterTicks: 10, monsterIds: ['late'] }],
    }],
    rewards: {},
  }

  it('creates the encounter without requiring a sequential bosses array', () => {
    const state: any = createRaidCombatState(raid, monsters)
    expect(state).not.toBeNull()
    expect(state?.monster?.id).toBe('captain')
    expect(liveAdds(state).map((m: any) => m.id)).toEqual(['ally'])
    expect(state?.raid?.currentWaveIndex).toBe(0)
  })

  it('counts primary enemies, initial companions and authored reinforcements in total raid HP', () => {
    const syntheticRaids: any = { test_wave_raid: raid }
    expect(raidTotalHitpoints('test_wave_raid', monsters, syntheticRaids)).toBe(650)
  })

  it('reports Wave X / N progress for wave-shaped raid state', () => {
    const progress: any = raidProgress({
      raid: { raidId: 'test_wave_raid', name: 'Test Wave Raid', waves: raid.waves, currentWaveIndex: 0 },
    }, monsters)
    expect(progress?.kind).toBe('wave')
    expect(progress?.position).toBe(1)
    expect(progress?.total).toBe(1)
  })
})

describe('finite encounter enemies', () => {
  it('does not complete when the primary enemy dies while another encounter enemy survives', () => {
    const primary = enemy('primary', 1)
    const companion = enemy('companion', 500)
    const state: any = createCombatState(primary, 'melee', 'aggressive', null, { primary, companion })
    state.encounter = { finite: true, wave: 1 }
    state.adds = [prepareAdd(companion, 1)]
    state.monster.currentHP = 0

    const out = processCombatTick(state, PLAYER, { weapon: { itemId: 'test_blade' } }, TEST_WEAPON)

    expect(out.combatState.active).toBe(true)
    expect(out.events.some((event: any) => event.type === 'monsterDeath')).toBe(false)
    expect(activeTarget(out.combatState)?.id).toBe('companion')
  })

  it('does not arm a treadmill respawn when a finite encounter companion dies', () => {
    const primary = enemy('primary', 10_000)
    const companion = enemy('companion', 1)
    let state: any = createCombatState(primary, 'melee', 'aggressive', null, { primary, companion })
    state.encounter = { finite: true, wave: 1 }
    state.adds = [prepareAdd(companion, 1)]
    state = setCombatTarget(state, 0)

    const out = processCombatTick(state, PLAYER, { weapon: { itemId: 'test_blade' } }, TEST_WEAPON)

    expect(liveAdds(out.combatState)).toHaveLength(0)
    expect(out.combatState.addSpawnCountdown).toBeNull()
    expect(out.combatState.active).toBe(true)
  })

  it('owns modifier-spawned enemies as raid-only encounter content', () => {
    const sunspire: any = (raidsData as any).sunspire_colosseum
    expect(sunspire.encounterOnlyMonsters).toEqual([
      'ashen_warband_bulwark',
      'ember_swarm',
      'sunspire_healing_totem',
    ])
    for (const id of sunspire.encounterOnlyMonsters) expect((monstersData as any)[id], id).toBeDefined()
  })

})
