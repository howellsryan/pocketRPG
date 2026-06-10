// Hit-splat mapping: turns combat tick events into floating damage splats
// rendered by <HitSplatLayer> over the combatant HP bars. Pure logic so the
// event→splat contract is regression-testable; the PvP redesign can reuse it
// by mapping its own event stream into the same splat shape.

export const HIT_SPLAT_DURATION_MS = 900

let hitSplatSeq = 0

function makeHitSplat(value) {
  hitSplatSeq += 1
  return {
    id: hitSplatSeq,
    value: Math.max(0, Math.floor(Number(value) || 0)),
    // Random horizontal offset so simultaneous splats don't stack exactly.
    left: 25 + Math.floor(Math.random() * 50),
  }
}

// Maps one tick's PvE combat events to splats per target.
// Returns { monster: [...], player: [...] } — splats to show over the
// monster's HP bar (damage the player dealt) and the player's HP bar
// (damage the player took). A 0-value splat is a miss/blocked hit.
export function splatsFromCombatEvents(events) {
  const monster = []
  const player = []
  for (const ev of events || []) {
    if (!ev) continue
    if (ev.type === 'playerHit') {
      monster.push(makeHitSplat(ev.damage))
    } else if (ev.type === 'specialHit') {
      for (const hit of ev.hits || []) monster.push(makeHitSplat(hit))
    } else if (ev.type === 'monsterHit') {
      player.push(makeHitSplat(ev.damage))
    } else if (ev.type === 'monsterMiss') {
      player.push(makeHitSplat(0))
    } else if (ev.type === 'dragonfireHit') {
      player.push(makeHitSplat(ev.damage))
    }
  }
  return { monster, player }
}

// Maps PvP tick events (the engine's tick-tagged recentEvents entries) to
// splats per side for the given viewer. Returns { self: [...], opp: [...] } —
// damage you take shows over your HP badge, damage you deal over the
// opponent's. Multi-hit specials splat each hit; 0 is a miss/blocked hit.
export function splatsFromPvpEvents(events, selfCharacterId) {
  const self = []
  const opp = []
  const selfId = Number(selfCharacterId)
  for (const ev of events || []) {
    if (!ev || ev.type !== 'attack') continue
    const target = Number(ev.defenderCharacterId) === selfId ? self : opp
    const hits = Array.isArray(ev.hits) && ev.hits.length > 0 ? ev.hits : [ev.damage]
    for (const hit of hits) target.push(makeHitSplat(hit))
  }
  return { self, opp }
}
