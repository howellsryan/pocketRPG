import CollectionLogPanel from '../components/CollectionLogPanel.jsx'

export default function CollectionLogScreen() {
  // The panel owns the redesigned gilded header, hero, card grid and the
  // detail sheet/modal overlay — so the screen is just a full-height host.
  return (
    <div class="forge-shell h-full">
      <CollectionLogPanel />
    </div>
  )
}
