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
 * Public view of somebody in a raid LOBBY: the above plus what they are
 * bringing.
 *
 * A raid party sizes itself up before it sets off — a lobby that cannot show
 * you a member's gear cannot tell you whether the run is worth starting — so
 * inspecting a party member's kit is the point of the screen, not a leak.
 * Deliberately confined to the lobby: during the fight the room broadcasts at
 * ~1.7Hz and eight full packs per beat is payload nobody reads.
 */
export function lobbyMember(member) {
  return {
    ...publicMember(member),
    levels: member.levels || null,
    equipment: member.equipment || {},
    inventory: Array.isArray(member.inventory) ? member.inventory : [],
    joinedAt: member.joinedAt ?? null,
  }
}

/**
 * The room state as one member is allowed to see it: their own record in full,
 * everyone else reduced to the damage table — or, in a raid lobby, to the
 * damage table plus their kit.
 */
export function projectStateForMember(state, characterId) {
  if (!state) return null
  const selfKey = String(characterId)
  const inLobby = state.phase === 'lobby'
  const members = {}
  for (const [id, member] of Object.entries(state.members || {})) {
    if (id === selfKey) members[id] = member
    else members[id] = inLobby ? lobbyMember(member) : publicMember(member)
  }
  return {
    tick: state.tick || 0,
    bossId: state.bossId,
    boss: state.boss,
    targetCharId: state.targetCharId ?? null,
    phase: state.phase || 'active',
    hostCharacterId: state.hostCharacterId ?? null,
    raid: state.raid || null,
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
