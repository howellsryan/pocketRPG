const SECTION_HEADER_SIZES = {
  sm: 'text-[9px]',
  md: 'text-[11px]',
  lg: 'text-[13px]',
}

/**
 * Small uppercase label used as section titles throughout the game (Cinzel by default,
 * Grenze Gotisch inside a .forge-shell screen — see --font-display).
 * Replaces the repeated inline `fontFamily: 'Cinzel, serif', fontSize: 11px, opacity: 0.6 ...` pattern.
 * `variant="parchment"` uses ink instead of parchment text — pair with Card/Panel variant="parchment".
 */
export default function SectionHeader({ children, size = 'md', variant = 'default', className = '', as: Tag = 'h3' }) {
  const colorClass = variant === 'parchment' ? 'text-[var(--text-faint)]' : 'text-[var(--color-parchment)]'
  return (
    <Tag
      class={`font-[var(--font-display)] font-bold ${colorClass} opacity-60 uppercase tracking-wider ${SECTION_HEADER_SIZES[size] || SECTION_HEADER_SIZES.md} ${className}`}
    >
      {children}
    </Tag>
  )
}
