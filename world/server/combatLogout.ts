// Combat logging: you do not get to leave a fight by closing the tab.
//
// The whole Wilderness rests on this. "Drop everything on death" only means
// anything if death is actually reachable, and before this a player at 5 HP
// could close their browser and keep the lot — the exit beacon departed them
// inside a second, and a lingering player was skipped by the duel loop anyway.
//
// The rule is one clock. While a player is fighting, `combatBlockUntilTick` is
// pushed to `tick + COMBAT_LOGOUT_BLOCK_TICKS`; nothing may remove them from the
// world until it lapses. That covers every exit at once — the Log out button, a
// closing tab's `leave` frame, the out-of-band exit beacon and a socket that
// simply died — because they all end up asking this module the same question.
//
// Pure on purpose: the Durable Object cannot be imported by the test harness,
// and this is exactly the logic that must not be taken on trust.

/** ~10s. Long enough that disengaging to log out is a real gamble, short enough
 * that it does not sit on the character's save lock (CLAUDE.md §14). */
export const COMBAT_LOGOUT_BLOCK_TICKS = 17

/**
 * Hard ceiling on a combat linger, measured from the moment the player left.
 *
 * The block above refreshes for as long as somebody keeps swinging, which is
 * the point — but it also means a bug, or an attacker content to poke a corpse
 * forever, could hold the character's save lock indefinitely. 100 ticks (60s)
 * is far past any real fight and bounds the worst case.
 */
export const COMBAT_LINGER_MAX_TICKS = 100

export type CombatLogoutSubject = {
  charId: string
  /** A live PvE combat session, or null. */
  combat: { npcId: string } | null
  /** Wilderness single-combat opponent and how long the lock survives. */
  pvpOpponentId?: string | null
  pvpLockUntilTick?: number
}

/**
 * Is this player in a fight right now?
 *
 * Three ways to be, and the third is the one worth stating: an npc that has
 * this player as its `attackerId` is hunting them even when their own session
 * has ended (they walked out of reach — see combat.ts `reselectAttacker`), and
 * walking away from a dragon is not leaving combat.
 */
export function isFighting(
  player: CombatLogoutSubject,
  tick: number,
  npcAttackerIds: ReadonlySet<string>,
): boolean {
  if (player.combat) return true
  if (player.pvpOpponentId && (player.pvpLockUntilTick ?? 0) > tick) return true
  return npcAttackerIds.has(player.charId)
}

/** The block clock after this tick. Only ever moves forward — an out-of-combat
 * tick leaves it where it was, which is what makes it a countdown rather than a
 * flag that flickers off the instant a monster loses reach for one tick. */
export function nextCombatBlockUntil(current: number, tick: number, fighting: boolean): number {
  return fighting ? Math.max(current, tick + COMBAT_LOGOUT_BLOCK_TICKS) : current
}

/** May this player leave the world right now? */
export function logoutBlocked(combatBlockUntilTick: number, tick: number): boolean {
  return tick < combatBlockUntilTick
}

/** Player-facing refusal. One string, used for both the chat line and the
 * client's "your logout didn't happen" signal, so they cannot disagree. */
export const LOGOUT_BLOCKED_MESSAGE =
  'You can’t log out during a fight. You must be out of combat for 10 seconds.'

/**
 * Has a lingering player's grace period really run out?
 *
 * An ordinary linger (a dropped socket outside combat) passes `0` for the
 * deadline and is unchanged: it ends at `lingerUntilTick`. A combat linger sets
 * a deadline, and then survives until the fight has been over for the full
 * block — or until the ceiling, whichever comes first.
 */
export function lingerExpired(
  tick: number,
  lingerUntilTick: number,
  combatBlockUntilTick: number,
  combatLingerDeadline: number,
): boolean {
  if (tick < lingerUntilTick) return false
  if (tick >= combatLingerDeadline) return true
  return !logoutBlocked(combatBlockUntilTick, tick)
}
