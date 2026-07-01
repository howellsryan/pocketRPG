import Card from '../components/Card.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { useGame } from '../state/gameState.jsx'

export default function HelpScreen() {
  const { showInfoToasts, updateShowInfoToasts } = useGame()

  return (
    <div class="h-full flex flex-col">
      <div class="flex-shrink-0 bg-[#111] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="flex items-center gap-2 font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">
          <GameIcon iconKey="tinderbox" size={22} class="flex-shrink-0" />
          Settings
        </h1>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        <Card className="p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-[var(--color-parchment)]">Info notifications</div>
              <div class="text-xs text-[var(--color-parchment)] opacity-50 mt-0.5">Show ℹ️ toast messages for minor game events</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showInfoToasts}
              onClick={() => updateShowInfoToasts(!showInfoToasts)}
              class="flex-shrink-0 relative w-11 h-6 rounded-full border-0 cursor-pointer transition-colors duration-200"
              style={{ background: showInfoToasts ? 'var(--color-mana)' : '#444' }}
            >
              <span
                class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: showInfoToasts ? 'translateX(20px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </Card>
        {/* CC BY 3.0 requires visible attribution; this is its only in-game home. */}
        <p class="text-xs text-[var(--color-parchment)] opacity-50 px-1">
          Item icons by game-icons.net (CC BY 3.0). See the NOTICE file for full attribution.
        </p>
      </div>
    </div>
  )
}
