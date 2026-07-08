import Card from '../components/Card.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { useGame } from '../state/gameState.jsx'
import { SETTINGS_NAV_LINKS } from '../components/navTabs.js'

export default function HelpScreen({ onNavigate }) {
  const { showInfoToasts, updateShowInfoToasts } = useGame()

  return (
    <div class="forge-shell h-full flex flex-col">
      <div class="flex-shrink-0 bg-[var(--color-void-light)] border-b border-[var(--color-void-border)] px-4 py-3">
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

        <Card className="p-2">
          <div class="divide-y divide-[var(--color-void-border)]">
            {SETTINGS_NAV_LINKS.map((link) => (
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
