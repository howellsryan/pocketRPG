import { getPlace } from '../engine/world.js'
import { travelFraction, travelDestName, formatTravelTicks } from '../engine/travel.js'
import { journeyStatus } from '../engine/journeys.js'
import { formatRuneCost } from '../engine/teleports.js'
import GameIcon from './GameIcon.jsx'
import TeleportRuneCost from './TeleportRuneCost.jsx'
import { getSkillArt } from '../utils/skillArt.js'

/**
 * The travel-in-progress card's content: lead + ETA, progress bar, route, and
 * the action row (Teleport ahead / Turn back, plus whatever `extraActions`
 * the caller adds — TravelStatusModal's "World" button). Pure presentation —
 * WorldMapScreen wraps this in its `.wm-travelbar` chrome for the inline map
 * overlay, TravelStatusModal wraps it in the shared `Modal` for every other
 * screen. Keeping one component means the two can never show different text
 * or a different rune bill for the same trip.
 */
export default function TravelStatusContent({ travel, teleCheckFor, itemsData, onTeleport, onCancel, extraActions = null }) {
  if (!travel) return null
  const js = journeyStatus(travel)
  // Skip the walk: teleport straight to the leg's destination (journeys then
  // start their search there). Hidden mid-search — nothing to skip.
  const tele = js?.searching ? null : teleCheckFor(travel.dest)

  return (
    <>
      <div class="wm-travelbar-top">
        <span class="wm-travelbar-lead">
          {js
            ? <>{js.icon} {js.searching ? <>Searching <b>{travelDestName(travel)}</b></> : <>Following the trail to <b>{travelDestName(travel)}</b></>}</>
            : <>Travelling to <b>{travelDestName(travel)}</b></>}
        </span>
        <span class="wm-travelbar-ticks">{formatTravelTicks((travel.totalTicks ?? 0) - (travel.ticksRemaining ?? 0))} / {formatTravelTicks(travel.totalTicks ?? 0)}</span>
      </div>
      <div class="wm-track"><div class="wm-track-fill" style={{ width: Math.round(travelFraction(travel) * 100) + '%' }} /></div>
      <div class="wm-travelbar-route">
        {js
          ? `${js.name} — step ${js.step} of ${js.steps}`
          : `Route: ${(travel.path || []).map((id) => getPlace(id)?.name || id).join(' → ')}`}
      </div>
      <div class="wm-travelbar-actions">
        {tele && (
          <button
            class={`wm-travelbar-tele${tele.ok ? '' : ' is-locked'}`}
            onClick={() => tele.ok ? onTeleport() : null}
            disabled={!tele.ok}
            title={tele.ok ? `Consumes ${formatRuneCost(tele.runes, itemsData)} · +${tele.xp} Magic XP` : tele.reason}
          >
            <span class="wm-travelbar-tele__lead">
              <GameIcon iconKey={getSkillArt('magic').icon} color={tele.ok ? '#fff' : 'var(--text-faint)'} size={16} /> Teleport ahead
            </span>
            {/* The cost used to live in a title attribute, which a phone
                never shows. */}
            <TeleportRuneCost runes={tele.runeCost} size={13} />
          </button>
        )}
        {extraActions}
        <button class="wm-travelbar-cancel" onClick={onCancel}>{js ? 'Abandon journey' : 'Turn back'}</button>
      </div>
    </>
  )
}
