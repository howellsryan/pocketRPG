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
  type TickContext,
  type TickPlayer,
} from './tick'
import { npcsFromZone, tickNpc, toNpcDiff, type NpcState } from './npc'
import { isExpired, isVisibleTo, takeLoot, visibleLootFor, type LootEntity } from './loot'
import { sanitizeChat } from '../shared/chat'
import { emptyInventory, moveInventorySlot } from './mining'
import { getLevelFromXP } from '../../src/engine/experience.js'
import { flushGrants, isEmptyPayload, type GrantPayload, type ItemStack } from './grants'
import { loadCharacterWithSave } from '../../functions/_lib/game/save.js'
import { validateZone, type ZoneDef } from '../shared/zone'
import { gearFromEquipment } from '../shared/appearance'
import type { ClientMessage, EntityDiff, LootItem, ServerMessage, StaticObject, ZoneEvent } from '../shared/protocol'
import { parseClientMessage } from '../shared/protocol'
import type { Env } from './env'

type ConnState = { charId: string | null }
type Connection = PartyConnection<ConnState>
import pastureZone from '../zones/pasture.json'

const TICK_MS = 600
const AUTH_TIMEOUT_MS = 5000
const CHECKPOINT_EVERY_TICKS = 100
const HP_REGEN_EVERY_TICKS = 100
const RATE_LIMIT_WINDOW_MS = 1000
const RATE_LIMIT_MAX_MESSAGES = 10
// Every player's ent re-broadcasts on this cadence even when idle, so a client
// that missed a join edge (reconnect gap, suspended tab) self-heals within 30s.
const PRESENCE_KEYFRAME_TICKS = 50

const ZONES: Record<string, ZoneDef> = { pasture: pastureZone as ZoneDef }
for (const zone of Object.values(ZONES)) {
  const result = validateZone(zone)
  if (!result.valid) throw new Error(`invalid zone '${zone.id}': ${result.errors.join('; ')}`)
}

type Player = TickPlayer & {
  conn: Connection
  lastMsgTimes: number[]
  identityId: string
  sessionId: string
  flushSeq: number
  /** Units seeded from the character's PocketRPG inventory at hello — already
   * in the save, so a deposit MOVES them to the bank rather than granting. */
  saveBacked: Record<string, number>
  /** Loot the player has walked over to pick up, resolved on arrival. */
  pendingLoot: { id: string; x: number; z: number } | null
  /** Loot ids this client currently sees — diffed each tick for add/remove. */
  lootView: Set<string>
}

function toItemList(record: Record<string, number>): ItemStack[] {
  return Object.entries(record)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }))
}

function mergeInto(target: Record<string, number>, items: ItemStack[]): void {
  for (const item of items) target[item.itemId] = (target[item.itemId] ?? 0) + item.quantity
}

function send(conn: Connection, message: ServerMessage): void {
  conn.send(JSON.stringify(message))
}

export class WorldZone extends Server<Env> {
  players = new Map<string, Player>()
  dirty = new Set<string>()
  tickCount = 0
  tickTimer: ReturnType<typeof setInterval> | null = null
  authTimers = new Map<string, ReturnType<typeof setTimeout>>()
  rocks: Map<string, RockState> | null = null
  npcs: Map<string, NpcState> | null = null
  loot = new Map<string, LootEntity>()
  /** Presence edges + chat queued between ticks; drained by tick(). */
  pendingJoins = new Set<string>()
  pendingLeaves = new Set<string>()
  pendingChat: Extract<ZoneEvent, { e: 'chat' }>[] = []
  /** Players whose pack was reordered since the last tick — the next tick's
   * diff carries the authoritative {e:'inv'} echo (client swaps optimistically). */
  pendingInvEcho = new Set<string>()

  get zone(): ZoneDef {
    return ZONES[this.name] ?? pastureZone as ZoneDef
  }

  private ensureRocks(): Map<string, RockState> {
    if (!this.rocks) {
      this.rocks = new Map(
        this.zone.objects
          .filter((o) => o.type === 'rock' && o.rock)
          .map((o) => [o.id, { id: o.id, rock: o.rock!, x: o.x, z: o.z, depletedUntilTick: 0 }])
      )
    }
    return this.rocks
  }

  private ensureNpcs(): Map<string, NpcState> {
    if (!this.npcs) this.npcs = npcsFromZone(this.zone.npcs)
    return this.npcs
  }

  onConnect(connection: Connection): void {
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
    if (!this.withinRateLimit(player)) {
      connection.close(1008, 'rate_limited')
      return
    }
    this.handleAuthedMessage(player, message)
  }

  // Async so the runtime keeps the DO alive until the disconnect flush and
  // position checkpoint land — fire-and-forget writes here can be lost when
  // the last player leaves and the instance idles out.
  async onClose(connection: Connection): Promise<void> {
    this.clearAuthTimer(connection.id)
    const charId = connection.state?.charId ?? null
    if (!charId) return
    const player = this.players.get(charId)
    if (!player) return
    // A duplicate-connection kick closes the old socket after the charId has
    // been re-registered on a new one — that close must not tear down the
    // live player.
    if (player.conn !== connection) return
    if (player.combat) {
      const npc = this.npcs?.get(player.combat.npcId)
      if (npc && npc.attackerId === charId) npc.attackerId = null
    }
    this.players.delete(charId)
    this.dirty.delete(charId)
    this.pendingLeaves.add(charId)
    this.maybeStopTicking()
    await this.flush(player, 'disconnect')
    await this.checkpointPlayer(player)
  }

  private clearAuthTimer(connectionId: string): void {
    const timer = this.authTimers.get(connectionId)
    if (timer) {
      clearTimeout(timer)
      this.authTimers.delete(connectionId)
    }
  }

  private withinRateLimit(player: Player): boolean {
    const now = Date.now()
    player.lastMsgTimes = player.lastMsgTimes.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    player.lastMsgTimes.push(now)
    return player.lastMsgTimes.length <= RATE_LIMIT_MAX_MESSAGES
  }

  private async handleHello(connection: Connection, message: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
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

    // Reconnect while the session is still live (mobile socket drop, second
    // tab): carry the in-memory session over to the new socket. Re-seeding
    // from D1 here would teleport the player to a checkpoint up to 60s stale
    // and silently drop unflushed minted items/XP — the live session is the
    // source of truth until it disconnect-flushes.
    const liveCharId = String(row.id)
    const existing = this.players.get(liveCharId)
    if (existing) {
      this.clearAuthTimer(connection.id)
      existing.conn.close(1008, 'duplicate_connection')
      if (existing.combat) {
        const npc = this.ensureNpcs().get(existing.combat.npcId)
        if (npc && npc.attackerId === liveCharId) npc.attackerId = null
      }
      existing.path = []
      existing.pendingInteract = null
      existing.mining = null
      existing.combat = null
      existing.pendingLoot = null
      existing.anim = 'idle'
      existing.conn = connection
      existing.lastMsgTimes = []
      connection.setState({ charId: liveCharId })
      this.sendWelcome(existing)
      this.ensureTicking()
      return
    }

    let stats
    let seeded
    let equipment: Record<string, unknown> = {}
    let maxHp = 10
    try {
      const { saveObject } = await loadCharacterWithSave(this.env, row.id, payload.sub)
      stats = sessionStatsFromSave(saveObject)
      seeded = sessionInventoryFromSave(saveObject)
      equipment = (saveObject.equipment ?? {}) as Record<string, unknown>
      const hpEntry = (saveObject.stats as Record<string, { xp?: number; level?: number }> | undefined)?.hitpoints
      maxHp = Number(hpEntry?.level) || getLevelFromXP(Number(hpEntry?.xp) || 0) || 10
    } catch {
      connection.close(1008, 'character_not_found')
      return
    }

    const charId = String(row.id)
    this.clearAuthTimer(connection.id)

    const posRow = await this.env.DB.prepare(
      'SELECT x, z FROM world_positions WHERE character_id = ? AND zone_id = ?'
    ).bind(row.id, this.name).first<{ x: number; z: number }>()
    const spawn = this.zone.spawn
    const x = posRow?.x ?? spawn.x
    const z = posRow?.z ?? spawn.z

    connection.setState({ charId })
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
      minted: {},
      mining: null,
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
      saveBacked: seeded.saveBacked,
      pendingLoot: null,
      lootView: new Set(),
    }
    this.players.set(charId, player)
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
      zone: { id: this.zone.id, w: this.zone.width, h: this.zone.height, collision: this.zone.collision },
      statics,
      you: { x: player.x, z: player.z, stats: player.stats, inventory: player.inventory, ...(player.gear.weapon ? { gear: player.gear } : {}) },
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
        this.clearIntents(player)
        break
      }
      case 'cancel':
        player.path = []
        this.clearIntents(player)
        break
      case 'ping':
        send(player.conn, { t: 'pong', n: message.n })
        break
      case 'chat': {
        const text = sanitizeChat(message.text)
        if (text) this.pendingChat.push({ e: 'chat', charId: player.charId, name: player.name, text })
        break
      }
      case 'moveInv':
        if (moveInventorySlot(player.inventory, message.from, message.to)) this.pendingInvEcho.add(player.charId)
        break
      case 'interact':
        this.handleInteract(player, message)
        break
      case 'hello':
        break
    }
  }

  private clearIntents(player: Player): void {
    player.pendingInteract = null
    player.mining = null
    player.combat = null
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

    if (message.kind === 'rock' && message.action === 'mine') {
      const rock = this.ensureRocks().get(message.id)
      if (!rock) return
      target = rock
      intent = { kind: 'rock', id: rock.id, action: 'mine' }
    } else if (message.kind === 'npc' && message.action === 'attack') {
      const npc = this.ensureNpcs().get(message.id)
      if (!npc || npc.state === 'dead') return
      target = npc
      intent = { kind: 'npc', id: npc.id, action: 'attack' }
    } else if (message.kind === 'object' && message.action === 'deposit') {
      const chest = this.zone.objects.find((o) => o.id === message.id && o.type === 'bank_chest')
      if (!chest) return
      target = chest
      intent = { kind: 'object', id: chest.id, action: 'deposit' }
    } else {
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
    const rocks = this.ensureRocks()
    const npcs = this.ensureNpcs()
    const ctx: TickContext = {
      tick: this.tickCount,
      rocks,
      npcs,
      collision: this.zone.collision,
      pathAdjacent: (from, to) => findPathAdjacent(this.zone.collision, from, to),
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
      if (result.deposit) {
        // flush() empties the pack synchronously before its first await, so
        // the events below already show the post-deposit state.
        void this.flush(player, 'deposit')
        result.events.push({ e: 'inv', inventory: player.inventory })
        result.events.push({ e: 'msg', text: 'You deposit your items into your bank.' })
      }
      if (result.events.length > 0) eventsByChar.set(player.charId, result.events)
      if (result.died) this.respawnPlayer(player, playerEnts)
    }

    // Loot pickups resolve after movement (the player may have just arrived).
    for (const player of this.players.values()) this.tryTakeLoot(player, eventsByChar)

    // Authoritative pack-order echo for reorders received since the last tick.
    for (const charId of this.pendingInvEcho) {
      const player = this.players.get(charId)
      if (!player) continue
      const events = eventsByChar.get(charId) ?? []
      events.push({ e: 'inv', inventory: player.inventory })
      eventsByChar.set(charId, events)
    }
    this.pendingInvEcho.clear()
    for (const [id, loot] of this.loot) if (isExpired(loot, this.tickCount)) this.loot.delete(id)

    const npcEnts: EntityDiff[] = []
    for (const id of npcChanged) {
      const npc = npcs.get(id)
      if (npc && !npcRemoved.has(id)) npcEnts.push(toNpcDiff(npc))
    }
    const ents = [...playerEnts.values(), ...npcEnts]
    this.broadcastDiffs(ents, rockChanges, [...npcRemoved, ...playersRemoved], hits, chatEvents, eventsByChar)

    if (this.tickCount % HP_REGEN_EVERY_TICKS === 0) {
      for (const player of this.players.values()) if (player.hp < player.maxHp) player.hp += 1
    }
    if (this.tickCount % CHECKPOINT_EVERY_TICKS === 0) {
      if (this.dirty.size > 0) void this.flushCheckpoints()
      for (const player of this.players.values()) void this.flush(player, 'timer')
    }
  }

  private respawnPlayer(player: Player, playerEnts: Map<string, EntityDiff>): void {
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
    chatEvents: ZoneEvent[],
    eventsByChar: Map<string, ZoneEvent[]>
  ): void {
    const hitEvents: ZoneEvent[] = hits.map((h) => ({ e: 'hit', targetId: h.targetId, dmg: h.dmg }))
    for (const player of this.players.values()) {
      const visible = visibleLootFor(this.loot.values(), player.charId, this.tickCount)
      const visibleIds = new Set(visible.map((l) => l.id))
      const lootAdded: LootItem[] = visible.filter((l) => !player.lootView.has(l.id))
      const lootRemoved: string[] = [...player.lootView].filter((id) => !visibleIds.has(id))
      player.lootView = visibleIds

      const events: ZoneEvent[] = []
      const own = eventsByChar.get(player.charId)
      if (own) events.push(...own)
      if (hitEvents.length > 0) events.push(...hitEvents)
      if (chatEvents.length > 0) events.push(...chatEvents)

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
   * them to the save blob. Items follow "inventory first, bank on deposit":
   * a chest deposit banks everything in the pack (moving save-backed units,
   * granting minted ones); a disconnect lands minted units in the character's
   * inventory; the periodic timer flushes XP only. On failure the snapshot is
   * merged back so the next flush retries it. */
  private async flush(player: Player, reason: GrantPayload['reason']): Promise<void> {
    const payload: GrantPayload = { xpBySkill: player.pendingXp, items: [], itemsTo: 'bank', moveToBank: [], reason }
    player.pendingXp = {}
    if (reason === 'deposit') {
      payload.items = toItemList(player.minted)
      payload.moveToBank = toItemList(player.saveBacked)
      player.minted = {}
      player.saveBacked = {}
      player.inventory = emptyInventory()
    } else if (reason === 'disconnect') {
      payload.items = toItemList(player.minted)
      payload.itemsTo = 'inventory'
      player.minted = {}
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
      mergeInto(player.minted, payload.items)
      mergeInto(player.saveBacked, payload.moveToBank)
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
