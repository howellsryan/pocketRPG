import Card from '../components/Card.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { SCREENS } from '../utils/constants.js'

const HUB_LINKS = [
  { id: SCREENS.BANK,  label: 'Bank',         sub: 'Store and manage your items', iconKey: 'coins' },
  { id: SCREENS.STORE, label: 'Trading Post', sub: 'Buy and sell on the market',  iconKey: 'offers' },
]

export default function BankHubScreen({ onNavigate }) {
  return (
    <div class="forge-shell h-full flex flex-col">
      <div class="flex-shrink-0 bg-[var(--color-void-light)] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="flex items-center gap-2 font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">
          <GameIcon iconKey="coins" size={22} class="flex-shrink-0" />
          Bank &amp; Trading Post
        </h1>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4">
        <Card className="p-2">
          <div class="divide-y divide-[var(--color-void-border)]">
            {HUB_LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => onNavigate?.(link.id)}
                class="flex items-center gap-3 w-full min-h-[56px] px-2 bg-transparent border-0 text-left cursor-pointer active:opacity-70"
              >
                <span class="w-11 flex justify-center items-center flex-shrink-0">
                  <GameIcon iconKey={link.iconKey} size={40} />
                </span>
                <span class="flex-1">
                  <span class="block text-sm font-semibold text-[var(--color-parchment)]">{link.label}</span>
                  <span class="block text-xs text-[var(--color-parchment)] opacity-60">{link.sub}</span>
                </span>
                <span class="text-[var(--color-parchment)] opacity-40 text-lg leading-none pr-1">›</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
