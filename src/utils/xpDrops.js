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

export function emitXpDrops(drops) {
  if (typeof window === 'undefined' || !drops?.length) return
  for (const drop of drops) {
    window.dispatchEvent(new CustomEvent('pocketrpg:xp-gain', { detail: { skill: drop.skill, amount: drop.amount } }))
  }
}
