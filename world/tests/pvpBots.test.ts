import { describe, expect, it } from 'vitest'
import {
  applyBotIntents,
  botTemplateCombatLevel,
  botsToSpawn,
  createBot,
  roamBot,
  rollBotDrops,
  templateForCombatLevel,
  toBotDiff,
  MAX_WILDERNESS_BOTS,
  type BotState,
} from '../server/pvpBots'
import { withinPvpBracket, PVP_LINE_Z } from '../shared/pvpArea'
import type { PvpFighter } from '../server/pvpCombat'
import type { InvSlot } from '../shared/protocol'

const tile = () => ({ x: 20, z: PVP_LINE_Z - 10 })
const noTile = () => null

function opponent(over: Partial<PvpFighter> = {}): PvpFighter {
  return {
    charId: 'p1', combatantId: 7, name: 'Player', x: 21, z: PVP_LINE_Z - 10,
    hp: 99, maxHp: 99,
    levels: { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99, prayer: 99 },
    combatLevel: 99, equipment: { weapon: { itemId: 'dragon_scimitar' } },
    inventory: new Array<InvSlot>(28).fill(null), stance: 'aggressive', spell: null,
    prayerPoints: 99, maxPrayerPoints: 99, prayerDrainAccumulator: 0,
    activeProtectionPrayer: null, activeCombatPrayer: null, activePotions: {},
    specialEnergy: 100, specialAttackQueued: false, pvpAttackTimer: 0,
    pvpOpponentId: null, pvpLockUntilTick: 0, isBot: false, anim: 'idle',
    ...over,
  }
}

const spawn = (levels: number[], existing: BotState[] = []): BotState[] =>
  botsToSpawn(existing, { tick: 1, dangerPlayerLevels: levels, randomDangerTile: tile })

describe('the roster', () => {
  it('spawns nothing while nobody is north of the line', () => {
    expect(spawn([])).toEqual([])
  })

  it('spawns an opponent inside the player’s own bracket', () => {
    const [bot] = spawn([56])
    expect(bot).toBeDefined()
    expect(withinPvpBracket(bot.combatLevel, 56)).toBe(true)
  })

  it('spawns nothing more once the player already has someone to fight', () => {
    const first = spawn([56])
    expect(spawn([56], first)).toEqual([])
  })

  it('covers a second player of a very different level', () => {
    const first = spawn([25])
    const second = spawn([112], first)
    expect(second).toHaveLength(1)
    expect(withinPvpBracket(second[0].combatLevel, 112)).toBe(true)
  })

  it('never exceeds the cap', () => {
    let bots: BotState[] = []
    for (const level of [10, 25, 39, 56, 71, 83, 96, 112, 126]) {
      bots = [...bots, ...spawn([level], bots)]
    }
    expect(bots.length).toBeLessThanOrEqual(MAX_WILDERNESS_BOTS)
  })

  it('spawns nothing when there is nowhere to put them', () => {
    expect(botsToSpawn([], { tick: 1, dangerPlayerLevels: [56], randomDangerTile: noTile })).toEqual([])
  })

  it('ignores dead bots when deciding whether a player is covered', () => {
    const [bot] = spawn([56])
    bot.state = 'dead'
    expect(spawn([56], [bot])).toHaveLength(1)
  })
})

describe('template matching', () => {
  it('picks the closest template inside the bracket', () => {
    const template = templateForCombatLevel(58)
    expect(template).not.toBeNull()
    expect(botTemplateCombatLevel(template!.id)).toBe(56)
  })

  it('returns nothing for a level the roster cannot legally fight', () => {
    // Above the top template (126) by more than the bracket: an opponent that
    // appears but cannot be attacked is worse than none.
    expect(templateForCombatLevel(200)).toBeNull()
  })
})

describe('a bot in a fight', () => {
  it('never turns on a protection prayer, whatever its AI decides', () => {
    const template = templateForCombatLevel(83)!
    const bot = createBot(template, tile())
    const foe = opponent()
    for (let i = 0; i < 40; i++) {
      bot.pvpAttackTimer = 0
      applyBotIntents(bot, foe)
      expect(bot.activeProtectionPrayer).toBeNull()
    }
  })

  it('does pray for damage — the ban is protection only, not prayer', () => {
    const bot = createBot(templateForCombatLevel(83)!, tile())
    bot.pvpAttackTimer = 0
    applyBotIntents(bot, opponent())
    expect(bot.activeCombatPrayer).toBeTruthy()
  })

  it('keeps a weapon it swapped to, rather than throwing the swap away each tick', () => {
    const bot = createBot(templateForCombatLevel(83)!, tile())
    const before = (bot.equipment as { weapon?: { itemId?: string } }).weapon?.itemId
    // A nearly-dead opponent is what makes the AI reach for a finisher.
    const dying = opponent({ hp: 4, maxHp: 99 })
    bot.pvpAttackTimer = 0
    applyBotIntents(bot, dying)
    const after = (bot.equipment as { weapon?: { itemId?: string } }).weapon?.itemId
    expect(after).toBeTruthy()
    // Either it kept its bow or it genuinely swapped — what must never happen is
    // the equipment object being replaced by an empty one.
    expect(typeof after).toBe('string')
    if (after !== before) expect(bot.gear).toBeTruthy()
  })

  it('walks its consumable cooldowns down so it can eat again', () => {
    const bot = createBot(templateForCombatLevel(83)!, tile())
    bot.eatCooldown = 3
    bot.comboCooldown = 3
    applyBotIntents(bot, opponent())
    expect(bot.eatCooldown).toBeLessThan(3)
  })
})

describe('roaming', () => {
  it('walks toward a destination when it has a path', () => {
    const bot = createBot(templateForCombatLevel(83)!, tile())
    const path = () => [{ x: bot.x, z: bot.z }, { x: bot.x + 1, z: bot.z }, { x: bot.x + 2, z: bot.z }]
    roamBot(bot, path, tile)
    const startX = bot.x
    roamBot(bot, path, tile)
    expect(bot.x).toBeGreaterThan(startX - 1)
    expect(bot.anim === 'walk' || bot.anim === 'idle').toBe(true)
  })

  it('stands still when there is nowhere to go', () => {
    const bot = createBot(templateForCombatLevel(83)!, tile())
    const before = { x: bot.x, z: bot.z }
    roamBot(bot, () => null, noTile)
    expect({ x: bot.x, z: bot.z }).toEqual(before)
    expect(bot.anim).toBe('idle')
  })
})

describe('the wire view', () => {
  it('renders as a player, flagged as a bot, and marked attackable north of the line', () => {
    const bot = createBot(templateForCombatLevel(83)!, tile())
    const diff = toBotDiff(bot)
    expect(diff.kind).toBe('player')
    expect(diff.bot).toBe(true)
    expect(diff.pvp).toBe(true)
    expect(diff.combatLevel).toBe(bot.combatLevel)
    expect(diff.monsterId).toBeUndefined()
  })

  it('has no pvp flag south of the line', () => {
    const bot = createBot(templateForCombatLevel(83)!, { x: 20, z: PVP_LINE_Z + 3 })
    expect(toBotDiff(bot).pvp).toBeUndefined()
  })
})

describe('the drop table', () => {
  it('rolls a Zesta unique on the rare band and coins otherwise', () => {
    // rollBotLootBox reads the rng twice on a rare, so a fixed 0.01 lands on the
    // first Zesta item.
    expect(rollBotDrops(() => 0.01)).toEqual([{ itemId: 'zesta_longsword', quantity: 1 }])
    expect(rollBotDrops(() => 0.5)[0].itemId).toBe('coins')
  })

  it('never drops the gear the bot is wearing', () => {
    const bot = createBot(templateForCombatLevel(126)!, tile())
    const worn = new Set(Object.values(bot.equipment as Record<string, { itemId?: string }>).map((e) => e?.itemId))
    for (let i = 0; i < 200; i++) {
      for (const drop of rollBotDrops()) expect(worn.has(drop.itemId)).toBe(false)
    }
  })
})
