import GameIcon from './GameIcon.jsx'
import { DESKTOP_NAV_TABS } from './navTabs.js'

export default function SideNav({ active, onNavigate, isInCombat, onDisabledClick, demo = false, lockedScreens = null, onLockedClick, isCloudAccount = false, onOpenChat = null }) {
  return (
    <nav
      class="hidden md:flex flex-col flex-shrink-0 w-44 lg:w-52 fm-navrail pb-3 gap-1 overflow-y-auto"
      aria-label="Primary"
    >
      {/* h-14 matches the desktop top bar (Header md:h-14) so this border-b
          and the top bar's border-b form one continuous line. */}
      <div class="h-14 flex-shrink-0 flex items-center px-4 mb-1 border-b border-[var(--fm-rule)]">
        <div class="fm-navbrand text-base tracking-wide">
          PocketRPG
        </div>
      </div>

      {DESKTOP_NAV_TABS.map(tab => {
        const isActive = active === tab.id
        const isLocked = demo && lockedScreens?.has(tab.id)
        const baseColor = isActive ? 'text-[var(--fm-ember-deep)]' : 'text-[var(--fm-ink-soft)]'
        const opacity = isInCombat ? 'opacity-30' : isLocked ? 'opacity-40' : isActive ? 'opacity-100' : 'opacity-80'
        const cursor = isInCombat ? 'cursor-not-allowed' : 'cursor-pointer'
        const activeBg = isActive ? 'bg-[var(--fm-parch-hi)]' : 'bg-transparent'
        const hover = isInCombat || isLocked ? '' : 'hover:bg-[var(--fm-parch-hi)] hover:opacity-100'
        const activeBorder = isActive
          ? 'border-l-2 border-[var(--fm-ember)]'
          : 'border-l-2 border-transparent'
        return (
          <button
            key={tab.id}
            onClick={() => { if (isInCombat) onDisabledClick?.(); else if (isLocked) onLockedClick?.(); else onNavigate(tab.id) }}
            disabled={isInCombat}
            aria-current={isActive ? 'page' : undefined}
            title={isLocked ? 'Available with a free account' : undefined}
            class={`flex items-center gap-3 w-full px-4 py-2 mx-0 border-0 text-left transition-colors ${activeBg} ${activeBorder} ${baseColor} ${opacity} ${cursor} ${hover}`}
          >
            <span class="w-11 flex justify-center items-center flex-shrink-0">
              <GameIcon iconKey={tab.iconKey} size={tab.iconSize || 44} color={tab.iconColor} />
            </span>
            <span class="text-sm font-semibold font-[var(--font-body)]">{tab.label}</span>
            {isLocked && <span class="ml-auto text-[11px] opacity-70" aria-hidden="true">🔒</span>}
          </button>
        )
      })}

      {/* Game Helper — desktop trigger for the chat panel (cloud accounts only;
          mobile houses it in GameFrameBar's bottom rail instead). Pinned to the
          rail's foot, below the primary destinations. */}
      {isCloudAccount && !demo && onOpenChat && (
        <button
          onClick={() => { if (!isInCombat) onOpenChat() }}
          disabled={isInCombat}
          title="Game Helper"
          class={`mt-auto flex items-center gap-3 w-full px-4 py-2 mx-0 border-0 border-l-2 border-transparent text-left text-[var(--fm-ink-soft)] transition-colors ${isInCombat ? 'opacity-30 cursor-not-allowed' : 'opacity-80 cursor-pointer hover:bg-[var(--fm-parch-hi)] hover:opacity-100'}`}
        >
          <span class="w-11 flex justify-center items-center flex-shrink-0">
            <GameIcon iconKey="chat_bubble" size={30} />
          </span>
          <span class="text-sm font-semibold font-[var(--font-body)]">Game Helper</span>
        </button>
      )}
    </nav>
  )
}
