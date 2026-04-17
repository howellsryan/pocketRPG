/**
 * Outer surface container — use for top-level grouping (paperdoll, bonus summary, task item rows).
 * For nested inner surfaces use <Panel> instead.
 */
export default function Card({ children, className = '', padding = 'p-3', as: Tag = 'div', ...props }) {
  return (
    <Tag
      class={`bg-[var(--color-void-light)] border border-[#2a2a2a] rounded-xl ${padding} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  )
}
