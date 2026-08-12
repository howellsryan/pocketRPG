import { describe, it, expect, vi, afterEach } from 'vitest'
import monsters from '../src/data/monsters.json'
import items from '../src/data/items.json'
import skills from '../src/data/skills.json'
import collectionLog from '../src/data/collectionLog.json'
import dailyTasks from '../src/data/dailyTasks.json'
import worldActivities from '../src/data/worldActivities.json'
import prayersData from '../src/data/prayers.json'
import spellsData from '../src/data/spells.json'
import {
  COOP_BOSSES,
  addCoopMember,
  createCoopBossState,
  createCoopMember,
  processCoopTick,
  isRoomWideAttacker,
  advanceRoomWideAttackTimer,
  advanceAddAttackTimers,
} from '../src/engine/coopBossEngine.js'
import {
  getAddSpec,
  addDefinitionsFor,
  selectAddDefinition,
} from '../src/engine/bossAdds.js'
import { createCombatState, applySpecialAttack } from '../src/engine/combat.js'
import { checkBossRequirementsPure } from '../src/engine/combatRequirements.js'
import { SELF_HEALING_SPEC_TYPES } from '../src/engine/specialAttackEnergy.js'
import { PVP_SPECIAL_ATTACK_LABELS } from '../src/engine/pvpSpecialAttacks.js'
import { SLAYER_MASTERS, pickSlayerMonster } from '../src/engine/slayerMasters.js'
import { createPvpState, processPvpTick } from '../src/engine/pvpEngine.js'
import { monsterMechanics } from '../functions/_lib/mcp/reference.js'
import bespokeIcons from '../src/data/bespokeIcons.json'
import { MONSTER_ART } from '../src/utils/combatArt.js'
import { readFileSync } from 'node:fs'
import equipmentModels from '../src/data/equipmentModels.json'
import { worldLairZone } from '../src/engine/worldLairs.js'
import {
  monsterAttackClipName,
  selectMonsterAttackClip,
  MONSTER_CLIP_IDLE,
  MONSTER_CLIP_DEATH,
  MONSTER_CLIP_ATTACK,
  MONSTER_CLIP_ATTACK_RANGED,
} from '../src/engine/monsterClips.js'

const monstersData = monsters as Record<string, any>
const itemsData = items as Record<string, any>
const BOSS = 'zaryth_the_empty_lord'
const boss = monstersData[BOSS]

const ARMOUR = ['zaryth_helm', 'zaryth_platebody', 'zaryth_platelegs']
const UNIQUES = [...ARMOUR, 'zaryth_crossbow', 'zaryth_hilt', 'zaryth_vambraces']
const SENTINELS = ['zaryth_blade_sentinel', 'zaryth_bolt_sentinel', 'zaryth_rune_sentinel']
const OTHER_GODSWORDS = ['grondar_godsword', 'zephyra_godsword', 'lumira_godsword', 'krylth_godsword']

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Zaryth — monster data', () => {
  it('is the hardest boss in the game by combat level and hitpoints', () => {
    const others = Object.values(monstersData).filter((m: any) => m.boss && m.id !== BOSS)
    expect(boss.boss).toBe(true)
    expect(boss.combatLevel).toBeGreaterThan(Math.max(...others.map((m: any) => m.combatLevel || 0)))
    expect(boss.hitpoints).toBeGreaterThan(Math.max(...others.map((m: any) => m.hitpoints || 0)))
  })

  it('attacks every 6 ticks and rotates its style on every attack', () => {
    expect(boss.attackSpeed).toBe(6)
    expect(boss.multiForm).toBe(true)
    expect(boss.randomFormEveryAttack).toBe(true)
    expect(Object.keys(boss.forms).sort()).toEqual(['magic', 'melee', 'ranged'])
  })

  it('caps its damage per style: 60 ranged, 40 magic, 35 melee', () => {
    expect(boss.forms.ranged.maxHit).toBe(60)
    expect(boss.forms.magic.maxHit).toBe(40)
    expect(boss.forms.melee.maxHit).toBe(35)
    expect(boss.forms.ranged.attackStyle).toBe('ranged')
    expect(boss.forms.magic.attackStyle).toBe('magic')
    expect(['crush', 'stab', 'slash']).toContain(boss.forms.melee.attackStyle)
  })

  it('summons a minion matching the style it is currently using, each capped at 15', () => {
    expect(boss.spawnsAdd.monsterIdByStyle).toEqual({
      melee: 'zaryth_blade_sentinel',
      ranged: 'zaryth_bolt_sentinel',
      magic: 'zaryth_rune_sentinel',
    })
    for (const id of SENTINELS) {
      const add = monstersData[id]
      expect(add.isAdd, `${id} isAdd`).toBe(true)
      expect(add.summonedBy).toBe(BOSS)
      expect(add.maxHit).toBe(15)
      expect(add.drops).toEqual([])
    }
  })

  it('every drop resolves to a real item', () => {
    for (const drop of boss.drops) expect(itemsData[drop.itemId], `unknown ${drop.itemId}`).toBeDefined()
  })

  it('drops the vambraces at 1/128 and every other unique at 1/256', () => {
    const byId = Object.fromEntries(boss.drops.map((d: any) => [d.itemId, d]))
    expect(byId.zaryth_vambraces.chance).toBeCloseTo(1 / 128, 8)
    for (const id of ['zaryth_helm', 'zaryth_platebody', 'zaryth_platelegs', 'zaryth_crossbow', 'zaryth_hilt']) {
      expect(byId[id].chance, `${id} rate`).toBeCloseTo(1 / 256, 8)
    }
  })

  it('pays about 1m a kill from its non-unique drops alone', () => {
    let expected = 0
    for (const drop of boss.drops) {
      const item = itemsData[drop.itemId]
      if (item.isBossUnique) continue
      const qty = Array.isArray(drop.quantity) ? (drop.quantity[0] + drop.quantity[1]) / 2 : drop.quantity
      // Coins are worth their face value; every other item is priced by shopValue.
      const unit = drop.itemId === 'coins' ? 1 : (item.shopValue || 0)
      expected += qty * unit * drop.chance
    }
    expect(expected).toBeGreaterThan(900_000)
    expect(expected).toBeLessThan(1_100_000)
  })

  it('carries a master clue and the commons the brief called for', () => {
    const ids = new Set(boss.drops.map((d: any) => d.itemId))
    expect(ids.has('clue_scroll_master')).toBe(true)
    for (const id of ['blood_rune', 'manta_ray', 'super_restore', 'onyx_dragon_bolt_e', 'seraphic_arrow', 'snapdrake', 'runeforged_ore']) {
      expect(ids.has(id), `missing ${id}`).toBe(true)
    }
  })
})

describe('Zaryth — entry gate', () => {
  const ctx = (bossKillCounts: Record<string, number>) => ({
    slayerLevel: 99,
    completedQuests: new Set<string>(),
    bossKillCounts,
    questsData: [],
    monstersData,
  })

  it('is locked until all four god wars generals have been killed once', () => {
    const locked = checkBossRequirementsPure({ ...boss, id: BOSS }, ctx({ warlord_grondar: 1 }))
    expect(locked.locked).toBe(true)
    expect(locked.reason).toContain('Zaryth')
  })

  it('opens once every prerequisite kill is on record', () => {
    const counts = Object.fromEntries(Object.keys(boss.killCountRequirement).map((id) => [id, 1]))
    expect(checkBossRequirementsPure({ ...boss, id: BOSS }, ctx(counts)).locked).toBe(false)
  })

  it('names the prerequisite boss rather than its id', () => {
    const gate = checkBossRequirementsPure(
      { id: 'x', name: 'X', killCountRequirement: { warlord_grondar: 2 } },
      ctx({}),
    )
    expect(gate.reason).toBe('Defeat Warlord Grondar 2 times to challenge X')
  })

  it('leaves a boss with no kill-count requirement unlocked', () => {
    expect(checkBossRequirementsPure({ id: 'x', name: 'X' }, ctx({})).locked).toBe(false)
  })
})

describe('Zaryth — slayer assignment', () => {
  const zulKaar = () => SLAYER_MASTERS.find((m: any) => m.id === 'zul_kaar')!
  const poolIds = () => zulKaar().monsterPool.map((e: any) => (typeof e === 'string' ? e : e.id))
  // Every quest gate satisfied, so this isolates the kill-count gate.
  const allQuests = new Set<string>(
    Object.values(monstersData).map((m: any) => m.questRequirement).filter(Boolean))
  const gateCtx = (bossKillCounts: Record<string, number>) => ({
    slayerLevel: 99, completedQuests: allQuests, bossKillCounts, questsData: [], monstersData,
  })

  it('is in the boss-only slayer pool, alongside the bosses that gate nothing', () => {
    expect(poolIds()).toContain(BOSS)
    expect(poolIds()).toContain('corporeal_horror')
  })

  it('never hands out a task the combat gate would refuse outright, at any state of progress', () => {
    // Each stage of a player's boss progress, from nothing killed to everything.
    const gateBosses = Object.keys(monstersData[BOSS].killCountRequirement)
    const stages = gateBosses.map((_, i) =>
      Object.fromEntries(gateBosses.slice(0, i + 1).map(id => [id, 1])))
    stages.unshift({})

    for (const bossKillCounts of stages) {
      const history = new Map<string, string[]>()
      for (let i = 0; i < 200; i++) {
        const pick = pickSlayerMonster(zulKaar(), 99, { history, bossKillCounts, completedQuests: allQuests })!
        const monster = monstersData[pick.monsterId]
        if (!monster) continue
        const gate = checkBossRequirementsPure({ ...monster, id: pick.monsterId }, gateCtx(bossKillCounts))
        expect(gate.locked, `${pick.monsterId} assigned but locked: ${gate.reason}`).toBe(false)
      }
    }
  })
})

describe('style-matched boss adds', () => {
  it('reads a per-style spec into one definition per form', () => {
    const definitions = addDefinitionsFor(getAddSpec(boss), monstersData)!
    expect(Object.keys(definitions).sort()).toEqual(['magic', 'melee', 'ranged'])
    expect(definitions.ranged.id).toBe('zaryth_bolt_sentinel')
  })

  it('still collapses a single-monsterId spec to one default entry', () => {
    const definitions = addDefinitionsFor(getAddSpec(monstersData.corporeal_horror), monstersData)!
    expect(Object.keys(definitions)).toEqual(['default'])
    expect(selectAddDefinition(definitions, { currentForm: 'ranged' }).id).toBe('dread_core')
  })

  it('picks the add matching the form the boss is in', () => {
    const definitions = addDefinitionsFor(getAddSpec(boss), monstersData)!
    expect(selectAddDefinition(definitions, { currentForm: 'melee' }).id).toBe('zaryth_blade_sentinel')
    expect(selectAddDefinition(definitions, { currentForm: 'magic' }).id).toBe('zaryth_rune_sentinel')
  })

  it('falls back to a definition rather than spawning nothing for an unknown form', () => {
    const definitions = addDefinitionsFor(getAddSpec(boss), monstersData)!
    expect(selectAddDefinition(definitions, { currentForm: 'nonsense' })).toBeTruthy()
    expect(selectAddDefinition(null, { currentForm: 'melee' })).toBeNull()
  })

  it('seeds a fight with the add for the boss opening form', () => {
    const state = createCombatState(boss, 'melee', 'accurate', null, monstersData)
    expect(state.addDefinition.id).toBe('zaryth_bolt_sentinel')
    expect(state.addSpawnCountdown).toBeGreaterThan(0)
  })
})

describe('Zaryth gear', () => {
  it('makes the armour best in slot for melee accuracy, defence and damage', () => {
    for (const id of ARMOUR) {
      const piece = itemsData[id]
      const rivals = Object.values(itemsData).filter((i: any) => i.slot === piece.slot && i.id !== id)
      const best = (pick: (i: any) => number) => Math.max(...rivals.map((i: any) => pick(i) || 0))
      for (const style of ['stab', 'slash', 'crush']) {
        expect(piece.attackBonus[style], `${id} ${style} accuracy`).toBeGreaterThan(best((i) => i.attackBonus?.[style]))
        expect(piece.defenceBonus[style], `${id} ${style} defence`).toBeGreaterThan(best((i) => i.defenceBonus?.[style]))
      }
      expect(piece.otherBonus.meleeStrength, `${id} strength`).toBeGreaterThan(best((i) => i.otherBonus?.meleeStrength))
      expect(piece.otherBonus.meleeDamage, `${id} damage`).toBeGreaterThan(best((i) => i.otherBonus?.meleeDamage))
    }
  })

  it('makes the vambraces best in slot for ranged, which its drop rate promises', () => {
    // The commonest unique off the hardest boss in the game, and it used to be
    // strictly worse than a 5m pair of Gloves of Slaughter — 18 accuracy and 2
    // ranged strength against 20 and 10. A boss whose whole table is the reward
    // for four other bosses cannot hand out a downgrade as its likeliest prize.
    const gloves = itemsData.zaryth_vambraces
    const rivals = Object.values(itemsData).filter((i: any) => i.slot === 'gloves' && i.id !== gloves.id)
    const best = (pick: (i: any) => number) => Math.max(...rivals.map((i: any) => pick(i) || 0))
    expect(gloves.attackBonus.ranged, 'ranged accuracy').toBeGreaterThan(best((i) => i.attackBonus?.ranged))
    expect(gloves.otherBonus.rangedStrength, 'ranged strength').toBeGreaterThan(best((i) => i.otherBonus?.rangedStrength))
    // Specialist, not all-round: the melee/magic gloves keep their own slots.
    expect(gloves.attackBonus.magic, 'magic accuracy should be a penalty').toBeLessThan(0)
    expect(gloves.otherBonus.meleeStrength).toBe(0)
    // It is also the rarest thing the Vaults hands out, so the raid moves with it.
    expect(gloves.isBossUnique).toBe(true)
  })

  it('prices the armour at 1b a piece, the crossbow at 750m and the hilt at 500m', () => {
    for (const id of ARMOUR) expect(itemsData[id].shopValue).toBe(1_000_000_000)
    expect(itemsData.zaryth_crossbow.shopValue).toBe(750_000_000)
    expect(itemsData.zaryth_hilt.shopValue).toBe(500_000_000)
  })

  it('makes the crossbow the strongest in the game', () => {
    const crossbows = Object.values(itemsData).filter((i: any) => i.weaponClass === 'crossbow' && i.id !== 'zaryth_crossbow')
    const zaryth = itemsData.zaryth_crossbow
    expect(zaryth.attackBonus.ranged).toBeGreaterThan(Math.max(...crossbows.map((i: any) => i.attackBonus?.ranged || 0)))
    expect(zaryth.otherBonus.rangedStrength).toBeGreaterThan(Math.max(...crossbows.map((i: any) => i.otherBonus?.rangedStrength || 0)))
  })

  it('makes the godsword hit harder than the chaotic maul at the same speed', () => {
    const gs = itemsData.zaryth_godsword
    const maul = itemsData.chaotic_maul
    expect(gs.twoHanded).toBe(true)
    expect(gs.attackSpeed).toBeLessThanOrEqual(maul.attackSpeed)
    expect(gs.otherBonus.meleeStrength).toBeGreaterThan(maul.otherBonus.meleeStrength)
    expect(gs.attackBonus.slash).toBeGreaterThan(maul.attackBonus.crush)
  })

  it('prices the godsword at the hilt plus every other godsword, rounded up to the next million', () => {
    const parts = itemsData.zaryth_hilt.shopValue + OTHER_GODSWORDS.reduce((sum, id) => sum + itemsData[id].shopValue, 0)
    expect(itemsData.zaryth_godsword.shopValue).toBe(Math.ceil(parts / 1_000_000) * 1_000_000)
  })

  it('builds the godsword by consuming the hilt and all four other godswords', () => {
    const recipe = (skills as any).smithing.actions.find((r: any) => r.product === 'zaryth_godsword')
    expect(recipe, 'recipe missing').toBeDefined()
    expect(recipe.materials).toEqual({
      zaryth_hilt: 1,
      grondar_godsword: 1,
      zephyra_godsword: 1,
      lumira_godsword: 1,
      krylth_godsword: 1,
    })
  })

  it('marks every unique as a boss unique with a positive value', () => {
    for (const id of UNIQUES) {
      expect(itemsData[id].isBossUnique, `${id} isBossUnique`).toBe(true)
      expect(itemsData[id].shopValue).toBeGreaterThan(0)
    }
  })
})

describe('Zaryth special attacks', () => {
  const playerStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99 }
  const dummy = {
    id: 'dummy', name: 'Dummy', hitpoints: 100000, attackSpeed: 4, attackStyle: 'crush', maxHit: 1,
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0, strengthBonus: 0,
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    drops: [],
  }
  const fire = (equipment: Record<string, any>, roll: number) => {
    vi.spyOn(Math, 'random').mockReturnValue(roll)
    const state: any = createCombatState(dummy, 'ranged', 'accurate', null, {})
    const out = applySpecialAttack(state, playerStats, equipment, itemsData)
    return out.events.find((e: any) => e.type === 'specialHit')
  }

  it('never rolls a zero for the crossbow, even on the unluckiest roll', () => {
    const equipment = { weapon: { itemId: 'zaryth_crossbow' }, ammo: { itemId: 'dragon_bolt', quantity: 100 } }
    for (const roll of [0, 0.5, 0.999999]) {
      const ev = fire(equipment, roll)
      expect(ev.specType).toBe('empty_bolt')
      expect(ev.totalDamage, `roll ${roll}`).toBeGreaterThan(0)
    }
  })

  it('heals the godsword wielder for half the damage its cleave deals', () => {
    const ev = fire({ weapon: { itemId: 'zaryth_godsword' } }, 0)
    expect(ev.specType).toBe('empty_lord_cleave')
    expect(ev.healAmount).toBe(Math.floor(ev.totalDamage / 2))
  })

  it('registers the cleave as a self-healing special so the HP is actually restored', () => {
    expect(SELF_HEALING_SPEC_TYPES.has('empty_lord_cleave')).toBe(true)
  })

  it('matches the other life-stealing specials it shares its healing path with', () => {
    // The cleave heals through the same specialHit.healAmount field these do,
    // and the co-op room applies all of them from one branch — so a change to
    // that field's meaning has to break here, not silently in a group fight.
    const siphon = fire(
      { weapon: { itemId: 'venom_blowpipe' }, ammo: { itemId: 'dragon_arrow', quantity: 100 } },
      0,
    )
    expect(siphon.specType).toBe('toxic_siphon')
    expect(siphon.totalDamage).toBeGreaterThan(0)
    expect(siphon.healAmount).toBe(Math.floor(siphon.totalDamage / 2))
    expect(SELF_HEALING_SPEC_TYPES.has('toxic_siphon')).toBe(true)
  })

  it('costs 50 energy and is described to the player on both weapons', () => {
    for (const id of ['zaryth_crossbow', 'zaryth_godsword']) {
      expect(itemsData[id].specialAttack.energyCost).toBe(50)
      expect(itemsData[id].specialAttack.description.length).toBeGreaterThan(0)
    }
  })

  it('is usable in PvP as well as PvE', () => {
    expect(PVP_SPECIAL_ATTACK_LABELS.empty_bolt).toBeTruthy()
    expect(PVP_SPECIAL_ATTACK_LABELS.empty_lord_cleave).toBeTruthy()
  })
})

describe('Zaryth special attacks in PvP', () => {
  function combatant(characterId: number, weaponId: string, hp = 5_000_000) {
    return {
      characterId,
      hp, maxHP: 5_000_000, currentHP: hp,
      stats: { attack: 99, strength: 99, defence: 1, hitpoints: 99, ranged: 99, magic: 99, prayer: 99 },
      combatType: weaponId === 'zaryth_crossbow' ? 'ranged' : 'melee',
      stance: 'aggressive',
      equipment: {
        weapon: { itemId: weaponId },
        ...(weaponId === 'zaryth_crossbow' ? { ammo: { itemId: 'dragon_bolt', quantity: 5000 } } : {}),
      },
      inventory: Array(28).fill(null),
      attackTimer: 0, prayerPoints: 0, maxPrayerPoints: 99,
      specialAttackEnergy: 100,
    }
  }

  function fireSpec(weaponId: string, attackerHP = 5_000_000) {
    let state: any = createPvpState(combatant(1, weaponId, attackerHP) as any, combatant(2, 'zaryth_godsword') as any, 0)
    const out = processPvpTick(state, [{ characterId: 1, tick_number: 1, action: { type: 'queue_special' } }], itemsData, 600)
    return out
  }

  it('resolves the crossbow special as a landed hit rather than an unsupported type', () => {
    const out = fireSpec('zaryth_crossbow')
    expect(out.events.some((e: any) => e.type === 'spec_failed')).toBe(false)
    const attack = out.events.find((e: any) => e.type === 'attack' && e.specType === 'empty_bolt')
    expect(attack, 'no empty_bolt attack event').toBeDefined()
    expect(attack.damage).toBeGreaterThan(0)
  })

  it('heals the godsword wielder in PvP too', () => {
    const out = fireSpec('zaryth_godsword', 1000)
    expect(out.events.some((e: any) => e.type === 'spec_failed')).toBe(false)
    const attack = out.events.find((e: any) => e.type === 'attack' && e.specType === 'empty_lord_cleave')
    expect(attack, 'no cleave attack event').toBeDefined()
    const heal = attack.specialAttack.healAmount
    expect(heal).toBe(Math.floor(attack.damage / 2))
    // The defender swings back on the same tick, so the heal is read against
    // what actually came in rather than against the starting HP.
    const incoming = out.events
      .filter((e: any) => e.type === 'attack' && e.defenderCharacterId === 1)
      .reduce((sum: number, e: any) => sum + (e.damage || 0), 0)
    expect(out.stateNext.combatants['1'].hp).toBe(1000 + heal - incoming)
  })
})

describe('room-wide attacks in a co-op session', () => {
  const deps = { itemsData, monstersData, prayersData, spellsData }

  function savePayload(weaponId = 'krylth_spear') {
    return {
      stats: Object.fromEntries(
        ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer'].map((k) => [k, { xp: 13_034_431 }]),
      ),
      equipment: { weapon: { itemId: weaponId, quantity: 1 } },
      inventory: [null, null, null],
      settings: { combatStance: 'aggressive' },
    }
  }

  function joined(bossId: string, ids: number[], weaponId?: string) {
    let state = createCoopBossState(bossId, monstersData)!
    for (const id of ids) {
      state = addCoopMember(state, createCoopMember({
        characterId: id, username: `player${id}`, savePayload: savePayload(weaponId), itemsData,
      }))
    }
    return state
  }

  it('keeps a warstrike drain on the shared record, so the rotation cannot hand it back', () => {
    // Zaryth rotates every attack and each form authors its own defences, so
    // applyForm replaces the numbers a Grondar Godsword just ground off. Left
    // un-carried, a warstrike here was worth one swing.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(BOSS, [1], 'grondar_godsword')
    const queueSpecial = [{ tick_number: 1, characterId: 1, characterSeq: 0, action: { type: 'queue_special' } }]
    state = processCoopTick(state, queueSpecial, deps, Date.now()).stateNext

    const drain = state.boss.monster.defenceBonusDrain
    expect(drain, 'the drain never reached the room').toBeTruthy()
    expect(Math.min(...(Object.values(drain) as number[]))).toBeGreaterThan(0)

    let rotated = false
    for (let i = 0; i < 40 && !rotated; i++) {
      const out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
      rotated = out.events.some((e: any) => e.type === 'formChange')
    }
    expect(rotated, 'the boss never changed form').toBe(true)

    const form = (monstersData as any)[BOSS].forms[state.boss.monster.currentForm]
    for (const [style, authored] of Object.entries(form.defenceBonus) as [string, number][]) {
      expect(state.boss.monster.defenceBonus[style], style)
        .toBe(Math.max(-64, authored - state.boss.monster.defenceBonusDrain[style]))
    }
  })

  it('flags only bosses whose data asks for it', () => {
    expect(isRoomWideAttacker(boss)).toBe(true)
    expect(isRoomWideAttacker(monstersData.corporeal_horror)).toBe(false)
    expect(isRoomWideAttacker(null)).toBe(false)
  })

  it('swings on the room clock once every attackSpeed ticks, not once per member', () => {
    const record: any = { attackSpeed: 3 }
    expect([1, 2, 3, 4, 5, 6].map(() => advanceRoomWideAttackTimer(record)))
      .toEqual([false, false, true, false, false, true])
  })

  it('starts an attack clock that predates the mechanic at the boss speed, not mid-swing', () => {
    const record: any = { attackSpeed: 3 }
    expect(advanceRoomWideAttackTimer(record)).toBe(false)
    expect(record.attackTimer).toBe(2)
  })

  it('damages every living member on the tick it swings, not just the target', () => {
    // Every roll pinned low so each swing connects for its minimum.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(BOSS, [1, 2, 3])
    const startHP = Object.values(state.members).map((m: any) => m.hp)
    for (let i = 0; i < 6; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    const damaged = Object.values(state.members).filter((m: any, i) => m.hp < startHP[i])
    expect(damaged).toHaveLength(3)
  })

  it('leaves a normal boss hitting only the member it is facing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined('corporeal_horror', [1, 2, 3])
    const startHP = Object.fromEntries(Object.values(state.members).map((m: any) => [m.characterId, m.hp]))
    for (let i = 0; i < 8; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    const damaged = Object.values(state.members).filter((m: any) => m.hp < startHP[m.characterId])
    expect(damaged.length).toBeLessThanOrEqual(1)
  })

  it('runs each of its minions off the room clock, so one swing each is resolved per tick', () => {
    // Every minion keeps its own countdown, and they need not be in step: the
    // second here is summoned a tick after the first.
    const boss: any = { adds: [{ attackSpeed: 3 }, { attackSpeed: 3, attackTimer: 2 }] }
    const swings = [1, 2, 3, 4, 5, 6].map(() => advanceAddAttackTimers(boss))
    expect(swings.map((s) => s[0])).toEqual([false, false, true, false, false, true])
    expect(swings.map((s) => s[1])).toEqual([false, true, false, false, true, false])
  })

  it('never swings a minion the room does not have, and gives a fresh one a full wind-up', () => {
    expect(advanceAddAttackTimers({ adds: [] } as any)).toEqual([])
    expect(advanceAddAttackTimers({} as any)).toEqual([])
    // The clock rides the minion itself, so a replacement cannot inherit the
    // countdown of the one it replaced.
    const boss: any = { adds: [{ attackSpeed: 3 }] }
    advanceAddAttackTimers(boss)
    expect(boss.adds[0].attackTimer).toBe(2)
    boss.adds = [{ attackSpeed: 3 }]
    expect(advanceAddAttackTimers(boss)).toEqual([false])
    expect(boss.adds[0].attackTimer).toBe(2)
  })

  it('lands its minion on the whole room, one roll each and no more', () => {
    // Room-wide works by every member's session resolving the same swing and
    // each member taking their OWN roll — so a member must never lose more
    // than one minion hit in a tick, however many members are in the room.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(BOSS, [1, 2, 3])
    // A live minion, with the boss's own clock held off so every point of
    // damage below is the minion's.
    state.boss.adds = [{ ...monstersData.zaryth_bolt_sentinel, instanceId: 'a#0', currentHP: 150, attackTimer: 1 }]
    state.boss.attackTimer = 999
    const before = Object.fromEntries(Object.values(state.members).map((m: any) => [m.characterId, m.hp]))
    const out = processCoopTick(state, [], deps, Date.now())
    const maxHit = monstersData.zaryth_bolt_sentinel.maxHit
    for (const m of Object.values(out.stateNext.members) as any[]) {
      const taken = before[m.characterId] - m.hp
      expect(taken, `member ${m.characterId} took ${taken}, max is ${maxHit}`).toBeLessThanOrEqual(maxHit)
      // One event per member per swing — not one per member, per member.
      const mine = out.events.filter((e: any) => e.fromAdd && e.type === 'monsterHit' && e.characterId === m.characterId)
      expect(mine.length).toBeLessThanOrEqual(1)
    }
    // And it reached past the single member the boss happens to be facing.
    const struck = (Object.values(out.stateNext.members) as any[])
      .filter((m) => before[m.characterId] - m.hp > 0)
    expect(struck.length).toBeGreaterThan(1)
  })

  it('changes form ONCE a swing, not once per member', () => {
    // Every member's session used to run the rotation and write back over the
    // shared record, so one swing produced one form change per living member —
    // each member hit by a different form's max hit, each rolling against a
    // different form's defences, and the HUD showing whichever ticked last.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(BOSS, [1, 2, 3, 4])
    expect((monstersData as any)[BOSS].multiForm, 'this boss does not rotate').toBe(true)

    const changesPerTick: number[] = []
    const formsSeen: string[] = []
    for (let i = 0; i < 12; i++) {
      const out = processCoopTick(state, [], deps, Date.now())
      state = out.stateNext
      const changes = out.events.filter((e: any) => e.type === 'formChange')
      if (changes.length) {
        changesPerTick.push(changes.length)
        formsSeen.push(...changes.map((c: any) => c.currentForm))
      }
    }
    expect(changesPerTick.length, 'it never changed form at all').toBeGreaterThan(0)
    for (const n of changesPerTick) expect(n, 'one swing produced several form changes').toBe(1)
    // And what it changed to is what the room is now in — one boss, one form.
    expect(state.boss.monster.currentForm).toBe(formsSeen[formsSeen.length - 1])
  })

  it('hits every member with the SAME form on one swing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined(BOSS, [1, 2, 3, 4])
    state.boss.attackTimer = 1
    const out = processCoopTick(state, [], deps, Date.now())
    const hits = out.events.filter((e: any) => e.type === 'monsterHit' && !e.fromAdd)
    expect(hits.length, 'the room-wide swing did not reach everybody').toBeGreaterThan(1)
    // The engine names the attacker on every swing event; a room fighting one
    // boss can only ever see one name on a tick.
    expect(new Set(hits.map((h: any) => h.monsterName)).size).toBe(1)
  })

  it('leaves a normal boss\'s minion on its target alone', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let state = joined('corporeal_horror', [1, 2, 3])
    const before = Object.fromEntries(Object.values(state.members).map((m: any) => [m.characterId, m.hp]))
    for (let i = 0; i < 8; i++) state = processCoopTick(state, [], deps, Date.now()).stateNext
    const struck = (Object.values(state.members) as any[]).filter((m) => before[m.characterId] - m.hp > 0)
    expect(struck.length).toBeLessThanOrEqual(1)
  })

  it('is playable as a group', () => {
    expect(Object.prototype.hasOwnProperty.call(COOP_BOSSES, BOSS)).toBe(true)
  })

  it('actually swings its minions, tick after tick, while the room is alive', () => {
    // The room owns each minion's clock, but the target member's session write-
    // back used to copy its whole add list back — attackTimer included, and that
    // copy is PINNED to full on a tick the room is not swinging. The countdown
    // was overwritten with the pinned value every tick, so it oscillated between
    // full and full-minus-one and never reached zero: the sentinels stood there
    // for the entire fight and hit nobody. It only started ticking once the last
    // member died and no session was left to write back.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state: any = joined(BOSS, [1, 2])
    const sentinel = monstersData.zaryth_bolt_sentinel
    state.boss.adds = [{ ...sentinel, instanceId: 'sentinel#1', currentHP: 150, attackTimer: sentinel.attackSpeed }]
    state.boss.addSpawnCountdown = null
    state.boss.attackTimer = 9999   // the boss itself held off, so every hit below is the minion's

    let cur = state
    let minionHits = 0
    const timers: number[] = []
    for (let i = 0; i < 12; i++) {
      const out = processCoopTick(cur, [], deps, Date.now())
      cur = out.stateNext
      // The members must stay standing, or this stops measuring the live room.
      for (const m of Object.values(cur.members) as any[]) { m.hp = m.maxHP; m.status = 'alive' }
      cur.boss.adds[0].currentHP = 150
      timers.push(cur.boss.adds[0].attackTimer)
      minionHits += out.events.filter((e: any) => e.fromAdd && e.type === 'monsterHit').length
    }
    expect(minionHits, `the sentinel never swung — room clock read ${timers.join(' ')}`).toBeGreaterThan(0)
    // Over 12 ticks at speed 4 it owes the two members ~3 swings each, so this
    // also catches a clock that fires once and then re-sticks.
    expect(minionHits).toBeGreaterThanOrEqual(4)
  })

  it('lets a member the boss is not facing finish a minion off', () => {
    // The non-target merge matched the session's add list against the room's BY
    // POSITION, and the engine splices a killed add out of its own list — so on
    // exactly the tick that matters every add behind it shifted a slot. The kill
    // was invisible (the corpse is simply absent from the list), the survivors
    // were compared against the wrong add's health, and the wait never restarted
    // because it is parked at null while the field is at its cap. The room told
    // every client the sentinel had died and it went on swinging at full health.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state: any = joined(BOSS, [1, 2])
    const sentinel = (id: string, hp: number) => ({
      ...monstersData.zaryth_blade_sentinel, instanceId: id, currentHP: hp, attackTimer: 4,
    })
    // A full field, so the summon countdown is parked exactly as it is in play.
    state.boss.adds = [sentinel('a#1', 150), sentinel('a#2', 1), sentinel('a#3', 150), sentinel('a#4', 150)]
    state.boss.addsSpawned = 4
    state.boss.addSpawnCountdown = null
    state.boss.addsDefeated = 0

    // Member 2 is not the boss's target, and swings at the wounded sentinel.
    state.targetCharId = '1'
    state.members['2'].combat.addTargetIndex = 1
    state.members['2'].combat.playerAttackTimer = 0

    const out = processCoopTick(state, [], deps, Date.now())
    const after = out.stateNext.boss

    expect(after.adds.map((a: any) => a.instanceId), 'the sentinel it killed is still standing')
      .toEqual(['a#1', 'a#3', 'a#4'])
    expect(after.addsDefeated, 'the kill was not counted').toBe(1)
    expect(after.addSpawnCountdown, 'a full field never summons again after this')
      .toBeGreaterThan(0)
    // The survivors keep their own health — the shifted comparison used to write
    // one add's health onto another's.
    for (const add of after.adds) expect(add.currentHP).toBe(150)
    // And the room said so, once.
    expect(out.events.filter((e: any) => e.type === 'addDefeated')).toHaveLength(1)
  })

  it('leaves a minion nobody touched exactly where it was', () => {
    // The other side of the merge: a non-target member who kills nothing must
    // not remove, revive or reshuffle anything.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state: any = joined(BOSS, [1, 2])
    state.boss.adds = [
      { ...monstersData.zaryth_blade_sentinel, instanceId: 'a#1', currentHP: 150, attackTimer: 4 },
      { ...monstersData.zaryth_rune_sentinel, instanceId: 'a#2', currentHP: 150, attackTimer: 4 },
    ]
    state.boss.addsSpawned = 2
    state.boss.addSpawnCountdown = 5
    state.targetCharId = '1'

    const out = processCoopTick(state, [], deps, Date.now())
    expect(out.stateNext.boss.adds.map((a: any) => a.instanceId)).toEqual(['a#1', 'a#2'])
    expect(out.stateNext.boss.addsDefeated).toBeFalsy()
  })

  it('restores HP to the member whose life-stealing special landed', () => {
    // A high roll that still connects: the boss's defences are stripped on the
    // shared record so the accuracy check passes, leaving the damage roll high
    // enough that half of it is a heal worth asserting on.
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    let state = joined(BOSS, [1])
    const member: any = Object.values(state.members)[0]
    member.equipment.weapon = { itemId: 'zaryth_godsword', quantity: 1 }
    member.hp = 10
    member.combat.playerAttackTimer = 0
    state.boss.monster.defenceBonus = { stab: -1000, slash: -1000, crush: -1000, magic: -1000, ranged: -1000 }
    // Room-wide swings would confound the reading, so the boss's clock is held
    // off while the special resolves.
    state.boss.attackTimer = 99
    const out = processCoopTick(state, [
      { characterId: 1, tick_number: 1, action: { type: 'queue_special' } },
    ], deps, Date.now())
    const healed = out.events.find((e: any) => e.type === 'specialHit')
    expect(healed, 'no special resolved').toBeDefined()
    expect(healed.healAmount).toBeGreaterThan(0)
    const after: any = Object.values(out.stateNext.members)[0]
    expect(after.hp).toBe(Math.min(after.maxHP, 10 + healed.healAmount))
  })
})

describe('Zaryth — 3D rig', () => {
  const arena = (equipmentModels as any).monsters[BOSS]

  /** Clip names straight out of a GLB's JSON chunk — no three.js needed. */
  function clipNames(glbPath: string): string[] {
    const buf = readFileSync(glbPath)
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'))
    return (json.animations ?? []).map((a: { name: string }) => a.name)
  }

  it('is registered for the combat arena, which auto-enables it for this boss', () => {
    expect(arena, 'no equipmentModels.monsters entry').toBeDefined()
    expect(arena.model).toBe('monsters/zaryth_the_empty_lord.glb')
  })

  it('ships the shipped asset with every clip the arena looks up by name', () => {
    const names = clipNames(new URL('../public/3d-samples/' + arena.model, import.meta.url).pathname)
    expect(names).toEqual(expect.arrayContaining([
      MONSTER_CLIP_IDLE, MONSTER_CLIP_DEATH, MONSTER_CLIP_ATTACK, MONSTER_CLIP_ATTACK_RANGED,
    ]))
  })

  it('swings with the melee clip for every melee style, on a rig whose melee clip works', () => {
    for (const style of ['crush', 'stab', 'slash', null, undefined]) {
      expect(monsterAttackClipName(style as any, 'warlord_grondar')).toBe(MONSTER_CLIP_ATTACK)
    }
  })

  it('swings with the one ranged clip for both ranged and magic', () => {
    expect(monsterAttackClipName('ranged')).toBe(MONSTER_CLIP_ATTACK_RANGED)
    expect(monsterAttackClipName('magic')).toBe(MONSTER_CLIP_ATTACK_RANGED)
  })

  it('swings with that same ranged clip in MELEE form, because its own melee clip collapses', () => {
    // Zaryth's melee clip rears up, strikes, and then drops to the floor with no
    // recovery; trimmed at the follow-through it reads as a slow reach. It
    // rerolls its style every swing, so that was a third of everything the boss
    // ever did on screen. Both render paths read this one table.
    for (const style of ['crush', 'stab', 'slash']) {
      expect(monsterAttackClipName(style, BOSS)).toBe(MONSTER_CLIP_ATTACK_RANGED)
    }
  })

  it('covers all three of the boss forms with a clip the asset actually has', () => {
    const names = clipNames(new URL('../public/3d-samples/' + arena.model, import.meta.url).pathname)
    const clips = names.map((name) => ({ name }))
    for (const form of Object.values(boss.forms) as any[]) {
      const picked = selectMonsterAttackClip(clips, form.attackStyle, BOSS)
      expect(picked, `no clip for ${form.attackStyle}`).toBeTruthy()
      expect(names).toContain(picked!.name)
    }
    // Every form resolves to the one clip that reads as a strike from where it
    // stands — including melee, which is the whole point of the override.
    expect(selectMonsterAttackClip(clips, 'crush', BOSS)!.name)
      .toBe(selectMonsterAttackClip(clips, 'magic', BOSS)!.name)
  })

  it('keeps the two-clip split for a rig that is not on the override list', () => {
    const clips = [{ name: MONSTER_CLIP_ATTACK }, { name: MONSTER_CLIP_ATTACK_RANGED }]
    expect(selectMonsterAttackClip(clips, 'crush', 'warlord_grondar')!.name)
      .not.toBe(selectMonsterAttackClip(clips, 'magic', 'warlord_grondar')!.name)
  })

  it('falls back to the melee clip for a rig that only has one attack', () => {
    const oneClip = [{ name: MONSTER_CLIP_IDLE }, { name: MONSTER_CLIP_ATTACK }]
    expect(selectMonsterAttackClip(oneClip, 'magic')!.name).toBe(MONSTER_CLIP_ATTACK)
    expect(selectMonsterAttackClip([{ name: MONSTER_CLIP_IDLE }], 'crush')).toBeNull()
    expect(selectMonsterAttackClip(null as any, 'crush')).toBeNull()
  })

  it('has an instanced open-world lair of its own', () => {
    expect(worldLairZone(BOSS)).toBe('zaryth_throne')
  })
})

describe('Zaryth — naming, price and art', () => {
  it('is named just "Zaryth"', () => {
    expect(boss.name).toBe('Zaryth')
    // The id keys D1 kill counts, the collection log and live saves — renaming
    // the display name must never rename it.
    expect(BOSS).toBe('zaryth_the_empty_lord')
  })

  it('costs 20 credits to skip', () => {
    expect(boss.skipCost).toBe(20)
  })

  it('never drops the godsword — the hilt forges it', () => {
    const dropped = new Set(boss.drops.map((d: any) => d.itemId))
    expect(dropped.has('zaryth_hilt')).toBe(true)
    expect(dropped.has('zaryth_godsword')).toBe(false)
  })

  it('has bespoke art for the boss and every unique it drops', () => {
    // Falling through to a game-icons glyph is what the default looked like.
    expect(bespokeIcons[BOSS], 'boss emblem missing').toBeDefined()
    for (const id of UNIQUES.concat('zaryth_godsword')) {
      expect(bespokeIcons[id], `${id} has no bespoke icon`).toBeDefined()
      expect(bespokeIcons[id].body.length).toBeGreaterThan(200)
    }
  })

  it('points its combat emblem at that bespoke art', () => {
    expect(MONSTER_ART[BOSS].icon).toBe(BOSS)
    expect(bespokeIcons[MONSTER_ART[BOSS].icon]).toBeDefined()
  })
})

describe('Zaryth — content wiring', () => {
  it('has a collection log section covering every unique it can drop', () => {
    const section = (collectionLog as any).categories
      .flatMap((c: any) => c.sections)
      .find((s: any) => s.id === BOSS)
    expect(section, 'collection log section missing').toBeDefined()
    // The godsword is forged from the hilt, never dropped — the four other god
    // wars bosses log their hilt alone for the same reason.
    expect(section.items).not.toContain('zaryth_godsword')
    for (const id of UNIQUES) {
      expect(section.items, `${id} missing from collection log`).toContain(id)
    }
  })

  it('logs every unique the drop table can actually produce', () => {
    const section = (collectionLog as any).categories
      .flatMap((c: any) => c.sections)
      .find((s: any) => s.id === BOSS)
    for (const drop of boss.drops) {
      if (!itemsData[drop.itemId].isBossUnique) continue
      expect(section.items, `${drop.itemId} dropped but not logged`).toContain(drop.itemId)
    }
  })

  it('tells an assistant that the minion depends on the style the boss is in', () => {
    const mechanics = monsterMechanics({ ...boss, id: BOSS })!
    const text = mechanics.notes.join(' ')
    expect(text).toMatch(/depends on the style/)
    for (const id of SENTINELS) expect(text).toContain(monstersData[id].name)
  })

  it('leaves a single-add boss description unchanged', () => {
    const text = monsterMechanics(monstersData.corporeal_horror)!.notes.join(' ')
    expect(text).not.toMatch(/depends on the style/)
  })

  it('has a Grandmaster daily task', () => {
    const task = (dailyTasks as any[]).find((t) => t.id === 'slay_zaryth_the_empty_lord')
    expect(task).toBeDefined()
    expect(task.tier).toBe('Grandmaster')
    expect(task.trigger).toEqual({ type: 'boss_kill', monsterId: BOSS, target: 3 })
  })

  it('is startable at the world place its prerequisite generals are fought at', () => {
    const places = Object.entries(worldActivities as Record<string, any[]>)
      .filter(([, acts]) => acts.some((a) => a.kind === 'combat' && a.ref === BOSS))
      .map(([id]) => id)
    expect(places).toContain('faloden')
  })
})
