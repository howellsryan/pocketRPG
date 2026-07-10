import { Server, type Connection as PartyConnection } from 'partyserver'
import { verifyJWT } from '../../functions/_lib/jwt.js'
import { findPath, findPathAdjacent } from './pathfind'
import {
  respawnedRocks,
  sessionInventoryFromSave,
  sessionStatsFromSave,
  tickPlayer,
  toEntityDiff,
  type RockState,
  type TickPlayer,
} from './tick'
import { emptyInventory } from './mining'
import { flushGrants, isEmptyPayload, type GrantPayload, type ItemStack } from './grants'
import { loadCharacterWithSave } from '../../functions/_lib/game/save.js'
import { validateZone, type ZoneDef } from '../shared/zone'
import type { ClientMessage, EntityDiff, ServerMessage, StaticObject, ZoneEvent } from '../shared/protocol'
import { parseClientMessage } from '../shared/protocol'
import type { Env } from './env'

type ConnState = { charId: string | null }
type Connection = PartyConnection<ConnState>
import pastureZone from '../zones/pasture.json'

const TICK_MS = 600
const AUTH_TIMEOUT_MS = 5000
const CHECKPOINT_EVERY_TICKS = 100
const RATE_LIMIT_WINDOW_MS = 1000
const RATE_LIMIT_MAX_MESSAGES = 10

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

  onClose(connection: Connection): void {
    this.clearAuthTimer(connection.id)
    const charId = connection.state?.charId ?? null
    if (!charId) return
    const player = this.players.get(charId)
    if (!player) return
    this.players.delete(charId)
    this.dirty.delete(charId)
    void this.flush(player, 'disconnect')
    void this.checkpointPlayer(player)
    this.maybeStopTicking()
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

    let stats
    let seeded
    try {
      const { saveObject } = await loadCharacterWithSave(this.env, row.id, payload.sub)
      stats = sessionStatsFromSave(saveObject)
      seeded = sessionInventoryFromSave(saveObject)
    } catch {
      connection.close(1008, 'character_not_found')
      return
    }

    const charId = String(row.id)
    this.clearAuthTimer(connection.id)

    const existing = this.players.get(charId)
    if (existing) {
      existing.conn.close(1008, 'duplicate_connection')
      this.players.delete(charId)
    }

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
      conn: connection,
      lastMsgTimes: [],
      identityId: String(payload.sub),
      sessionId: crypto.randomUUID(),
      flushSeq: 0,
      saveBacked: seeded.saveBacked,
    }
    this.players.set(charId, player)

    const statics: StaticObject[] = this.zone.objects
    send(connection, {
      t: 'welcome',
      selfId: charId,
      tick: this.tickCount,
      zone: { id: this.zone.id, w: this.zone.width, h: this.zone.height, collision: this.zone.collision },
      statics,
      you: { x, z, stats: player.stats, inventory: player.inventory },
    })

    const depleted = [...this.ensureRocks().values()]
      .filter((r) => r.depletedUntilTick > this.tickCount)
      .map((r) => ({ id: r.id, depleted: true }))
    if (depleted.length > 0) send(connection, { t: 'diff', tick: this.tickCount, rocks: depleted })

    this.ensureTicking()
  }

  private handleAuthedMessage(player: Player, message: ClientMessage): void {
    switch (message.t) {
      case 'walk': {
        const path = findPath(this.zone.collision, { x: player.x, z: player.z }, { x: message.x, z: message.z })
        player.path = path ? path.slice(1) : []
        player.pendingInteract = null
        player.mining = null
        break
      }
      case 'cancel':
        player.path = []
        player.pendingInteract = null
        player.mining = null
        break
      case 'ping':
        send(player.conn, { t: 'pong', n: message.n })
        break
      case 'interact':
        this.handleInteract(player, message)
        break
      case 'hello':
        break
    }
  }

  private handleInteract(player: Player, message: Extract<ClientMessage, { t: 'interact' }>): void {
    let target: { x: number; z: number } | null = null
    let intent: Player['pendingInteract'] = null

    if (message.kind === 'rock' && message.action === 'mine') {
      const rock = this.ensureRocks().get(message.id)
      if (!rock) return
      target = rock
      intent = { kind: 'rock', id: rock.id, action: 'mine' }
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
    player.mining = null
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
    const rockChanges = respawnedRocks(rocks, this.tickCount)
    const entChanges: EntityDiff[] = []
    const eventsByChar = new Map<string, ZoneEvent[]>()

    for (const player of this.players.values()) {
      const result = tickPlayer(player, { tick: this.tickCount, rocks })
      if (result.entChanged) {
        this.dirty.add(player.charId)
        entChanges.push(toEntityDiff(player))
      }
      rockChanges.push(...result.rockChanges)
      if (result.deposit) {
        // flush() empties the pack synchronously before its first await, so
        // the events below already show the post-deposit state.
        void this.flush(player, 'deposit')
        result.events.push({ e: 'inv', inventory: player.inventory })
        result.events.push({ e: 'msg', text: 'You deposit your items into your bank.' })
      }
      if (result.events.length > 0) eventsByChar.set(player.charId, result.events)
    }

    if (entChanges.length > 0 || rockChanges.length > 0 || eventsByChar.size > 0) {
      for (const player of this.players.values()) {
        const events = eventsByChar.get(player.charId)
        if (entChanges.length === 0 && rockChanges.length === 0 && !events) continue
        const message: Extract<ServerMessage, { t: 'diff' }> = { t: 'diff', tick: this.tickCount }
        if (entChanges.length > 0) message.ents = entChanges
        if (rockChanges.length > 0) message.rocks = rockChanges
        if (events) message.events = events
        send(player.conn, message)
      }
    }

    if (this.tickCount % CHECKPOINT_EVERY_TICKS === 0) {
      if (this.dirty.size > 0) void this.flushCheckpoints()
      for (const player of this.players.values()) void this.flush(player, 'timer')
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
