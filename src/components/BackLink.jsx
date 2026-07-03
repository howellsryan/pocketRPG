/**
 * Shared "← Back" control — the same small text-only link CombatScreen has
 * always used for its own back navigation (text-xs, gold-dim, no button
 * chrome), now reused everywhere a screen needs one instead of each screen
 * rolling its own back button style.
 */
export default function BackLink({ onClick, className = '' }) {
  if (!onClick) return null
  return (
    <button
      onClick={onClick}
      aria-label="Back"
      class={`text-xs text-[var(--color-gold-dim)] flex items-center gap-1 bg-transparent border-0 cursor-pointer active:opacity-70 ${className}`}
    >
      ← Back
    </button>
  )
}
