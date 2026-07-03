import GameIcon from './GameIcon.jsx'
import { GAME_FRAME_TOP_TABS, GAME_FRAME_BOTTOM_LEFT_TABS, GAME_FRAME_BOTTOM_RIGHT_TABS } from './navTabs.js'

// OSRS-style mobile chrome: two icon rails framing the main content panel.
// Top rail: Skip · World Map · Inventory · Equipment. Bottom rail: Settings ·
// Credits · Home. Mobile-only (md:hidden) — desktop keeps SideNav + Header.
function FrameNavButton({ label, active = false, disabled = false, locked = false, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={title || label}
      class={`flex flex-col items-center justify-center gap-1 min-w-[52px] min-h-[52px] px-1 rounded-md border transition-colors ${
        active ? 'bg-[#2a2010] border-[var(--color-gold-dim)]' : 'bg-transparent border-transparent'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : locked ? 'opacity-40 cursor-pointer' : 'cursor-pointer opacity-90 hover:opacity-100'}`}
    >
      {/* Parchment tile behind the icon — the game icon art is drawn for light
          surfaces and doesn't read directly on the near-black rail. */}
      <span class={`w-10 h-[34px] flex items-center justify-center rounded border ${active ? 'bg-[#f0e2bd] border-[var(--color-gold-dim)]' : 'bg-[#e6d8b6] border-[#4a4436]'}`}>{children}</span>
      <span class={`text-[9px] font-semibold leading-none whitespace-nowrap ${active ? 'text-[var(--color-gold-light)]' : 'text-[var(--color-parchment)]'}`}>
        {label}
      </span>
    </button>
  )
}

export default function GameFrameBar({
  position = 'top',
  active,
  onNavigate,
  isInCombat = false,
  onDisabledClick = null,
  demo = false,
  lockedScreens = null,
  onLockedClick = null,
  onLockedFeature = null,
  onSkip1h = null,
  skipMode = 'hour',
  raidSkipCost = null,
  onBuyCredits = null,
  credits = 0,
  isCloudAccount = false,
}) {
  const navButton = (tab) => {
    const isLocked = demo && lockedScreens?.has(tab.id)
    return (
      <FrameNavButton
        key={tab.id}
        label={tab.label}
        active={active === tab.id}
        disabled={isInCombat}
        locked={isLocked}
        title={isLocked ? 'Available with a free account' : tab.label}
        onClick={() => { if (isInCombat) onDisabledClick?.(); else if (isLocked) onLockedClick?.(); else onNavigate?.(tab.id) }}
      >
        <GameIcon iconKey={tab.iconKey} size={tab.iconSize || 30} color={tab.iconColor} />
      </FrameNavButton>
    )
  }

  if (position === 'top') {
    const skipLabel = raidSkipCost != null ? `Skip (${raidSkipCost})` : skipMode === 'kill' ? 'Skip' : 'Skip 1h'
    return (
      <nav
        aria-label="Quick actions"
        class="pwa-header md:hidden flex items-center justify-around flex-shrink-0 bg-[#111] border-b border-[#333] px-2 py-1"
      >
        <FrameNavButton
          label={skipLabel}
          locked={demo}
          title={demo
            ? 'Skip is available with a free account'
            : raidSkipCost != null
            ? `Skip the entire raid (costs ${raidSkipCost} credit${raidSkipCost === 1 ? '' : 's'})`
            : skipMode === 'kill' ? 'Skip to the kill (requires 1 credit)' : 'Skip 1 hour (requires 1 credit)'}
          onClick={() => { if (demo) onLockedFeature?.(); else onSkip1h?.() }}
        >
          <span class="text-[22px] leading-none">{demo ? '🔒' : '⏭️'}</span>
        </FrameNavButton>
        {GAME_FRAME_TOP_TABS.map(navButton)}
      </nav>
    )
  }

  return (
    <nav
      aria-label="Menu"
      class="md:hidden flex items-center justify-around flex-shrink-0 bg-[#111] border-t border-[#333] px-2 pt-1 pb-safe"
    >
      {GAME_FRAME_BOTTOM_LEFT_TABS.map(navButton)}
      {(isCloudAccount || demo) && (
        <FrameNavButton
          label={demo ? 'Credits' : `${credits.toLocaleString()} Credits`}
          locked={demo}
          title={demo ? 'Credits are available with a free account' : 'Buy credits'}
          onClick={() => { if (demo) onLockedFeature?.(); else onBuyCredits?.() }}
        >
          <span class="text-[22px] leading-none">{demo ? '🔒' : '💎'}</span>
        </FrameNavButton>
      )}
      {GAME_FRAME_BOTTOM_RIGHT_TABS.map(navButton)}
    </nav>
  )
}
