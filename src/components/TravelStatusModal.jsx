import { useEffect, useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { useTravelStatus } from '../hooks/useTravelStatus.js'
import { SCREENS } from '../utils/constants.js'
import Modal from './Modal.jsx'
import TravelStatusContent from './TravelStatusContent.jsx'
import GameIcon from './GameIcon.jsx'

/**
 * Travel status shown on whatever screen the player is actually on, so
 * confirming a gated activity's travel prompt no longer forces a redirect to
 * the World Map just to watch the walk happen — App renders this instead of
 * (never alongside) the World Map's own inline copy, `.wm-travelbar`, so a
 * `screen` prop gates it rather than App choosing whether to mount it at all:
 * staying mounted across every screen (App renders it unconditionally, same
 * as TravelPrompt) means `dismissedDest` below survives a screen change,
 * including a round trip through the World Map — a conditional *mount*
 * instead would reset it there, showing the same trip's card again.
 *
 * Dismissible (backdrop tap / Escape / no action needed) so the player can
 * get back to whatever they were doing — travel keeps ticking in the
 * background regardless of screen (App's tick loop), same as it always has.
 * Dismissal is per-trip: a fresh `travel` (a new destination) un-dismisses it.
 */
export default function TravelStatusModal({ screen, onGoToWorldMap, onAutoStart }) {
  const { itemsData } = useGame()
  const { travel, teleCheckFor, castTeleport, cancelTravel } = useTravelStatus({ onAutoStart })
  const [dismissedDest, setDismissedDest] = useState(null)

  useEffect(() => {
    if (!travel) setDismissedDest(null)
  }, [travel])

  if (!travel || screen === SCREENS.WORLD_MAP || dismissedDest === travel.dest) return null

  return (
    <Modal onClose={() => setDismissedDest(travel.dest)}>
      <TravelStatusContent
        travel={travel}
        teleCheckFor={teleCheckFor}
        itemsData={itemsData}
        onTeleport={() => castTeleport(travel.dest)}
        onCancel={cancelTravel}
        extraActions={
          <button class="wm-travelbar-skip" onClick={onGoToWorldMap}>
            <GameIcon iconKey="globe" size={16} color="var(--color-gold-light)" /> World
          </button>
        }
      />
    </Modal>
  )
}
