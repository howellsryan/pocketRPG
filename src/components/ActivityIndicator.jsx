import { useGame } from '../state/gameState.jsx'
import { SKILL_ICONS, SCREENS } from '../utils/constants.js'
import SkillIcon from './SkillIcon.jsx'

/**
 * Compact indicator for the currently running background task: the activity's
 * icon wrapped in a progress ring that fills green as the current action
 * completes. Tapping it jumps to the activity's screen.
 */

function describeTask(task) {
  if (!task) return null
  switch (task.type) {
    case 'skill':
      return { skill: task.skill, icon: SKILL_ICONS[task.skill] || '🔨', screen: SCREENS.SKILLS, label: task.skill }
    case 'gather':
      if (task.gatherTask?.oneShot || task.gatherTask?.isClue) return null
      return { icon: task.gatherTask?.icon || '🌿', screen: SCREENS.GATHER, label: task.gatherTask?.name || 'Gathering' }
    case 'agility':
      return { skill: 'agility', icon: SKILL_ICONS.agility || '🏃', screen: SCREENS.AGILITY, label: 'Agility' }
    case 'thieving':
      return { skill: 'thieving', icon: SKILL_ICONS.thieving || '🗝️', screen: SCREENS.SKILLS, label: 'Thieving' }
    case 'hunter':
      return { skill: 'hunter', icon: SKILL_ICONS.hunter || '🪤', screen: SCREENS.SKILLS, label: 'Hunter' }
    case 'quest':
      return { icon: '📜', screen: SCREENS.QUESTS, label: task.quest?.name || 'Quest' }
    case 'minigame':
      return { icon: task.minigameTask?.icon || '🎮', screen: SCREENS.MINIGAMES, label: task.minigameTask?.name || 'Minigame' }
    case 'clue':
      return { icon: '🗺️', screen: SCREENS.CLUES, label: 'Clue scroll' }
    default:
      return null
  }
}

export default function ActivityIndicator({ onNavigate }) {
  const { activeTask } = useGame()
  const info = describeTask(activeTask)
  if (!info) return null

  const total = Number(activeTask.totalTicks) || 0
  const remaining = Number(activeTask.ticksRemaining)
  const hasProgress = total > 0 && Number.isFinite(remaining)
  const progress = hasProgress ? Math.max(0, Math.min(1, (total - remaining) / total)) : 0

  const size = 30
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - progress)

  return (
    <button
      type="button"
      onClick={() => onNavigate && onNavigate(info.screen)}
      title={`Running: ${info.label}`}
      aria-label={`Active task: ${info.label}`}
      class="relative flex items-center justify-center bg-transparent border-0 p-0 cursor-pointer"
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <style>{`@keyframes pocketrpg-activity-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }`}</style>
      <svg width={size} height={size} class="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a2a" stroke-width={stroke} />
        {hasProgress && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-hp-green)"
            stroke-width={stroke}
            stroke-linecap="round"
            stroke-dasharray={c}
            stroke-dashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.25s linear' }}
          />
        )}
      </svg>
      <span
        class="flex items-center justify-center text-[13px] leading-none"
        style={hasProgress ? undefined : { animation: 'pocketrpg-activity-pulse 1.6s ease-in-out infinite' }}
      >
        {info.skill ? <SkillIcon skill={info.skill} size={16} title={info.label} /> : info.icon}
      </span>
    </button>
  )
}
