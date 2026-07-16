// Wire protocol between the world client and the WorldZone Durable Object.
// Single source of truth — both client and server import from here.
// Full shape defined in docs/open-world-build-guide.md §5; filled in
// incrementally as each phase needs more message types.

export type InvSlot = { itemId: string; quantity: number } | null

/** Server-computed visual appearance (equipped-gear mapping lives in
 * shared/appearance.ts). Server → client only; clients never send gear. */
export type GearDescriptor = { weapon?: { archetype: string; tint?: string } }

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
  | { t: 'interact'; kind: 'rock' | 'npc' | 'loot' | 'object'; id: string; action: string }
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
  | { t: 'unequip'; slot: string }
  | { t: 'logout' }
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
  /** Special-attack energy readout (0-100). */
  | { e: 'spec'; energy: number }
  /** Worn equipment changed (equip/unequip) — the Equipment tab re-renders. */
  | { e: 'equip'; equipment: EquipmentMap }

export type EntityDiff = {
  id: string
  kind: 'player' | 'npc'
  x: number
  z: number
  anim: 'idle' | 'walk' | 'mine' | 'attack' | 'die'
  hp?: number
  maxHp?: number
  monsterId?: string
  name?: string
  gear?: GearDescriptor
  /** Combat target's entity id. Present iff this entity is actively in combat;
   * absent means no target — the client must clear any previously-stored one,
   * not merge/patch. */
  targetId?: string
}

export type StaticObject = {
  id: string
  type: 'rock' | 'bank_chest' | 'tree' | StationType
  rock?: string
  tree?: string
  x: number
  z: number
}

export type ExitMarker = { id: string; x: number; z: number; label: string }
export type PropPlacement = { model: string; x: number; z: number; rot?: number; scale?: number }
export type GroundPalette = { walkableA: string; walkableB: string; blockedA: string; blockedB: string }
export type ZoneAmbience = { sky?: string; hemiIntensity?: number; sunIntensity?: number }
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

export type LootItem = { id: string; itemId: string; qty: number; x: number; z: number }

export type ServerMessage =
  | {
      t: 'welcome'
      selfId: string
      tick: number
      zone: { id: string; name?: string; w: number; h: number; collision: string[]; exits?: ExitMarker[]; props?: PropPlacement[]; palette?: GroundPalette; ambience?: ZoneAmbience; terrain?: ZoneTerrain }
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
  /** Player stepped on an exit tile; save + position are already durable.
   * The client reconnects to the target zone's DO (full reload). */
  | { t: 'transition'; zone: string; x: number; z: number }
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
        (kind === 'rock' || kind === 'npc' || kind === 'loot' || kind === 'object') &&
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
    case 'unequip': {
      const slot = (raw as Record<string, unknown>).slot
      return typeof slot === 'string' && slot.length > 0 && slot.length <= 32 ? { t: 'unequip', slot } : null
    }
    case 'logout':
      return { t: 'logout' }
    case 'ping': {
      const n = (raw as Record<string, unknown>).n
      return typeof n === 'number' ? { t: 'ping', n } : null
    }
    default:
      return null
  }
}
