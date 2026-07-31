// Wire protocol between the world client and the WorldZone Durable Object.
// Single source of truth — both client and server import from here.
// Full shape defined in docs/open-world-build-guide.md §5; filled in
// incrementally as each phase needs more message types.

export type InvSlot = { itemId: string; quantity: number } | null

/** Server-computed visual appearance (equipped-gear mapping lives in
 * shared/appearance.ts). Server → client only; clients never send gear. */
export type GearDescriptor = {
  weapon?: { archetype: string; tint?: string }
  armor?: { body?: { tint?: string }; legs?: { tint?: string }; boots?: { tint?: string } }
  /** Equipped itemIds for slots the combat-arena registry
   * (src/data/equipmentModels.json) can render per-item — the client resolves
   * each to the exact model + bone-space placement + tint the equip modal uses,
   * so both heroes wear the same loadout. Only itemIds the registry covers are
   * included (slot → itemId); the archetype/tint fields above stay the fallback
   * for weapons the registry doesn't cover. */
  equip?: Record<string, string>
}

export type InvActionWire = 'equip' | 'eat' | 'drink' | 'bury' | 'drop'

export type CombatStance = 'accurate' | 'aggressive' | 'defensive'

/** Equipment slot → equipped itemId, surfaced to the client for the Equipment
 * tab. Server → client only; clients drive equip/unequip through invAction/unequip. */
export type EquipmentMap = Record<string, string>

export type BankSlot = { itemId: string; quantity: number }

export type StationType = 'furnace' | 'anvil' | 'range'

export type ClientMessage =
  | { t: 'hello'; token: string }
  | { t: 'walk'; x: number; z: number }
  | { t: 'interact'; kind: 'rock' | 'npc' | 'loot' | 'object' | 'player'; id: string; action: string }
  | { t: 'cancel' }
  | { t: 'chat'; text: string }
  | { t: 'moveInv'; from: number; to: number }
  | { t: 'invAction'; slot: number; action: InvActionWire }
  | { t: 'bank'; op: 'deposit' | 'withdraw'; itemId: string; qty: number }
  | { t: 'craft'; station: StationType; recipeId: string; qty: number }
  | { t: 'setRun'; run: boolean }
  | { t: 'setStance'; stance: CombatStance }
  /** Select the combat spell for magic weapons (null = no spell). */
  | { t: 'setSpell'; spell: string | null }
  | { t: 'special' }
  /** Toggle a prayer on/off (protection or combat slot; server validates level
   * requirement + non-empty pool). */
  | { t: 'pray'; prayerId: string }
  | { t: 'unequip'; slot: string }
  /** Travel to a named same-zone landmark (the overworld's place centres). */
  | { t: 'teleport'; placeId: string }
  /** Follow another player until cancelled (explicit walk/interact/teleport/
   * combat, or the target dying/leaving/logging out — see tick.ts). */
  | { t: 'follow'; targetId: string }
  /** The player answered the Wilderness crossing prompt. `yes` resumes the walk
   * that was stopped at the line and marks them consenting until they return to
   * the camp; `no` simply drops the prompt. */
  | { t: 'pvpConsent'; yes: boolean }
  | { t: 'logout' }
  /** The tab is really going away (closed or navigated off), as opposed to a
   * socket that dropped by accident. Flushes and releases the save lock now
   * instead of waiting out the linger grace. */
  | { t: 'leave' }
  | { t: 'ping'; n: number }

export type ZoneEvent =
  | { e: 'hit'; targetId: string; dmg: number }
  | { e: 'xp'; skill: string; amount: number }
  | { e: 'msg'; text: string }
  | { e: 'inv'; inventory: InvSlot[] }
  | { e: 'hp'; hp: number; maxHp: number }
  /** Bank contents after an op; `open: true` on arrival at a chest tells the
   * client to show the bank modal. */
  | { e: 'bank'; bank: BankSlot[]; open?: boolean }
  /** Player arrived at a processing station — open its recipe panel. */
  | { e: 'station'; station: StationType; open: true }
  | { e: 'chat'; charId: string; name: string; text: string }
  /** Run-energy readout (0-100) and whether run is toggled on. */
  | { e: 'run'; energy: number; running: boolean }
  /** Special-attack energy readout (0-100). `queued` (when present) says
   * whether a special is currently armed/queued to fire next — lets the
   * client highlight the button while armed and clear it once it fires. */
  | { e: 'spec'; energy: number; queued?: boolean }
  /** Prayer pool readout + the active protection/combat prayer ids (null = off).
   * Emitted on toggle and when combat drain moves the pool or empties it. */
  | { e: 'prayer'; points: number; max: number; protection: string | null; combat: string | null }
  /** Worn equipment changed (equip/unequip) — the Equipment tab re-renders. */
  | { e: 'equip'; equipment: EquipmentMap }
  /** Zone-wide boss kill feed entry (item 11). */
  | { e: 'kill'; monster: string; killer: string }
  /** Zone-wide broadcast when a boss drops a collection-log unique (item 11), or
   * when any kill drops an item worth the purple-loot threshold. `epic` marks
   * the latter — the banner goes purple for it. */
  | { e: 'uniqueDrop'; monster: string; player: string; item: string; epic?: boolean }
  /** Live damage-contribution readout for an in-combat boss, sorted by damage
   * descending — makes the top-damage loot rule legible mid-fight (item 11). */
  | { e: 'threat'; npcId: string; contributors: { charId: string; name: string; dmg: number }[] }
  /** The player walked into the Wilderness line without having consented yet.
   * Their path is already stopped at the last safe tile; the client shows the
   * confirm and answers with {t:'pvpConsent'}. */
  | { e: 'pvpPrompt' }
  /** This player's own PvP standing changed: which side of the line they are on,
   * and who (if anyone) they are locked in single combat with. Drives the HUD
   * banner and the "already fighting" menu state. Snapshot, not a merge. */
  | { e: 'pvpState'; inDanger: boolean; opponentId: string | null; opponentName: string | null }
  /** Zone-wide kill feed for a player kill — the Wilderness equivalent of the
   * boss `kill` event. `bot` marks a kill on one of the roaming bots. */
  | { e: 'pvpKill'; killer: string; victim: string; bot?: boolean }

export type EntityDiff = {
  id: string
  kind: 'player' | 'npc'
  x: number
  z: number
  anim: 'idle' | 'walk' | 'mine' | 'attack' | 'attack_ranged' | 'attack_magic' | 'attack_special' | 'die'
  hp?: number
  maxHp?: number
  monsterId?: string
  name?: string
  /** Player entities only: combat level, for the right-click menu's `(level-N)`
   * suffix — the same readout npcs get from their monster data. */
  combatLevel?: number
  gear?: GearDescriptor
  /** Combat target's entity id. Present iff this entity is actively in combat;
   * absent means no target — the client must clear any previously-stored one,
   * not merge/patch. */
  targetId?: string
  /** NPC entities only: the form a multi-form boss is currently in — the form it
   * will swing with NEXT, since the roll lands a wind-up ahead of the blow
   * (npc.ts advanceSharedSwing). The client tints the model by it, so the style
   * to pray against is readable off the boss itself. Snapshot, not a merge:
   * absent means no form. */
  form?: string
  /** Player entities only: the damage style their active protection prayer
   * blocks, drawn as an overhead icon. Snapshot, not a merge — absent means no
   * protection prayer, and must actually clear the icon. */
  overhead?: 'melee' | 'ranged' | 'magic'
  /** Player entities only: this player is north of the Wilderness line and can
   * therefore be attacked. The client uses it (with `combatLevel`) to decide
   * whether to offer an Attack row; the server re-checks everything. Absent
   * means safe. */
  pvp?: true
  /** Player entities only: a roaming Wilderness bot rather than a real account.
   * Rendered exactly like a player on purpose — this only exists so the client
   * never offers Follow on something that cannot be followed. */
  bot?: true
}

export type StaticObject = {
  id: string
  type: 'rock' | 'bank_chest' | 'tree' | StationType
  rock?: string
  tree?: string
  x: number
  z: number
}

export type ExitMarker = { id: string; x: number; z: number; label: string; hideMarker?: boolean }
/** Same-zone travel destination surfaced to the client's Travel menu. */
export type Landmark = { id: string; label: string; x: number; z: number }
export type PropPlacement = { model: string; x: number; z: number; rot?: number; scale?: number }
export type GroundPalette = { walkableA: string; walkableB: string; blockedA: string; blockedB: string }
export type ZoneAmbience = { sky?: string; hemiIntensity?: number; sunIntensity?: number }
/** Client-render-only ambient life (wandering critters, chimney smoke).
 * Decoration only — no collision, no server authority. Mirrors shared/zone.ts. */
export type ZoneAmbientCritter = { model: string; x: number; z: number; w: number; h: number; count: number }
export type ZoneAmbientSmoke = { x: number; z: number; y?: number }
export type ZoneAmbient = { critters?: ZoneAmbientCritter[]; smoke?: ZoneAmbientSmoke[] }
/** Client-render-only terrain height for a zone (docs/open-world-terrain-plan.md).
 * `relief` is peak height in tiles (≤~1.5); `procedural` seeds deterministic
 * noise. Absent => flat ground. `material` names a T2 blend preset. */
export type ScatterLayer = {
  model: string
  /** Instances per 100 eligible (walkable, unoccupied) tiles. */
  density: number
  jitter?: number
  scaleRange?: [number, number]
  minSlope?: number
  maxSlope?: number
}
export type ZoneTerrain = {
  relief: number
  procedural?: { seed: number; frequency: number }
  heightmap?: string
  material?: string
  scatter?: ScatterLayer[]
}
/** Client-render-only painted ground kind (path/water/floor). Decoration only —
 * collision stays in the ASCII grid. Mirrors shared/groundKinds.ts. */
export type ZoneGroundRegion = { kind: string; x: number; z: number; w: number; h: number }

export type LootItem = { id: string; itemId: string; qty: number; x: number; z: number }

/** Static monster spawn-point summary for the world map's monster markers
 * (not live positions — those only stream inside AOI). See zoneSpawnSummary
 * in shared/zone.ts. */
export type NpcSpawn = { monsterId: string; x: number; z: number }

export type ServerMessage =
  | {
      t: 'welcome'
      selfId: string
      tick: number
      zone: { id: string; name?: string; w: number; h: number; collision: string[]; exits?: ExitMarker[]; landmarks?: Landmark[]; props?: PropPlacement[]; palette?: GroundPalette; ambience?: ZoneAmbience; ambient?: ZoneAmbient; terrain?: ZoneTerrain; ground?: ZoneGroundRegion[]; spawns?: NpcSpawn[] }
      statics: StaticObject[]
      you: {
        x: number
        z: number
        hp: number
        maxHp: number
        stats: Record<string, { xp: number; level: number }>
        inventory: InvSlot[]
        gear?: GearDescriptor
        runEnergy: number
        running: boolean
        stance: CombatStance
        /** Selected combat-spell id, when one is set this session. */
        spell?: string
        specialEnergy: number
        equipment: EquipmentMap
        /** Prayer pool + active toggles at hello (pool full per session). */
        prayer: { points: number; max: number; protection: string | null; combat: string | null }
      }
    }
  | {
      t: 'diff'
      tick: number
      ents?: EntityDiff[]
      removed?: string[]
      rocks?: { id: string; depleted: boolean }[]
      loot?: LootItem[]
      lootRemoved?: string[]
      events?: ZoneEvent[]
    }
  | { t: 'dead'; respawn: { x: number; z: number } }
  /** Died in an instanced boss lair (§ world-design.md): the room is closed, so
   * death ejects the player out of it entirely instead of respawning them back
   * in front of the boss. The socket is closed right after (code 1008, reason
   * 'instance_death') — the client shows a choice screen rather than
   * reconnecting, so it must not auto-reload like `transition` does. */
  | { t: 'instanceDeath'; zone: string; zoneName: string }
  /** Player stepped on an exit tile; save + position are already durable.
   * The client reconnects to the target zone's DO (full reload). */
  | { t: 'transition'; zone: string; x: number; z: number }
  /** Same-zone hard teleport (travel menu): the client snaps self to (x,z) with
   * no walk interpolation. Server has already moved the authoritative position. */
  | { t: 'snap'; x: number; z: number }
  | { t: 'error'; code: string; msg: string }
  | { t: 'pong'; n: number }

/** Validates an unknown decoded JSON value is a well-formed ClientMessage.
 * Unknown `t` (or malformed shape) must close the connection per §5 —
 * callers pass the result to a switch and close on `null`. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const t = (raw as Record<string, unknown>).t
  switch (t) {
    case 'hello': {
      const token = (raw as Record<string, unknown>).token
      return typeof token === 'string' ? { t: 'hello', token } : null
    }
    case 'walk': {
      const x = (raw as Record<string, unknown>).x
      const z = (raw as Record<string, unknown>).z
      return Number.isInteger(x) && Number.isInteger(z) ? { t: 'walk', x: x as number, z: z as number } : null
    }
    case 'interact': {
      const r = raw as Record<string, unknown>
      const kind = r.kind
      const id = r.id
      const action = r.action
      if (
        (kind === 'rock' || kind === 'npc' || kind === 'loot' || kind === 'object' || kind === 'player') &&
        typeof id === 'string' &&
        typeof action === 'string'
      ) {
        return { t: 'interact', kind, id, action }
      }
      return null
    }
    case 'cancel':
      return { t: 'cancel' }
    case 'chat': {
      const text = (raw as Record<string, unknown>).text
      return typeof text === 'string' ? { t: 'chat', text } : null
    }
    case 'moveInv': {
      const from = (raw as Record<string, unknown>).from
      const to = (raw as Record<string, unknown>).to
      const inRange = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 28
      return inRange(from) && inRange(to) ? { t: 'moveInv', from, to } : null
    }
    case 'invAction': {
      const slot = (raw as Record<string, unknown>).slot
      const action = (raw as Record<string, unknown>).action
      const validSlot = Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < 28
      const validAction = action === 'equip' || action === 'eat' || action === 'drink' || action === 'bury' || action === 'drop'
      return validSlot && validAction ? { t: 'invAction', slot: slot as number, action } : null
    }
    case 'bank': {
      const op = (raw as Record<string, unknown>).op
      const itemId = (raw as Record<string, unknown>).itemId
      const qty = (raw as Record<string, unknown>).qty
      const validOp = op === 'deposit' || op === 'withdraw'
      const validQty = Number.isInteger(qty) && (qty as number) >= 1 && (qty as number) <= 1_000_000_000
      return validOp && typeof itemId === 'string' && itemId.length > 0 && itemId.length <= 64 && validQty
        ? { t: 'bank', op, itemId, qty: qty as number }
        : null
    }
    case 'craft': {
      const r = raw as Record<string, unknown>
      const station = r.station
      const recipeId = r.recipeId
      const qty = r.qty
      const validStation = station === 'furnace' || station === 'anvil' || station === 'range'
      const validQty = Number.isInteger(qty) && (qty as number) >= 1 && (qty as number) <= 28
      return validStation && typeof recipeId === 'string' && recipeId.length > 0 && recipeId.length <= 64 && validQty
        ? { t: 'craft', station: station as StationType, recipeId, qty: qty as number }
        : null
    }
    case 'setRun': {
      const run = (raw as Record<string, unknown>).run
      return typeof run === 'boolean' ? { t: 'setRun', run } : null
    }
    case 'setStance': {
      const stance = (raw as Record<string, unknown>).stance
      return stance === 'accurate' || stance === 'aggressive' || stance === 'defensive'
        ? { t: 'setStance', stance }
        : null
    }
    case 'setSpell': {
      const spell = (raw as Record<string, unknown>).spell
      if (spell === null) return { t: 'setSpell', spell: null }
      return typeof spell === 'string' && spell.length > 0 && spell.length <= 64 ? { t: 'setSpell', spell } : null
    }
    case 'special':
      return { t: 'special' }
    case 'pray': {
      const prayerId = (raw as Record<string, unknown>).prayerId
      return typeof prayerId === 'string' && prayerId.length > 0 && prayerId.length <= 64 ? { t: 'pray', prayerId } : null
    }
    case 'unequip': {
      const slot = (raw as Record<string, unknown>).slot
      return typeof slot === 'string' && slot.length > 0 && slot.length <= 32 ? { t: 'unequip', slot } : null
    }
    case 'teleport': {
      const placeId = (raw as Record<string, unknown>).placeId
      return typeof placeId === 'string' && placeId.length > 0 && placeId.length <= 64 ? { t: 'teleport', placeId } : null
    }
    case 'follow': {
      const targetId = (raw as Record<string, unknown>).targetId
      return typeof targetId === 'string' && targetId.length > 0 && targetId.length <= 64 ? { t: 'follow', targetId } : null
    }
    case 'pvpConsent': {
      const yes = (raw as Record<string, unknown>).yes
      return typeof yes === 'boolean' ? { t: 'pvpConsent', yes } : null
    }
    case 'logout':
      return { t: 'logout' }
    case 'leave':
      return { t: 'leave' }
    case 'ping': {
      const n = (raw as Record<string, unknown>).n
      return typeof n === 'number' ? { t: 'ping', n } : null
    }
    default:
      return null
  }
}
