import GameIcon from './GameIcon.jsx'
import { GAME_FRAME_TOP_TABS, GAME_FRAME_TOP_LEFT_TABS, GAME_FRAME_BOTTOM_LEFT_TABS } from './navTabs.js'

// OSRS-style mobile chrome: gold medallion rails framing the main content
// panel, drawn into the carved-wood shell (.gf-shell / .gf-main in index.css).
// Top rail: Home · World Map · Inventory · Equipment. Bottom rail: Settings ·
// Credits + Skip (centered). Mobile-only (md:hidden) — desktop keeps
// SideNav + Header.
function FrameMedallion({ label, active = false, disabled = false, locked = false, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={title || label}
      class={`gf-medallion ${active ? 'gf-medallion--active' : ''} ${locked ? 'gf-medallion--locked' : ''}`}
    >
      {children}
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
  const navMedallion = (tab) => {
    const isLocked = demo && lockedScreens?.has(tab.id)
    return (
      <FrameMedallion
        key={tab.id}
        label={tab.label}
        active={active === tab.id}
        disabled={isInCombat}
        locked={isLocked}
        title={isLocked ? 'Available with a free account' : tab.label}
        onClick={() => { if (isInCombat) onDisabledClick?.(); else if (isLocked) onLockedClick?.(); else onNavigate?.(tab.id) }}
      >
        {tab.iconDisc
          ? <span class="gf-icon-disc"><GameIcon iconKey={tab.iconKey} size={tab.iconSize || 30} color={tab.iconColor} /></span>
          : <GameIcon iconKey={tab.iconKey} size={tab.iconSize || 30} color={tab.iconColor} />}
      </FrameMedallion>
    )
  }

  const skipLabel = raidSkipCost != null ? `Skip (${raidSkipCost})` : skipMode === 'kill' ? 'Skip' : 'Skip 1h'
  const skipTitle = demo
    ? 'Skip is available with a free account'
    : raidSkipCost != null
    ? `Skip the entire raid (costs ${raidSkipCost} credit${raidSkipCost === 1 ? '' : 's'})`
    : skipMode === 'kill' ? 'Skip to the kill (requires 1 credit)' : 'Skip 1 hour (requires 1 credit)'

  if (position === 'top') {
    return (
      <nav
        aria-label="Quick actions"
        class="pwa-header md:hidden flex items-center justify-evenly flex-shrink-0 px-3 pt-3 pb-1"
      >
        {GAME_FRAME_TOP_LEFT_TABS.map(navMedallion)}
        {GAME_FRAME_TOP_TABS.map(navMedallion)}
      </nav>
    )
  }

  return (
    <nav
      aria-label="Menu"
      class="md:hidden flex items-center justify-between flex-shrink-0 px-5 pt-2 pb-safe"
    >
      {GAME_FRAME_BOTTOM_LEFT_TABS.map(navMedallion)}
      <span class="flex-1 flex items-center justify-center gap-2">
        {(isCloudAccount || demo) && (
          <button
            onClick={() => { if (demo) onLockedFeature?.(); else onBuyCredits?.() }}
            aria-label="Credits"
            title={demo ? 'Credits are available with a free account' : 'Buy credits'}
            class={`gf-credits ${demo ? 'gf-medallion--locked' : ''}`}
          >
            {demo
              ? <span class="text-[16px] leading-none">🔒</span>
              : <GameIcon iconKey="cut_diamond" size={20} color="#f0c040" />}
            <span>{demo ? '—' : credits.toLocaleString()}</span>
          </button>
        )}
        <button
          onClick={() => { if (demo) onLockedFeature?.(); else onSkip1h?.() }}
          aria-label={skipLabel}
          title={skipTitle}
          class={`gf-credits ${demo ? 'gf-medallion--locked' : ''}`}
        >
          {demo
            ? <span class="text-[16px] leading-none">🔒</span>
            : <GameIcon iconKey="fast_forward_button" size={20} color="#d9b45a" />}
        </button>
      </span>
    </nav>
  )
}
