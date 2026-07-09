import { Server, type Connection as PartyConnection } from 'partyserver'
import { verifyJWT } from '../../functions/_lib/jwt.js'
import { findPath } from './pathfind'
import { advanceMovement, toEntityDiff, type TickPlayer } from './tick'
import { validateZone, type ZoneDef } from '../shared/zone'
import type { ClientMessage, ServerMessage, StaticObject } from '../shared/protocol'
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

  get zone(): ZoneDef {
    return ZONES[this.name] ?? pastureZone as ZoneDef
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
    const player: Player = { charId, name: row.username, x, z, path: [], anim: 'idle', conn: connection, lastMsgTimes: [] }
    this.players.set(charId, player)

    const statics: StaticObject[] = this.zone.objects
    send(connection, {
      t: 'welcome',
      selfId: charId,
      tick: this.tickCount,
      zone: { id: this.zone.id, w: this.zone.width, h: this.zone.height, collision: this.zone.collision },
      statics,
      you: { x, z, stats: {}, inventory: [] },
    })

    this.ensureTicking()
  }

  private handleAuthedMessage(player: Player, message: ClientMessage): void {
    switch (message.t) {
      case 'walk': {
        const path = findPath(this.zone.collision, { x: player.x, z: player.z }, { x: message.x, z: message.z })
        player.path = path ? path.slice(1) : []
        break
      }
      case 'cancel':
        player.path = []
        break
      case 'ping':
        send(player.conn, { t: 'pong', n: message.n })
        break
      case 'interact':
        // Rocks/npcs/loot arrive in Phase 1/2 — no interactables exist yet.
        break
      case 'hello':
        break
    }
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
    const changed: Player[] = []

    for (const player of this.players.values()) {
      const result = advanceMovement(player)
      if (result.changed) {
        Object.assign(player, result.next)
        this.dirty.add(player.charId)
        changed.push(player)
      }
    }

    if (changed.length > 0) {
      const ents = changed.map((p) => toEntityDiff(p))
      const message: ServerMessage = { t: 'diff', tick: this.tickCount, ents }
      const body = JSON.stringify(message)
      for (const player of this.players.values()) player.conn.send(body)
    }

    if (this.tickCount % CHECKPOINT_EVERY_TICKS === 0 && this.dirty.size > 0) {
      void this.flushCheckpoints()
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
