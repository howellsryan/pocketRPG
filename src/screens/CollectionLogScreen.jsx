import CollectionLogPanel from '../components/CollectionLogPanel.jsx'
import BackLink from '../components/BackLink.jsx'

// `onBack` (from App): returns to the screen the player came from.
export default function CollectionLogScreen({ onBack }) {
  // The panel owns the redesigned gilded header, hero, card grid and the
  // detail sheet/modal overlay — so the screen is just a full-height host,
  // plus the back row above it.
  return (
    <div class="forge-shell h-full flex flex-col">
      {onBack && (
        <div class="px-4 pt-4 flex-shrink-0">
          <BackLink onClick={onBack} />
        </div>
      )}
      <div class="flex-1 min-h-0">
        <CollectionLogPanel />
      </div>
    </div>
  )
}
