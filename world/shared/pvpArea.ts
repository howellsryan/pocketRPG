// The Wilderness: the one zone where players may attack each other, and the
// rules that decide when. Shared by the world server (authority), the world
// client (which rows a right-click menu offers) and the zone generator (which
// paints the line in the collision grid) — three readers of one set of numbers,
// because a boundary the client draws in a different place from the one the
// server enforces is worse than no boundary at all.

/** Zone id of the PvP area. The only zone in which pvpCombat resolves a swing. */
export const PVP_ZONE_ID = 'wilderness'

/**
 * The northernmost SAFE row. North is decreasing z, so every tile with
 * `z <= PVP_LINE_Z - 1` is dangerous and everything from PVP_LINE_Z south is
 * the camp. The line itself is walkable (it is the gate row you cross), and
 * standing on it is still safe — you are not in until you are through.
 */
export const PVP_LINE_Z = 45

/** Combat-level spread inside which two players may attack each other. */
export const PVP_LEVEL_BRACKET = 10

/**
 * Ticks a duel survives with nobody in reach before it releases. Without it,
 * walking one tile out of melee range would end a fight and free both sides to
 * be attacked by somebody else — so every fight would be won by whoever
 * disengaged first. 17 ticks ≈ 10s, the same grace the world already uses for a
 * dropped socket.
 */
export const PVP_COMBAT_LOCK_TICKS = 17

export type Tile = { x: number; z: number }

/** Is this tile inside the dangerous half of the Wilderness? */
export function isDangerTile(tile: Tile): boolean {
  return tile.z < PVP_LINE_Z
}

/** Does this zone/room have PvP at all? Room names are never suffixed here —
 * the Wilderness is deliberately NOT an instanced zone (players have to be able
 * to find each other), so an exact id match is the whole test. */
export function isPvpZone(zoneId: string): boolean {
  return zoneId === PVP_ZONE_ID
}

/** Are two combat levels inside the ±10 bracket? */
export function withinPvpBracket(a: number, b: number): boolean {
  return Math.abs(Math.floor(a) - Math.floor(b)) <= PVP_LEVEL_BRACKET
}

/**
 * A tile is a CROSSING when a step takes the player from the camp into the
 * danger half. The consent prompt fires on the crossing, never on the tile:
 * a player already north of the line who walks further north is long past the
 * point of being asked.
 */
export function crossesIntoDanger(from: Tile, to: Tile): boolean {
  return !isDangerTile(from) && isDangerTile(to)
}

/**
 * Trims a walk path at the last tile before the line, and reports whether it
 * had to. The server calls this for a player who has not consented yet: their
 * character stops at the gate rather than being teleported back or silently
 * refused, which is what makes the prompt read as "you are about to step
 * through" instead of "that click did nothing".
 *
 * Returns the untouched path when it never crosses — the common case, and the
 * reason this is a pure function rather than a branch inside the tick.
 */
export function stopPathAtLine(from: Tile, path: Tile[]): { path: Tile[]; blocked: boolean } {
  let previous = from
  for (let i = 0; i < path.length; i++) {
    if (crossesIntoDanger(previous, path[i])) return { path: path.slice(0, i), blocked: true }
    previous = path[i]
  }
  return { path, blocked: false }
}

export type PvpCandidate = {
  charId: string
  combatLevel: number
  x: number
  z: number
  /** Who this character is locked in combat with, if anyone. */
  opponentId: string | null
  /** True while the lock is still live (see PVP_COMBAT_LOCK_TICKS). */
  locked: boolean
}

export type AttackRefusal =
  | 'not_pvp_zone'
  | 'attacker_safe'
  | 'target_safe'
  | 'self'
  | 'out_of_bracket'
  | 'target_engaged'
  | 'attacker_engaged'

/**
 * The single gate every player-vs-player attack passes, on the server and
 * (for menu rows only) on the client. Returns null when the attack is allowed,
 * otherwise the reason — which the caller turns into the player's message.
 *
 * Single combat is the pair of `*_engaged` refusals: a character already locked
 * with someone may neither pick a new target nor be picked as one. Re-attacking
 * the character you are ALREADY locked with is always allowed, which is what
 * lets a fight resume after a disengage without dropping the lock.
 */
export function pvpAttackRefusal(
  zoneId: string,
  attacker: PvpCandidate,
  target: PvpCandidate,
): AttackRefusal | null {
  if (!isPvpZone(zoneId)) return 'not_pvp_zone'
  if (attacker.charId === target.charId) return 'self'
  if (!isDangerTile(attacker)) return 'attacker_safe'
  if (!isDangerTile(target)) return 'target_safe'
  if (!withinPvpBracket(attacker.combatLevel, target.combatLevel)) return 'out_of_bracket'
  const alreadyPaired = attacker.opponentId === target.charId && target.opponentId === attacker.charId
  if (alreadyPaired) return null
  if (attacker.locked && attacker.opponentId) return 'attacker_engaged'
  if (target.locked && target.opponentId) return 'target_engaged'
  return null
}

/** Player-facing copy for a refusal. Kept beside the rule so a new refusal
 * cannot ship without one. */
export function pvpRefusalMessage(refusal: AttackRefusal, targetName = 'them'): string {
  switch (refusal) {
    case 'attacker_safe': return 'You must cross into the Wilderness to attack anyone.'
    case 'target_safe': return `${targetName} is not in the Wilderness.`
    case 'out_of_bracket': return `${targetName} is outside your combat bracket.`
    case 'target_engaged': return `${targetName} is already fighting someone.`
    case 'attacker_engaged': return 'You are already fighting someone.'
    case 'self': return 'You cannot attack yourself.'
    default: return 'You cannot attack players here.'
  }
}
