import { formatNumber } from '../utils/helpers.js'

// Returns an array of page indices (0-based) and '...' gap sentinels.
// Always includes first, last, and current±1 to keep the window small on
// boards with many pages.
function buildPageWindow(page, totalPages) {
  const indices = new Set(
    [0, totalPages - 1, page - 1, page, page + 1].filter(p => p >= 0 && p < totalPages)
  )
  const sorted = [...indices].sort((a, b) => a - b)
  const result = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...')
    result.push(sorted[i])
  }
  return result
}

const BTN = 'min-h-[44px] min-w-[36px] px-2 rounded-lg text-xs font-semibold flex items-center justify-center'
const BTN_PAGE = `${BTN} border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-parchment)]`
const BTN_ACTIVE = `${BTN} bg-[var(--color-gold)] text-[#111] pointer-events-none`
const BTN_NAV = `${BTN} border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-parchment)] text-base`
const BTN_DISABLED = 'opacity-30 pointer-events-none'

// Shared pagination footer for any list with server-side paging.
//   page:         current 0-based page index
//   totalPages:   total number of pages
//   totalCount:   total number of records (for display)
//   onPageChange: (newPage: number) => void
export default function Pagination({ page, totalPages, totalCount, onPageChange }) {
  if (!totalCount) return null

  const pages = totalPages > 1 ? buildPageWindow(page, totalPages) : null

  return (
    <div class="flex flex-col items-center gap-2 py-4">
      <div class="text-xs text-[var(--color-parchment)] opacity-60">
        {formatNumber(totalCount)} players total
      </div>
      {pages && (
        <div class="flex items-center gap-1 flex-wrap justify-center">
          <button
            class={`${BTN_NAV}${page === 0 ? ` ${BTN_DISABLED}` : ''}`}
            onClick={() => page > 0 && onPageChange(page - 1)}
            aria-label="Previous page"
          >‹</button>
          {pages.map((p, i) =>
            p === '...'
              ? <span key={`gap-${i}`} class="text-xs text-[var(--color-parchment)] opacity-40 px-1">…</span>
              : <button
                  key={p}
                  class={p === page ? BTN_ACTIVE : BTN_PAGE}
                  onClick={() => p !== page && onPageChange(p)}
                >{p + 1}</button>
          )}
          <button
            class={`${BTN_NAV}${page >= totalPages - 1 ? ` ${BTN_DISABLED}` : ''}`}
            onClick={() => page < totalPages - 1 && onPageChange(page + 1)}
            aria-label="Next page"
          >›</button>
        </div>
      )}
    </div>
  )
}
