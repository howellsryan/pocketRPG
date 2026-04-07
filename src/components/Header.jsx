import { useGame } from '../state/gameState.jsx'
import { calcCombatLevel } from '../utils/helpers.js'
import { getLevelFromXP } from '../engine/experience.js'

export default function Header({ activity }) {
  const { player, stats, currentHP, getMaxHP } = useGame()
  if (!player) return null

  const maxHP = getMaxHP()
  const hpPct = maxHP > 0 ? (currentHP / maxHP) * 100 : 0
  const hpColor = hpPct > 50 ? 'var(--color-hp-green)' : hpPct > 25 ? 'var(--color-hp-yellow)' : 'var(--color-hp-red)'

  const levels = {}
  for (const [skill, data] of Object.entries(stats)) {
    levels[skill] = data.level || getLevelFromXP(data.xp)
  }
  const combatLevel = calcCombatLevel({
    attack: levels.attack || 1,
    strength: levels.strength || 1,
    defence: levels.defence || 1,
    hitpoints: levels.hitpoints || 10,
    prayer: levels.prayer || 1,
    ranged: levels.ranged || 1,
    magic: levels.magic || 1
  })

  const totalLevel = Object.values(levels).reduce((s, l) => s + l, 0)

  return (
    <header class="flex-shrink-0 bg-[#111] border-b border-[#333] px-3 py-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-[var(--font-display)] text-sm font-bold text-[var(--color-gold)] truncate">
            {player.name}
          </span>
          <span class="text-[10px] text-[var(--color-parchment)] opacity-60 whitespace-nowrap">
            CB {combatLevel} · Total {totalLevel}
          </span>
        </div>

        {/* HP bar */}
        <div class="flex items-center gap-1.5 ml-2">
          <span class="text-xs">❤️</span>
          <div class="w-20 h-3 bg-[#222] rounded-full overflow-hidden border border-[#444]">
            <div
              class="h-full rounded-full transition-all duration-300"
              style={{ width: `${hpPct}%`, backgroundColor: hpColor }}
            />
          </div>
          <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-80 min-w-[32px]">
            {currentHP}/{maxHP}
          </span>
        </div>
      </div>

      {activity && (
        <div class="text-[10px] text-[var(--color-gold-dim)] mt-0.5 truncate progress-active">
          {activity}
        </div>
      )}
    </header>
  )
}
