// Hit-splat mapping: turns combat tick events into floating damage splats
// rendered by <HitSplatLayer> over the combatant HP bars. Pure logic so the
// event→splat contract is regression-testable; the PvP redesign can reuse it
// by mapping its own event stream into the same splat shape.

export const HIT_SPLAT_DURATION_MS = 900

let hitSplatSeq = 0

function makeHitSplat(value, variant) {
  hitSplatSeq += 1
  return {
    id: hitSplatSeq,
    value: Math.max(0, Math.floor(Number(value) || 0)),
    // Random horizontal offset so simultaneous splats don't stack exactly.
    left: 25 + Math.floor(Math.random() * 50),
    // Optional colour variant (e.g. 'summon' → orange). Undefined = default
    // red damage / blue zero splat.
    ...(variant ? { variant } : {}),
  }
}

// Maps one tick's PvE combat events to splats per target.
// Returns { monster, add, player } — damage the player dealt to the boss, to
// its spawned add, and damage the player took. Damage the player dealt is
// routed by the event's `toAdd` flag, so hitting the add never splats over the
// boss's HP bar. A 0-value splat is a miss/blocked hit.
export function splatsFromCombatEvents(events) {
  const monster = []
  const add = []
  const player = []
  for (const ev of events || []) {
    if (!ev) continue
    const dealt = ev.toAdd ? add : monster
    if (ev.type === 'playerHit') {
      dealt.push(makeHitSplat(ev.damage))
    } else if (ev.type === 'specialHit') {
      for (const hit of ev.hits || []) dealt.push(makeHitSplat(hit))
    } else if (ev.type === 'summonHit') {
      // The summon always attacks the boss, never the add. Multi-hit
      // creatures (Steel Titan = 3) carry each swing in `hits` — splat every
      // one, or a triple hit reads as a single combined number.
      for (const hit of ev.hits || [ev.damage]) monster.push(makeHitSplat(hit, 'summon'))
    } else if (ev.type === 'monsterHit') {
      player.push(makeHitSplat(ev.damage))
    } else if (ev.type === 'monsterMiss') {
      player.push(makeHitSplat(0))
    } else if (ev.type === 'dragonfireHit') {
      player.push(makeHitSplat(ev.damage))
    }
  }
  return { monster, add, player }
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

// Maps a co-op boss tick's events to splats for one viewer. Every member's
// events arrive tagged with the `characterId` whose session produced them, so
// damage dealt to the boss shows for the whole group (that is the shared HP
// bar everyone is chipping at) while incoming damage only splats for the member
// the boss actually swung at. Returns { boss, add, player }.
export function splatsFromCoopEvents(events, selfCharacterId) {
  const boss = []
  const add = []
  const player = []
  const selfId = Number(selfCharacterId)
  for (const ev of events || []) {
    if (!ev) continue
    const mine = Number(ev.characterId) === selfId
    const dealt = ev.toAdd ? add : boss
    if (ev.type === 'playerHit') {
      dealt.push(makeHitSplat(ev.damage))
    } else if (ev.type === 'specialHit') {
      for (const hit of ev.hits || []) dealt.push(makeHitSplat(hit))
    } else if (ev.type === 'summonHit') {
      for (const hit of ev.hits || [ev.damage]) boss.push(makeHitSplat(hit, 'summon'))
    } else if (mine && ev.isTarget && (ev.type === 'monsterHit' || ev.type === 'dragonfireHit')) {
      player.push(makeHitSplat(ev.damage))
    } else if (mine && ev.isTarget && ev.type === 'monsterMiss') {
      player.push(makeHitSplat(0))
    } else if (mine && ev.type === 'boltProc' && ev.selfDamage) {
      // Blood-forfeit recoil: self-inflicted, so it lands whoever the boss faces.
      player.push(makeHitSplat(ev.selfDamage))
    }
  }
  return { boss, add, player }
}
