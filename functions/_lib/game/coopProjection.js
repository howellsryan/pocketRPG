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
 * Everything that happened after the tick this client last acknowledged, up to
 * the last tick the room is willing to publish.
 *
 * `untilTick` is not decoration. Events are keyed by the tick they happened on
 * and a client acknowledges the tick it was told about, so anything appended to
 * a tick AFTER a client acknowledged it is filtered out by `> since` forever.
 * That is exactly the shape of a kill: the engine emits `bossDefeated`
 * immediately, then settlement takes several D1 round-trips per winner and
 * appends `killSettled` to the same tick. A poll landing in that window used to
 * acknowledge the tick and never see the loot.
 */
export function eventsSince(events, sinceTick, untilTick = Infinity) {
  const since = Number(sinceTick)
  const until = Number(untilTick)
  if (!Array.isArray(events)) return []
  const capped = Number.isFinite(until)
    ? events.filter((ev) => (Number(ev?.tick) || 0) <= until)
    : events
  if (!Number.isFinite(since)) return [...capped]
  return capped.filter((ev) => (Number(ev?.tick) || 0) > since)
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
