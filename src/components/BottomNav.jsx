import { SCREENS } from '../utils/constants.js'

const tabs = [
  { id: SCREENS.HOME,      label: 'Home',    icon: '🏠' },
  { id: SCREENS.STATS,     label: 'Stats',   icon: '📊' },
  { id: SCREENS.INVENTORY, label: 'Items',   icon: '🎒' },
  { id: SCREENS.EQUIPMENT, label: 'Equip',   icon: '🛡️' },
  { id: SCREENS.BANK,      label: 'Bank',    icon: '🏦' },
  { id: SCREENS.STORE,     label: 'Store',   icon: '🪙' },
  { id: SCREENS.GATHER,    label: 'Gather',  icon: '🌿' },
  { id: SCREENS.COMBAT,    label: 'Combat',  icon: '⚔️' },
  { id: SCREENS.SKILLS,    label: 'Skills',  icon: '🔨' },
  { id: SCREENS.QUESTS,    label: 'Quests',  icon: '📜' },
]

export default function BottomNav({ active, onNavigate, isInBossFight, onDisabledClick }) {
  return (
    <nav
      class="flex-shrink-0 bg-[#111] border-t border-[var(--color-void-border)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div class="flex items-center h-[52px]">
        {tabs.map(tab => {
          const isActive = active === tab.id
          const opacity = isInBossFight ? 'opacity-20' : isActive ? 'opacity-100' : 'opacity-45'
          const color = isActive ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment)]'
          const cursor = isInBossFight ? 'cursor-not-allowed' : 'cursor-pointer'
          return (
            <button
              key={tab.id}
              onClick={() => { if (isInBossFight) onDisabledClick?.(); else onNavigate(tab.id) }}
              disabled={isInBossFight}
              class={`flex flex-col items-center justify-center flex-1 h-full bg-transparent border-0 p-0 transition-opacity ${color} ${opacity} ${cursor}`}
            >
              <span class="text-[16px] leading-none">{tab.icon}</span>
              <span class="text-[9px] font-semibold mt-[2px] font-[var(--font-body)]">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
