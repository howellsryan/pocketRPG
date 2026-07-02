import { useEffect } from 'preact/hooks'
import GameIcon from './GameIcon.jsx'
import { NAV_TABS } from './navTabs.js'

export default function BurgerMenu({ open, onClose, active, onNavigate, isInCombat, onDisabledClick, demo = false, lockedScreens = null, onLockedClick }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleSelect = (tabId) => {
    if (isInCombat) { onDisabledClick?.(); return }
    if (demo && lockedScreens?.has(tabId)) { onLockedClick?.(); return }
    onNavigate?.(tabId)
    onClose?.()
  }

  return (
    <div
      class={`md:hidden fixed inset-0 z-[150] ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        class={`absolute inset-0 bg-black transition-opacity duration-200 ${open ? 'opacity-60' : 'opacity-0'}`}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Navigation"
        class={`absolute top-0 left-0 h-full w-[78%] max-w-[300px] fm-navrail shadow-2xl flex flex-col transform transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--fm-rule)]">
          <div class="fm-navbrand text-lg tracking-wide">
            PocketRPG
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            class="w-11 h-11 flex items-center justify-center bg-transparent border-0 text-[var(--fm-ink-soft)] opacity-70 hover:opacity-100 cursor-pointer text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 overflow-y-auto py-2">
          {NAV_TABS.map(tab => {
            const isActive = active === tab.id
            const isLocked = demo && lockedScreens?.has(tab.id)
            const baseColor = isActive ? 'text-[var(--fm-ember-deep)]' : 'text-[var(--fm-ink-soft)]'
            const opacity = isInCombat ? 'opacity-30' : isLocked ? 'opacity-40' : isActive ? 'opacity-100' : 'opacity-85'
            const cursor = isInCombat ? 'cursor-not-allowed' : 'cursor-pointer'
            const activeBg = isActive ? 'bg-[var(--fm-parch-hi)]' : 'bg-transparent'
            const activeBorder = isActive
              ? 'border-l-2 border-[var(--fm-ember)]'
              : 'border-l-2 border-transparent'
            const label = tab.id === 'inventory' ? 'Inventory' : tab.label
            return (
              <button
                key={tab.id}
                onClick={() => handleSelect(tab.id)}
                disabled={isInCombat}
                aria-current={isActive ? 'page' : undefined}
                title={isLocked ? 'Available with a free account' : undefined}
                class={`flex items-center gap-3 w-full px-4 min-h-[48px] border-0 text-left transition-colors ${activeBg} ${activeBorder} ${baseColor} ${opacity} ${cursor}`}
              >
                <span class="w-11 flex justify-center items-center flex-shrink-0">
                  <GameIcon iconKey={tab.iconKey} size={tab.iconSize || 44} color={tab.iconColor} />
                </span>
                <span class="text-base font-semibold font-[var(--font-body)]">{label}</span>
                {isLocked && <span class="ml-auto text-[12px] opacity-70" aria-hidden="true">🔒</span>}
              </button>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
