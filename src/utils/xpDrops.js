// Floating "+X skill XP" drops during combat, feeding the same
// <XpDropOverlay> the background-activity path already uses.
//
// Combat emits an `xp` event per hit, and both skills of a melee swing land on
// the same tick, so a tick's events are aggregated per skill before they are
// dispatched — otherwise a single swing reads as two or three separate drops.
//
// In a co-op fight every member's events arrive on the same feed. Filtering to
// the viewer's own characterId is what makes an XP drop mean "that hit was
// mine" — the shared boss HP bar cannot tell you that on its own.
//
// Every number reaching here is already what the player BANKED, never what the
// engine rolled: the engine has no account type, so a Grindman's half-XP cut is
// taken at the funnel that writes the XP (grantXP on the client, the co-op
// room's applyConsumptionEvents, grantSessionXp in the world) and the event
// carries the result. Nothing on this side re-derives it — a display that does
// its own arithmetic is a second rule to keep in step with the first.

export function xpDropsFromCombatEvents(events, selfCharacterId) {
  const totals = new Map()
  const self = selfCharacterId == null ? null : Number(selfCharacterId)
  for (const ev of events || []) {
    if (!ev || ev.type !== 'xp' || !ev.xpSkills || typeof ev.xpSkills !== 'object') continue
    if (self !== null && Number(ev.characterId) !== self) continue
    for (const [skill, amount] of Object.entries(ev.xpSkills)) {
      const gained = Math.floor(Number(amount) || 0)
      if (gained <= 0) continue
      totals.set(skill, (totals.get(skill) || 0) + gained)
    }
  }
  return [...totals.entries()].map(([skill, amount]) => ({ skill, amount }))
}

/**
 * Drops from a tick's banked XP, keyed by skill — the solo fight's route, where
 * grantXP hands back what it wrote and nothing has to read the events twice.
 */
export function dropsFromBankedXp(bankedXp) {
  return Object.entries(bankedXp || {})
    .map(([skill, amount]) => ({ skill, amount: Math.floor(Number(amount) || 0) }))
    .filter((drop) => drop.amount > 0)
}

export function emitXpDrops(drops) {
  if (typeof window === 'undefined' || !drops?.length) return
  for (const drop of drops) {
    // A gain the account type rounds away to nothing is no drop at all.
    if (!(drop?.amount > 0)) continue
    window.dispatchEvent(new CustomEvent('pocketrpg:xp-gain', { detail: { skill: drop.skill, amount: drop.amount } }))
  }
}
