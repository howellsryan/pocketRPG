import { useEffect } from 'preact/hooks'
import GameIcon from './GameIcon.jsx'
import { NAV_TABS } from './navTabs.js'

export default function BurgerMenu({ open, onClose, active, onNavigate, isInCombat, onDisabledClick }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleSelect = (tabId) => {
    if (isInCombat) { onDisabledClick?.(); return }
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
        class={`absolute top-0 left-0 h-full w-[78%] max-w-[300px] bg-[#111] border-r border-[var(--color-void-border)] shadow-2xl flex flex-col transform transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-void-border)]">
          <div class="font-[var(--font-display)] text-[var(--color-gold)] text-lg font-bold tracking-wide">
            PocketRPG
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            class="w-11 h-11 flex items-center justify-center bg-transparent border-0 text-[var(--color-parchment)] opacity-70 hover:opacity-100 cursor-pointer text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 overflow-y-auto py-2">
          {NAV_TABS.map(tab => {
            const isActive = active === tab.id
            const baseColor = isActive ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment)]'
            const opacity = isInCombat ? 'opacity-30' : isActive ? 'opacity-100' : 'opacity-85'
            const cursor = isInCombat ? 'cursor-not-allowed' : 'cursor-pointer'
            const activeBg = isActive ? 'bg-[var(--color-void-light)]' : 'bg-transparent'
            const activeBorder = isActive
              ? 'border-l-2 border-[var(--color-gold)]'
              : 'border-l-2 border-transparent'
            const label = tab.id === 'inventory' ? 'Inventory' : tab.label
            return (
              <button
                key={tab.id}
                onClick={() => handleSelect(tab.id)}
                disabled={isInCombat}
                aria-current={isActive ? 'page' : undefined}
                class={`flex items-center gap-3 w-full px-4 min-h-[48px] border-0 text-left transition-colors ${activeBg} ${activeBorder} ${baseColor} ${opacity} ${cursor}`}
              >
                <span class="w-11 flex justify-center items-center flex-shrink-0">
                  <GameIcon iconKey={tab.iconKey} size={tab.iconSize || 44} color={tab.iconColor} />
                </span>
                <span class="text-base font-semibold font-[var(--font-body)]">{label}</span>
              </button>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
