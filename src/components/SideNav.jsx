import GameIcon from './GameIcon.jsx'
import { NAV_TABS } from './navTabs.js'

export default function SideNav({ active, onNavigate, isInCombat, onDisabledClick }) {
  return (
    <nav
      class="hidden md:flex flex-col flex-shrink-0 w-44 lg:w-52 bg-[#111] border-r border-[var(--color-void-border)] py-3 gap-1 overflow-y-auto"
      aria-label="Primary"
    >
      <div class="px-4 pb-3 mb-1 border-b border-[var(--color-void-border)]">
        <div class="font-[var(--font-display)] text-[var(--color-gold)] text-base font-bold tracking-wide">
          PocketRPG
        </div>
      </div>

      {NAV_TABS.map(tab => {
        const isActive = active === tab.id
        const baseColor = isActive ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment)]'
        const opacity = isInCombat ? 'opacity-30' : isActive ? 'opacity-100' : 'opacity-80'
        const cursor = isInCombat ? 'cursor-not-allowed' : 'cursor-pointer'
        const activeBg = isActive ? 'bg-[var(--color-void-light)]' : 'bg-transparent'
        const hover = isInCombat ? '' : 'hover:bg-[var(--color-void-light)] hover:opacity-100'
        const activeBorder = isActive
          ? 'border-l-2 border-[var(--color-gold)]'
          : 'border-l-2 border-transparent'
        const label = tab.id === 'inventory' ? 'Inventory' : tab.label
        return (
          <button
            key={tab.id}
            onClick={() => { if (isInCombat) onDisabledClick?.(); else onNavigate(tab.id) }}
            disabled={isInCombat}
            aria-current={isActive ? 'page' : undefined}
            class={`flex items-center gap-3 w-full px-4 py-2 mx-0 border-0 text-left transition-colors ${activeBg} ${activeBorder} ${baseColor} ${opacity} ${cursor} ${hover}`}
          >
            <GameIcon iconKey={tab.iconKey} size={22} class="flex-shrink-0" />
            <span class="text-sm font-semibold font-[var(--font-body)]">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
