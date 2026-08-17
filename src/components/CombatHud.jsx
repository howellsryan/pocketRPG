import GameIcon from './GameIcon.jsx'
import SkillEmblem from './SkillEmblem.jsx'

// Shared building blocks for the mobile combat HUD, used by BOTH the solo
// CombatScreen and the co-op CoopBossScreen so the two fights look identical.
// Pure presentation — each screen supplies its own values and handlers.

// `meta` is a slot under the name for fight-specific readouts the solo screen
// has no equivalent of (the co-op loot-share bar). Optional, so adding one never
// changes the solo header.
export function CombatFightHead({ icon, accent, name, nameColor, sub, meta, combatLevel, onInfo, aside }) {
  return (
    <div class="cb-fight__head">
      <div class="cb-fight__id">
        <SkillEmblem iconKey={icon} accent={accent} size={34} glow={0} />
        <div class="min-w-0">
          <div class="cb-fight__name" style={{ color: nameColor }}>{name}</div>
          {sub && <div class="cb-fight__sub">{sub}</div>}
          {meta}
        </div>
      </div>
      <span class="flex items-center gap-1.5 flex-shrink-0">
        {aside}
        {onInfo ? (
          <button class="cb-fight__cb" onClick={onInfo} aria-label={`${name} info`}>
            CB {combatLevel}
            <GameIcon iconKey="info" color="#e0564b" size={13} />
          </button>
        ) : (
          <span class="cb-fight__cb">CB {combatLevel}</span>
        )}
      </span>
    </div>
  )
}

