/**
 * Master-detail layout. Below md, only the list pane shows (mobile uses a
 * modal for selection details). At md+, list and detail render side-by-side.
 *
 * Props:
 *   list:   JSX rendered in the left pane (always visible)
 *   detail: JSX rendered in the right pane (md+ only). Pass an empty-state
 *           message when nothing is selected so the pane isn't blank.
 *   detailWidthClass: optional override for the detail pane width.
 */
export default function TwoPaneLayout({ list, detail, detailWidthClass = 'md:w-[360px] lg:w-[420px]', showDetailPane = true }) {
  return (
    <div class="flex-1 min-h-0 md:flex md:gap-4 md:overflow-hidden">
      <div class="h-full md:flex-1 md:min-w-0 md:overflow-hidden md:flex md:flex-col">
        {list}
      </div>
      {showDetailPane && (
        <aside class={`hidden md:flex md:flex-col ${detailWidthClass} md:flex-shrink-0 md:overflow-y-auto md:border-l md:border-[var(--color-void-border)] md:pl-4`}>
          {detail}
        </aside>
      )}
    </div>
  )
}
