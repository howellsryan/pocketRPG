import { SKILL_ICONS } from '../utils/constants.js'
import { getLevelProgress, getXPToNextLevel } from '../engine/experience.js'
import { formatNumber } from '../utils/helpers.js'
import ProgressBar from './ProgressBar.jsx'

export default function SkillBadge({ skill, xp, level, onClick, compact = false }) {
  const icon = SKILL_ICONS[skill] || '❓'
  const progress = getLevelProgress(xp)
  const toNext = getXPToNextLevel(xp)
  const name = skill.charAt(0).toUpperCase() + skill.slice(1)

  if (compact) {
    return (
      <button
        onClick={() => onClick?.(skill)}
        class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] active:bg-[#222] w-full"
      >
        <span class="text-sm">{icon}</span>
        <span class="text-xs text-[var(--color-parchment)] flex-1 text-left truncate">{name}</span>
        <span class="text-xs font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{level}</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => onClick?.(skill)}
      class="flex flex-col p-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] active:bg-[#222] transition-colors"
    >
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center gap-1.5">
          <span class="text-base">{icon}</span>
          <span class="text-xs font-semibold text-[var(--color-parchment)]">{name}</span>
        </div>
        <span class="text-sm font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{level}</span>
      </div>
      <ProgressBar value={progress} max={1} height="h-1.5" />
      <div class="text-[9px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-40 mt-1">
        {level >= 99 ? 'MAX' : `${formatNumber(toNext)} to ${level + 1}`}
      </div>
    </button>
  )
}
