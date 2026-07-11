import Card from '../components/Card.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { SCREENS } from '../utils/constants.js'

const ADVENTURE_LINKS = [
  { id: SCREENS.QUESTS,    label: 'Quests Board', iconKey: 'quest_scroll_blue' },
  { id: SCREENS.CLUES,     label: 'Clues',        iconKey: 'clue_scroll_purple' },
  { id: SCREENS.MINIGAMES, label: 'Minigames',    iconKey: 'minigame_scroll_red' },
  { id: SCREENS.GATHER,    label: 'Gather',       iconKey: 'kingsherb' },
]

export default function AdventuresScreen({ onNavigate }) {
  return (
    <div class="forge-shell h-full flex flex-col">
      <div class="flex-shrink-0 bg-[var(--color-void-light)] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="flex items-center gap-2 font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">
          <GameIcon iconKey="adventures_scroll" size={22} class="flex-shrink-0" />
          Adventures
        </h1>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4">
        <Card className="p-2">
          <div class="divide-y divide-[var(--color-void-border)]">
            {ADVENTURE_LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => onNavigate?.(link.id)}
                class="flex items-center gap-3 w-full min-h-[48px] px-2 bg-transparent border-0 text-left cursor-pointer active:opacity-70"
              >
                <span class="w-11 flex justify-center items-center flex-shrink-0">
                  <GameIcon iconKey={link.iconKey} size={link.iconSize || 40} color={link.iconColor} />
                </span>
                <span class="flex-1 text-sm font-semibold text-[var(--color-parchment)]">{link.label}</span>
                <span class="text-[var(--color-parchment)] opacity-40 text-lg leading-none pr-1">›</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
