// The Wilderness's roaming bots — the answer to "there is nobody online".
//
// They are NOT npcs. An npc is a monster: it has a monsterId, a drop table the
// PvE engine rolls, and a model the client resolves from monsters.json. A
// Wilderness bot is a PLAYER as far as everything downstream is concerned — it
// wears real equipment, it is diffed as `kind: 'player'`, it is attacked through
// the same eligibility gate a real player is, and it fights back with
// src/engine/pvpBotAI.js, the same brain the duel system gave it.
//
// Three deliberate differences from a real player, all of them rules the
// product asked for:
//   * no protection prayers, ever (the AI is allowed to pray for damage; the
//     engine's own applyIntent refuses protection prayers, and nothing here
//     puts one on),
//   * a dedicated drop table (rollBotLootBox) rather than the gear it wears —
//     killing one is a loot roll, not a gear strip,
//   * they exist only while a real player is in the zone. The DO's tick loop
//     stops on an empty room, so a bot that outlived the last player would be
//     a room that never goes idle.
import botsData from '../../src/data/pvpBots.json'
import itemsData from '../../src/data/items.json'
import { combatLevelFromLevels } from '../../src/engine/combatLevel.js'
import { getMaxPrayerPoints } from '../../src/engine/prayerDrain.js'
import { computeBotIntents } from '../../src/engine/pvpBotAI.js'
import { applyIntent } from '../../src/engine/pvpEngine.js'
import { rollBotLootBox } from '../../src/engine/pvpBotRewards.js'
import { gearFromEquipment } from '../shared/appearance'
import { isDangerTile, withinPvpBracket, PVP_LEVEL_BRACKET } from '../shared/pvpArea'
import { toCombatant, type PvpFighter } from './pvpCombat'
import type { EntityDiff, GearDescriptor, InvSlot } from '../shared/protocol'
import type { Tile } from './pathfind'

const items = itemsData as unknown as Record<string, Record<string, unknown> | undefined>

/** How many bots may roam at once. Enough that a player always has someone to
 * hunt without the zone reading as a bot farm. */
export const MAX_WILDERNESS_BOTS = 6
/** How many a single player is worth. One each was the whole roster a lone
 * player ever saw — the wastes read as empty between kills. Every extra one is
 * still inside that player's bracket, so it is someone they may actually
 * attack rather than scenery. */
export const BOTS_PER_PLAYER = 3
/** Ticks between a bot's death and a replacement walking in. */
export const BOT_RESPAWN_TICKS = 50
/** Ticks a roaming bot waits at its destination before picking a new one. */
const BOT_WANDER_PAUSE_TICKS = 8

type BotTemplate = {
  id: string
  username: string
  stats: Record<string, number>
  equipment: Record<string, { itemId: string; quantity?: number } | undefined>
  inventory: { itemId: string; quantity: number }[]
  /** Combat spell id, for a template whose staff is not a powered one. Without
   * it such a bot refuses every swing ("you need to select a spell") — the
   * powered staves are the only magic weapon that needs no spell. */
  spell?: string
}

const TEMPLATES: BotTemplate[] = (botsData as unknown as { bots: BotTemplate[] }).bots

/** Combat level per template, computed once — the roster is static. */
const TEMPLATE_LEVELS = new Map<string, number>(
  TEMPLATES.map((t) => [t.id, combatLevelFromLevels(t.stats)]),
)

export function botTemplateCombatLevel(templateId: string): number {
  return TEMPLATE_LEVELS.get(templateId) ?? 3
}

export type BotState = PvpFighter & {
  templateId: string
  /** Roaming path, walked one tile per tick. */
  path: Tile[]
  /** Ticks to idle before picking a new roam destination. */
  wanderPause: number
  gear: GearDescriptor
  /** Bots keep their own consumable clocks; a real player's live on the session
   * as absolute ticks, which a bot has no use for. */
  eatCooldown: number
  comboCooldown: number
  state: 'alive' | 'dead'
  /** Tick the corpse is removed from the wire (a beat after death, so the
   * client can play the fall). */
  removeAtTick: number
}

let botSeq = 0

function inventoryFrom(template: BotTemplate): InvSlot[] {
  const out: InvSlot[] = new Array<InvSlot>(28).fill(null)
  template.inventory.slice(0, 28).forEach((slot, i) => {
    if (slot?.itemId && slot.quantity >= 1) out[i] = { itemId: slot.itemId, quantity: slot.quantity }
  })
  return out
}

/** Deep-copies the template's equipment so a bot re-arming mid-fight can never
 * write through to the shared JSON every future bot is built from. */
function equipmentFrom(template: BotTemplate): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [slot, entry] of Object.entries(template.equipment ?? {})) {
    if (entry?.itemId) out[slot] = { ...entry }
  }
  return out
}

export function createBot(template: BotTemplate, tile: Tile): BotState {
  botSeq += 1
  const levels = { ...template.stats }
  const maxHp = Math.max(1, Math.floor(levels.hitpoints ?? 10))
  const maxPrayer = getMaxPrayerPoints(levels.prayer ?? 1)
  const equipment = equipmentFrom(template)
  return {
    charId: `wbot_${botSeq}`,
    // Negative so it can never collide with a real character id, and a NUMBER
    // so pvpBotAI's `Number(id) !== Number(botId)` opponent lookup works.
    combatantId: -botSeq,
    templateId: template.id,
    name: template.username,
    x: tile.x,
    z: tile.z,
    hp: maxHp,
    maxHp,
    levels,
    baseLevels: { ...template.stats },
    combatLevel: botTemplateCombatLevel(template.id),
    equipment,
    inventory: inventoryFrom(template),
    gear: gearFromEquipment(equipment),
    stance: 'aggressive',
    spell: template.spell ?? null,
    prayerPoints: maxPrayer,
    maxPrayerPoints: maxPrayer,
    prayerDrainAccumulator: 0,
    // Never set. A bot that prayed against your style would make the one
    // opponent available offline the hardest fight in the game.
    activeProtectionPrayer: null,
    activeCombatPrayer: null,
    activePotions: {},
    specialEnergy: 100,
    specialAttackQueued: false,
    pvpAttackTimer: 0,
    pvpOpponentId: null,
    pvpLockUntilTick: 0,
    isBot: true,
    anim: 'idle',
    path: [],
    wanderPause: 0,
    eatCooldown: 0,
    comboCooldown: 0,
    state: 'alive',
    removeAtTick: 0,
  }
}

/**
 * The template to spawn for a player of this combat level: the closest one
 * INSIDE the ±10 bracket, so a bot that appears is always one they may
 * actually attack. Null when no template fits — a level the roster does not
 * cover simply gets no bot rather than one they can only stare at.
 */
export function templateForCombatLevel(combatLevel: number, exclude: Set<string> = new Set()): BotTemplate | null {
  let best: BotTemplate | null = null
  let bestGap = Infinity
  for (const template of TEMPLATES) {
    if (exclude.has(template.id)) continue
    const level = botTemplateCombatLevel(template.id)
    if (!withinPvpBracket(level, combatLevel)) continue
    const gap = Math.abs(level - combatLevel)
    if (gap < bestGap) { best = template; bestGap = gap }
  }
  return best
}

export type BotRosterInput = {
  tick: number
  /** Combat levels of every real player currently north of the line. */
  dangerPlayerLevels: number[]
  /** A random walkable tile in the danger half, for a spawn or a roam target. */
  randomDangerTile: () => Tile | null
}

/**
 * Decides which bots should exist right now.
 *
 * Two passes. The first is the floor — "every player in the danger half can
 * find something to fight": for each such player with no live bot inside their
 * bracket, spawn the closest-matching template. The second populates the wastes
 * up to `BOTS_PER_PLAYER` each, capped at MAX_WILDERNESS_BOTS, taking a
 * different template every time so the zone reads as several people out there
 * rather than one opponent and a lot of dirt. With nobody north of the line no
 * bot is spawned at all.
 *
 * Returns the bots to ADD; the caller owns the map.
 */
export function botsToSpawn(bots: Iterable<BotState>, input: BotRosterInput): BotState[] {
  const live = [...bots].filter((b) => b.state === 'alive')
  const spawned: BotState[] = []
  const used = new Set(live.map((b) => b.templateId))
  const ceiling = Math.min(MAX_WILDERNESS_BOTS, input.dangerPlayerLevels.length * BOTS_PER_PLAYER)

  const spawnFor = (template: BotTemplate | null): boolean => {
    if (!template) return false
    const tile = input.randomDangerTile()
    if (!tile) return false
    used.add(template.id)
    spawned.push(createBot(template, tile))
    return true
  }

  // The coverage pass answers to the hard cap only, never to the per-player
  // ceiling: bots outlive the player they were spawned for, so a zone holding
  // three bots in a departed player's bracket would otherwise leave whoever is
  // still out there with nothing they may legally attack.
  for (const level of input.dangerPlayerLevels) {
    if (live.length + spawned.length >= MAX_WILDERNESS_BOTS) break
    const covered = [...live, ...spawned].some((b) => withinPvpBracket(b.combatLevel, level))
    if (covered) continue
    spawnFor(templateForCombatLevel(level, used)
      // Every template already spawned is still better than nothing when a
      // second player of a similar level turns up.
      ?? templateForCombatLevel(level))
  }

  // Top up, one per player per round, so two players in the zone get company
  // in both their brackets rather than three bots in the first one's.
  for (let round = 1; round < BOTS_PER_PLAYER; round += 1) {
    for (const level of input.dangerPlayerLevels) {
      if (live.length + spawned.length >= ceiling) return spawned
      // Unused templates only: a second bot wearing the first one's name and
      // kit is the thing that reads as a farm.
      spawnFor(templateForCombatLevel(level, used))
    }
  }
  return spawned
}

/**
 * One tick of a bot that is NOT fighting: amble toward a destination in the
 * wastes, pause, pick another. Deliberately a slow walk (one tile per tick, no
 * running) — a bot sprinting laps of the zone reads as a script, and the point
 * is that it looks like somebody out there doing the same thing you are.
 */
export function roamBot(bot: BotState, pathTo: (from: Tile, to: Tile) => Tile[] | null, randomDangerTile: () => Tile | null): void {
  if (bot.path.length > 0) {
    const step = bot.path.shift()!
    bot.x = step.x
    bot.z = step.z
    bot.anim = 'walk'
    return
  }
  bot.anim = 'idle'
  if (bot.wanderPause > 0) {
    bot.wanderPause -= 1
    return
  }
  const target = randomDangerTile()
  if (!target) return
  const path = pathTo({ x: bot.x, z: bot.z }, target)
  bot.path = path ? path.slice(1) : []
  bot.wanderPause = BOT_WANDER_PAUSE_TICKS
}

/**
 * Steps a fighting bot toward its opponent and runs its brain for this tick.
 *
 * Movement first: pvpBotAI has no concept of a tile, so closing the gap is this
 * module's job. It walks to its own weapon's reach, exactly as a player's
 * approach path does.
 */
export function driveBotCombat(
  bot: BotState,
  opponent: PvpFighter,
  reach: number,
  pathTo: (from: Tile, to: Tile) => Tile[] | null,
): void {
  const gap = Math.max(Math.abs(bot.x - opponent.x), Math.abs(bot.z - opponent.z))
  if (gap > reach) {
    if (bot.path.length === 0) {
      const path = pathTo({ x: bot.x, z: bot.z }, { x: opponent.x, z: opponent.z })
      bot.path = path ? path.slice(1) : []
    }
    const step = bot.path.shift()
    if (step) {
      bot.x = step.x
      bot.z = step.z
      bot.anim = 'walk'
    }
  } else {
    bot.path = []
  }
  applyBotIntents(bot, opponent)
}

/**
 * Runs pvpBotAI over a synthetic two-combatant state and applies whatever it
 * decided straight onto the bot.
 *
 * The state is rebuilt every tick rather than kept: it is a VIEW (toCombatant
 * shares the bot's own equipment and pack), so holding one would only be a
 * second copy of the truth waiting to go stale.
 */
export function applyBotIntents(bot: BotState, opponent: PvpFighter): void {
  bot.eatCooldown = Math.max(0, bot.eatCooldown - 1)
  bot.comboCooldown = Math.max(0, bot.comboCooldown - 1)

  const botView = toCombatant(bot) as Record<string, any>
  botView.eatCooldown = bot.eatCooldown
  botView.comboCooldown = bot.comboCooldown
  const opponentView = toCombatant(opponent) as Record<string, any>
  const state = {
    tick: 0,
    combatants: {
      [String(bot.combatantId)]: botView,
      [String(opponent.combatantId)]: opponentView,
    },
  }

  const events: unknown[] = []
  for (const intent of computeBotIntents(state, bot.combatantId, items)) {
    applyIntent(botView, intent, items, events)
  }

  // applyIntent REPLACES equipment/inventory on an equip (it builds new objects
  // rather than mutating), so both have to be read back or a weapon swap would
  // be thrown away every tick — which is precisely the bot's finisher plan.
  bot.equipment = botView.equipment as Record<string, unknown>
  bot.inventory = botView.inventory as InvSlot[]
  bot.gear = gearFromEquipment(bot.equipment)
  bot.activePotions = (botView.activePotions ?? {}) as Record<string, number>
  bot.stance = String(botView.stance ?? bot.stance)
  bot.specialAttackQueued = !!botView.specialAttackQueued
  bot.eatCooldown = Math.max(0, Number(botView.eatCooldown) || 0)
  bot.comboCooldown = Math.max(0, Number(botView.comboCooldown) || 0)
  bot.pvpAttackTimer = Math.max(bot.pvpAttackTimer, Math.max(0, Number(botView.attackTimer) || 0))
  bot.hp = Math.max(0, Math.min(bot.maxHp, Math.floor(Number(botView.hp) || bot.hp)))
  // The combat prayer the AI picked. A protection prayer can never arrive here:
  // pvpEngine's applyIntent refuses one outright, which is the single line that
  // enforces the "bots do not protect" rule for every future prayer too.
  bot.activeCombatPrayer = (botView.activeCombatPrayer as string | null) ?? null
  bot.activeProtectionPrayer = null
}

/** The wire view of a bot. `bot: true` exists so the client withholds Follow;
 * everything else is deliberately identical to a player's diff. */
export function toBotDiff(bot: BotState): EntityDiff {
  const diff: EntityDiff = {
    id: bot.charId,
    kind: 'player',
    x: bot.x,
    z: bot.z,
    anim: bot.anim as EntityDiff['anim'],
    name: bot.name,
    combatLevel: bot.combatLevel,
    gear: bot.gear,
    hp: bot.hp,
    maxHp: bot.maxHp,
    bot: true,
  }
  if (bot.pvpOpponentId) diff.targetId = bot.pvpOpponentId
  if (isDangerTile(bot)) diff.pvp = true
  return diff
}

/** The dedicated drop table. Rolled server-side (§14) — a bot's kill is the one
 * source of Zesta gear in the game. */
export function rollBotDrops(rng: () => number = Math.random): { itemId: string; quantity: number }[] {
  return rollBotLootBox(rng)
}

export { PVP_LEVEL_BRACKET }
