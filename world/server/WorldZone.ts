import { resourceNodeFor } from '../shared/resources'
import { Server, type Connection as PartyConnection } from 'partyserver'
import { verifyJWT } from '../../functions/_lib/jwt.js'
import { findPath, findPathAdjacent } from './pathfind'
import {
  combatStanceFromSave,
  emptyResult,
  respawnedRocks,
  sessionInventoryFromSave,
  sessionStatsFromSave,
  tickPlayer,
  toEntityDiff,
  type RockState,
  type StationState,
  type TickContext,
  type TickPlayer,
} from './tick'
import { STATIONS, recipeFor, stationTypeForVerb, isStationType } from '../shared/recipes'
import { hasMaterials, maxCraftable } from './crafting'
import { resolveCombatSetup, isSameFightTarget, playerAttackRange, emitPrayerIfChanged, emitSpecIfChanged, FULL_SPECIAL_ENERGY, NPC_REMOVE_AFTER_DEATH_TICKS } from './combat'
import { seedPrayer, resolvePrayerToggle } from '../shared/prayer'
import spellsJson from '../../src/data/spells.json'
import { countsAsEngaged, npcsFromZone, reselectAttacker, threatContributors, threatKey, tickNpc, toNpcDiff, type NpcState } from './npc'
import { stepMinions } from './minions'
import { lairEntryFailure } from './lairEntry'
import { collisionWithMonsters } from '../shared/monsterSize'
import { computeAoi, type AoiEntity } from './aoi'
import { KILL_DROP_OWNER_TICKS, PLAYER_DROP_OWNER_TICKS, isExpired, isVisibleTo, mayTake, ownLootOnlyMessage, spawnDrops, takeLoot, visibleLootFor, type LootEntity, type LootViewer } from './loot'
import { sanitizeChat } from '../shared/chat'
import { addToInventory, countItem, freeSlotCount, inventoryIsFull, isStackable, moveInventorySlot, removeItems, removeOneAt } from './mining'
import { getLevelFromXP } from '../../src/engine/experience.js'
import { flushGrants, isEmptyPayload, type GrantPayload } from './grants'
import { dropBroadcastsFrom, isBossMonster, recordBossKill, recordKillCounts } from './bossKills'
import { rollLootForCredited } from './killLoot'
import {
  creditWorldSlayerKill, drainSlayerCredit, killDailyEvents, restoreSlayerCredit, seedSlayerSession,
  slayerCreditNeedsFlush, xpDailyEvents,
  type DailyEvent, type SlayerTask,
} from './killProgress'
import { applyDailyTaskEvents as applyDailyTaskEventsJs } from '../../functions/_lib/game/dailyTaskProgress.js'

// The lib is plain JS shared with functions/**; its `identityId = null` default
// is all TS has to infer from, which types the field as null.
const applyDailyTaskEvents = applyDailyTaskEventsJs as (
  env: unknown,
  args: { characterId: number; identityId: string | null; events: DailyEvent[] },
) => Promise<unknown>
import { auditLog } from '../../functions/_lib/game/audit.js'
import monstersDataJson from '../../src/data/monsters.json'

type MonsterNames = Record<string, { name?: string } | undefined>
const monsterNames = monstersDataJson as MonsterNames
import { beginWorldSession, refreshWorldSession, endWorldSession, expireWorldSessionAfter } from '../../functions/_lib/game/worldSessions.js'
import { isCoopSessionLive } from '../../functions/_lib/game/coopBoss.js'
import { loadCharacterWithSave } from '../../functions/_lib/game/save.js'
import { zoneSpawnSummary, type ZoneDef, type ZoneExitDef } from '../shared/zone'
import { baseRoomZone, instanceDeathEjectTarget, isInstancedRoom, MAX_PLAYERS_PER_INSTANCE } from '../shared/instances'
import { ZONES } from './zones'
import { endOneLifeRun, flipOneLifeOff } from './oneLife'
import { isPvpZone, isDangerTile, pvpRefusalMessage, crossesIntoDanger, PVP_LINE_Z } from '../shared/pvpArea'
import {
  beginPvpFight, endPvpFight, pvpApproachPlan, pvpAttackAnim, pvpAttackRange, refuseAttack, stepPvpFight,
  type PvpFighter, type PvpTickOutput,
} from './pvpCombat'
import {
  botsToSpawn, driveBotCombat, roamBot, rollBotDrops, toBotDiff, BOT_RESPAWN_TICKS,
  type BotState,
} from './pvpBots'
import { collectDeathDrops, recordPvpBotKill, recordPvpKill } from './pvpDeath'
import { COMBAT_LINGER_MAX_TICKS, LOGOUT_BLOCKED_MESSAGE, isFighting, lingerExpired, logoutBlocked, nextCombatBlockUntil } from './combatLogout'
import { sessionCombatLevel } from './tick'
import { loadStoredZone } from './zoneStore'
import { gearFromEquipment } from '../shared/appearance'
import { BURY_XP, healAmount, primaryInvAction, resolveEatTiming, resolveDrink } from '../shared/itemActions'
import { checkEquipRequirements, equipItem, placeUnequippedItems, getAttackSpeed } from '../../src/engine/equipment.js'
import { setQuestGateBypass, resolveQuestGateBypass } from '../../src/engine/questGates.js'
import { applyEat, applyCombo } from '../../src/engine/combat.js'
import { isComboConsumable, boostedMagicLevel } from '../../src/engine/consumables.js'
import { hasMasterRejuvenation } from '../../src/engine/specialRegen.js'
import itemsData from '../../src/data/items.json'
import { commitFlush, consumeUnits, depositUnits, drainForFlush, emptyPools, mintUnits, restoreFlush, withdrawUnits, type ItemPools, type Tally } from './sessionItems'
import { grantSessionXp, cutPathToRange, withinRange, withinRangeAndSight } from './tick'
import type { BankSlot, ClientMessage, CombatStance, EntityDiff, LootItem, ServerMessage, StaticObject, ZoneEvent } from '../shared/protocol'
import { parseClientMessage } from '../shared/protocol'
import type { Env } from './env'

type ConnState = { charId: string | null }
type Connection = PartyConnection<ConnState>
import overworldZone from '../zones/overworld.json'

const TICK_MS = 600
const AUTH_TIMEOUT_MS = 5000
const CHECKPOINT_EVERY_TICKS = 100
const HP_REGEN_EVERY_TICKS = 100
// Rate limiting must NEVER kick a legitimate player — tap-to-move spam on a
// phone easily exceeds 10 msg/s, and closing the socket there caused constant
// visible reconnects. Above the soft limit messages are silently dropped (a
// dropped walk is harmless — the next tap replaces it); only a hard flood
// (buggy/abusive client) closes the connection. Pings bypass the limiter —
// they're the keepalive.
const RATE_LIMIT_WINDOW_MS = 1000
const RATE_LIMIT_SOFT_DROP = 15
const RATE_LIMIT_HARD_KICK = 40
// Every player's ent re-broadcasts on this cadence even when idle, so a client
// that missed a join edge (reconnect gap, suspended tab) self-heals within 30s.
const PRESENCE_KEYFRAME_TICKS = 50
// A dropped socket lingers this long before the player really leaves the zone —
// a grace period so a brief mobile socket drop doesn't make the player vanish
// for everyone. It is deliberately SHORT (17 ticks ≈ 10s) because a lingering
// player still holds this character's save lock, and the idle game cannot write
// a single cloud save until it lapses. Don't lengthen it: a reconnect past the
// grace period just re-enters at the checkpoint, whereas a longer grace period
// strands the player's save.
const LINGER_TICKS = 17
// Fallback expiry written to the world_sessions row on a socket close, so the
// save lock lapses on its own shortly after the linger even if this DO never
// runs the linger expiry (evicted/crashed). Sits just past the linger to leave
// the flush + release its D1 round-trips in the normal case.
const LINGER_LOCK_GRACE_MS = LINGER_TICKS * 600 + 5_000

type Player = TickPlayer & {
  conn: Connection
  lastMsgTimes: number[]
  identityId: string
  /** From characters.is_ironman / is_grindman, stamped at hello: both gate floor
   * loot to this player's own drops (see loot.ts). Narrowed to required over
   * TickPlayer's optional isGrindman, so a session can never be built without
   * the flag the rule is only as good as. Live on the session so a reconnect
   * keeps them without a second D1 read. */
  isIronman: boolean
  isGrindman: boolean
  /** From characters.is_one_life, stamped at hello. Dying in the world revokes
   * it exactly as dying in the idle game does; cleared once the D1 flip lands,
   * restored on failure so the next death retries. */
  isOneLife: boolean
  sessionId: string
  flushSeq: number
  /** Provenance pools for every unit in the pack (see sessionItems.ts).
   * pools.minted IS the TickPlayer.minted record — one object, two views. */
  pools: ItemPools
  /** Live session view of the save's bank (quantities only; charge-carrying
   * entries are excluded — the world can't preserve charges). */
  bankView: Tally
  completedQuests: Set<string>
  /** The player's slayer task, seeded from the save at hello and advanced by
   * world kills. `dirty` is what makes the flush write it: a session that never
   * killed anything on-task must not write its snapshot over a task the idle
   * game changed. Points/completions are DELTAS (see grants.ts). */
  slayer: {
    task: SlayerTask | null
    tasksCompleted: number
    doubleXp: boolean
    credit: { pointsEarned: number; tasksCompleted: number; masterCompletions: Record<string, number> }
    dirty: boolean
  }
  /** Kills since the last flush, per monster id — batched into kill_counts so a
   * grind is one upsert per monster rather than one per cow (bossKills.ts). */
  killTally: Record<string, number>
  /** Daily-task events since the last flush, replayed server-side against this
   * character's issued tasks (functions/_lib/game/dailyTaskProgress.js). */
  dailyEvents: DailyEvent[]
  /** The player re-geared in-world → next flush snapshots equipment to the save. */
  equipmentDirty: boolean
  /** The player changed combat stance in-world → next flush writes it back to
   * the save's settings.combatStance, so the main game picks up the change. */
  stanceDirty: boolean
  /** Debounced post-bank/equip flush tick, for durability. Null = none due. */
  flushAtTick: number | null
  /** Last HP value sent to this client ({e:'hp'} goes out only on change). */
  lastHpSent: number
  /** Absolute tick at/after which the next normal-food eat (resp. combo
   * consumable) is allowed. Enforces §4's separate eat/combo cooldowns so a
   * client can't spam-heal many times per tick and out-tank a boss. */
  eatReadyTick: number
  comboReadyTick: number
  /** Events queued outside the tick (bank ops, item actions) — drained into
   * the player's next diff. */
  pendingEvents: ZoneEvent[]
  /** Loot the player has walked over to pick up, resolved on arrival. */
  pendingLoot: { id: string; x: number; z: number } | null
  /** Loot ids this client currently sees — diffed each tick for add/remove. */
  lootView: Set<string>
  /** Entity ids this client currently sees, for AOI zones — diffed each tick
   * for enter/leave. Unused (stays whole-view) when the zone has no aoiRadius. */
  entView: Set<string>
  /** Set when the socket drops: the player lingers in-world (visible to others,
   * frozen) until this tick, then is really removed + flushed. Cleared on
   * reconnect. Null = connected. Backgrounding a tab must not kick you instantly. */
  lingerUntilTick: number | null

  // ── The Wilderness (world/shared/pvpArea.ts). Inert in every other zone. ──
  /** This character's id as a NUMBER, for the shared PvP engine's combatant
   * map — bots take negative ones so the two can never collide. */
  combatantId: number
  /** Skill LEVELS, mirrored from `stats` at hello. The duel reads levels only,
   * and a defence-draining special writes back HERE rather than into `stats`:
   * the drain is session-local and must never reach the save. */
  levels: Record<string, number>
  /** The undrained levels above, so a fight can put back what its specials
   * took. Nothing else restores them, and this session outlives every fight. */
  baseLevels: Record<string, number>
  /** No exit from the world until this tick — see server/combatLogout.ts.
   * Refreshed every tick the player is fighting, PvE or PvP. */
  combatBlockUntilTick: number
  /** Ceiling on a linger that only exists because the player left mid-fight;
   * 0 when this linger is the ordinary dropped-socket kind. */
  combatLingerDeadline: number
  combatLevel: number
  /** Answered YES at the line. `pvpCrossed` records that the consent was spent,
   * so walking back into the camp arms the prompt again for the next trip —
   * clearing consent on "is in the camp" alone would cancel it in the same tick
   * it was given, since YES is answered from the safe side of the gate. */
  pvpConsent: boolean
  pvpCrossed: boolean
  /** Single combat: who this player is locked with, and until when. */
  pvpOpponentId: string | null
  pvpLockUntilTick: number
  pvpAttackTimer: number
  specialAttackQueued: boolean
  /** An Attack click on a player, awaiting arrival — the PvP twin of
   * pendingInteract, which only ever carries npcs. */
  pvpPendingTargetId: string | null
  /** Target tile the chase path was last computed for, so a stationary target
   * costs no pathfind per tick (mirrors followTargetTile). */
  pvpChaseTile: { x: number; z: number } | null
  /** The player walked away from this fight. The lock survives — whoever is
   * chasing them keeps swinging and nobody else may jump in — but their OWN
   * swings stop until they click Attack again. The PvP twin of
   * CombatSession.passive. */
  pvpPassive: boolean
  /** Gates the {e:'pvpState'} echo. */
  lastPvpStateSent: string | null
  /** Always false for a real account; the field exists so a Player satisfies
   * PvpFighter alongside a bot. */
  isBot: boolean
}

function lootViewer(player: Player): LootViewer {
  return { charId: player.charId, isIronman: player.isIronman, isGrindman: player.isGrindman }
}

type Items = Record<string, { name?: string; slot?: string | null; type?: string } | undefined>
const items = itemsData as unknown as Items

function itemNameOf(itemId: string): string {
  return items[itemId]?.name ?? itemId
}

/** Ticks between a bank/equip mutation and its durability flush (debounced). */
const DIRTY_FLUSH_DELAY_TICKS = 5

/** Quantities-only session view of the save's bank. Charge-carrying entries
 * are excluded entirely — the world session can't preserve charges, so those
 * items must stay untouchable from the world's bank UI. */
function bankViewFromSave(save: Record<string, unknown>): Tally {
  const out: Tally = {}
  const bank = save.bank
  if (!bank || typeof bank !== 'object') return out
  for (const [key, val] of Object.entries(bank as Record<string, unknown>)) {
    const entry = val as { quantity?: number; charges?: number } | number
    const qty = typeof entry === 'number' ? Math.floor(entry) : Math.floor(Number(entry?.quantity) || 0)
    const charges = typeof entry === 'number' ? 0 : Math.floor(Number(entry?.charges) || 0)
    if (qty < 1 || charges > 0) continue
    out[key] = (out[key] ?? 0) + qty
  }
  return out
}

function send(conn: Connection, message: ServerMessage): void {
  try {
    conn.send(JSON.stringify(message))
  } catch {
    // A lingering (backgrounded) player's socket is closed — dropping the frame
    // is fine; they get a fresh welcome if/when they reconnect.
  }
}

type EquipmentEntry = { itemId?: unknown } | undefined
/** Worn equipment as slot → itemId, for the client's Equipment tab. */
function equipmentMap(equipment: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [slot, entry] of Object.entries(equipment)) {
    const itemId = (entry as EquipmentEntry)?.itemId
    if (typeof itemId === 'string' && itemId) out[slot] = itemId
  }
  return out
}

export class WorldZone extends Server<Env> {
  players = new Map<string, Player>()
  dirty = new Set<string>()
  tickCount = 0
  tickTimer: ReturnType<typeof setInterval> | null = null
  authTimers = new Map<string, ReturnType<typeof setTimeout>>()
  rocks: Map<string, RockState> | null = null
  npcs: Map<string, NpcState> | null = null
  stations: Map<string, StationState> | null = null
  loot = new Map<string, LootEntity>()
  /** Wilderness bots (server/pvpBots.ts). Empty in every other zone, and
   * emptied the moment the last player leaves this one — the tick loop stops on
   * an empty room, so a bot that outlived its audience would be a room that
   * never idles out. */
  bots = new Map<string, BotState>()
  /** Bots are held off until this tick after one dies, so a kill is not
   * instantly replaced by an identical opponent standing on the corpse. */
  botSpawnAfterTick = 0
  /** Presence edges + chat queued between ticks; drained by tick(). */
  pendingJoins = new Set<string>()
  pendingLeaves = new Set<string>()
  pendingChat: Extract<ZoneEvent, { e: 'chat' }>[] = []
  /** Players whose pack was reordered since the last tick — the next tick's
   * diff carries the authoritative {e:'inv'} echo (client swaps optimistically). */
  pendingInvEcho = new Set<string>()
  /** Resolved zone def for this DO's lifetime: a stored D1 def (world editor)
   * overriding the bundled one, else bundled. Populated once, before the first
   * connect completes, so the synchronous `zone` getter always has it. Edits to
   * an occupied zone take effect the next time the DO spins up empty. */
  loadedZone: ZoneDef | null = null
  private zoneLoadPromise: Promise<ZoneDef | null> | null = null

  get zone(): ZoneDef {
    return this.loadedZone ?? ZONES[baseRoomZone(this.name)] ?? (overworldZone as unknown as ZoneDef)
  }

  /** Live occupancy, for the instance assigner (server/instances.ts) and for
   * the idle game's "N in the Wilderness" readout (server/index.ts). Called as
   * a Durable Object RPC, so it must stay serializable and side-effect free.
   * Lingering players still hold their slot — they are in-world, just frozen. */
  playerCount(): number {
    return this.players.size
  }

  /** Is this room the Wilderness? The zone is deliberately not instanced (two
   * players who cannot find each other are not in a PvP zone), so the room name
   * is the authored zone id. */
  private get isPvp(): boolean {
    return isPvpZone(this.name)
  }

  /** Departs a character on behalf of the exit beacon (server/leave.ts), which
   * a closing tab fires because its `leave` frame may never flush. Called as a
   * Durable Object RPC. Treats a still-connected player and a lingering one the
   * same: both are flushed and the save lock released now, so closing the
   * browser costs nothing the Log out button wouldn't. False means the room has
   * already let them go — the socket close won the race, which is fine. */
  async departCharacter(charId: string): Promise<boolean> {
    const player = this.players.get(String(charId))
    if (!player) return false
    await this.depart(player, 'leave')
    return true
  }

  /** Resolves and caches this DO's zone def once: stored D1 def first, else the
   * bundled def, else null (unknown zone → connection rejected). Concurrent
   * connects share one in-flight load. */
  private async resolveZone(): Promise<ZoneDef | null> {
    if (this.loadedZone) return this.loadedZone
    if (!this.zoneLoadPromise) {
      this.zoneLoadPromise = (async () => {
        const base = baseRoomZone(this.name)
        const stored = await loadStoredZone(this.env.DB, base).catch(() => null)
        return stored ?? ZONES[base] ?? null
      })()
    }
    const zone = await this.zoneLoadPromise
    if (zone) this.loadedZone = zone
    return zone
  }

  /** All gather nodes — ore rocks and trees share one state machine. */
  private ensureRocks(): Map<string, RockState> {
    if (!this.rocks) {
      this.rocks = new Map(
        this.zone.objects
          .filter((o) => Boolean(resourceNodeFor(o)))
          .map((o) => [o.id, {
            id: o.id,
            ...resourceNodeFor(o)!,
            x: o.x,
            z: o.z,
            depletedUntilTick: 0,
          }])
      )
    }
    return this.rocks
  }

  private ensureNpcs(): Map<string, NpcState> {
    if (!this.npcs) this.npcs = npcsFromZone(this.zone.npcs)
    return this.npcs
  }

  /** Releases aggro on every npc chasing this charId. A pursuing npc's
   * `attackerId` can outlive `player.combat` (it's cleared the instant the
   * player isn't adjacent — see combat.ts), so this must scan all npcs rather
   * than just the one the player was last fighting. */
  private releaseAggro(charId: string): void {
    for (const npc of this.ensureNpcs().values()) {
      if (npc.attackerId === charId) npc.attackerId = null
    }
  }

  private ensureStations(): Map<string, StationState> {
    if (!this.stations) {
      this.stations = new Map(
        this.zone.objects
          .filter((o) => isStationType(o.type))
          .map((o) => [o.id, { id: o.id, type: o.type as StationState['type'], x: o.x, z: o.z }])
      )
    }
    return this.stations
  }

  async onConnect(connection: Connection, ctx: { request: Request }): Promise<void> {
    // This DO is its own isolate — the Worker's fetch handler installed the
    // preview quest-gate bypass over there, not here.
    setQuestGateBypass(resolveQuestGateBypass(this.env, ctx?.request?.url))
    const zone = await this.resolveZone()
    if (!zone) {
      connection.close(1008, 'unknown_zone')
      return
    }
    connection.setState({ charId: null })
    const timer = setTimeout(() => {
      if (!connection.state?.charId) connection.close(1008, 'auth_timeout')
    }, AUTH_TIMEOUT_MS)
    this.authTimers.set(connection.id, timer)
  }

  async onMessage(connection: Connection, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      connection.close(1008, 'invalid_json')
      return
    }
    const message = parseClientMessage(parsed)
    if (!message) {
      connection.close(1008, 'invalid_message')
      return
    }

    const charId = connection.state?.charId ?? null
    if (!charId) {
      if (message.t === 'hello') await this.handleHello(connection, message)
      else connection.close(1008, 'not_authed')
      return
    }

    const player = this.players.get(charId)
    if (!player) {
      connection.close(1008, 'unknown_player')
      return
    }
    if (message.t === 'ping') {
      send(player.conn, { t: 'pong', n: message.n })
      return
    }
    const verdict = this.rateLimitVerdict(player)
    if (verdict === 'kick') {
      connection.close(1008, 'rate_limited')
      return
    }
    if (verdict === 'drop') return
    this.handleAuthedMessage(player, message)
  }

  // Async so the runtime keeps the DO alive until the disconnect flush and
  // position checkpoint land — fire-and-forget writes here can be lost when
  // the last player leaves and the instance idles out.
  onClose(connection: Connection): void {
    this.clearAuthTimer(connection.id)
    const charId = connection.state?.charId ?? null
    if (!charId) return
    const player = this.players.get(charId)
    if (!player) return
    // A duplicate-connection kick closes the old socket after the charId has
    // been re-registered on a new one — that close must not tear down the
    // live player.
    if (player.conn !== connection) return
    // Linger instead of removing now: the player stays in-world (visible to
    // others, frozen and idle) for a grace period so a backgrounded tab or a
    // brief mobile socket drop doesn't kick them out for everyone. A reconnect
    // (handleHello carry-over) clears the linger; otherwise the tick loop
    // removes + flushes them once it expires. Combat/aggro is released now so
    // a frozen player can't hold a monster.
    //
    // Unless they were fighting: a dropped socket is the easiest combat log of
    // all (pull the plug), so that case keeps the fight and the aggro and runs
    // the same deferred exit a closing tab gets.
    if (logoutBlocked(player.combatBlockUntilTick, this.tickCount)) {
      this.beginCombatLinger(player)
      this.ensureTicking()
      return
    }
    this.releaseAggro(charId)
    player.path = []
    this.clearIntents(player)
    player.anim = 'idle'
    player.running = false
    player.lingerUntilTick = this.tickCount + LINGER_TICKS
    // Arm the save lock to lapse with the linger even if this instance never
    // gets to run the linger expiry below.
    void expireWorldSessionAfter(this.env, Number(charId), player.sessionId, LINGER_LOCK_GRACE_MS)
    // Keep ticking so the linger timer advances even if this was the last
    // connected player.
    this.ensureTicking()
  }

  /** Really removes a player from the zone: releases aggro, broadcasts the
   * leave, disconnect-flushes the pack/XP and checkpoints the position. Used by
   * linger expiry and explicit logout. */
  private async removeAndFlush(player: Player): Promise<void> {
    const charId = player.charId
    this.releaseAggro(charId)
    this.releasePvp(player)
    this.players.delete(charId)
    this.dirty.delete(charId)
    this.pendingLeaves.add(charId)
    await this.flush(player, 'disconnect')
    await this.checkpointPlayer(player)
    // Only once the writes are done: stopping the clock first left the last
    // player out of an empty zone with no socket and no timer holding this DO
    // open while its flush was still round-tripping to D1.
    this.maybeStopTicking()
    // Release the world-session lock so the idle game can save again — but only
    // if this exact session still holds it (a reconnect may have re-claimed it).
    await endWorldSession(this.env, Number(charId), player.sessionId)
  }

  private clearAuthTimer(connectionId: string): void {
    const timer = this.authTimers.get(connectionId)
    if (timer) {
      clearTimeout(timer)
      this.authTimers.delete(connectionId)
    }
  }

  private rateLimitVerdict(player: Player): 'ok' | 'drop' | 'kick' {
    const now = Date.now()
    player.lastMsgTimes = player.lastMsgTimes.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    player.lastMsgTimes.push(now)
    if (player.lastMsgTimes.length > RATE_LIMIT_HARD_KICK) return 'kick'
    if (player.lastMsgTimes.length > RATE_LIMIT_SOFT_DROP) return 'drop'
    return 'ok'
  }

  private async handleHello(connection: Connection, message: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    // Clear the auth timeout as soon as hello ARRIVES — the D1 reads below can
    // outlive the 5s timer on a cold start, which would kick a valid login
    // mid-handshake. Auth failures below still close the connection themselves.
    this.clearAuthTimer(connection.id)
    // Guarantees the zone def is resolved before sendWelcome/first tick, even if
    // a hello somehow raced ahead of onConnect's resolution.
    if (!(await this.resolveZone())) {
      connection.close(1008, 'unknown_zone')
      return
    }
    const payload = await verifyJWT(message.token, this.env.JWT_SECRET)
    if (!payload || payload.scope !== 'world' || !payload.sub || !payload.character_id) {
      connection.close(1008, 'invalid_token')
      return
    }

    const row = await this.env.DB.prepare(
      'SELECT id, username, is_ironman, is_one_life, is_grindman FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(payload.character_id, payload.sub).first<{ id: number; username: string; is_ironman: number | null; is_one_life: number | null; is_grindman: number | null }>()
    if (!row) {
      connection.close(1008, 'character_not_found')
      return
    }

    // Never enter the world during a live co-op boss fight: the room is the
    // authority on this character's pack and XP until they leave it.
    if (await isCoopSessionLive(this.env, row.id)) {
      connection.close(1008, 'in_coop_session')
      return
    }

    // Reconnect while the session is still live (mobile socket drop, second
    // tab): carry the in-memory session over to the new socket. Re-seeding
    // from D1 here would teleport the player to a checkpoint up to 60s stale
    // and silently drop unflushed minted items/XP — the live session is the
    // source of truth until it disconnect-flushes.
    const liveCharId = String(row.id)
    const existing = this.players.get(liveCharId)
    if (existing) {
      existing.conn.close(1008, 'duplicate_connection')
      this.releaseAggro(liveCharId)
      existing.path = []
      existing.pendingInteract = null
      existing.mining = null
      existing.crafting = null
      existing.combat = null
      existing.pendingLoot = null
      existing.pvpPendingTargetId = null
      // A reconnect is a FRESH page: it knows nothing about which side of the
      // Wilderness line it is on, and {e:'pvpState'} only fires on change. Left
      // stamped, the echo never came and the client offered no Attack rows
      // until the player happened to walk back across the line.
      existing.lastPvpStateSent = null
      existing.anim = 'idle'
      existing.conn = connection
      existing.lastMsgTimes = []
      existing.lingerUntilTick = null
      // Coming back cancels the deferred exit and un-freezes them: a combat
      // linger leaves the duel PASSIVE, and a player who reconnected into the
      // middle of one has to be able to swing back. (The PvE session is cleared
      // above, as it has been for every reconnect — but the Wilderness lock is
      // NOT, so a fight survives the loser reloading.) `combatBlockUntilTick` is
      // deliberately left alone: they are still in the fight, so the clock
      // governing their next logout attempt keeps running.
      existing.combatLingerDeadline = 0
      existing.pvpPassive = false
      connection.setState({ charId: liveCharId })
      void beginWorldSession(this.env, row.id, existing.sessionId)
      this.sendWelcome(existing)
      this.pendingJoins.add(liveCharId)
      this.ensureTicking()
      return
    }

    // Instance capacity. Checked only after the reconnect branch above, so a
    // player already holding a slot is never locked out of their own fight by
    // a dropped socket. The assigner (server/instances.ts) normally routes
    // around a full room; this is the race-proof backstop.
    if (isInstancedRoom(this.name) && this.players.size >= MAX_PLAYERS_PER_INSTANCE) {
      connection.close(1008, 'instance_full')
      return
    }

    let stats
    let seeded
    let equipment: Record<string, unknown> = {}
    let maxHp = 10
    let bankView: Tally = {}
    let completedQuests = new Set<string>()
    let slayer = seedSlayerSession({})
    let masterRejuvenation = false
    let stance: CombatStance = 'accurate'
    let saveForGate: unknown = null
    try {
      const { saveObject } = await loadCharacterWithSave(this.env, row.id, payload.sub)
      saveForGate = saveObject
      stats = sessionStatsFromSave(saveObject)
      seeded = sessionInventoryFromSave(saveObject)
      equipment = (saveObject.equipment ?? {}) as Record<string, unknown>
      const hpEntry = (saveObject.stats as Record<string, { xp?: number; level?: number }> | undefined)?.hitpoints
      maxHp = Number(hpEntry?.level) || getLevelFromXP(Number(hpEntry?.xp) || 0) || 10
      bankView = bankViewFromSave(saveObject)
      const questList = (saveObject.settings as { completedQuests?: unknown } | undefined)?.completedQuests
      completedQuests = new Set(Array.isArray(questList) ? questList.filter((q): q is string => typeof q === 'string') : [])
      slayer = seedSlayerSession(saveObject as Record<string, unknown>)
      masterRejuvenation = hasMasterRejuvenation((saveObject.settings as { unlockedFeatures?: unknown } | undefined)?.unlockedFeatures)
      stance = combatStanceFromSave(saveObject)
    } catch {
      connection.close(1008, 'character_not_found')
      return
    }

    // The lair's own entry requirements, at the door rather than only at the
    // endpoint that mints the handoff. A room name is a URL path segment and
    // the session token names no zone, so this socket is a door of its own —
    // and the world grants this boss's collection log and kill counts (§14).
    // After the reconnect branch above on purpose: a player already holding a
    // slot passed this on the way in, and re-judging it would drop them out of
    // a fight they are winning.
    const lairLock = await lairEntryFailure(this.env, this.name, saveForGate, row.id)
    if (lairLock) {
      connection.close(1008, 'boss_locked')
      return
    }

    const charId = String(row.id)

    const posRow = await this.env.DB.prepare(
      'SELECT x, z FROM world_positions WHERE character_id = ? AND zone_id = ?'
    ).bind(row.id, this.name).first<{ x: number; z: number }>()
    const spawn = this.zone.spawn
    const x = posRow?.x ?? spawn.x
    const z = posRow?.z ?? spawn.z

    connection.setState({ charId })
    const pools = emptyPools(seeded.saveBacked)
    const player: Player = {
      charId,
      name: row.username,
      x,
      z,
      path: [],
      anim: 'idle',
      stats,
      inventory: seeded.inventory,
      pendingXp: {},
      minted: pools.minted,
      mining: null,
      crafting: null,
      pendingInteract: null,
      hp: maxHp,
      maxHp,
      equipment,
      gear: gearFromEquipment(equipment),
      combat: null,
      conn: connection,
      lastMsgTimes: [],
      identityId: String(payload.sub),
      isIronman: !!row.is_ironman,
      isOneLife: !!row.is_one_life,
      isGrindman: !!row.is_grindman,
      sessionId: crypto.randomUUID(),
      flushSeq: 0,
      pools,
      bankView,
      completedQuests,
      slayer,
      killTally: {},
      dailyEvents: [],
      equipmentDirty: false,
      stanceDirty: false,
      flushAtTick: null,
      lastHpSent: maxHp,
      eatReadyTick: 0,
      comboReadyTick: 0,
      pendingEvents: [],
      pendingLoot: null,
      lootView: new Set(),
      entView: new Set(),
      running: false,
      runEnergy: 100,
      lastRunSent: 100,
      stance,
      spell: null,
      specialEnergy: FULL_SPECIAL_ENERGY,
      masterRejuvenation,
      lastSpecSent: FULL_SPECIAL_ENERGY,
      lastSpecQueuedSent: false,
      pendingSpecial: false,
      ...seedPrayer(stats.prayer?.level ?? getLevelFromXP(Number(stats.prayer?.xp) || 0) ?? 1),
      lastPrayerSent: null,
      activePotions: {},
      following: null,
      followTargetTile: null,
      lingerUntilTick: null,
      combatantId: row.id,
      levels: Object.fromEntries(Object.entries(stats).map(([skill, entry]) => [skill, entry.level])),
      baseLevels: Object.fromEntries(Object.entries(stats).map(([skill, entry]) => [skill, entry.level])),
      combatLevel: sessionCombatLevel(stats),
      pvpConsent: false,
      pvpCrossed: false,
      pvpOpponentId: null,
      pvpLockUntilTick: 0,
      pvpAttackTimer: 0,
      specialAttackQueued: false,
      pvpPendingTargetId: null,
      pvpChaseTile: null,
      pvpPassive: false,
      lastPvpStateSent: null,
      combatBlockUntilTick: 0,
      combatLingerDeadline: 0,
      isBot: false,
    }
    // One line per login so `wrangler tail` can answer "does the world think
    // this character is an Ironman or a Grindman?" without a D1 query — the
    // floor-loot rule is only as good as these flags.
    console.log('[World][hello]', { charId, zone: this.name, isIronman: player.isIronman, isGrindman: player.isGrindman })
    this.players.set(charId, player)
    void beginWorldSession(this.env, row.id, player.sessionId)
    this.sendWelcome(player)
    this.pendingJoins.add(charId)
    this.ensureTicking()
  }

  /** Welcome + intro snapshot (depleted rocks, npcs, other players, visible
   * loot) for the player's CURRENT connection, resetting their loot view.
   * Shared by fresh joins and live-session reconnects. */
  private sendWelcome(player: Player): void {
    const statics: StaticObject[] = this.zone.objects
    send(player.conn, {
      t: 'welcome',
      selfId: player.charId,
      tick: this.tickCount,
      zone: {
        // The ROOM name, not the authored zone id: the client stores this and
        // reconnects to it, and an instance must be re-entered by room or the
        // player rejoins a different copy of the lair.
        id: this.name,
        name: this.zone.name,
        w: this.zone.width,
        h: this.zone.height,
        collision: this.zone.collision,
        ...(this.zone.exits?.length ? { exits: this.zone.exits.map((e) => ({ id: e.id, x: e.x, z: e.z, label: e.label, ...(e.hideMarker ? { hideMarker: true } : {}) })) } : {}),
        ...(this.zone.landmarks?.length ? { landmarks: this.zone.landmarks } : {}),
        ...(this.zone.props?.length ? { props: this.zone.props } : {}),
        ...(this.zone.palette ? { palette: this.zone.palette } : {}),
        ...(this.zone.ambience ? { ambience: this.zone.ambience } : {}),
        ...(this.zone.ambient ? { ambient: this.zone.ambient } : {}),
        ...(this.zone.terrain ? { terrain: this.zone.terrain } : {}),
        ...(this.zone.ground?.length ? { ground: this.zone.ground } : {}),
        ...(this.zone.npcs.length ? { spawns: zoneSpawnSummary(this.zone) } : {}),
      },
      statics,
      you: {
        x: player.x,
        z: player.z,
        hp: player.hp,
        maxHp: player.maxHp,
        stats: player.stats,
        inventory: player.inventory,
        gear: player.gear,
        runEnergy: Math.round(player.runEnergy),
        running: player.running,
        stance: player.stance,
        ...(player.spell ? { spell: player.spell } : {}),
        specialEnergy: Math.round(player.specialEnergy),
        equipment: equipmentMap(player.equipment),
        prayer: {
          points: Math.ceil(player.prayerPoints),
          max: player.maxPrayerPoints,
          protection: player.activeProtectionPrayer,
          combat: player.activeCombatPrayer,
        },
      },
    })

    const depleted = [...this.ensureRocks().values()]
      .filter((r) => r.depletedUntilTick > this.tickCount)
      .map((r) => ({ id: r.id, depleted: true }))
    const npcEnts = [...this.ensureNpcs().values()]
      .filter((n) => n.state !== 'dead')
      .map((n) => toNpcDiff(n))
    const otherEnts = [
      ...[...this.players.values()].filter((p) => p.charId !== player.charId).map((p) => toEntityDiff(p, { pvpZone: this.isPvp })),
      ...[...this.bots.values()].filter((b) => b.state === 'alive').map((b) => toBotDiff(b)),
    ]
    const visibleLoot = visibleLootFor(this.loot.values(), lootViewer(player), this.tickCount)
    player.lootView = new Set(visibleLoot.map((l) => l.id))
    // AOI zones send the whole snapshot at join, then the first tick prunes
    // everything out of range — so seed the view with what we just sent.
    player.entView = new Set([...otherEnts, ...npcEnts].map((e) => e.id))
    const intro: Extract<ServerMessage, { t: 'diff' }> = { t: 'diff', tick: this.tickCount }
    if (depleted.length > 0) intro.rocks = depleted
    if (npcEnts.length > 0 || otherEnts.length > 0) intro.ents = [...otherEnts, ...npcEnts]
    if (visibleLoot.length > 0) intro.loot = visibleLoot
    if (intro.rocks || intro.ents || intro.loot) send(player.conn, intro)
  }

  private handleAuthedMessage(player: Player, message: ClientMessage): void {
    switch (message.t) {
      case 'walk': {
        const path = findPath(this.playerCollision(player), { x: player.x, z: player.z }, { x: message.x, z: message.z })
        player.path = path ? path.slice(1) : []
        // Walking away is disengaging: the session survives (so a monster that
        // was fighting you keeps swinging while it can reach you, and the
        // engine's attack timers aren't reset each step) but the player stops
        // attacking until they click Attack again. stepCombat ends it once the
        // monster is out of reach too.
        this.clearIntents(player, true)
        if (player.combat) player.combat.passive = true
        // Walking away is disengaging in the Wilderness too: the lock survives
        // (so whoever is chasing you keeps swinging, and nobody else may jump
        // in) but YOUR swings stop until you click Attack again. Without this a
        // ranged or magic fighter kept firing at a target they were running
        // away from, which is not a decision anyone made.
        player.pvpPassive = true
        break
      }
      case 'cancel':
        player.path = []
        this.clearIntents(player)
        break
      case 'ping':
        break // answered upstream, before the rate limiter — it's the keepalive
      case 'chat': {
        const text = sanitizeChat(message.text)
        if (text) {
          this.pendingChat.push({ e: 'chat', charId: player.charId, name: player.name, text })
          // Player-authored text broadcast to strangers needs a durable history
          // for safety review. Swallowed: an audit outage must not silence the
          // zone's chat, and the failure is logged either way.
          void auditLog(this.env, 'world_chat', {
            characterId: Number(player.charId),
            identityId: player.identityId,
            zone: this.name,
            text,
          }, { swallow: true })
        }
        break
      }
      case 'moveInv':
        if (moveInventorySlot(player.inventory, message.from, message.to)) this.pendingInvEcho.add(player.charId)
        break
      case 'invAction':
        this.handleInvAction(player, message)
        break
      case 'bank':
        this.handleBank(player, message)
        break
      case 'craft':
        this.handleCraft(player, message)
        break
      case 'interact':
        this.handleInteract(player, message)
        break
      case 'setRun':
        player.running = message.run
        player.pendingEvents.push({ e: 'run', energy: Math.round(player.runEnergy), running: player.running })
        break
      case 'setStance':
        player.stance = message.stance
        player.stanceDirty = true
        // Apply mid-fight too — the engine reads stance each tick.
        if (player.combat) player.combat.state.stance = message.stance
        break
      case 'setSpell':
        this.handleSetSpell(player, message.spell)
        break
      case 'special': {
        // Queue the weapon's special for the next combat tick (engine checks
        // energy + weapon and drains on fire). Out of combat, arm it instead
        // of refusing — startCombat fires it as the very first swing of the
        // next fight this player starts. A second tap while still queued (not
        // yet fired) cancels it, so the client can toggle the button off.
        if (player.combat) player.combat.state.specialAttackQueued = !player.combat.state.specialAttackQueued
        else if (this.isPvp) player.specialAttackQueued = !player.specialAttackQueued
        else player.pendingSpecial = !player.pendingSpecial
        emitSpecIfChanged(player, player.pendingEvents)
        break
      }
      case 'pray':
        this.handlePray(player, message.prayerId)
        break
      case 'unequip':
        this.handleUnequip(player, message.slot)
        break
      case 'teleport':
        this.handleTeleport(player, message.placeId)
        break
      case 'follow':
        this.handleFollow(player, message.targetId)
        break
      case 'pvpConsent':
        // Arms the crossing. NO needs no branch: the step that raised the
        // prompt already dropped the path, so the character is standing still.
        if (this.isPvp && message.yes) player.pvpConsent = true
        break
      case 'logout':
        // Answered, never silently ignored: a Log out button that does nothing
        // reads as a broken game, and the client is holding its reload on this
        // reply. The text is the chat line AND the client's cancel signal.
        if (logoutBlocked(player.combatBlockUntilTick, this.tickCount)) {
          player.pendingEvents.push({ e: 'logoutRefused', text: LOGOUT_BLOCKED_MESSAGE })
          break
        }
        void this.depart(player, 'logout')
        break
      case 'leave':
        void this.depart(player, 'leave')
        break
      case 'hello':
        break
    }
  }

  /** Leaving on purpose — an explicit logout, or a tab actually being closed.
   * Removes the player now, with no linger: the grace period exists for sockets
   * that dropped by accident, and sitting on the save lock for a minute after a
   * deliberate exit is what leaves the idle game unable to save when the player
   * switches straight back to it. Flushes, checkpoints, releases the lock, then
   * closes. `logout` also tells the client, which clears its stored session.
   *
   * The ONE thing that defers it is an active fight: closing the tab must not
   * be a better escape than running, so a departing fighter is frozen in place
   * instead (beginCombatLinger) and really leaves when the fight has been over
   * for COMBAT_LOGOUT_BLOCK_TICKS. Every exit funnels through here — the button,
   * the `leave` frame and the out-of-band beacon — so that is one check, not
   * three that can drift apart. */
  private async depart(player: Player, reason: 'logout' | 'leave'): Promise<void> {
    if (logoutBlocked(player.combatBlockUntilTick, this.tickCount)) {
      this.beginCombatLinger(player)
      player.conn.close(1000, reason)
      return
    }
    const conn = player.conn
    await this.removeAndFlush(player)
    if (reason === 'logout') send(conn, { t: 'error', code: 'logged_out', msg: 'You have left the world.' })
    conn.close(1000, reason)
  }

  /**
   * Freezes a player who tried to leave mid-fight. They stay in the world,
   * visible, targetable and losable — but PASSIVE, on both combat paths: a
   * character nobody is driving must not go on winning fights, it must only go
   * on being in them.
   *
   * Aggro and the PvP lock are deliberately NOT released (the ordinary socket
   * close does release aggro), because releasing them is what would end the
   * fight and let the block lapse in the very next tick.
   */
  private beginCombatLinger(player: Player): void {
    player.path = []
    this.clearIntents(player, true)
    player.anim = 'idle'
    player.running = false
    if (player.combat) player.combat.passive = true
    player.pvpPassive = true
    const floor = this.tickCount + LINGER_TICKS
    player.lingerUntilTick = player.lingerUntilTick === null ? floor : Math.min(player.lingerUntilTick, floor)
    // Re-entrant on purpose: `depart` closes the socket, which lands straight
    // back here through onClose, and the exit beacon can arrive after both. Only
    // the first pass arms the ceiling and pays for the D1 write.
    if (player.combatLingerDeadline === 0) {
      player.combatLingerDeadline = this.tickCount + COMBAT_LINGER_MAX_TICKS
      // The lock's own fallback expiry has to cover the ceiling, not the
      // ordinary linger: armed short, the save would unlock while the body is
      // still standing on the field.
      void expireWorldSessionAfter(this.env, Number(player.charId), player.sessionId, COMBAT_LINGER_MAX_TICKS * 600 + 5_000)
    }
    this.ensureTicking()
  }

  /** Takes an equipped item off, returning it to the pack (reverse of equip):
   * mints the returned unit, updates gear, marks equipment dirty, re-announces. */
  private handleUnequip(player: Player, slot: string): void {
    const entry = (player.equipment as Record<string, { itemId?: string; quantity?: number }>)[slot]
    const itemId = entry?.itemId
    if (!itemId) return
    const qty = Math.max(1, Math.floor(Number(entry.quantity) || 1))
    if (freeSlotCount(player.inventory) < 1 && !(isStackable(itemId) && countItem(player.inventory, itemId) > 0)) {
      player.pendingEvents.push({ e: 'msg', text: 'Your pack is full.' })
      return
    }
    const equipment = { ...player.equipment }
    delete equipment[slot]
    addToInventory(player.inventory, itemId, qty)
    mintUnits(player.pools, itemId, qty)
    player.equipment = equipment
    player.gear = gearFromEquipment(player.equipment)
    player.equipmentDirty = true
    this.pendingJoins.add(player.charId)
    player.pendingEvents.push({ e: 'equip', equipment: equipmentMap(player.equipment) })
    player.pendingEvents.push({ e: 'msg', text: `You remove the ${itemNameOf(itemId)}.` })
    this.pendingInvEcho.add(player.charId)
    this.scheduleDirtyFlush(player)
  }

  /** A pack-slot action: the primary verb (equip/eat/drink/bury, validated
   * against the shared derivation so the client can't invent one) or drop. */
  /** Toggle a prayer on/off (§4). Validates the Prayer level requirement and a
   * non-empty pool server-side, updates the session toggles, mirrors them onto a
   * live fight's engine state, and echoes the readout. */
  private handlePray(player: Player, prayerId: string): void {
    const prayerLevel = player.stats.prayer?.level ?? getLevelFromXP(Number(player.stats.prayer?.xp) || 0) ?? 1
    const result = resolvePrayerToggle(
      {
        prayerPoints: player.prayerPoints,
        maxPrayerPoints: player.maxPrayerPoints,
        prayerDrainAccumulator: player.prayerDrainAccumulator,
        activeProtectionPrayer: player.activeProtectionPrayer,
        activeCombatPrayer: player.activeCombatPrayer,
      },
      prayerId,
      prayerLevel,
    )
    if (!result.ok) {
      const text =
        result.reason === 'level' ? `You need Prayer level ${result.required} for that.`
        : result.reason === 'empty' ? 'You have run out of prayer points.'
        : 'You cannot use that prayer.'
      player.pendingEvents.push({ e: 'msg', text })
      return
    }
    player.activeProtectionPrayer = result.session.activeProtectionPrayer
    player.activeCombatPrayer = result.session.activeCombatPrayer
    // Mid-fight the engine reads the active prayers off the combat state each
    // tick — mirror the toggle there so it takes effect this fight.
    if (player.combat) {
      player.combat.state.activeProtectionPrayer = player.activeProtectionPrayer
      player.combat.state.activeCombatPrayer = player.activeCombatPrayer
    }
    emitPrayerIfChanged(player, player.pendingEvents)
  }

  private handleInvAction(player: Player, message: Extract<ClientMessage, { t: 'invAction' }>): void {
    const slot = player.inventory[message.slot]
    if (!slot) return
    const itemId = slot.itemId

    if (message.action === 'drop') {
      const qty = slot.quantity
      player.inventory[message.slot] = null
      consumeUnits(player.pools, itemId, qty)
      for (const loot of spawnDrops([{ itemId, quantity: qty }], player.x, player.z, player.charId, this.tickCount, PLAYER_DROP_OWNER_TICKS)) {
        this.loot.set(loot.id, loot)
      }
      this.pendingInvEcho.add(player.charId)
      this.scheduleDirtyFlush(player)
      return
    }

    const primary = primaryInvAction(itemId)
    if (!primary || primary.action !== message.action) return

    if (message.action === 'drink') {
      // Potions run on the combo cooldown (§4). Apply the effect to the live
      // fight's engine state when in combat (so the boost/pool takes effect this
      // tick and the tick sync mirrors it back to the session), else to the
      // session directly.
      const buffState = player.combat ? player.combat.state : player
      const actor = {
        hp: player.hp,
        maxHP: player.maxHp,
        activePotions: buffState.activePotions,
        prayerPoints: buffState.prayerPoints,
        maxPrayerPoints: buffState.maxPrayerPoints,
      }
      const res = resolveDrink(actor, itemId, this.tickCount, player.eatReadyTick, player.comboReadyTick)
      if (!res.allowed) {
        player.pendingEvents.push({ e: 'msg', text: 'You need to wait before drinking again.' })
        return
      }
      removeOneAt(player.inventory, message.slot)
      consumeUnits(player.pools, itemId, 1)
      player.hp = actor.hp
      buffState.prayerPoints = actor.prayerPoints
      player.eatReadyTick = res.eatReadyTick
      player.comboReadyTick = res.comboReadyTick
      if (player.combat) {
        player.combat.state = applyCombo(player.combat.state)
        player.prayerPoints = player.combat.state.prayerPoints
      }
      const restored = res.result.prayerRestored ?? 0
      player.pendingEvents.push({
        e: 'msg',
        text: restored > 0 ? `You drink the ${itemNameOf(itemId).toLowerCase()}. (+${restored} prayer)` : `You drink the ${itemNameOf(itemId).toLowerCase()}.`,
      })
      emitPrayerIfChanged(player, player.pendingEvents)
      this.pendingInvEcho.add(player.charId)
      this.scheduleDirtyFlush(player)
      return
    }

    if (message.action === 'eat') {
      // §4 eat timing: a normal food and a combo food each have their own 3-tick
      // cooldown (one of each may land the same tick, never faster). Without this
      // the eat ran instantly outside the tick loop — the 15 msg/s soft limit let
      // a client heal ~9 times per 600ms tick and out-tank any boss.
      const combo = isComboConsumable(items[itemId])
      const timing = resolveEatTiming(this.tickCount, combo, player.eatReadyTick, player.comboReadyTick)
      if (!timing.allowed) {
        player.pendingEvents.push({ e: 'msg', text: 'You need to wait before eating again.' })
        return
      }
      removeOneAt(player.inventory, message.slot)
      consumeUnits(player.pools, itemId, 1)
      player.hp = Math.min(player.maxHp, player.hp + healAmount(itemId))
      player.eatReadyTick = timing.eatReadyTick
      player.comboReadyTick = timing.comboReadyTick
      // Mid-fight, mirror the engine's consumable timing onto the live session:
      // a normal food delays the next attack (applyEat), a combo food doesn't
      // (applyCombo). Keeps the world's DPS-vs-heal trade-off honest.
      if (player.combat) player.combat.state = (combo ? applyCombo : applyEat)(player.combat.state)
      // Same trade in a duel: normal food costs you the swing you were about to
      // land, a combo item does not (§4). Without this the Wilderness would be
      // the one fight in the game where eating is free.
      if (this.isPvp && !combo) {
        player.pvpAttackTimer = Math.max(player.pvpAttackTimer, getAttackSpeed(player.equipment, itemsData) + 1)
      }
      player.pendingEvents.push({ e: 'msg', text: `You eat the ${itemNameOf(itemId).toLowerCase()}.` })
      this.pendingInvEcho.add(player.charId)
      this.scheduleDirtyFlush(player)
      return
    }

    if (message.action === 'bury') {
      const xp = BURY_XP[itemId]
      if (!xp) return
      removeOneAt(player.inventory, message.slot)
      consumeUnits(player.pools, itemId, 1)
      player.pendingEvents.push({ e: 'msg', text: 'You bury the bones.' })
      player.pendingEvents.push(...grantSessionXp(player, 'prayer', xp))
      this.pendingInvEcho.add(player.charId)
      this.scheduleDirtyFlush(player)
      return
    }

    this.handleEquip(player, message.slot, itemId, primary.label)
  }

  private handleEquip(player: Player, slotIndex: number, itemId: string, verb: string): void {
    const slot = player.inventory[slotIndex]
    const item = items[itemId]
    if (!slot || !item) return
    const reqError = checkEquipRequirements(item, player.stats, player.completedQuests) as
      | { reason: 'quest'; questUnlock: string }
      | { reason: 'skill'; skill: string; required: number }
      | null
    if (reqError) {
      const text = reqError.reason === 'quest'
        ? 'A quest still stands between you and that.'
        : `You need ${reqError.skill.charAt(0).toUpperCase()}${reqError.skill.slice(1)} level ${reqError.required} to equip this.`
      player.pendingEvents.push({ e: 'msg', text })
      return
    }

    const equipment = { ...player.equipment }
    const result = equipItem(equipment, item, itemsData, slot) as { equipped: boolean; unequipped: { itemId: string; quantity?: number }[] }
    if (!result.equipped) {
      player.pendingEvents.push({ e: 'msg', text: 'You can’t equip that.' })
      return
    }
    const equippedQty = item.slot === 'ammo' ? slot.quantity : 1
    const newInv = [...player.inventory]
    if (item.slot === 'ammo' || slot.quantity <= 1) newInv[slotIndex] = null
    else newInv[slotIndex] = { ...slot, quantity: slot.quantity - 1 }
    const placed = placeUnequippedItems(result.unequipped, newInv, itemsData) as { ok: boolean; inventory: typeof newInv }
    if (!placed.ok) {
      player.pendingEvents.push({ e: 'msg', text: 'Your pack is full.' })
      return
    }

    player.equipment = equipment
    player.inventory = placed.inventory
    consumeUnits(player.pools, itemId, equippedQty)
    // Unequipped gear entering the pack behaves like minted: once the flush
    // snapshots equipment, the save no longer accounts for it anywhere else.
    for (const un of result.unequipped) {
      if (un) mintUnits(player.pools, un.itemId, Math.max(1, Math.floor(Number(un.quantity) || 1)))
    }
    player.gear = gearFromEquipment(player.equipment)
    player.equipmentDirty = true
    // Re-announce the ent so everyone sees the new weapon immediately.
    this.pendingJoins.add(player.charId)
    player.pendingEvents.push({ e: 'equip', equipment: equipmentMap(player.equipment) })
    player.pendingEvents.push({ e: 'msg', text: `You ${verb.toLowerCase()} the ${itemNameOf(itemId)}.` })
    this.pendingInvEcho.add(player.charId)
    this.scheduleDirtyFlush(player)
  }

  /** Sets (or clears) the session's combat spell. Level-gated against the
   * session's Magic level (boosted by any active Super Combat/Magic
   * Potion/Imbued Brain, same as the boost already applied to magic damage);
   * applies to an active magic fight immediately. */
  private handleSetSpell(player: Player, spellId: string | null): void {
    if (spellId !== null) {
      const spell = (spellsJson as Record<string, { name?: string; levelReq?: number } | undefined>)[spellId]
      if (!spell) return
      const magicLevel = boostedMagicLevel(player.stats.magic?.level ?? 1, player.activePotions, items)
      if (magicLevel < (spell.levelReq ?? 1)) {
        player.pendingEvents.push({ e: 'msg', text: `You need Magic level ${spell.levelReq} to cast ${spell.name ?? spellId}.` })
        return
      }
    }
    player.spell = spellId
    if (player.combat) {
      const setup = resolveCombatSetup(player)
      if (setup.needsSpell) {
        // Cleared the spell mid-magic-fight: the engine would splash 0s forever.
        player.pendingEvents.push({ e: 'msg', text: 'You stop fighting — no spell selected.' })
        const npc = this.ensureNpcs().get(player.combat.npcId)
        if (npc && npc.attackerId === player.charId) npc.attackerId = null
        player.combat = null
      } else {
        player.combat.state.combatType = setup.combatType
        player.combat.state.spell = setup.spell
      }
    }
  }

  /** Starts a craft run from the recipe panel. Everything re-validates
   * server-side: station adjacency, recipe membership, level, materials; qty is
   * a request clamped to what the pack's materials actually allow. */
  private handleCraft(player: Player, message: Extract<ClientMessage, { t: 'craft' }>): void {
    const station = [...this.ensureStations().values()].find(
      (s) => s.type === message.station && Math.max(Math.abs(s.x - player.x), Math.abs(s.z - player.z)) <= 1
    )
    if (!station) return
    const recipe = recipeFor(message.station, message.recipeId)
    if (!recipe) return
    const skill = STATIONS[message.station].skill
    const level = player.stats[skill]?.level ?? 1
    if (level < recipe.level) {
      const skillName = skill.charAt(0).toUpperCase() + skill.slice(1)
      player.pendingEvents.push({ e: 'msg', text: `You need ${skillName} level ${recipe.level} to make that.` })
      return
    }
    if (!hasMaterials(player.inventory, recipe)) {
      player.pendingEvents.push({ e: 'msg', text: "You don't have the materials to make that." })
      return
    }
    this.clearIntents(player)
    player.path = []
    player.crafting = {
      station: message.station,
      stationId: station.id,
      recipeId: recipe.id,
      remaining: Math.min(message.qty, maxCraftable(player.inventory, recipe)),
      progress: 0,
    }
    this.ensureTicking()
  }

  private chestAdjacent(player: Player): boolean {
    return this.zone.objects.some(
      (o) => o.type === 'bank_chest' && Math.max(Math.abs(o.x - player.x), Math.abs(o.z - player.z)) <= 1
    )
  }

  private bankList(player: Player): BankSlot[] {
    return Object.entries(player.bankView)
      .filter(([, quantity]) => quantity > 0)
      .map(([itemId, quantity]) => ({ itemId, quantity }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId))
  }

  /** One bank move. Quantities clamp server-side (to what's actually held, and
   * on withdraw to pack space) — the client's 1/5/10/X/All are only requests. */
  private handleBank(player: Player, message: Extract<ClientMessage, { t: 'bank' }>): void {
    if (!this.chestAdjacent(player)) return
    const itemId = message.itemId

    if (message.op === 'deposit') {
      const qty = Math.min(message.qty, countItem(player.inventory, itemId))
      if (qty < 1) return
      removeItems(player.inventory, itemId, qty)
      depositUnits(player.pools, itemId, qty)
      player.bankView[itemId] = (player.bankView[itemId] ?? 0) + qty
    } else {
      const available = player.bankView[itemId] ?? 0
      let qty = Math.min(message.qty, available)
      if (qty < 1) return
      if (isStackable(itemId)) {
        if (inventoryIsFull(player.inventory, itemId)) qty = 0
      } else {
        qty = Math.min(qty, freeSlotCount(player.inventory))
      }
      if (qty < 1) {
        player.pendingEvents.push({ e: 'msg', text: 'Your pack is full.' })
        return
      }
      addToInventory(player.inventory, itemId, qty)
      const left = available - qty
      if (left > 0) player.bankView[itemId] = left
      else delete player.bankView[itemId]
      withdrawUnits(player.pools, itemId, qty)
      if (qty < message.qty && message.qty <= available) {
        player.pendingEvents.push({ e: 'msg', text: 'Your pack couldn’t hold everything.' })
      }
    }

    player.pendingEvents.push({ e: 'bank', bank: this.bankList(player) })
    this.pendingInvEcho.add(player.charId)
    this.scheduleDirtyFlush(player)
  }

  /** Debounced durability flush after bank/equip/consume mutations, so a DO
   * eviction can't unwind a move the player just watched succeed. */
  private scheduleDirtyFlush(player: Player): void {
    player.flushAtTick = this.tickCount + DIRTY_FLUSH_DELAY_TICKS
    this.ensureTicking()
  }

  /** Travel-menu teleport: snap the player to a named same-zone landmark (a
   * place centre in the merged overworld). Same-zone, so no DO switch — just set
   * the authoritative position and tell the client to snap (no walk interp).
   * Clears path/interacts and drops combat + aggro so it can't be used to drag a
   * monster across the map. Unknown/blocked ids are ignored. */
  private handleTeleport(player: Player, placeId: string): void {
    const lm = (this.zone.landmarks ?? []).find((l) => l.id === placeId)
    if (!lm) return
    if (this.zone.collision[lm.z]?.[lm.x] !== '.') return
    player.path = []
    this.clearIntents(player)
    this.releaseAggro(player.charId)
    player.x = lm.x
    player.z = lm.z
    player.anim = 'idle'
    this.dirty.add(player.charId)
    // Runs outside the tick, so re-broadcast the new position to nearby players
    // via pendingJoins (the tick converts it to an entity diff) — mark alone only
    // checkpoints. ensureTicking flushes it even if the zone was otherwise idle.
    this.pendingJoins.add(player.charId)
    this.ensureTicking()
    send(player.conn, { t: 'snap', x: lm.x, z: lm.z })
  }

  /** Right-click → Follow (item 10): re-paths toward the target each tick
   * their tile changes (tick.ts's updateFollow) until cancelled — any
   * explicit walk/interact/teleport/craft (clearIntents, called here too, so
   * a follow replaces whatever intent was active), combat start, or the
   * target leaving the zone. Same-zone only; there's no cross-zone follow. */
  private handleFollow(player: Player, targetId: string): void {
    if (targetId === player.charId) return
    if (!this.players.has(targetId)) {
      player.pendingEvents.push({ e: 'msg', text: "You can't see them anymore." })
      return
    }
    this.clearIntents(player, true)
    // Following is a movement order, so it disengages exactly as a walk does.
    if (player.combat) player.combat.passive = true
    player.following = targetId
    player.followTargetTile = null
    this.ensureTicking()
  }

  /** The zone grid as this player may walk it: large monsters block their own
   * footprint, minus whatever tile the player is standing on (a dragon can
   * wander onto them, and being inside one must never wedge them in place). */
  private playerCollision(player: Player): string[] {
    return collisionWithMonsters(this.zone.collision, this.ensureNpcs().values(), { x: player.x, z: player.z })
  }

  private clearIntents(player: Player, keepCombat = false): void {
    player.pendingInteract = null
    player.mining = null
    player.crafting = null
    if (!keepCombat) player.combat = null
    player.pendingLoot = null
    player.following = null
    player.followTargetTile = null
    player.pvpPendingTargetId = null
    player.pvpChaseTile = null
  }

  private handleInteract(player: Player, message: Extract<ClientMessage, { t: 'interact' }>): void {
    // Loot pickup paths ONTO the tile (not adjacent) and resolves on arrival.
    if (message.kind === 'loot' && message.action === 'take') {
      const loot = this.loot.get(message.id)
      if (!loot) return
      const viewer = lootViewer(player)
      // Refuse before the walk, not silently on arrival: an account asking for
      // loot they were never shown gets told why instead of pathing across the
      // zone for nothing.
      if (!mayTake(loot, viewer)) {
        player.pendingEvents.push({ e: 'msg', text: ownLootOnlyMessage(viewer) })
        return
      }
      if (!isVisibleTo(loot, viewer, this.tickCount)) return
      const path = findPath(this.zone.collision, { x: player.x, z: player.z }, { x: loot.x, z: loot.z })
      if (!path) return
      player.path = path.slice(1)
      this.clearIntents(player)
      player.pendingLoot = { id: loot.id, x: loot.x, z: loot.z }
      return
    }

    let target: { x: number; z: number } | null = null
    let intent: Player['pendingInteract'] = null

    if (message.kind === 'rock' && (message.action === 'mine' || message.action === 'chop' || message.action === 'fish' || message.action === 'gather')) {
      // startInteract re-validates the verb against the node's skill.
      const rock = this.ensureRocks().get(message.id)
      if (!rock) return
      target = rock
      intent = { kind: 'rock', id: rock.id, action: message.action }
    } else if (message.kind === 'player' && message.action === 'attack') {
      this.handleAttackPlayer(player, message.id)
      return
    } else if (message.kind === 'npc' && message.action === 'attack') {
      const npc = this.ensureNpcs().get(message.id)
      if (!npc || npc.state === 'dead') return
      target = npc
      intent = { kind: 'npc', id: npc.id, action: 'attack' }
    } else if (message.kind === 'object' && message.action === 'bank') {
      const chest = this.zone.objects.find((o) => o.id === message.id && o.type === 'bank_chest')
      if (!chest) return
      target = chest
      intent = { kind: 'object', id: chest.id, action: 'bank' }
    } else if (message.kind === 'object' && stationTypeForVerb(message.action)) {
      const station = this.zone.objects.find((o) => o.id === message.id && o.type === stationTypeForVerb(message.action))
      if (!station) return
      target = station
      intent = { kind: 'object', id: station.id, action: message.action }
    } else {
      return
    }

    if (!target) return

    // Attack clicks: stop at the weapon's reach (ranged/magic need not close to
    // melee) instead of always walking to melee adjacency, and preserve the live
    // combat session (engine attack timer) when the click re-targets the fight
    // already in progress — Q5: re-clicking the current foe previously reset the
    // timer into a free instant hit.
    if (intent && intent.kind === 'npc') {
      const range = playerAttackRange(player)
      // Already within reach: no path at all — otherwise every re-click nudges
      // the player one tile closer via the adjacency path below, creeping a
      // ranged/magic attacker into melee range over repeated clicks.
      if (withinRange({ x: player.x, z: player.z }, target, range)) {
        player.path = []
      } else {
        const path = findPathAdjacent(this.zone.collision, { x: player.x, z: player.z }, target)
        if (!path) return
        player.path = cutPathToRange(path.slice(1), target, range)
      }
      this.clearIntents(player, isSameFightTarget(player, intent))
      player.pendingInteract = intent
      return
    }

    const path = findPathAdjacent(this.zone.collision, { x: player.x, z: player.z }, target)
    if (!path) return
    player.path = path.slice(1)
    this.clearIntents(player)
    player.pendingInteract = intent
  }

  /** Every fighter in this room by id — real players and roaming bots, which
   * are attacked through exactly the same path.
   *
   * A LINGERING player counts. Everyone can see them standing there (their ent
   * still rides every diff), and a body you can see but cannot hit is the whole
   * combat-log exploit: pull the plug at 5 HP and walk away with the lot. They
   * are passive, so they land nothing back — see beginCombatLinger. */
  private pvpFighter(id: string): PvpFighter | null {
    const player = this.players.get(id)
    if (player) return player
    const bot = this.bots.get(id)
    return bot && bot.state === 'alive' ? bot : null
  }

  /**
   * An Attack click on another player (or a bot). Refusals are answered
   * immediately with the reason — an attack that silently does nothing is
   * indistinguishable from a broken game — and an allowed click only sets an
   * INTENT plus an approach path. The single-combat lock is taken when the
   * first swing is actually in reach (tickPvp), never here: locking on the
   * click would let a player reserve a victim from across the zone and then
   * never turn up.
   */
  private handleAttackPlayer(player: Player, targetId: string): void {
    if (!this.isPvp) return
    const target = this.pvpFighter(targetId)
    if (!target) return
    const refusal = refuseAttack(this.name, player, target, this.tickCount)
    if (refusal) {
      player.pendingEvents.push({ e: 'msg', text: pvpRefusalMessage(refusal, target.name) })
      return
    }
    this.clearIntents(player)
    player.pvpPendingTargetId = target.charId
    // A fresh Attack click is the ONLY thing that re-engages after walking away
    // (see pvpPassive), mirroring how a PvE fight needs a new click.
    player.pvpPassive = false
    player.pvpChaseTile = null
    this.stepPvpApproach(player, target)
  }

  /**
   * Walks the player toward their attack target, re-pathing whenever the target
   * has moved. Called at the click AND every tick until the fight starts.
   *
   * One path computed at click time is not enough out here: bots hold at their
   * own weapon's range and players run, so a stale path walks you to an empty
   * tile and leaves the intent hanging forever — which is exactly what made a
   * ranged or magic attack look like it simply did nothing. Guarded on the
   * target's tile changing, the same way updateFollow avoids a pathfind per
   * tick for a stationary target.
   */
  private stepPvpApproach(player: Player, target: PvpFighter): void {
    const range = pvpAttackRange(player)
    const plan = pvpApproachPlan(player, target, range, player.pvpChaseTile, player.path.length)
    if (plan.kind === 'arrived') {
      player.path = []
      player.pvpChaseTile = null
      return
    }
    if (plan.kind === 'hold') return
    player.pvpChaseTile = { x: target.x, z: target.z }
    const path = findPathAdjacent(this.zone.collision, { x: player.x, z: player.z }, target)
    player.path = path ? cutPathToRange(path.slice(1), target, range) : []
  }

  // ── The Wilderness ────────────────────────────────────────────────────────

  /** A random walkable tile north of the line, for a bot spawn or roam target.
   * Rejection-samples rather than building an index: the danger half is mostly
   * open ground, so this lands on the first or second try. */
  private randomDangerTile(): { x: number; z: number } | null {
    const collision = this.zone.collision
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(Math.random() * this.zone.width)
      const z = Math.floor(Math.random() * PVP_LINE_Z)
      if (collision[z]?.[x] === '.') return { x, z }
    }
    return null
  }

  /** Every fighter the duel loop should consider this tick — lingering players
   * included, so a fight survives the loser closing their browser (see
   * pvpFighter). */
  private pvpFighters(): PvpFighter[] {
    const out: PvpFighter[] = []
    for (const player of this.players.values()) out.push(player)
    for (const bot of this.bots.values()) if (bot.state === 'alive') out.push(bot)
    return out
  }

  /** Keeps the bot roster matched to who is actually out there, and empties it
   * when nobody is. Spawns are held for BOT_RESPAWN_TICKS after a kill. */
  private tickBotRoster(botChanged: Set<string>, botRemoved: Set<string>): void {
    for (const bot of [...this.bots.values()]) {
      if (bot.state === 'dead' && this.tickCount >= bot.removeAtTick) {
        this.bots.delete(bot.charId)
        botRemoved.add(bot.charId)
      }
    }
    const dangerLevels: number[] = []
    for (const player of this.players.values()) {
      if (player.lingerUntilTick === null && isDangerTile(player)) dangerLevels.push(player.combatLevel)
    }
    if (dangerLevels.length === 0) {
      // Nobody north of the line: let the roster go. The tick loop stops on an
      // empty room, so bots must never be the reason it keeps running.
      for (const bot of this.bots.values()) botRemoved.add(bot.charId)
      this.bots.clear()
      return
    }
    if (this.tickCount < this.botSpawnAfterTick) return
    for (const bot of botsToSpawn(this.bots.values(), {
      tick: this.tickCount,
      dangerPlayerLevels: dangerLevels,
      randomDangerTile: () => this.randomDangerTile(),
    })) {
      this.bots.set(bot.charId, bot)
      botChanged.add(bot.charId)
    }
  }

  /** Drains a swing's rune / ammo cost out of the attacker's real pack. Players
   * additionally drain the provenance pools and flag a durability flush — a
   * consumed save-backed rune that only left the session pack would resurrect on
   * the next DO eviction. */
  private consumePvpSwingCost(fighter: PvpFighter, swing: { runesConsumed: Record<string, number> | null; ammoConsumed: { itemId: string; qty: number } | null }): void {
    const player = fighter.isBot ? null : this.players.get(fighter.charId)
    if (swing.runesConsumed) {
      for (const [runeId, qty] of Object.entries(swing.runesConsumed)) {
        const n = Math.max(0, Math.floor(Number(qty) || 0))
        if (n > 0 && removeItems(fighter.inventory, runeId, n) && player) {
          consumeUnits(player.pools, runeId, n)
        }
      }
      if (player) {
        this.pendingInvEcho.add(player.charId)
        this.scheduleDirtyFlush(player)
      }
    }
    if (swing.ammoConsumed) {
      const equipment = fighter.equipment as { ammo?: { itemId?: string; quantity?: number } | null }
      const ammo = equipment.ammo
      if (ammo && ammo.itemId === swing.ammoConsumed.itemId) {
        const left = Math.max(0, (Math.floor(Number(ammo.quantity)) || 0) - swing.ammoConsumed.qty)
        fighter.equipment = { ...fighter.equipment, ammo: left > 0 ? { ...ammo, quantity: left } : null }
        if (player) {
          player.equipmentDirty = true
          this.scheduleDirtyFlush(player)
        }
      }
    }
  }

  /**
   * Everything a Wilderness death costs, settled at the death tile before the
   * respawn moves the corpse: the whole pack and every worn item hit the floor
   * owned by the killer, the session is emptied, and the loss is flushed
   * immediately so it is durable before anyone walks over the pile.
   *
   * The pack drains the provenance pools; the worn gear does not. Equipment
   * leaves the save through the emptied snapshot (`equipmentDirty`) — draining
   * it here as well would take the same units off the save twice.
   */
  private dropEverythingOnDeath(player: Player, killerCharId: string): void {
    const { drops, fromPack } = collectDeathDrops(player.inventory, player.equipment)
    for (const stack of fromPack) consumeUnits(player.pools, stack.itemId, stack.quantity)
    player.inventory = new Array(28).fill(null)
    player.equipment = {}
    player.gear = gearFromEquipment(player.equipment)
    player.equipmentDirty = true
    for (const loot of spawnDrops(drops, player.x, player.z, killerCharId, this.tickCount, KILL_DROP_OWNER_TICKS, { fromPlayer: true })) {
      this.loot.set(loot.id, loot)
    }
    this.pendingInvEcho.add(player.charId)
    player.pendingEvents.push({ e: 'equip', equipment: equipmentMap(player.equipment) })
    // Not debounced: a death is the one mutation that must not be lost to an
    // eviction, and the killer may be standing on the pile already.
    player.flushAtTick = null
    void this.flush(player, 'timer')
  }

  /** Releases both sides of whatever `fighter` was locked in. */
  private releasePvp(fighter: PvpFighter): void {
    const other = fighter.pvpOpponentId ? this.pvpFighter(fighter.pvpOpponentId) : null
    endPvpFight(fighter, other)
  }

  /**
   * One tick of the Wilderness: consent bookkeeping, the bot roster, the
   * single-combat locks, every live duel, and the deaths they cause.
   *
   * Runs AFTER the per-player tick (so movement this tick is already applied and
   * a duel resolves against final positions) and BEFORE the loot / exit loops,
   * which both skip a player who died this tick.
   */
  private tickPvp(
    deaths: Player[],
    playerEnts: Map<string, EntityDiff>,
    hits: { targetId: string; dmg: number }[],
    eventsByChar: Map<string, ZoneEvent[]>,
    broadcastEvents: ZoneEvent[],
    botChanged: Set<string>,
    botRemoved: Set<string>,
  ): void {
    if (!this.isPvp) {
      if (this.bots.size > 0) this.bots.clear()
      return
    }

    // Consent is spent by the crossing and re-armed by the walk home, so the
    // prompt appears on every trip north rather than once per session.
    for (const player of this.players.values()) {
      if (isDangerTile(player)) player.pvpCrossed = true
      else if (player.pvpCrossed) {
        player.pvpCrossed = false
        player.pvpConsent = false
      }
    }

    this.tickBotRoster(botChanged, botRemoved)

    const fighters = new Map(this.pvpFighters().map((f) => [f.charId, f]))

    // Release a lock whose other half has gone, lapsed, or stepped back into
    // the camp. Safety is absolute: reaching the camp ends the fight.
    for (const fighter of fighters.values()) {
      if (!fighter.pvpOpponentId) continue
      const other = fighters.get(fighter.pvpOpponentId)
      const stale = !other
        || other.pvpOpponentId !== fighter.charId
        || fighter.pvpLockUntilTick <= this.tickCount
        || !isDangerTile(fighter)
        || !isDangerTile(other)
      if (stale) endPvpFight(fighter, other ?? null)
    }

    // An approach that has arrived becomes a real fight. Re-judged here rather
    // than trusted from the click: levels, positions and everyone else's locks
    // have all had time to move since.
    for (const player of this.players.values()) {
      const targetId = player.pvpPendingTargetId
      if (!targetId) continue
      const target = fighters.get(targetId)
      if (!target || player.lingerUntilTick !== null) {
        player.pvpPendingTargetId = null
        continue
      }
      if (!withinRangeAndSight(player, target, pvpAttackRange(player), this.zone.collision)) {
        // Still closing. Re-path onto wherever they have moved to, or the walk
        // ends at a tile they left several ticks ago.
        this.stepPvpApproach(player, target)
        continue
      }
      const refusal = refuseAttack(this.name, player, target, this.tickCount)
      if (refusal) {
        player.pvpPendingTargetId = null
        player.pendingEvents.push({ e: 'msg', text: pvpRefusalMessage(refusal, target.name) })
        continue
      }
      player.pvpPendingTargetId = null
      player.pvpChaseTile = null
      player.pvpPassive = false
      beginPvpFight(player, target, this.tickCount)
    }

    // Bots: fight whoever turned on them, otherwise amble.
    for (const bot of this.bots.values()) {
      if (bot.state !== 'alive') continue
      const opponent = bot.pvpOpponentId ? fighters.get(bot.pvpOpponentId) : null
      if (opponent) {
        driveBotCombat(bot, opponent, pvpAttackRange(bot), (from, to) => findPath(this.zone.collision, from, to))
      } else {
        roamBot(bot, (from, to) => findPath(this.zone.collision, from, to), () => this.randomDangerTile())
      }
      botChanged.add(bot.charId)
    }

    // Every live duel, once. Ordered by the lower charId so a pair resolves the
    // same way whichever of the two the map yields first.
    const out: PvpTickOutput = { swings: [], deaths: [] }
    const stepped = new Set<string>()
    for (const fighter of fighters.values()) {
      const other = fighter.pvpOpponentId ? fighters.get(fighter.pvpOpponentId) : null
      if (!other || other.pvpOpponentId !== fighter.charId) continue
      const key = fighter.charId < other.charId ? `${fighter.charId}|${other.charId}` : `${other.charId}|${fighter.charId}`
      if (stepped.has(key)) continue
      stepped.add(key)
      stepPvpFight(fighter, other, { tick: this.tickCount, collision: this.zone.collision }, out)
    }

    for (const swing of out.swings) {
      const attacker = fighters.get(swing.attackerId)
      const defender = fighters.get(swing.defenderId)
      if (!attacker || !defender) continue
      if (swing.refusal) {
        const player = this.players.get(attacker.charId)
        if (player) player.pendingEvents.push({ e: 'msg', text: swing.refusal })
        continue
      }
      attacker.anim = pvpAttackAnim(attacker, swing.special)
      this.consumePvpSwingCost(attacker, swing)
      for (const dmg of swing.splats) hits.push({ targetId: defender.charId, dmg })
      if (swing.special) {
        const player = this.players.get(attacker.charId)
        if (player) emitSpecIfChanged(player, player.pendingEvents)
      }
      this.markPvpEnt(attacker, playerEnts, botChanged)
      this.markPvpEnt(defender, playerEnts, botChanged)
    }

    for (const fighter of fighters.values()) {
      const player = this.players.get(fighter.charId)
      if (player) emitPrayerIfChanged(player, player.pendingEvents)
    }

    for (const death of out.deaths) {
      this.settlePvpDeath(death.victimId, death.killerId, fighters, deaths, eventsByChar, broadcastEvents, botChanged)
    }

    for (const player of this.players.values()) this.emitPvpStateIfChanged(player, fighters)
  }

  private markPvpEnt(fighter: PvpFighter, playerEnts: Map<string, EntityDiff>, botChanged: Set<string>): void {
    const player = this.players.get(fighter.charId)
    if (player) {
      playerEnts.set(player.charId, toEntityDiff(player, { pvpZone: true }))
      this.dirty.add(player.charId)
      return
    }
    botChanged.add(fighter.charId)
  }

  /** Settles one Wilderness death — a player's or a bot's. */
  private settlePvpDeath(
    victimId: string,
    killerId: string,
    fighters: Map<string, PvpFighter>,
    deaths: Player[],
    eventsByChar: Map<string, ZoneEvent[]>,
    broadcastEvents: ZoneEvent[],
    botChanged: Set<string>,
  ): void {
    const victim = fighters.get(victimId)
    const killer = fighters.get(killerId)
    if (!victim) return
    const killerName = killer?.name ?? 'Someone'
    this.releasePvp(victim)
    if (killer) this.releasePvp(killer)

    const bot = this.bots.get(victimId)
    if (bot) {
      bot.state = 'dead'
      bot.hp = 0
      bot.anim = 'die'
      bot.removeAtTick = this.tickCount + NPC_REMOVE_AFTER_DEATH_TICKS
      this.botSpawnAfterTick = this.tickCount + BOT_RESPAWN_TICKS
      botChanged.add(bot.charId)
      // The dedicated drop table, rolled server-side — a bot's gear is never
      // stripped, and this is the only source of Zesta uniques in the game.
      const drops = rollBotDrops()
      for (const loot of spawnDrops(drops, bot.x, bot.z, killerId, this.tickCount)) this.loot.set(loot.id, loot)
      if (killer && !killer.isBot) void recordPvpBotKill(this.env, killerId, bot.templateId, drops)
      broadcastEvents.push({ e: 'pvpKill', killer: killerName, victim: bot.name, bot: true })
      return
    }

    const player = this.players.get(victimId)
    if (!player) return
    this.dropEverythingOnDeath(player, killerId)
    // One-life ends here rather than in respawnPlayer, for the same reason a PvE
    // death does: the message rides pendingEvents, which drains into THIS tick's
    // frame — the last frame a dying player is guaranteed to receive.
    endOneLifeRun(player, (id) => flipOneLifeOff(this.env, id))
    const events = eventsByChar.get(player.charId) ?? []
    events.push({ e: 'hp', hp: 0, maxHp: player.maxHp })
    eventsByChar.set(player.charId, events)
    deaths.push(player)
    if (killer && !killer.isBot) void recordPvpKill(this.env, killerId, victimId)
    broadcastEvents.push({ e: 'pvpKill', killer: killerName, victim: player.name })
  }

  /** {e:'pvpState'} on change only — which side of the line the player is on and
   * who they are locked with. Drives the HUD banner and the client's menu. */
  private emitPvpStateIfChanged(player: Player, fighters: Map<string, PvpFighter>): void {
    const opponent = player.pvpOpponentId ? fighters.get(player.pvpOpponentId) ?? null : null
    const inDanger = isDangerTile(player)
    const key = `${inDanger ? 1 : 0}|${opponent?.charId ?? ''}`
    if (key === player.lastPvpStateSent) return
    player.lastPvpStateSent = key
    player.pendingEvents.push({
      e: 'pvpState',
      inDanger,
      opponentId: opponent?.charId ?? null,
      opponentName: opponent?.name ?? null,
    })
  }

  private ensureTicking(): void {
    if (this.tickTimer) return
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
  }

  private maybeStopTicking(): void {
    if (this.players.size === 0 && this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
      // The roster dies with the room. A bot held across an idle period would
      // be a stale opponent standing in an empty zone waiting for an eviction.
      this.bots.clear()
      this.botSpawnAfterTick = 0
    }
  }

  private tick(): void {
    this.tickCount += 1

    // Expire lingering (disconnected) players whose grace period is up: remove
    // them for real, flush their pack/XP, and broadcast the leave. Done first
    // so the tick below never processes an already-gone player.
    for (const player of [...this.players.values()]) {
      if (player.lingerUntilTick === null) continue
      if (lingerExpired(this.tickCount, player.lingerUntilTick, player.combatBlockUntilTick, player.combatLingerDeadline)) {
        void this.removeAndFlush(player)
      }
    }

    const rocks = this.ensureRocks()
    const npcs = this.ensureNpcs()
    const positions = new Map<string, { x: number; z: number }>()
    for (const p of this.players.values()) positions.set(p.charId, { x: p.x, z: p.z })
    const ctx: TickContext = {
      tick: this.tickCount,
      rocks,
      npcs,
      stations: this.ensureStations(),
      collision: this.zone.collision,
      // Player approach paths route around large monsters; the raw grid stays
      // on ctx.collision for line of sight and for npc chase steps.
      pathAdjacent: (from, to) => findPathAdjacent(collisionWithMonsters(this.zone.collision, npcs.values(), from), from, to),
      players: positions,
      lair: isInstancedRoom(this.name),
      pvpZone: this.isPvp,
      // The Wilderness line. One gate for every path source there is or will be
      // (tick.ts takeSteps) — a walk, a follow, an approach path.
      blockStep: this.isPvp
        ? (player, to) => !(player as Player).pvpConsent && crossesIntoDanger(player, to)
        : undefined,
    }

    const rockChanges = respawnedRocks(rocks, this.tickCount)
    const npcChanged = new Set<string>()
    const npcRemoved = new Set<string>()
    const botChanged = new Set<string>()
    const botRemoved = new Set<string>()
    const hits: { targetId: string; dmg: number }[] = []
    const eventsByChar = new Map<string, ZoneEvent[]>()
    // Player ents deduped by id (last write wins — e.g. a death-tick respawn).
    const playerEnts = new Map<string, EntityDiff>()
    const deaths: Player[] = []

    // Presence edges queued since the last tick. A leave only broadcasts if
    // the player is really gone (a same-tick rejoin keeps them present).
    for (const id of this.pendingJoins) {
      const joined = this.players.get(id)
      if (joined) playerEnts.set(id, toEntityDiff(joined, { pvpZone: this.isPvp }))
    }
    this.pendingJoins.clear()
    if (this.tickCount % PRESENCE_KEYFRAME_TICKS === 0) {
      for (const p of this.players.values()) playerEnts.set(p.charId, toEntityDiff(p, { pvpZone: this.isPvp }))
    }
    const playersRemoved = [...this.pendingLeaves].filter((id) => !this.players.has(id))
    this.pendingLeaves.clear()
    const chatEvents = this.pendingChat
    this.pendingChat = []
    // Zone-wide boss kill feed + unique-drop broadcasts (item 11) — same
    // broadcast-to-everyone shape as chatEvents.
    const broadcastEvents: ZoneEvent[] = []

    // Retarget in-combat npcs onto the top-threat player they can reach BEFORE
    // they step, so a boss chases/attacks the biggest threat in a group fight
    // rather than the first attacker (item 9).
    for (const npc of npcs.values()) {
      if (npc.state !== 'combat') continue
      const engaged: { charId: string; x: number; z: number }[] = []
      for (const p of this.players.values()) {
        if (countsAsEngaged(npc, p.combat?.npcId)) engaged.push({ charId: p.charId, x: p.x, z: p.z })
      }
      // `positions` is every player in the zone: a boss keeps hunting a quarry
      // who has walked out of the fight, and only lets go when they leave.
      reselectAttacker(npc, engaged, this.zone.collision, positions, npcs)
    }

    // NPCs first (wander/respawn/heal) so player combat this tick reads fresh state.
    const npcResult = emptyResult()
    for (const npc of npcs.values()) tickNpc(npc, ctx, npcResult)
    // Between the npcs and the players: a minion summoned this tick has to be on
    // the field before the sessions that mirror it onto their own state.add run.
    stepMinions(ctx, npcResult)
    for (const id of npcResult.npcChanged) npcChanged.add(id)
    for (const id of npcResult.npcRemoved) npcRemoved.add(id)

    for (const player of this.players.values()) {
      const result = tickPlayer(player, ctx)
      if (result.entChanged) {
        this.dirty.add(player.charId)
        playerEnts.set(player.charId, toEntityDiff(player, { pvpZone: this.isPvp }))
      }
      rockChanges.push(...result.rockChanges)
      for (const id of result.npcChanged) npcChanged.add(id)
      hits.push(...result.hits)
      for (const loot of result.newLoot) this.loot.set(loot.id, loot)
      if (result.bankOpen) {
        result.events.push({ e: 'bank', bank: this.bankList(player), open: true })
      }
      if (result.stationOpen) {
        result.events.push({ e: 'station', station: result.stationOpen, open: true })
      }
      if (result.consumed.length > 0) {
        // Items left the pack this tick (craft materials, spell runes) — drain
        // the provenance pools to match, and debounce a durability flush (a
        // consumed save-backed unit must not resurrect on a DO eviction).
        for (const consumed of result.consumed) {
          for (const [itemId, qty] of Object.entries(consumed)) consumeUnits(player.pools, itemId, qty)
        }
        this.scheduleDirtyFlush(player)
      }
      if (result.equipmentDirty) {
        // Ranged ammo was consumed from the equipped slot this tick — snapshot
        // equipment to the save on the next flush so arrows aren't free.
        player.equipmentDirty = true
        this.scheduleDirtyFlush(player)
      }
      for (const kill of result.kills) {
        // Snapshot each credited player's task BEFORE crediting it. Completing a
        // task NULLS it (creditWorldSlayerKill), so read after, the one kill that
        // finishes a task is the one kill that could never roll the task-only
        // drops the task exists to unlock.
        const creditedPlayers = (kill.credited ?? [])
          .filter((charId) => this.players.has(charId))
          .map((charId) => {
            const p = this.players.get(charId)!
            return { charId, slayerTask: p.slayer.task, isGrindman: p.isGrindman === true }
          })
        this.creditKill(kill)
        const isBoss = isBossMonster(kill.monsterId)
        const monsterName = monsterNames[kill.monsterId]?.name ?? kill.monsterId
        if (isBoss) {
          const killerName = this.players.get(kill.owner)?.name ?? 'Someone'
          broadcastEvents.push({ e: 'kill', monster: monsterName, killer: killerName })
        }

        // Everyone past the 10% line rolls the table INDEPENDENTLY, the way a
        // co-op room pays its winners — not a share of one drop. The killer's
        // roll rode the death event and is already on the floor under their own
        // name; the rest are rolled here, where each player's own slayer task
        // and Grindman flag are visible (a task-only drop must not roll for
        // someone who is not on it). Their pile is owned by them, so loot.ts
        // hides it from everyone else for the owner window with nothing new:
        // two piles on one tile, one each.
        const extra = kill.summoned ? [] : rollLootForCredited(kill.monsterId, creditedPlayers, kill.killer)
        for (const share of extra) {
          for (const loot of spawnDrops(share.loot, kill.x, kill.z, share.charId, this.tickCount)) {
            this.loot.set(loot.id, loot)
          }
        }

        // Collection log and audit per player, on their OWN roll: a unique is
        // logged for whoever actually pulled it. Gated on the drop rather than
        // the monster, so an ordinary kill with nothing logged reaches no D1.
        // The killer's own share only counts when they earned the kill — a boss
        // audits even on an empty roll, so a last-hit sniper below the line
        // would otherwise be filed as having killed it.
        const killerShare = (kill.credited ?? []).includes(kill.killer)
          ? [{ charId: kill.killer, loot: kill.loot }]
          : []
        for (const share of [...killerShare, ...extra]) {
          void recordBossKill(this.env, { ...kill, owner: share.charId, loot: share.loot })
          const playerName = this.players.get(share.charId)?.name ?? 'Someone'
          for (const drop of dropBroadcastsFrom(kill.monsterId, share.loot, itemsData)) {
            broadcastEvents.push({
              e: 'uniqueDrop',
              monster: monsterName,
              player: playerName,
              item: itemNameOf(drop.itemId),
              epic: drop.epic,
            })
          }
        }
      }
      if (result.events.length > 0) eventsByChar.set(player.charId, result.events)
      // Settled after this tick's diff goes out (below), never here: every death
      // path either heals the player to full or removes them from `this.players`
      // — and broadcastDiffs only delivers to players still in that map. Settled
      // inline, the killing blow's own splat and the emptied bar were dropped on
      // the floor for the one client that had to see them.
      if (result.died) {
        // Ends here rather than in respawnPlayer: its message goes onto
        // pendingEvents, which is drained into this tick's frame further down —
        // and a death that ejects the player never gets another frame at all.
        endOneLifeRun(player, (id) => flipOneLifeOff(this.env, id))
        deaths.push(player)
      }
    }

    // The Wilderness: duels, bots and the deaths they cause. After the player
    // loop so a fight resolves against this tick's final positions, and before
    // the loot / exit loops below, both of which skip anyone who died.
    this.tickPvp(deaths, playerEnts, hits, eventsByChar, broadcastEvents, botChanged, botRemoved)

    // Who is in a fight, after everything that could start or end one this tick.
    // One pass, one set: `attackerId` is the npc's side of a fight the player's
    // own session may already have dropped (they walked out of reach), and that
    // still counts — walking away from a dragon is not leaving combat.
    const npcAttackerIds = new Set<string>()
    for (const npc of npcs.values()) if (npc.attackerId) npcAttackerIds.add(npc.attackerId)
    for (const player of this.players.values()) {
      player.combatBlockUntilTick = nextCombatBlockUntil(
        player.combatBlockUntilTick,
        this.tickCount,
        isFighting(player, this.tickCount, npcAttackerIds),
      )
    }

    // Damage-contribution readout for every boss fight this tick — gated on an
    // actual change so it doesn't spam once the fight goes quiet (item 11).
    const playerNames = new Map<string, string>()
    for (const p of this.players.values()) playerNames.set(p.charId, p.name)
    for (const npc of npcs.values()) {
      if (npc.state !== 'combat' || !isBossMonster(npc.monsterId)) continue
      const contributors = threatContributors(npc, playerNames)
      const key = threatKey(contributors)
      if (key === npc.lastThreatSent) continue
      npc.lastThreatSent = key
      broadcastEvents.push({ e: 'threat', npcId: npc.id, contributors })
    }

    // Loot pickups resolve after movement (the player may have just arrived).
    // A player who died this tick is skipped by both of the loops here: their
    // death is settled below and would otherwise race a zone transition for the
    // same player — a corpse takes no loot and walks through no doorway.
    for (const player of this.players.values()) {
      if (!deaths.includes(player)) this.tryTakeLoot(player, eventsByChar)
    }

    // Zone exits: standing on an exit tile (even mid-path) leaves this zone.
    const exits = this.zone.exits ?? []
    if (exits.length > 0) {
      for (const player of [...this.players.values()]) {
        if (deaths.includes(player)) continue
        const exit = exits.find((e) => e.x === player.x && e.z === player.z)
        if (exit) void this.transitionPlayer(player, exit)
      }
    }

    // Events queued outside the tick (bank ops, item actions), then the
    // authoritative pack echo for anything that changed the pack, then an HP
    // echo whenever the value this client last saw is stale.
    for (const player of this.players.values()) {
      if (player.pendingEvents.length === 0) continue
      const events = eventsByChar.get(player.charId) ?? []
      events.push(...player.pendingEvents)
      player.pendingEvents = []
      eventsByChar.set(player.charId, events)
    }
    for (const charId of this.pendingInvEcho) {
      const player = this.players.get(charId)
      if (!player) continue
      const events = eventsByChar.get(charId) ?? []
      events.push({ e: 'inv', inventory: player.inventory })
      eventsByChar.set(charId, events)
    }
    this.pendingInvEcho.clear()
    for (const player of this.players.values()) {
      // A death carries its own 0 (stepCombat) — take the reading without
      // echoing it twice, so the respawn's full bar still counts as a change.
      if (deaths.includes(player)) player.lastHpSent = 0
      if (player.hp === player.lastHpSent) continue
      player.lastHpSent = player.hp
      const events = eventsByChar.get(player.charId) ?? []
      events.push({ e: 'hp', hp: player.hp, maxHp: player.maxHp })
      eventsByChar.set(player.charId, events)
    }
    for (const [id, loot] of this.loot) if (isExpired(loot, this.tickCount)) this.loot.delete(id)

    const npcEnts: EntityDiff[] = []
    for (const id of npcChanged) {
      const npc = npcs.get(id)
      if (npc && !npcRemoved.has(id)) npcEnts.push(toNpcDiff(npc))
    }
    const botEnts: EntityDiff[] = []
    for (const id of botChanged) {
      const bot = this.bots.get(id)
      if (bot && !botRemoved.has(id)) botEnts.push(toBotDiff(bot))
    }
    const ents = [...playerEnts.values(), ...npcEnts, ...botEnts]
    this.broadcastDiffs(ents, rockChanges, [...npcRemoved, ...playersRemoved, ...botRemoved], hits, [...chatEvents, ...broadcastEvents], eventsByChar)

    // The death frame is out; now respawn (or eject) them.
    for (const player of deaths) this.respawnPlayer(player)

    if (this.tickCount % HP_REGEN_EVERY_TICKS === 0) {
      for (const player of this.players.values()) if (player.hp < player.maxHp) player.hp += 1
    }
    for (const player of this.players.values()) {
      if (player.flushAtTick !== null && this.tickCount >= player.flushAtTick) {
        player.flushAtTick = null
        void this.flush(player, 'timer')
      }
    }
    if (this.tickCount % CHECKPOINT_EVERY_TICKS === 0) {
      if (this.dirty.size > 0) void this.flushCheckpoints()
      for (const player of this.players.values()) {
        void this.flush(player, 'timer')
        // Keep the world-session lock fresh (TTL self-heals a dead DO). Skip
        // lingering players — a backgrounded tab shouldn't hold the idle game
        // out; if they never reconnect, linger expiry ends the session anyway.
        // A combat linger is the exception: that body is still in a fight it
        // can lose, so the world must keep owning its save until it is settled.
        const held = player.lingerUntilTick === null || logoutBlocked(player.combatBlockUntilTick, this.tickCount)
        if (held) void refreshWorldSession(this.env, Number(player.charId), player.sessionId)
      }
    }
  }

  /** Hands the player to another zone. The save flush and the position row
   * (written with the TARGET zone/tile) must both be durable before the client
   * hears `transition` — its next hello reads them from D1. */
  private async transitionPlayer(player: Player, exit: ZoneExitDef): Promise<void> {
    this.players.delete(player.charId)
    this.dirty.delete(player.charId)
    this.pendingLeaves.add(player.charId)
    this.releaseAggro(player.charId)
    this.maybeStopTicking()
    await this.flush(player, 'transition')
    await this.env.DB.prepare(
      `INSERT INTO world_positions (character_id, zone_id, x, z, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id, x = excluded.x, z = excluded.z, updated_at = excluded.updated_at`
    ).bind(Number(player.charId), exit.toZone, exit.toX, exit.toZ, Date.now()).run()
    send(player.conn, { t: 'transition', zone: exit.toZone, x: exit.toX, z: exit.toZ })
    player.conn.close(1000, 'transition')
  }

  /** Runs after the death tick's diff has been broadcast, so the client has
   * already seen the killing blow and an empty bar. */
  private respawnPlayer(player: Player): void {
    // Item 10: a zone can require dying to be a real trip back out (e.g. the
    // dungeon respawns at Varrick's entrance, not its own spawn ~40 tiles from
    // the bosses) — cross-zone, so it's the same DB update + reconnect the
    // walk-onto-an-exit transition uses, not a same-zone teleport.
    const deathRespawn = this.zone.deathRespawn
    if (deathRespawn) {
      void this.respawnAcrossZone(player, deathRespawn)
      return
    }
    // An instanced boss lair is closed, but dying no longer respawns you back
    // in front of the boss to keep swinging — it ends this player's part of
    // the fight. Ejects them out of the room entirely and hands the client a
    // choice screen (a fresh instance of the same lair, or the idle game)
    // instead of silently reopening the fight.
    if (isInstancedRoom(this.name)) {
      void this.ejectFromInstanceDeath(player)
      return
    }
    const spawn = this.zone.spawn
    player.x = spawn.x
    player.z = spawn.z
    player.hp = player.maxHp
    player.path = []
    this.clearIntents(player)
    player.anim = 'idle'
    send(player.conn, { t: 'dead', respawn: { x: spawn.x, z: spawn.z } })
    this.dirty.add(player.charId)
    // This tick's ents are already sent, so the respawned pose rides the next
    // one — the same queue a joining player's first ent goes out on.
    this.pendingJoins.add(player.charId)
  }

  private async respawnAcrossZone(player: Player, target: { zone: string; x: number; z: number }): Promise<void> {
    this.players.delete(player.charId)
    this.dirty.delete(player.charId)
    this.pendingLeaves.add(player.charId)
    this.releaseAggro(player.charId)
    this.maybeStopTicking()
    player.hp = player.maxHp
    await this.flush(player, 'transition')
    await this.env.DB.prepare(
      `INSERT INTO world_positions (character_id, zone_id, x, z, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id, x = excluded.x, z = excluded.z, updated_at = excluded.updated_at`
    ).bind(Number(player.charId), target.zone, target.x, target.z, Date.now()).run()
    send(player.conn, { t: 'dead', respawn: { x: target.x, z: target.z } })
    send(player.conn, { t: 'transition', zone: target.zone, x: target.x, z: target.z })
    player.conn.close(1000, 'death')
  }

  /** A death in an instanced boss lair ends the player's part of that fight —
   * they leave the room entirely rather than respawning back in front of the
   * boss. Checkpoints them at the lair's own exit (so a stray reconnect lands
   * safely in the overworld, never stuck in a closed room) and releases the
   * world-session save lock like an explicit logout: unlike a same-app zone
   * transition, the player isn't continuing a session inside this world app —
   * whatever they pick on the choice screen re-enters through a fresh
   * `/api/world-token` handoff. Closes with 1008 (not 1000) so partysocket's
   * own reconnect-on-close never re-opens this room out from under the
   * overlay the client is about to show. */
  private async ejectFromInstanceDeath(player: Player): Promise<void> {
    const charId = player.charId
    this.players.delete(charId)
    this.dirty.delete(charId)
    this.pendingLeaves.add(charId)
    this.releaseAggro(charId)
    this.maybeStopTicking()
    player.hp = player.maxHp
    const target = instanceDeathEjectTarget(this.zone, overworldZone.spawn)
    await this.flush(player, 'disconnect')
    await this.env.DB.prepare(
      `INSERT INTO world_positions (character_id, zone_id, x, z, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id, x = excluded.x, z = excluded.z, updated_at = excluded.updated_at`
    ).bind(Number(charId), target.zone, target.x, target.z, Date.now()).run()
    await endWorldSession(this.env, Number(charId), player.sessionId)
    send(player.conn, { t: 'instanceDeath', zone: baseRoomZone(this.name), zoneName: this.zone.name })
    player.conn.close(1008, 'instance_death')
  }

  /** Resolves a walked-over loot pickup: adds it to the pack, records it as a
   * world-minted unit (so it survives every flush — the inventory-first rule),
   * and removes the entity. Full pack → message, loot stays. */
  private tryTakeLoot(player: Player, eventsByChar: Map<string, ZoneEvent[]>): void {
    const pending = player.pendingLoot
    if (!pending || player.path.length > 0) return
    const loot = this.loot.get(pending.id)
    const viewer = lootViewer(player)
    if (!loot || !isVisibleTo(loot, viewer, this.tickCount) || player.x !== loot.x || player.z !== loot.z) {
      player.pendingLoot = null
      return
    }
    const events = eventsByChar.get(player.charId) ?? []
    if (!mayTake(loot, viewer)) {
      console.warn('[World][loot] refused restricted-account pickup of unowned loot', {
        charId: player.charId, isIronman: player.isIronman, isGrindman: player.isGrindman,
        lootId: loot.id, itemId: loot.itemId, ownerCharId: loot.ownerCharId,
      })
      events.push({ e: 'msg', text: ownLootOnlyMessage(viewer) })
      player.pendingLoot = null
      if (!eventsByChar.has(player.charId)) eventsByChar.set(player.charId, events)
      return
    }
    if (takeLoot(player.inventory, player.minted, loot.itemId, loot.qty)) {
      this.loot.delete(loot.id)
      events.push({ e: 'inv', inventory: player.inventory })
    } else {
      events.push({ e: 'msg', text: 'Your pack is full.' })
    }
    player.pendingLoot = null
    if (!eventsByChar.has(player.charId)) eventsByChar.set(player.charId, events)
  }

  private broadcastDiffs(
    ents: EntityDiff[],
    rockChanges: { id: string; depleted: boolean }[],
    removed: string[],
    hits: { targetId: string; dmg: number }[],
    zoneEvents: ZoneEvent[],
    eventsByChar: Map<string, ZoneEvent[]>
  ): void {
    const hitEvents: ZoneEvent[] = hits.map((h) => ({ e: 'hit', targetId: h.targetId, dmg: h.dmg }))
    // AOI setup (only when the zone opts in): every live entity's position, this
    // tick's diffs by id, and a full-diff builder for entities entering range.
    const aoiRadius = this.zone.aoiRadius
    let aoiEntities: AoiEntity[] = []
    let changedById: Map<string, EntityDiff> = new Map()
    if (aoiRadius != null) {
      const removedSet = new Set(removed)
      for (const p of this.players.values()) if (!removedSet.has(p.charId)) aoiEntities.push({ id: p.charId, x: p.x, z: p.z })
      for (const n of this.ensureNpcs().values()) if (n.state !== 'dead' && !removedSet.has(n.id)) aoiEntities.push({ id: n.id, x: n.x, z: n.z })
      for (const b of this.bots.values()) if (b.state === 'alive' && !removedSet.has(b.charId)) aoiEntities.push({ id: b.charId, x: b.x, z: b.z })
      changedById = new Map(ents.map((e) => [e.id, e]))
    }
    for (const player of this.players.values()) {
      // Lingering players have a closed socket — their ent still rides `ents` to
      // everyone else, but there's nobody to receive a diff here.
      if (player.lingerUntilTick !== null) continue
      const visible = visibleLootFor(this.loot.values(), lootViewer(player), this.tickCount)
      const visibleIds = new Set(visible.map((l) => l.id))
      const lootAdded: LootItem[] = visible.filter((l) => !player.lootView.has(l.id))
      const lootRemoved: string[] = [...player.lootView].filter((id) => !visibleIds.has(id))
      player.lootView = visibleIds

      // Whole-view by default; AOI narrows ents/removed to the player's radius.
      let outEnts = ents
      let outRemoved = removed
      if (aoiRadius != null) {
        const slice = computeAoi(
          player.x, player.z, player.charId, aoiRadius, aoiEntities, changedById,
          (id) => {
            const p = this.players.get(id)
            if (p) return toEntityDiff(p, { pvpZone: this.isPvp })
            const b = this.bots.get(id)
            if (b) return toBotDiff(b)
            const n = this.npcs?.get(id)
            return n ? toNpcDiff(n) : null
          },
          player.entView,
        )
        player.entView = slice.view
        outEnts = slice.ents
        outRemoved = removed.length > 0 ? [...removed, ...slice.removed] : slice.removed
      }

      const events: ZoneEvent[] = []
      const own = eventsByChar.get(player.charId)
      if (own) events.push(...own)
      if (hitEvents.length > 0) events.push(...hitEvents)
      if (zoneEvents.length > 0) events.push(...zoneEvents)

      const message: Extract<ServerMessage, { t: 'diff' }> = { t: 'diff', tick: this.tickCount }
      if (outEnts.length > 0) message.ents = outEnts
      if (rockChanges.length > 0) message.rocks = rockChanges
      if (outRemoved.length > 0) message.removed = outRemoved
      if (lootAdded.length > 0) message.loot = lootAdded
      if (lootRemoved.length > 0) message.lootRemoved = lootRemoved
      if (events.length > 0) message.events = events

      if (message.ents || message.rocks || message.removed || message.loot || message.lootRemoved || message.events) {
        send(player.conn, message)
      }
    }
  }

  /**
   * Everything a kill is worth beyond its loot, for the character it was
   * attributed to: the kill count, their own slayer task, and the daily tasks
   * the kill feeds. All three are tallied on the session and flushed in a batch
   * — one D1 round trip per kill is not affordable on a grind (killProgress.ts).
   *
   * Paid to EVERY player who earned the kill on the shared 10% damage share
   * (`kill.credited`, killCredit.js), not just the one the loot pile went to —
   * the same rule a co-op room pays on, so a boss fought by three people counts
   * for three slayer tasks in both places. Their drops are rolled separately
   * (the kill loop above), one pile each on the same tile.
   *
   * Someone who has already left the zone takes no credit: their session (and
   * its slayer task) is gone.
   *
   * A boss MINION earns none of it (§4: adds count for nothing). Out here they
   * are real npcs rather than session-local adds, so they reach the kill list
   * like anything else — and a boss that respawns its sentinels on a timer would
   * otherwise be a kill-count and daily-task farm that never touches the boss.
   */
  private creditKill(kill: { monsterId: string; owner: string; credited: string[]; summoned?: boolean }): void {
    if (kill.summoned) return
    for (const charId of kill.credited ?? []) {
      const player = this.players.get(charId)
      if (!player) continue
      player.killTally[kill.monsterId] = (player.killTally[kill.monsterId] ?? 0) + 1

      const credited = creditWorldSlayerKill(player.slayer, kill.monsterId)
      if (!credited) continue
      if (credited.slayerXp > 0) player.pendingEvents.push(...grantSessionXp(player, 'slayer', credited.slayerXp))
      player.pendingEvents.push({ e: 'msg', text: credited.message })
      if (credited.completed) player.dailyEvents.push({ kind: 'slayer_task_complete', count: 1 })
      // Every credited kill re-arms the flush debounce, not just a completion —
      // it used to be the one case that flushed early, leaving a plain progress
      // tick (7→6) waiting on the 60s checkpoint, where a DO eviction would cost
      // it and — with no in-progress task UI in the world at all — a player
      // checking the idle tab would see nothing move. A kill streak faster than
      // DIRTY_FLUSH_DELAY_TICKS keeps re-arming this and rides the checkpoint
      // instead, same worst case as before; the debounce only helps once kills
      // (or any other flush-triggering change) stop landing that fast.
      if (slayerCreditNeedsFlush(credited)) this.scheduleDirtyFlush(player)
    }
  }

  /** Snapshots and clears the player's pending grant tallies, then applies
   * them to the save blob. Every flush carries XP, consumed units (eaten,
   * buried, dropped, equipped), bank deposits, the world-minted units the pack
   * has picked up (mined, looted, taken off) and — when the player re-geared —
   * the equipment snapshot. A disconnect additionally returns withdrawn bank
   * units still held (bank → inventory); remaining save-backed units simply
   * stay in the save's inventory where they always were. On failure the
   * snapshot merges back so the next flush retries it.
   *
   * Minted units ride EVERY flush, not just the disconnect: they are the one
   * pool with no copy outside this DO's memory, so deferring them meant a
   * session that ended without a clean disconnect flush deleted them outright
   * (see sessionItems.ts). Their reclassification to save-backed happens only
   * after the grant is known to have landed. */
  private async flush(player: Player, reason: GrantPayload['reason']): Promise<void> {
    const pools = player.pools
    const drained = drainForFlush(pools, reason)
    const payload: GrantPayload = {
      xpBySkill: player.pendingXp,
      itemsTo: 'inventory',
      reason,
      ...drained,
    }
    player.pendingXp = {}
    const slayerDrained = drainSlayerCredit(player.slayer)
    if (slayerDrained) Object.assign(payload, slayerDrained)
    const killTally = player.killTally
    player.killTally = {}
    const dailyEvents = [...player.dailyEvents, ...killDailyEvents(killTally), ...xpDailyEvents(payload.xpBySkill)]
    player.dailyEvents = []
    const equipmentWasDirty = player.equipmentDirty
    if (equipmentWasDirty) {
      payload.equipment = { ...player.equipment }
      player.equipmentDirty = false
    }
    const stanceWasDirty = player.stanceDirty
    if (stanceWasDirty) {
      payload.combatStance = player.stance
      player.stanceDirty = false
    }
    // Kill counts and daily tasks are their own tables, not the save — a flush
    // carrying nothing but kills still has to land them.
    if (isEmptyPayload(payload)) {
      this.flushProgress(player, killTally, dailyEvents)
      return
    }
    player.flushSeq += 1

    const ok = await flushGrants(this.env, {
      charId: Number(player.charId),
      identityId: player.identityId,
      sessionId: player.sessionId,
      flushSeq: player.flushSeq,
    }, payload)
    if (ok) {
      commitFlush(pools, drained)
      this.flushProgress(player, killTally, dailyEvents)
    } else {
      // A dropped payload is real lost progress and is otherwise completely
      // invisible — `wrangler tail` is the only place this surfaces.
      console.error('[World][flush] grant not applied, re-queued', {
        charId: player.charId, zone: this.name, reason, flushSeq: player.flushSeq,
      })
      for (const [skill, amount] of Object.entries(payload.xpBySkill)) {
        player.pendingXp[skill] = (player.pendingXp[skill] ?? 0) + amount
      }
      restoreFlush(pools, drained)
      if (equipmentWasDirty) player.equipmentDirty = true
      if (stanceWasDirty) player.stanceDirty = true
      restoreSlayerCredit(player.slayer, slayerDrained)
      // The XP went back on the pile, so its daily events must too — re-derived
      // from the restored tally on the next flush rather than double-counted
      // here. Kills go back the same way.
      for (const [monsterId, count] of Object.entries(killTally)) {
        player.killTally[monsterId] = (player.killTally[monsterId] ?? 0) + count
      }
      player.dailyEvents.unshift(...dailyEvents.filter((evt) => evt.kind === 'slayer_task_complete'))
    }
  }

  /** Kill counts + daily-task progress for a flush that has already landed.
   * Both are additive writes to their own tables, so unlike the grant they need
   * no revision guard — and both are fire-and-forget: a D1 hiccup here must not
   * hold up the tick loop or roll back a save write that already succeeded. */
  private flushProgress(player: Player, killTally: Record<string, number>, dailyEvents: DailyEvent[]): void {
    if (Object.keys(killTally).length > 0) {
      void recordKillCounts(this.env, Number(player.charId), killTally).catch((err) => {
        console.error('[World][flush] kill counts not recorded', { charId: player.charId, err })
      })
    }
    if (dailyEvents.length === 0) return
    void applyDailyTaskEvents(this.env, {
      characterId: Number(player.charId),
      identityId: player.identityId,
      events: dailyEvents,
    }).catch((err) => {
      console.error('[World][flush] daily task progress not applied', { charId: player.charId, err })
    })
  }

  private async flushCheckpoints(): Promise<void> {
    const charIds = [...this.dirty]
    this.dirty.clear()
    const now = Date.now()
    const statements = charIds
      .map((id) => this.players.get(id))
      .filter((p): p is Player => Boolean(p))
      .map((p) =>
        this.env.DB.prepare(
          `INSERT INTO world_positions (character_id, zone_id, x, z, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id, x = excluded.x, z = excluded.z, updated_at = excluded.updated_at`
        ).bind(Number(p.charId), this.name, p.x, p.z, now)
      )
    if (statements.length > 0) await this.env.DB.batch(statements)
  }

  private async checkpointPlayer(player: Player): Promise<void> {
    const now = Date.now()
    await this.env.DB.prepare(
      `INSERT INTO world_positions (character_id, zone_id, x, z, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id, x = excluded.x, z = excluded.z, updated_at = excluded.updated_at`
    ).bind(Number(player.charId), this.name, player.x, player.z, now).run()
  }
}
