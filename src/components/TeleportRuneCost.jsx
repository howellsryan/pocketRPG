import GameIcon from './GameIcon.jsx'
import itemsData from '../data/items.json'

/**
 * The runes a teleport takes, as icons with counts.
 *
 * Shown whether or not the cast is currently possible — a locked teleport is
 * exactly when a player needs to know what to go and buy, and the reason text
 * ("Not enough runes") never said which. A rune the player is short of shows
 * have/need against the full cost.
 *
 * The bill comes from `teleportRuneCost` (engine), so it already excludes
 * anything an equipped staff supplies.
 */
export default function TeleportRuneCost({ runes = [], size = 14 }) {
  if (!runes.length) return null
  return (
    <span class="wm-runecost">
      {runes.map((rune) => (
        <span
          key={rune.itemId}
          class={'wm-runecost__item' + (rune.short ? ' is-short' : '')}
          title={`${rune.name}: ${rune.have.toLocaleString()} of ${rune.need.toLocaleString()}`}
        >
          <GameIcon item={itemsData[rune.itemId]} size={size} />
          <span class="wm-runecost__n">{rune.short ? `${rune.have}/${rune.need}` : rune.need}</span>
        </span>
      ))}
    </span>
  )
}
