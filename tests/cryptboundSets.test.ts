// Validates the Cryptbound Brothers full-set effects in combat.js: the two
// pre-existing sets (Dravok/Dharok, Gorath/Guthan) plus the four added here
// (Morvyn/Ahrim, Kaelor/Karil, Torvek/Torag, Verin/Verac).

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'

function meleeWeapon(id: string, style: string, extra: any = {}) {
  return {
    id, slot: 'weapon', type: 'weapon', attackStyle: style, attackSpeed: 5,
    attackBonus: { stab: 80, slash: 80, crush: 80, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 80 },
    ...extra,
  }
}

function armourPiece(id: string, slot: string) {
  return {
    id, slot, type: 'armour',
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 20, slash: 20, crush: 20, magic: 0, ranged: 0 },
    otherBonus: {},
  }
}

const itemsData: any = {
  dravok_s_helm: armourPiece('dravok_s_helm', 'head'),
  dravok_s_platebody: armourPiece('dravok_s_platebody', 'body'),
  dravok_s_platelegs: armourPiece('dravok_s_platelegs', 'legs'),
  dravok_s_greataxe: meleeWeapon('dravok_s_greataxe', 'crush'),

  gorath_s_helm: armourPiece('gorath_s_helm', 'head'),
  gorath_s_platebody: armourPiece('gorath_s_platebody', 'body'),
  gorath_s_chainskirt: armourPiece('gorath_s_chainskirt', 'legs'),
  gorath_s_warspear: meleeWeapon('gorath_s_warspear', 'stab'),

  torvek_s_helm: armourPiece('torvek_s_helm', 'head'),
  torvek_s_platebody: armourPiece('torvek_s_platebody', 'body'),
  torvek_s_platelegs: armourPiece('torvek_s_platelegs', 'legs'),
  torvek_s_hammers: meleeWeapon('torvek_s_hammers', 'crush'),

  verin_s_helm: armourPiece('verin_s_helm', 'head'),
  verin_s_brassard: armourPiece('verin_s_brassard', 'body'),
  verin_s_plateskirt: armourPiece('verin_s_plateskirt', 'legs'),
  verin_s_flail: meleeWeapon('verin_s_flail', 'crush'),

  morvyn_s_hood: armourPiece('morvyn_s_hood', 'head'),
  morvyn_s_robetop: armourPiece('morvyn_s_robetop', 'body'),
  morvyn_s_robeskirt: armourPiece('morvyn_s_robeskirt', 'legs'),
  morvyn_s_staff: meleeWeapon('morvyn_s_staff', 'crush'),

  kaelor_s_coif: armourPiece('kaelor_s_coif', 'head'),
  kaelor_s_leathertop: armourPiece('kaelor_s_leathertop', 'body'),
  kaelor_s_leatherskirt: armourPiece('kaelor_s_leatherskirt', 'legs'),
  kaelor_s_crossbow: {
    id: 'kaelor_s_crossbow', slot: 'weapon', type: 'weapon', attackStyle: 'ranged', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 80 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { rangedStrength: 80 },
  },

  plain_dagger: meleeWeapon('plain_dagger', 'stab'),
  plain_shortbow: {
    id: 'plain_shortbow', slot: 'weapon', type: 'weapon', attackStyle: 'ranged', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 80 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { rangedStrength: 80 },
  },
}

const strongPlayer: any = {
  attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, currentHP: 99, maxHP: 99,
}

function weakDefenceMonster(overrides: any = {}) {
  return {
    id: 'crypt_dummy', name: 'Crypt Dummy', hitpoints: 10000, currentHP: 10000, combatLevel: 1,
    attackSpeed: 20, attackStyle: 'crush',
    stats: { attack: 1, strength: 50, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0, strengthBonus: 0,
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    drops: [],
    ...overrides,
  }
}

function strongDefenceMonster(overrides: any = {}) {
  return weakDefenceMonster({
    stats: { attack: 1, strength: 50, defence: 99, magic: 1, ranged: 1 },
    defenceBonus: { stab: 3000, slash: 3000, crush: 3000, magic: 3000, ranged: 3000 },
    ...overrides,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Dravok (Dharok) set — bonus damage scaling with missing HP', () => {
  it('deals more damage at half HP than at full HP, same roll otherwise', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const equipment = {
      weapon: { itemId: 'dravok_s_greataxe' }, head: { itemId: 'dravok_s_helm' },
      body: { itemId: 'dravok_s_platebody' }, legs: { itemId: 'dravok_s_platelegs' },
    }
    const monster = weakDefenceMonster()
    const fullHpState = createCombatState(monster, 'melee', 'accurate')
    const fullHpOut = processCombatTick(fullHpState, { ...strongPlayer, currentHP: 99 }, equipment, itemsData)
    const fullHpHit = fullHpOut.events.find((e: any) => e.type === 'playerHit')

    const halfHpState = createCombatState(weakDefenceMonster(), 'melee', 'accurate')
    const halfHpOut = processCombatTick(halfHpState, { ...strongPlayer, currentHP: 49 }, equipment, itemsData)
    const halfHpHit = halfHpOut.events.find((e: any) => e.type === 'playerHit')

    expect(fullHpHit.damage).toBeGreaterThan(0)
    expect(halfHpHit.damage).toBeGreaterThan(fullHpHit.damage)
  })
})

describe('Gorath (Guthan) set — 25% chance to heal for damage dealt', () => {
  const equipment = {
    weapon: { itemId: 'gorath_s_warspear' }, head: { itemId: 'gorath_s_helm' },
    body: { itemId: 'gorath_s_platebody' }, legs: { itemId: 'gorath_s_chainskirt' },
  }

  it('emits a guthanHeal event when the proc rolls under 25%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const state = createCombatState(weakDefenceMonster(), 'melee', 'accurate')
    const out = processCombatTick(state, strongPlayer, equipment, itemsData)
    expect(out.events.some((e: any) => e.type === 'guthanHeal')).toBe(true)
  })

  it('does not heal when the proc rolls over 25%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const state = createCombatState(weakDefenceMonster(), 'melee', 'accurate')
    const out = processCombatTick(state, strongPlayer, equipment, itemsData)
    expect(out.events.some((e: any) => e.type === 'guthanHeal')).toBe(false)
  })
})

describe('Torvek (Torag) set — 25% chance to stun the target on a melee hit', () => {
  const fullEquipment = {
    weapon: { itemId: 'torvek_s_hammers' }, head: { itemId: 'torvek_s_helm' },
    body: { itemId: 'torvek_s_platebody' }, legs: { itemId: 'torvek_s_platelegs' },
  }
  const noSetEquipment = { weapon: { itemId: 'plain_dagger' } }

  it('adds 5 extra ticks to the monster attack timer on proc', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const withSet = processCombatTick(createCombatState(weakDefenceMonster(), 'melee', 'accurate'), strongPlayer, fullEquipment, itemsData)
    const withoutSet = processCombatTick(createCombatState(weakDefenceMonster(), 'melee', 'accurate'), strongPlayer, noSetEquipment, itemsData)
    expect(withSet.combatState.monsterAttackTimer).toBe(withoutSet.combatState.monsterAttackTimer + 5)
  })

  it('does not stun when the proc rolls over 25%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const withSet = processCombatTick(createCombatState(weakDefenceMonster(), 'melee', 'accurate'), strongPlayer, fullEquipment, itemsData)
    const withoutSet = processCombatTick(createCombatState(weakDefenceMonster(), 'melee', 'accurate'), strongPlayer, noSetEquipment, itemsData)
    expect(withSet.combatState.monsterAttackTimer).toBe(withoutSet.combatState.monsterAttackTimer)
  })
})

describe('Verin (Verac) set — 25% chance to ignore target defence entirely', () => {
  const fullEquipment = {
    weapon: { itemId: 'verin_s_flail' }, head: { itemId: 'verin_s_helm' },
    body: { itemId: 'verin_s_brassard' }, legs: { itemId: 'verin_s_plateskirt' },
  }
  const noSetEquipment = { weapon: { itemId: 'plain_dagger' } }

  it('guarantees a hit against defence that would otherwise almost always miss', () => {
    // Natural accuracy here is ~2.4% (see hitChance math), so a 0.1 roll misses
    // without the set but is forced to a guaranteed hit once Verac's proc fires.
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const monster = strongDefenceMonster()
    const withSet = processCombatTick(createCombatState(monster, 'melee', 'accurate'), strongPlayer, fullEquipment, itemsData)
    const withoutSet = processCombatTick(createCombatState(strongDefenceMonster(), 'melee', 'accurate'), strongPlayer, noSetEquipment, itemsData)

    const withSetHit = withSet.events.find((e: any) => e.type === 'playerHit')
    const withoutSetHit = withoutSet.events.find((e: any) => e.type === 'playerHit')

    expect(withSetHit.damage).toBeGreaterThan(0)
    expect(withoutSetHit.damage).toBe(0)
  })
})

describe('Kaelor (Karil) set — 25% chance to fire an extra shot', () => {
  const fullEquipment = {
    weapon: { itemId: 'kaelor_s_crossbow' }, head: { itemId: 'kaelor_s_coif' },
    body: { itemId: 'kaelor_s_leathertop' }, legs: { itemId: 'kaelor_s_leatherskirt' },
  }
  const noSetEquipment = { weapon: { itemId: 'plain_shortbow' } }

  it('deals double damage when the proc rolls under 25%, vs. an identical non-set bow', () => {
    // Same fixed roll drives both the base hit and (with the set) the extra
    // shot, so the only source of difference is whether Karil's set procs.
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const withSet = processCombatTick(createCombatState(weakDefenceMonster(), 'ranged', 'accurate'), strongPlayer, fullEquipment, itemsData)
    const withoutSet = processCombatTick(createCombatState(weakDefenceMonster(), 'ranged', 'accurate'), strongPlayer, noSetEquipment, itemsData)

    const withSetHit = withSet.events.find((e: any) => e.type === 'playerHit')
    const withoutSetHit = withoutSet.events.find((e: any) => e.type === 'playerHit')

    expect(withoutSetHit.damage).toBeGreaterThan(0)
    expect(withSetHit.damage).toBe(withoutSetHit.damage * 2)
  })

  it('deals normal damage when the proc rolls over 25%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const withSet = processCombatTick(createCombatState(weakDefenceMonster(), 'ranged', 'accurate'), strongPlayer, fullEquipment, itemsData)
    const withoutSet = processCombatTick(createCombatState(weakDefenceMonster(), 'ranged', 'accurate'), strongPlayer, noSetEquipment, itemsData)

    const withSetHit = withSet.events.find((e: any) => e.type === 'playerHit')
    const withoutSetHit = withoutSet.events.find((e: any) => e.type === 'playerHit')

    expect(withSetHit.damage).toBe(withoutSetHit.damage)
  })
})

describe('Morvyn (Ahrim) set — 25% chance to drain target Strength on a magic hit', () => {
  const fullEquipment = {
    weapon: { itemId: 'morvyn_s_staff' }, head: { itemId: 'morvyn_s_hood' },
    body: { itemId: 'morvyn_s_robetop' }, legs: { itemId: 'morvyn_s_robeskirt' },
  }
  const spell = { name: 'Test Bolt', baseDamage: 40, baseXP: 5, runeReq: null }

  it('lowers the target Strength stat by 5 when the proc rolls under 25%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const monster = weakDefenceMonster()
    const state = createCombatState(monster, 'magic', 'accurate', spell)
    const out = processCombatTick(state, strongPlayer, fullEquipment, itemsData, {}, [])
    expect(out.combatState.monster.stats.strength).toBe(45)
    // Original template object must be untouched (no cross-fight leakage).
    expect(monster.stats.strength).toBe(50)
  })

  it('does not drain Strength when the proc rolls over 25%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const state = createCombatState(weakDefenceMonster(), 'magic', 'accurate', spell)
    const out = processCombatTick(state, strongPlayer, fullEquipment, itemsData, {}, [])
    expect(out.combatState.monster.stats.strength).toBe(50)
  })
})
