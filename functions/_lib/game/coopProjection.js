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

import {
  ROOM_EVENT_HISTORY_MAX,
  ROOM_EVENT_HISTORY_TICKS,
  eventsSince,
  pushEvents,
} from './roomEvents.js'

// The event ring is transport machinery the PvP match room needs too, so it
// lives in roomEvents.js. Re-exported under the co-op names its callers use.
export const COOP_EVENT_HISTORY_TICKS = ROOM_EVENT_HISTORY_TICKS
export const COOP_EVENT_HISTORY_MAX = ROOM_EVENT_HISTORY_MAX
export { eventsSince, pushEvents }

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

/**
 * A kill now pays every member past the damage threshold, so its event carries
 * each winner's drops — and the event ring is shared by the whole room. Strip
 * the other winners' item lists per poll, exactly as projectStateForMember
 * strips their packs: who won is public, what they got is not, and eight full
 * drop tables on every kill is payload nobody reads.
 */
export function projectEventsForMember(events, characterId) {
  const self = String(characterId)
  return (events || []).map((ev) => {
    if (ev?.type !== 'killSettled' || !Array.isArray(ev.settlements)) return ev
    const mine = String(ev.ownerCharacterId) === self
    return {
      ...ev,
      settlements: ev.settlements.map((s) => (
        String(s.characterId) === self ? s : { characterId: s.characterId, diverged: !!s.diverged }
      )),
      // Legacy single-winner fields describe the top-damage member.
      granted: mine ? ev.granted : [],
      killCount: mine ? ev.killCount : null,
    }
  })
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
