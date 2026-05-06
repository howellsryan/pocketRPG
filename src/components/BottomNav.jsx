import { NAV_TABS } from './navTabs.js'

export default function BottomNav({ active, onNavigate, isInCombat, onDisabledClick }) {
  return (
    <nav
      class="md:hidden flex-shrink-0 bg-[#111] border-t border-[var(--color-void-border)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div class="flex items-center h-[52px]">
        {NAV_TABS.map(tab => {
          const isActive = active === tab.id
          const opacity = isInCombat ? 'opacity-20' : isActive ? 'opacity-100' : 'opacity-45'
          const color = isActive ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment)]'
          const cursor = isInCombat ? 'cursor-not-allowed' : 'cursor-pointer'
          return (
            <button
              key={tab.id}
              onClick={() => { if (isInCombat) onDisabledClick?.(); else onNavigate(tab.id) }}
              disabled={isInCombat}
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
