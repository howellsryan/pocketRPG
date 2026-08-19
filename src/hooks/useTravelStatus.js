import { useGame } from '../state/gameState.jsx'
import { getWorld, getPlace } from '../engine/world.js'
import { travelCancelLocation, travelDestName } from '../engine/travel.js'
import { teleportIntoJourney } from '../engine/journeys.js'
import { teleportCheck, deductRunes, teleportRuneCost } from '../engine/teleports.js'
import { getLevelFromXP } from '../engine/experience.js'

/**
 * Shared "travel in progress" mechanics: the teleport-ahead check/cast and the
 * cancel ("turn back") action. Used by both WorldMapScreen's inline travel bar
 * and TravelStatusModal (the same status shown on any other screen) — one
 * source of truth for what a rune bill costs and what landing does, so the two
 * surfaces can't drift.
 *
 * `onAutoStart` fires when a teleport-ahead completes a trip that had a
 * pending gated-activity start riding it (same contract as arrival's own
 * resumeAutoStart). `onLandedFree` fires only for a free landing — no journey,
 * no autoStart — so a caller with its own place-hub UI (WorldMapScreen) can
 * open it; a caller with no such UI (TravelStatusModal) can leave it unset.
 */
export function useTravelStatus({ onAutoStart, onLandedFree } = {}) {
  const {
    worldLocation, updateWorldLocation, activeTask, setActiveTask, addToast,
    inventory, bank, equipment, stats, itemsData, updateInventory, updateBankDirect, grantXP,
  } = useGame()
  const world = getWorld()
  const here = getPlace(worldLocation) ? worldLocation : world.start
  const travel = activeTask?.type === 'travel' ? activeTask : null
  const magicLevel = getLevelFromXP(stats?.magic?.xp || 0)

  // Instant magic travel: needs the place's Magic level + runes (world.json
  // `teleport`), consumes them inventory-first like spellcasting, grants Magic
  // XP. The rune bill rides along with the check so a teleport button can show
  // what a cast costs — including when it is locked, which is exactly when the
  // player needs to know what to go and buy.
  const teleCheckFor = (destId) => {
    const chk = teleportCheck(destId, { magicLevel, inventory, bank, equipment, itemsData })
    return { ...chk, runeCost: teleportRuneCost(chk.runes, { inventory, bank, itemsData }) }
  }

  const castTeleport = (destId) => {
    if (destId === here && !travel) return
    if (travel?.journey?.phase === 'search') {
      addToast(`You're searching ${travelDestName(travel)} — finish or abandon the journey first.`, 'warning')
      return
    }
    const chk = teleCheckFor(destId)
    if (!chk.ok) {
      addToast(chk.reason, 'error')
      return
    }
    let nextTask = null
    let searching = false
    if (travel?.journey) {
      const re = teleportIntoJourney(travel, destId)
      if (!re) {
        addToast('The trail cannot continue from there.', 'error')
        return
      }
      nextTask = re.task
      searching = re.searching
    }
    const paid = deductRunes(chk.runes, inventory)
    if (!paid) {
      addToast('Not enough runes.', 'error')
      return
    }
    // Teleporting straight to the place a walked action was headed for still
    // auto-starts it on arrival — parity with walking or skipping the trail.
    const pendingAutoStart = (travel && !travel.journey && travel.autoStart && destId === travel.dest)
      ? travel.autoStart : null
    updateInventory(paid.inventory)
    if (Object.keys(paid.bankUpdates).length > 0) updateBankDirect(paid.bankUpdates)
    grantXP('magic', chk.xp)
    updateWorldLocation(destId)
    setActiveTask(nextTask)
    // Carry the trip's own returnTo (the screen the player confirmed travel
    // from) into the auto-start, same as arrival does — without it, resuming
    // here would fall back to the World Map, which is wrong for a teleport
    // triggered from TravelStatusModal on some other screen entirely.
    if (pendingAutoStart) onAutoStart?.(pendingAutoStart, travel.returnTo)
    else if (!nextTask) onLandedFree?.(destId)
    const name = getPlace(destId)?.name || destId
    addToast(searching ? `Teleported to ${name} — the search begins` : `Teleported to ${name}`, 'info')
  }

  // Turning back keeps the legs already walked: snap to the last node fully reached
  // rather than reverting the whole journey to its origin. Abandoning a clue/quest
  // journey costs nothing but the time spent — the scroll/quest is only consumed on
  // the final search.
  const cancelTravel = () => {
    if (!travel) return
    const journey = !!travel.journey
    const stopAt = travelCancelLocation(travel)
    setActiveTask(null)
    if (stopAt && stopAt !== here) {
      updateWorldLocation(stopAt)
      addToast(`${journey ? 'Journey abandoned' : 'Travel cancelled'} — you stop at ${getPlace(stopAt)?.name || stopAt}`, 'info')
    } else {
      addToast(journey ? 'Journey abandoned' : 'Travel cancelled', 'info')
    }
  }

  return { travel, teleCheckFor, castTeleport, cancelTravel }
}
