import CollectionLogPanel from '../components/CollectionLogPanel.jsx'

// `onBack` (from App): returns to the screen the player came from.
export default function CollectionLogScreen({ onBack }) {
  // The panel owns the redesigned gilded header, hero, card grid and the
  // detail sheet/modal overlay — so the screen is just a full-height host,
  // plus the back row above it.
  return (
    <div class="forge-shell h-full flex flex-col">
      {onBack && (
        <div class="px-4 pt-2 flex-shrink-0">
          <button
            onClick={onBack}
            aria-label="Back"
            class="w-11 h-11 -ml-2 flex items-center justify-center gap-1 text-[var(--color-gold)] bg-transparent border-0 cursor-pointer active:opacity-70"
          >
            <span class="text-xl leading-none">← Back</span>
          </button>
        </div>
      )}
      <div class="flex-1 min-h-0">
        <CollectionLogPanel />
      </div>
    </div>
  )
}
