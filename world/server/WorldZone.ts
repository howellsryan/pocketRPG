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
import { PLAYER_DROP_OWNER_TICKS, isExpired, isVisibleTo, spawnDrops, takeLoot, visibleLootFor, type LootEntity } from './loot'
import { sanitizeChat } from '../shared/chat'
import { addToInventory, countItem, freeSlotCount, inventoryIsFull, isStackable, moveInventorySlot, removeItems, removeOneAt } from './mining'
import { getLevelFromXP } from '../../src/engine/experience.js'
import { flushGrants, isEmptyPayload, type GrantPayload, type ItemStack } from './grants'
import { loadCharacterWithSave } from '../../functions/_lib/game/save.js'
import { type ZoneDef, type ZoneExitDef } from '../shared/zone'
import { ZONES } from './zones'
import { loadStoredZone } from './zoneStore'
import { gearFromEquipment } from '../shared/appearance'
import { BURY_XP, healAmount, primaryInvAction } from '../shared/itemActions'
import { checkEquipRequirements, equipItem, placeUnequippedItems } from '../../src/engine/equipment.js'
import itemsData from '../../src/data/items.json'
import { consumeUnits, depositUnits, emptyPools, mintUnits, withdrawUnits, type ItemPools, type Tally } from './sessionItems'
import { grantSessionXp } from './tick'
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
  /** Events queued outside the tick (bank ops, item actions) — drained into
   * the player's next diff. */
  pendingEvents: ZoneEvent[]
  /** Loot the player has walked over to pick up, resolved on arrival. */
  pendingLoot: { id: string; x: number; z: number } | null
  /** Loot ids this client currently sees — diffed each tick for add/remove. */
  lootView: Set<string>
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

    // Reconnect while the session is still live (mobile socket drop, second
    // tab): carry the in-memory session over to the new socket. Re-seeding
    // from D1 here would teleport the player to a checkpoint up to 60s stale
    // and silently drop unflushed minted items/XP — the live session is the
    // source of truth until it disconnect-flushes.
    const liveCharId = String(row.id)
    const existing = this.players.get(liveCharId)
    if (existing) {
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
      pendingEvents: [],
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
      },
      statics,
      you: { x: player.x, z: player.z, hp: player.hp, maxHp: player.maxHp, stats: player.stats, inventory: player.inventory, ...(player.gear.weapon ? { gear: player.gear } : {}) },
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
      case 'interact':
        this.handleInteract(player, message)
        break
      case 'hello':
        break
    }
  }

  /** A pack-slot action: the primary verb (equip/eat/drink/bury, validated
   * against the shared derivation so the client can't invent one) or drop. */
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
      player.pendingEvents.push({ e: 'msg', text: 'Potions don’t work out here yet.' })
      return
    }

    if (message.action === 'eat') {
      removeOneAt(player.inventory, message.slot)
      consumeUnits(player.pools, itemId, 1)
      player.hp = Math.min(player.maxHp, player.hp + healAmount(itemId))
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
    player.pendingEvents.push({ e: 'msg', text: `You ${verb.toLowerCase()} the ${itemNameOf(itemId)}.` })
    this.pendingInvEcho.add(player.charId)
    this.scheduleDirtyFlush(player)
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
      if (result.bankOpen) {
        result.events.push({ e: 'bank', bank: this.bankList(player), open: true })
      }
      if (result.events.length > 0) eventsByChar.set(player.charId, result.events)
      if (result.died) this.respawnPlayer(player, playerEnts)
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
    this.broadcastDiffs(ents, rockChanges, [...npcRemoved, ...playersRemoved], hits, chatEvents, eventsByChar)

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
      for (const player of this.players.values()) void this.flush(player, 'timer')
    }
  }

  /** Hands the player to another zone. The save flush and the position row
   * (written with the TARGET zone/tile) must both be durable before the client
   * hears `transition` — its next hello reads them from D1. */
  private async transitionPlayer(player: Player, exit: ZoneExitDef): Promise<void> {
    this.players.delete(player.charId)
    this.dirty.delete(player.charId)
    this.pendingLeaves.add(player.charId)
    if (player.combat) {
      const npc = this.npcs?.get(player.combat.npcId)
      if (npc && npc.attackerId === player.charId) npc.attackerId = null
    }
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
