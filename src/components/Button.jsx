const BUTTON_VARIANTS = {
  primary:   'bg-[var(--color-gold)] text-[var(--color-void)] hover:bg-[var(--color-gold-light)] border border-transparent',
  secondary: 'bg-[var(--color-void-light)] text-[var(--color-parchment)] border border-[var(--color-void-border)] hover:bg-[var(--color-void-lighter)]',
  danger:    'bg-[var(--color-blood)] text-white border border-transparent hover:bg-[var(--color-blood-light)]',
  success:   'bg-[var(--color-emerald-mid)] text-[#4ade80] border border-transparent hover:bg-[var(--color-emerald)]',
  ghost:     'bg-transparent text-[var(--color-parchment)] border border-transparent hover:bg-[var(--color-void-light)]',
  // Forgemark — pressed-metal / parchment buttons. Only use inside a .forge-shell screen.
  forgePrimary:   'fm-btn fm-btn--ember',
  forgeSecondary: 'fm-btn fm-btn--iron',
  forgeGhost:     'fm-btn fm-btn--ghost',
}

const BUTTON_SIZES = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-sm font-bold',
}

// .fm-btn sets its own padding/font-size — use its sm/lg modifiers instead of the
// Tailwind size classes above so Forgemark buttons size correctly.
const FORGE_BUTTON_SIZES = { sm: 'fm-btn--sm', md: '', lg: 'fm-btn--lg' }

/**
 * Reusable button.
 *   variant: primary | secondary | danger | success | ghost | forgePrimary | forgeSecondary | forgeGhost
 *   size:    sm | md | lg
 *   Full width via className="w-full".
 * Disabled state handled automatically.
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  disabled = false,
  className = '',
  children,
  ...props
}) {
  const isForge = variant.startsWith('forge')
  const variantClass = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary
  const sizeClass = isForge ? (FORGE_BUTTON_SIZES[size] ?? '') : (BUTTON_SIZES[size] || BUTTON_SIZES.md)
  const disabledClass = disabled
    ? 'opacity-40 cursor-not-allowed'
    : 'cursor-pointer active:scale-[0.98]'
  return (
    <button
      disabled={disabled}
      class={`${isForge ? '' : 'rounded-lg font-semibold'} transition-colors transition-transform ${variantClass} ${sizeClass} ${disabledClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
