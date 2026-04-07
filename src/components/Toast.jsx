import { useGame } from '../state/gameState.jsx'

const TOAST_COLORS = {
  info: 'border-[var(--color-mana)]',
  levelup: 'border-[var(--color-gold)]',
  drop: 'border-[var(--color-emerald)]',
  error: 'border-[var(--color-blood)]',
  combat: 'border-[var(--color-blood-light)]'
}

const TOAST_ICONS = {
  info: 'ℹ️',
  levelup: '',
  drop: '✨',
  error: '⚠️',
  combat: '⚔️'
}

export default function ToastContainer() {
  const { toasts } = useGame()

  return (
    <div class="fixed top-14 left-0 right-0 z-[60] flex flex-col items-center gap-1.5 pointer-events-none px-4">
      {toasts.map(toast => (
        <div
          key={toast.id}
          class={`toast-enter pointer-events-auto px-4 py-2 rounded-lg border-l-4 ${TOAST_COLORS[toast.type] || TOAST_COLORS.info}
            shadow-lg backdrop-blur-sm max-w-sm w-full
            ${toast.type === 'levelup'
              ? 'bg-gradient-to-r from-[#2a1f00]/95 to-[#1a1500]/95 border-2 border-[var(--color-gold)]'
              : 'bg-[#1a1a1a]/95'}`}
        >
          <div class="flex items-center gap-2">
            <span class={`${toast.type === 'levelup' ? 'text-xl' : 'text-sm'}`}>
              {toast.icon || TOAST_ICONS[toast.type] || TOAST_ICONS.info}
            </span>
            <span class={`font-semibold text-[var(--color-parchment)]
              ${toast.type === 'levelup' ? 'text-base text-[var(--color-gold)]' : 'text-sm'}`}>
              {toast.message}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
