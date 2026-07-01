/**
 * Inner surface container — darker than <Card>, use for sub-sections inside modals or cards
 * (item preview, price info, scale charges panel, stat rows).
 * `variant="parchment"` renders the Forgemark surface (light parchment, ink text) instead of
 * the default dark-void panel — only use this inside a screen wrapped in .forge-shell.
 */
export default function Panel({ children, className = '', padding = 'p-3', variant = 'default', as: Tag = 'div', ...props }) {
  const surface = variant === 'parchment'
    ? 'fm-parch'
    : 'bg-[var(--color-void)] border border-[#1a1a1a] rounded-lg'
  return (
    <Tag
      class={`${surface} ${padding} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  )
}
