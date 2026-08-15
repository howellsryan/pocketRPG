import { useGame } from '../state/gameState.jsx'
import { TOAST_STYLES, TOAST_ICONS } from '../utils/toastTypes.js'

const DismissBtn = ({ onClick, accent, size = 26 }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label="Dismiss"
    class="flex-shrink-0 rounded-full bg-[rgba(255,255,255,0.06)] border-0 flex items-center justify-center cursor-pointer active:opacity-70"
    style={{ width: size, height: size }}
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke={accent} stroke-width="2.2" stroke-linecap="round" />
    </svg>
  </button>
)

const Countdown = ({ ttl, color }) => (
  <div
    class="absolute left-0 bottom-0 h-[3px] w-full skill-toast-shrink"
    style={{ background: color, animationDuration: `${ttl || 3500}ms` }}
  />
)

function CompactToast({ toast, onDismiss }) {
  const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info
  const icon = toast.icon || TOAST_ICONS[toast.type] || 'ℹ️'
  return (
    <div class="toast-enter pointer-events-auto relative w-full max-w-sm flex items-center gap-3 pl-4 pr-3.5 py-3.5 rounded-2xl overflow-hidden shadow-[0_10px_28px_rgba(0,0,0,0.4)] bg-[rgba(26,26,26,0.96)] backdrop-blur-sm border border-[rgba(255,255,255,0.08)]">
      <div class="absolute left-0 top-0 bottom-0 w-1" style={{ background: style.bar }} />
      <div
        class="w-[38px] h-[38px] flex-shrink-0 rounded-xl flex items-center justify-center text-lg bg-[rgba(255,255,255,0.05)]"
        style={{ border: `1px solid ${style.accent}`, borderColor: style.accent }}
      >
        {icon}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[14px] font-semibold text-[var(--color-parchment)] leading-snug">{toast.message}</div>
      </div>
      <DismissBtn onClick={() => onDismiss(toast.id)} accent={style.accent} />
      <Countdown ttl={toast.ttl} color={style.bar} />
    </div>
  )
}

export default function ToastContainer() {
  const { toasts, dismissToast } = useGame()

  // z-[1100] keeps toasts above Modal overlays (z-[1000]) — e.g. the world
  // map / place-modal action pickers — so error feedback stays visible.
  return (
    <div class="fixed top-14 left-0 right-0 z-[1100] flex flex-col items-center gap-2.5 pointer-events-none px-4">
      {toasts.map(toast => <CompactToast key={toast.id} toast={toast} onDismiss={dismissToast} />)}
    </div>
  )
}
