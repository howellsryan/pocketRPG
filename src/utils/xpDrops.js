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
// Combat events carry the BASE XP: the engine has no account type, and the
// world server applies its own cut on the way out (world/server/tick.ts). So
// the account-type cut lands here, at the display, the same as grantXP applies
// it at the bank — a drop that reads +4 for a Grindman who banked 2 is a lie
// about the mode the player chose.

import { grindmanXP } from '../engine/grindman.js'

/**
 * The number a drop shows: what this account will actually bank. Applied per
 * gain and never to a total, because grantXP and the co-op room both floor per
 * gain — halving an aggregated 5 + 5 would show +5 against the 4 banked.
 */
export function xpDropAmount(amount, isGrindman) {
  return Math.floor(grindmanXP(Number(amount) || 0, isGrindman === true))
}

export function xpDropsFromCombatEvents(events, selfCharacterId, { isGrindman = false } = {}) {
  const totals = new Map()
  const self = selfCharacterId == null ? null : Number(selfCharacterId)
  for (const ev of events || []) {
    if (!ev || ev.type !== 'xp' || !ev.xpSkills || typeof ev.xpSkills !== 'object') continue
    if (self !== null && Number(ev.characterId) !== self) continue
    for (const [skill, amount] of Object.entries(ev.xpSkills)) {
      const gained = xpDropAmount(amount, isGrindman)
      if (gained <= 0) continue
      totals.set(skill, (totals.get(skill) || 0) + gained)
    }
  }
  return [...totals.entries()].map(([skill, amount]) => ({ skill, amount }))
}

export function emitXpDrops(drops) {
  if (typeof window === 'undefined' || !drops?.length) return
  for (const drop of drops) {
    // A gain the account type rounds away to nothing is no drop at all.
    if (!(drop?.amount > 0)) continue
    window.dispatchEvent(new CustomEvent('pocketrpg:xp-gain', { detail: { skill: drop.skill, amount: drop.amount } }))
  }
}
