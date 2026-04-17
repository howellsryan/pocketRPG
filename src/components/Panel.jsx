/**
 * Inner surface container — darker than <Card>, use for sub-sections inside modals or cards
 * (item preview, price info, scale charges panel, stat rows).
 */
export default function Panel({ children, className = '', padding = 'p-3', as: Tag = 'div', ...props }) {
  return (
    <Tag
      class={`bg-[var(--color-void)] border border-[#1a1a1a] rounded-lg ${padding} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  )
}
