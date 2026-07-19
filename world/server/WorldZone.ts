import { Server, type Connection as PartyConnection } from 'partyserver'
import { verifyJWT } from '../../functions/_lib/jwt.js'
import { findPath, findPathAdjacent } from './pathfind'
import {
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
import { resolveCombatSetup, isSameFightTarget, playerAttackRange, emitPrayerIfChanged, startCombat } from './combat'
import { seedPrayer, resolvePrayerToggle } from '../shared/prayer'
import spellsJson from '../../src/data/spells.json'
import { npcsFromZone, pickAggroTarget, reselectAttacker, threatContributors, threatKey, tickNpc, toNpcDiff, type NpcState } from './npc'
import { PLAYER_DROP_OWNER_TICKS, isExpired, isVisibleTo, spawnDrops, takeLoot, visibleLootFor, type LootEntity } from './loot'
import { sanitizeChat } from '../shared/chat'
import { addToInventory, countItem, freeSlotCount, inventoryIsFull, isStackable, moveInventorySlot, removeItems, removeOneAt } from './mining'
import { getLevelFromXP } from '../../src/engine/experience.js'
import { flushGrants, isEmptyPayload, type GrantPayload, type ItemStack } from './grants'
import { isBossMonster, recordBossKill, uniqueDropsFrom } from './bossKills'
import monstersDataJson from '../../src/data/monsters.json'

type MonsterNames = Record<string, { name?: string } | undefined>
const monsterNames = monstersDataJson as MonsterNames
import { isCharacterInActiveMatch } from './pvpLock'
import { beginWorldSession, refreshWorldSession, endWorldSession } from '../../functions/_lib/game/worldSessions.js'
import { loadCharacterWithSave } from '../../functions/_lib/game/save.js'
import { type ZoneDef, type ZoneExitDef } from '../shared/zone'
import { ZONES } from './zones'
import { loadStoredZone } from './zoneStore'
import { gearFromEquipment } from '../shared/appearance'
import { BURY_XP, healAmount, primaryInvAction, resolveEatTiming, resolveDrink } from '../shared/itemActions'
import { checkEquipRequirements, equipItem, placeUnequippedItems } from '../../src/engine/equipment.js'
import { applyEat, applyCombo } from '../../src/engine/combat.js'
import { isComboConsumable } from '../../src/engine/consumables.js'
import itemsData from '../../src/data/items.json'
import { consumeUnits, depositUnits, emptyPools, mintUnits, withdrawUnits, type ItemPools, type Tally } from './sessionItems'
import { grantSessionXp, cutPathToRange, withinRange } from './tick'
import type { BankSlot, ClientMessage, EntityDiff, LootItem, ServerMessage, StaticObject, ZoneEvent } from '../shared/protocol'
import { parseClientMessage } from '../shared/protocol'
import type { Env } from './env'

type ConnState = { charId: string | null }
type Connection = PartyConnection<ConnState>
import pastureZone from '../zones/pasture.json'

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
// A dropped socket lingers this long before the player really leaves the zone.
// Backgrounding a browser tab drops the socket in ~10s; without a grace period
// others would see the player vanish that fast. 100 ticks ≈ 60s.
const LINGER_TICKS = 100

type Player = TickPlayer & {
  conn: Connection
  lastMsgTimes: number[]
  identityId: string
  sessionId: string
  flushSeq: number
  /** Provenance pools for every unit in the pack (see sessionItems.ts).
   * pools.minted IS the TickPlayer.minted record — one object, two views. */
  pools: ItemPools
  /** Live session view of the save's bank (quantities only; charge-carrying
   * entries are excluded — the world can't preserve charges). */
  bankView: Tally
  completedQuests: Set<string>
  /** The player re-geared in-world → next flush snapshots equipment to the save. */
  equipmentDirty: boolean
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
  /** Set when the socket drops: the player lingers in-world (visible to others,
   * frozen) until this tick, then is really removed + flushed. Cleared on
   * reconnect. Null = connected. Backgrounding a tab must not kick you instantly. */
  lingerUntilTick: number | null
}

type Items = Record<string, { name?: string; slot?: string | null; type?: string } | undefined>
const items = itemsData as unknown as Items

function itemNameOf(itemId: string): string {
  return items[itemId]?.name ?? itemId
}

/** Ticks between a bank/equip mutation and its durability flush (debounced). */
const DIRTY_FLUSH_DELAY_TICKS = 5

function toItemList(record: Record<string, number>): ItemStack[] {
  return Object.entries(record)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }))
}

function mergeInto(target: Record<string, number>, items: ItemStack[]): void {
  for (const item of items) target[item.itemId] = (target[item.itemId] ?? 0) + item.quantity
}

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
    return this.loadedZone ?? ZONES[this.name] ?? (pastureZone as ZoneDef)
  }

  /** Resolves and caches this DO's zone def once: stored D1 def first, else the
   * bundled def, else null (unknown zone → connection rejected). Concurrent
   * connects share one in-flight load. */
  private async resolveZone(): Promise<ZoneDef | null> {
    if (this.loadedZone) return this.loadedZone
    if (!this.zoneLoadPromise) {
      this.zoneLoadPromise = (async () => {
        const stored = await loadStoredZone(this.env.DB, this.name).catch(() => null)
        return stored ?? ZONES[this.name] ?? null
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
          .filter((o) => (o.type === 'rock' && o.rock) || (o.type === 'tree' && o.tree))
          .map((o) => [o.id, {
            id: o.id,
            rock: o.type === 'tree' ? o.tree! : o.rock!,
            skill: o.type === 'tree' ? 'woodcutting' as const : 'mining' as const,
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

  async onConnect(connection: Connection): Promise<void> {
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
    this.releaseAggro(charId)
    player.path = []
    this.clearIntents(player)
    player.anim = 'idle'
    player.running = false
    player.lingerUntilTick = this.tickCount + LINGER_TICKS
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
    this.players.delete(charId)
    this.dirty.delete(charId)
    this.pendingLeaves.add(charId)
    this.maybeStopTicking()
    await this.flush(player, 'disconnect')
    await this.checkpointPlayer(player)
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
      'SELECT id, username FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(payload.character_id, payload.sub).first<{ id: number; username: string }>()
    if (!row) {
      connection.close(1008, 'character_not_found')
      return
    }

    // Never enter the world while a PvP match is active — the world flush path
    // mutates the save and would bypass the match's save-lockdown (§10/§14).
    if (await isCharacterInActiveMatch(this.env, row.id)) {
      connection.close(1008, 'in_active_match')
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
      existing.anim = 'idle'
      existing.conn = connection
      existing.lastMsgTimes = []
      existing.lingerUntilTick = null
      connection.setState({ charId: liveCharId })
      void beginWorldSession(this.env, row.id, existing.sessionId)
      this.sendWelcome(existing)
      this.pendingJoins.add(liveCharId)
      this.ensureTicking()
      return
    }

    let stats
    let seeded
    let equipment: Record<string, unknown> = {}
    let maxHp = 10
    let bankView: Tally = {}
    let completedQuests = new Set<string>()
    try {
      const { saveObject } = await loadCharacterWithSave(this.env, row.id, payload.sub)
      stats = sessionStatsFromSave(saveObject)
      seeded = sessionInventoryFromSave(saveObject)
      equipment = (saveObject.equipment ?? {}) as Record<string, unknown>
      const hpEntry = (saveObject.stats as Record<string, { xp?: number; level?: number }> | undefined)?.hitpoints
      maxHp = Number(hpEntry?.level) || getLevelFromXP(Number(hpEntry?.xp) || 0) || 10
      bankView = bankViewFromSave(saveObject)
      const questList = (saveObject.settings as { completedQuests?: unknown } | undefined)?.completedQuests
      completedQuests = new Set(Array.isArray(questList) ? questList.filter((q): q is string => typeof q === 'string') : [])
    } catch {
      connection.close(1008, 'character_not_found')
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
      sessionId: crypto.randomUUID(),
      flushSeq: 0,
      pools,
      bankView,
      completedQuests,
      equipmentDirty: false,
      flushAtTick: null,
      lastHpSent: maxHp,
      eatReadyTick: 0,
      comboReadyTick: 0,
      pendingEvents: [],
      pendingLoot: null,
      lootView: new Set(),
      running: false,
      runEnergy: 100,
      lastRunSent: 100,
      stance: 'accurate',
      spell: null,
      specialEnergy: 100,
      lastSpecSent: 100,
      ...seedPrayer(stats.prayer?.level ?? getLevelFromXP(Number(stats.prayer?.xp) || 0) ?? 1),
      lastPrayerSent: null,
      activePotions: {},
      lingerUntilTick: null,
    }
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
        id: this.zone.id,
        name: this.zone.name,
        w: this.zone.width,
        h: this.zone.height,
        collision: this.zone.collision,
        ...(this.zone.exits?.length ? { exits: this.zone.exits.map((e) => ({ id: e.id, x: e.x, z: e.z, label: e.label })) } : {}),
        ...(this.zone.props?.length ? { props: this.zone.props } : {}),
        ...(this.zone.palette ? { palette: this.zone.palette } : {}),
        ...(this.zone.ambience ? { ambience: this.zone.ambience } : {}),
        ...(this.zone.ambient ? { ambient: this.zone.ambient } : {}),
        ...(this.zone.terrain ? { terrain: this.zone.terrain } : {}),
        ...(this.zone.ground?.length ? { ground: this.zone.ground } : {}),
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
    const otherEnts = [...this.players.values()]
      .filter((p) => p.charId !== player.charId)
      .map((p) => toEntityDiff(p))
    const visibleLoot = visibleLootFor(this.loot.values(), player.charId, this.tickCount)
    player.lootView = new Set(visibleLoot.map((l) => l.id))
    const intro: Extract<ServerMessage, { t: 'diff' }> = { t: 'diff', tick: this.tickCount }
    if (depleted.length > 0) intro.rocks = depleted
    if (npcEnts.length > 0 || otherEnts.length > 0) intro.ents = [...otherEnts, ...npcEnts]
    if (visibleLoot.length > 0) intro.loot = visibleLoot
    if (intro.rocks || intro.ents || intro.loot) send(player.conn, intro)
  }

  private handleAuthedMessage(player: Player, message: ClientMessage): void {
    switch (message.t) {
      case 'walk': {
        const path = findPath(this.zone.collision, { x: player.x, z: player.z }, { x: message.x, z: message.z })
        player.path = path ? path.slice(1) : []
        // Keep the combat session across a walk so a ranged/magic foe keeps
        // attacking a fleeing player and the engine's attack timers aren't reset
        // each step; stepCombat ends it once the player is beyond every reach.
        this.clearIntents(player, true)
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
        if (text) this.pendingChat.push({ e: 'chat', charId: player.charId, name: player.name, text })
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
        // Apply mid-fight too — the engine reads stance each tick.
        if (player.combat) player.combat.state.stance = message.stance
        break
      case 'setSpell':
        this.handleSetSpell(player, message.spell)
        break
      case 'special':
        // Queue the weapon's special for the next combat tick (engine checks
        // energy + weapon and drains on fire). Ignored out of combat.
        if (player.combat) player.combat.state.specialAttackQueued = true
        else player.pendingEvents.push({ e: 'msg', text: 'You need to be fighting to use a special attack.' })
        break
      case 'pray':
        this.handlePray(player, message.prayerId)
        break
      case 'unequip':
        this.handleUnequip(player, message.slot)
        break
      case 'logout':
        void this.logout(player)
        break
      case 'hello':
        break
    }
  }

  /** Explicit logout: remove the player now (no linger), flush + checkpoint, tell
   * others they left, and close the socket. The client clears its session. */
  private async logout(player: Player): Promise<void> {
    const conn = player.conn
    await this.removeAndFlush(player)
    send(conn, { t: 'error', code: 'logged_out', msg: 'You have left the world.' })
    conn.close(1000, 'logout')
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
      const [loot] = spawnDrops([{ itemId, quantity: qty }], player.x, player.z, player.charId, this.tickCount, PLAYER_DROP_OWNER_TICKS)
      if (loot) this.loot.set(loot.id, loot)
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
   * session's Magic level; applies to an active magic fight immediately. */
  private handleSetSpell(player: Player, spellId: string | null): void {
    if (spellId !== null) {
      const spell = (spellsJson as Record<string, { name?: string; levelReq?: number } | undefined>)[spellId]
      if (!spell) return
      const magicLevel = player.stats.magic?.level ?? 1
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

  private clearIntents(player: Player, keepCombat = false): void {
    player.pendingInteract = null
    player.mining = null
    player.crafting = null
    if (!keepCombat) player.combat = null
    player.pendingLoot = null
  }

  private handleInteract(player: Player, message: Extract<ClientMessage, { t: 'interact' }>): void {
    // Loot pickup paths ONTO the tile (not adjacent) and resolves on arrival.
    if (message.kind === 'loot' && message.action === 'take') {
      const loot = this.loot.get(message.id)
      if (!loot) return
      const path = findPath(this.zone.collision, { x: player.x, z: player.z }, { x: loot.x, z: loot.z })
      if (!path) return
      player.path = path.slice(1)
      this.clearIntents(player)
      player.pendingLoot = { id: loot.id, x: loot.x, z: loot.z }
      return
    }

    let target: { x: number; z: number } | null = null
    let intent: Player['pendingInteract'] = null

    if (message.kind === 'rock' && (message.action === 'mine' || message.action === 'chop')) {
      // startInteract re-validates the verb against the node's skill.
      const rock = this.ensureRocks().get(message.id)
      if (!rock) return
      target = rock
      intent = { kind: 'rock', id: rock.id, action: message.action }
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

  private ensureTicking(): void {
    if (this.tickTimer) return
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
  }

  private maybeStopTicking(): void {
    if (this.players.size === 0 && this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  private tick(): void {
    this.tickCount += 1

    // Expire lingering (disconnected) players whose grace period is up: remove
    // them for real, flush their pack/XP, and broadcast the leave. Done first
    // so the tick below never processes an already-gone player.
    for (const player of [...this.players.values()]) {
      if (player.lingerUntilTick !== null && this.tickCount >= player.lingerUntilTick) {
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
      pathAdjacent: (from, to) => findPathAdjacent(this.zone.collision, from, to),
      players: positions,
    }

    const rockChanges = respawnedRocks(rocks, this.tickCount)
    const npcChanged = new Set<string>()
    const npcRemoved = new Set<string>()
    const hits: { targetId: string; dmg: number }[] = []
    const eventsByChar = new Map<string, ZoneEvent[]>()
    // Player ents deduped by id (last write wins — e.g. a death-tick respawn).
    const playerEnts = new Map<string, EntityDiff>()

    // Presence edges queued since the last tick. A leave only broadcasts if
    // the player is really gone (a same-tick rejoin keeps them present).
    for (const id of this.pendingJoins) {
      const joined = this.players.get(id)
      if (joined) playerEnts.set(id, toEntityDiff(joined))
    }
    this.pendingJoins.clear()
    if (this.tickCount % PRESENCE_KEYFRAME_TICKS === 0) {
      for (const p of this.players.values()) playerEnts.set(p.charId, toEntityDiff(p))
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
      for (const p of this.players.values()) if (p.combat?.npcId === npc.id) engaged.push({ charId: p.charId, x: p.x, z: p.z })
      reselectAttacker(npc, engaged, this.zone.collision)
    }

    // Aggressive idle npcs (bosses by default) pull the nearest unengaged player
    // in radius + sight into combat — you can't stroll past Grondar unbothered.
    // Force-starting the player's combat is what lets the engine roll the
    // monster's swings against them (item 9).
    const aggroCandidates = [...this.players.values()].map((p) => ({ charId: p.charId, x: p.x, z: p.z, inCombat: !!p.combat }))
    for (const npc of npcs.values()) {
      const targetId = pickAggroTarget(npc, aggroCandidates, this.zone.collision)
      if (!targetId) continue
      const target = this.players.get(targetId)
      // Live re-check: the snapshot is from before this loop, so a player pulled
      // by an earlier npc this tick must not be yanked into a second fight.
      if (!target || target.combat) continue
      startCombat(target, npc)
      if (target.combat) {
        npcChanged.add(npc.id)
        playerEnts.set(target.charId, toEntityDiff(target))
      }
    }

    // NPCs first (wander/respawn/heal) so player combat this tick reads fresh state.
    const npcResult = emptyResult()
    for (const npc of npcs.values()) tickNpc(npc, ctx, npcResult)
    for (const id of npcResult.npcChanged) npcChanged.add(id)
    for (const id of npcResult.npcRemoved) npcRemoved.add(id)

    for (const player of this.players.values()) {
      const result = tickPlayer(player, ctx)
      if (result.entChanged) {
        this.dirty.add(player.charId)
        playerEnts.set(player.charId, toEntityDiff(player))
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
        // Server-authoritative boss side-effects (collection log, kill count,
        // audit) — fire-and-forget D1 like the flushes below. No-op for
        // non-boss monsters.
        void recordBossKill(this.env, kill)
        if (!isBossMonster(kill.monsterId)) continue
        const monsterName = monsterNames[kill.monsterId]?.name ?? kill.monsterId
        const killerName = this.players.get(kill.owner)?.name ?? 'Someone'
        broadcastEvents.push({ e: 'kill', monster: monsterName, killer: killerName })
        for (const itemId of uniqueDropsFrom(kill.monsterId, kill.loot)) {
          broadcastEvents.push({ e: 'uniqueDrop', monster: monsterName, player: killerName, item: itemNameOf(itemId) })
        }
      }
      if (result.events.length > 0) eventsByChar.set(player.charId, result.events)
      if (result.died) this.respawnPlayer(player, playerEnts)
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
    for (const player of this.players.values()) this.tryTakeLoot(player, eventsByChar)

    // Zone exits: standing on an exit tile (even mid-path) leaves this zone.
    const exits = this.zone.exits ?? []
    if (exits.length > 0) {
      for (const player of [...this.players.values()]) {
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
    const ents = [...playerEnts.values(), ...npcEnts]
    this.broadcastDiffs(ents, rockChanges, [...npcRemoved, ...playersRemoved], hits, [...chatEvents, ...broadcastEvents], eventsByChar)

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
        if (player.lingerUntilTick === null) void refreshWorldSession(this.env, Number(player.charId), player.sessionId)
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

  private respawnPlayer(player: Player, playerEnts: Map<string, EntityDiff>): void {
    // Item 10: a zone can require dying to be a real trip back out (e.g. the
    // dungeon respawns at Varrick's entrance, not its own spawn ~40 tiles from
    // the bosses) — cross-zone, so it's the same DB update + reconnect the
    // walk-onto-an-exit transition uses, not a same-zone teleport.
    const deathRespawn = this.zone.deathRespawn
    if (deathRespawn) {
      void this.respawnAcrossZone(player, deathRespawn)
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
    playerEnts.set(player.charId, toEntityDiff(player))
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

  /** Resolves a walked-over loot pickup: adds it to the pack, records it as a
   * world-minted unit (so it survives every flush — the inventory-first rule),
   * and removes the entity. Full pack → message, loot stays. */
  private tryTakeLoot(player: Player, eventsByChar: Map<string, ZoneEvent[]>): void {
    const pending = player.pendingLoot
    if (!pending || player.path.length > 0) return
    const loot = this.loot.get(pending.id)
    if (!loot || !isVisibleTo(loot, player.charId, this.tickCount) || player.x !== loot.x || player.z !== loot.z) {
      player.pendingLoot = null
      return
    }
    const events = eventsByChar.get(player.charId) ?? []
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
    for (const player of this.players.values()) {
      // Lingering players have a closed socket — their ent still rides `ents` to
      // everyone else, but there's nobody to receive a diff here.
      if (player.lingerUntilTick !== null) continue
      const visible = visibleLootFor(this.loot.values(), player.charId, this.tickCount)
      const visibleIds = new Set(visible.map((l) => l.id))
      const lootAdded: LootItem[] = visible.filter((l) => !player.lootView.has(l.id))
      const lootRemoved: string[] = [...player.lootView].filter((id) => !visibleIds.has(id))
      player.lootView = visibleIds

      const events: ZoneEvent[] = []
      const own = eventsByChar.get(player.charId)
      if (own) events.push(...own)
      if (hitEvents.length > 0) events.push(...hitEvents)
      if (zoneEvents.length > 0) events.push(...zoneEvents)

      const message: Extract<ServerMessage, { t: 'diff' }> = { t: 'diff', tick: this.tickCount }
      if (ents.length > 0) message.ents = ents
      if (rockChanges.length > 0) message.rocks = rockChanges
      if (removed.length > 0) message.removed = removed
      if (lootAdded.length > 0) message.loot = lootAdded
      if (lootRemoved.length > 0) message.lootRemoved = lootRemoved
      if (events.length > 0) message.events = events

      if (message.ents || message.rocks || message.removed || message.loot || message.lootRemoved || message.events) {
        send(player.conn, message)
      }
    }
  }

  /** Snapshots and clears the player's pending grant tallies, then applies
   * them to the save blob. Every flush carries XP, consumed units (eaten,
   * buried, dropped, equipped), bank deposits and — when the player re-geared —
   * the equipment snapshot. A disconnect additionally lands the pack's
   * remaining minted units in the save's inventory and returns withdrawn bank
   * units still held (bank → inventory); remaining save-backed units simply
   * stay in the save's inventory where they always were. On failure the
   * snapshot merges back so the next flush retries it. */
  private async flush(player: Player, reason: GrantPayload['reason']): Promise<void> {
    const pools = player.pools
    const payload: GrantPayload = {
      xpBySkill: player.pendingXp,
      items: [],
      itemsTo: 'inventory',
      moveToBank: toItemList(pools.depositedSaveBacked),
      removeFromInventory: toItemList(pools.consumedSaveBacked),
      removeFromBank: toItemList(pools.consumedBankSourced),
      mintedToBank: toItemList(pools.mintedToBank),
      bankToInventory: [],
      reason,
    }
    player.pendingXp = {}
    pools.depositedSaveBacked = {}
    pools.consumedSaveBacked = {}
    pools.consumedBankSourced = {}
    pools.mintedToBank = {}
    const equipmentWasDirty = player.equipmentDirty
    if (equipmentWasDirty) {
      payload.equipment = { ...player.equipment }
      player.equipmentDirty = false
    }
    if (reason === 'disconnect' || reason === 'transition') {
      payload.items = toItemList(pools.minted)
      payload.bankToInventory = toItemList(pools.bankSourced)
      // pools.minted is aliased by player.minted (mining/loot write through
      // it), so empty it in place — reassigning would sever the alias.
      for (const key of Object.keys(pools.minted)) delete pools.minted[key]
      pools.bankSourced = {}
    }
    if (isEmptyPayload(payload)) return
    player.flushSeq += 1

    const ok = await flushGrants(this.env, {
      charId: Number(player.charId),
      identityId: player.identityId,
      sessionId: player.sessionId,
      flushSeq: player.flushSeq,
    }, payload)
    if (!ok) {
      for (const [skill, amount] of Object.entries(payload.xpBySkill)) {
        player.pendingXp[skill] = (player.pendingXp[skill] ?? 0) + amount
      }
      mergeInto(pools.minted, payload.items)
      mergeInto(pools.depositedSaveBacked, payload.moveToBank)
      mergeInto(pools.consumedSaveBacked, payload.removeFromInventory ?? [])
      mergeInto(pools.consumedBankSourced, payload.removeFromBank ?? [])
      mergeInto(pools.mintedToBank, payload.mintedToBank ?? [])
      mergeInto(pools.bankSourced, payload.bankToInventory ?? [])
      if (equipmentWasDirty) player.equipmentDirty = true
    }
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
        ).bind(Number(p.charId), this.zone.id, p.x, p.z, now)
      )
    if (statements.length > 0) await this.env.DB.batch(statements)
  }

  private async checkpointPlayer(player: Player): Promise<void> {
    const now = Date.now()
    await this.env.DB.prepare(
      `INSERT INTO world_positions (character_id, zone_id, x, z, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id, x = excluded.x, z = excluded.z, updated_at = excluded.updated_at`
    ).bind(Number(player.charId), this.zone.id, player.x, player.z, now).run()
  }
}
