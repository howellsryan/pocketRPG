import CollectionLogPanel from '../components/CollectionLogPanel.jsx'

export default function CollectionLogScreen() {
  return (
    <div class="h-full flex flex-col">
      <div class="flex-shrink-0 bg-[#111] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">📖 Collection Log</h1>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4">
        <CollectionLogPanel />
      </div>
    </div>
  )
}
