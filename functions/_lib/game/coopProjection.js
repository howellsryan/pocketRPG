// What a co-op room actually sends a client, and how it replays what they
// missed. Pure so both are testable without a Durable Object.
//
// Two separate problems, both of them the transport's fault rather than the
// engine's:
//
//   1. The room state carries every member's full pack, worn gear, skill levels
//      and quest list. Only their own is any of a player's business, and a
//      shared boss fight broadcasts state at ~1.7Hz — so the wire format is a
//      projection, never the raw state.
//   2. Members poll independently, so any given client misses most ticks. The
//      room keeps a short event ring and replays everything after the tick the
//      client last acknowledged, or a player watching a fight they are losing
//      sees a silent boss and none of their own hit splats.

/** Ticks of history the room keeps. ~72s at 600ms, comfortably longer than the
 * poll gap a backgrounded phone produces before its member is ejected anyway. */
export const COOP_EVENT_HISTORY_TICKS = 120
/** Hard ceiling so eight members swinging at once cannot grow the ring without
 * bound between the tick-window trims. */
export const COOP_EVENT_HISTORY_MAX = 600

/** Public view of somebody else in the fight: enough to render the damage
 * table and the boss's current target, and nothing else. */
export function publicMember(member) {
  return {
    characterId: member.characterId,
    username: member.username,
    damage: member.damage || 0,
    hp: member.hp,
    maxHP: member.maxHP,
    status: member.status,
  }
}

/**
 * The room state as one member is allowed to see it: their own record in full,
 * everyone else reduced to the damage table.
 */
export function projectStateForMember(state, characterId) {
  if (!state) return null
  const selfKey = String(characterId)
  const members = {}
  for (const [id, member] of Object.entries(state.members || {})) {
    members[id] = id === selfKey ? member : publicMember(member)
  }
  return {
    tick: state.tick || 0,
    bossId: state.bossId,
    boss: state.boss,
    targetCharId: state.targetCharId ?? null,
    members,
    memberCount: Object.keys(state.members || {}).length,
  }
}

/** Everything that happened after the tick this client last acknowledged. */
export function eventsSince(events, sinceTick) {
  const since = Number(sinceTick)
  if (!Array.isArray(events)) return []
  if (!Number.isFinite(since)) return [...events]
  return events.filter((ev) => (Number(ev?.tick) || 0) > since)
}

/** Appends a tick's events and trims the ring by both age and count. */
export function pushEvents(ring, events, currentTick) {
  const next = [...(ring || []), ...(events || [])]
  const cutoff = (Number(currentTick) || 0) - COOP_EVENT_HISTORY_TICKS
  const aged = next.filter((ev) => (Number(ev?.tick) || 0) > cutoff)
  return aged.length > COOP_EVENT_HISTORY_MAX ? aged.slice(-COOP_EVENT_HISTORY_MAX) : aged
}

/**
 * Members whose client has gone quiet for longer than the grace period. The
 * room ejects these itself — the save lock follows the member, so a player
 * whose tab crashed has to be released even while the room fights on without
 * them.
 */
export function staleMemberIds(state, lastSeen, now, staleMs) {
  const out = []
  for (const id of Object.keys(state?.members || {})) {
    const seen = Number(lastSeen?.[id])
    if (!Number.isFinite(seen) || now - seen >= staleMs) out.push(id)
  }
  return out
}
