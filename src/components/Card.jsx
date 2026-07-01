/**
 * Outer surface container — use for top-level grouping (paperdoll, bonus summary, task item rows).
 * For nested inner surfaces use <Panel> instead.
 * `variant="parchment"` renders the Forgemark surface (light parchment, ink text) instead of
 * the default dark-void card — only use this inside a screen wrapped in .forge-shell.
 */
export default function Card({ children, className = '', padding = 'p-3', variant = 'default', as: Tag = 'div', ...props }) {
  const surface = variant === 'parchment'
    ? 'fm-parch'
    : 'bg-[var(--color-void-light)] border border-[#2a2a2a] rounded-xl'
  return (
    <Tag
      class={`${surface} ${padding} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  )
}
