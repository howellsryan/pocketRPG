import Modal from './Modal.jsx'
import { useGame } from '../state/gameState.jsx'
import { getPlace, shortestPath } from '../engine/world.js'
import { describeActivity } from '../engine/worldContent.js'
import { formatTravelTicks } from '../engine/travel.js'

/**
 * Travel confirm / location picker. Rendered globally from App; shows itself when a gated
 * activity start (gameState.requestActivityStart) needs the player to travel. A single
 * candidate place is a confirm; multiple are a picker. Phase 3 of the map-driven overhaul.
 *
 * `originScreen`/`originScreenData` are the screen the player was on when the prompt
 * fired (App's `screen`/`actionData`) — carried into the travel task as `returnTo` so
 * arrival's back/stop buttons return there instead of a hardcoded destination.
 */
export default function TravelPrompt({ originScreen, originScreenData }) {
  const { travelPrompt, worldLocation, startTravelTo, dismissTravelPrompt } = useGame()
  if (!travelPrompt) return null

  const { kind, ref, places } = travelPrompt
  const desc = describeActivity(kind, ref)
  const options = (places || [])
    .map((id) => ({ id, place: getPlace(id), ticks: shortestPath(worldLocation, id)?.ticks ?? null }))
    .sort((a, b) => (a.ticks ?? Infinity) - (b.ticks ?? Infinity))

  const multi = options.length > 1
  const lead = multi
    ? `${desc.name} is available at more than one place. Choose where to travel:`
    : `${desc.name} is at ${options[0]?.place?.name || 'another place'}. Travel there?`

  // Confirming travel starts the walk right where the player already is —
  // TravelStatusModal (rendered globally from App) then takes over showing
  // progress, so there's no need to relocate the player to watch it happen.
  // The screen they were on still rides along as returnTo, for arrival's
  // back/stop buttons.
  const chooseDestination = (placeId) => {
    const returnTo = originScreen ? { screen: originScreen, data: originScreenData } : undefined
    startTravelTo(placeId, returnTo)
  }

  return (
    <Modal title={multi ? 'Where to?' : 'Travel here?'} onClose={dismissTravelPrompt}>
      <div class="wm-tp">
        <p class="wm-tp-lead">
          <span class="wm-tp-act">{desc.icon} <strong>{desc.name}</strong>{desc.level != null ? ` · Lv ${desc.level}` : ''}</span>
        </p>
        <p class="wm-tp-sub">{lead}</p>
        <div class="wm-tp-list">
          {options.map((o) => (
            <button class="wm-tp-option" key={o.id} onClick={() => chooseDestination(o.id)}>
              <span class="wm-tp-place">{o.place?.icon} {o.place?.name || o.id}</span>
              <span class="wm-tp-ticks">{o.ticks != null ? formatTravelTicks(o.ticks) : '—'}</span>
            </button>
          ))}
        </div>
        <button class="wm-tp-cancel" onClick={dismissTravelPrompt}>Not now</button>
      </div>
    </Modal>
  )
}
