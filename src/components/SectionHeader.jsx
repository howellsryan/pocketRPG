const SIZES = {
  sm: 'text-[9px]',
  md: 'text-[11px]',
  lg: 'text-[13px]',
}

/**
 * Small uppercase Cinzel label used as section titles throughout the game.
 * Replaces the repeated inline `fontFamily: 'Cinzel, serif', fontSize: 11px, opacity: 0.6 ...` pattern.
 */
export default function SectionHeader({ children, size = 'md', className = '', as: Tag = 'h3' }) {
  return (
    <Tag
      class={`font-[var(--font-display)] font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider ${SIZES[size] || SIZES.md} ${className}`}
    >
      {children}
    </Tag>
  )
}
