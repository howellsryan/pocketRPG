const BUTTON_VARIANTS = {
  primary:   'bg-[var(--color-gold)] text-[var(--color-void)] hover:bg-[var(--color-gold-light)] border border-transparent',
  secondary: 'bg-[#222] text-[var(--color-parchment)] border border-[var(--color-void-border)] hover:bg-[#2a2a2a]',
  danger:    'bg-[var(--color-blood)] text-white border border-transparent hover:bg-[var(--color-blood-light)]',
  success:   'bg-[#1a4a2a] text-[#4ade80] border border-transparent hover:bg-[#235a38]',
  ghost:     'bg-transparent text-[var(--color-parchment)] border border-transparent hover:bg-[var(--color-void-light)]',
}

const BUTTON_SIZES = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-sm font-bold',
}

/**
 * Reusable button.
 *   variant: primary | secondary | danger | success | ghost
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
  const variantClass = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary
  const sizeClass = BUTTON_SIZES[size] || BUTTON_SIZES.md
  const disabledClass = disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
  return (
    <button
      disabled={disabled}
      class={`rounded-lg font-semibold transition-colors ${variantClass} ${sizeClass} ${disabledClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
