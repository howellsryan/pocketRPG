import { useState, useEffect, useMemo } from 'preact/hooks'
import Card from './Card.jsx'
import Panel from './Panel.jsx'
import SectionHeader from './SectionHeader.jsx'
import itemsData from '../data/items.json'
import {
  getCollectionLogData,
  getCollectionLogTotal,
  summarizeProgress,
  summarizeSection,
} from '../engine/collectionLog.js'
import {
  fetchCollectionLog,
  getCachedEntries,
  getCachedTotal,
  subscribe,
} from '../cloud/collectionLog.js'

function itemLabel(itemId) {
  return itemsData[itemId]?.name || itemId
}

function collectionLogEntryKey(categoryId, sectionId, itemId) {
  return `${categoryId}:${sectionId}:${itemId}`
}

function CollectionSection({ category, section, entries }) {
  const [open, setOpen] = useState(false)
  const summary = summarizeSection(entries, category.id, section.id, section.items)
  const complete = summary.total > 0 && summary.obtained >= summary.total
  const countClass = complete
    ? 'text-[var(--color-hp-green)]'
    : 'text-[var(--color-parchment)] opacity-70'

  return (
    <Panel className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        class="w-full flex items-center justify-between gap-2 px-3 py-2 bg-transparent border-0 text-left cursor-pointer"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-base flex-shrink-0">{section.icon || category.icon || '📦'}</span>
          <span class="text-sm font-semibold text-[var(--color-parchment)] truncate">{section.label}</span>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class={`text-[11px] font-mono ${countClass}`}>{summary.obtained}/{summary.total}</span>
          <span class="text-[var(--color-gold)] text-xs">{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && (
        <div class="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
          {section.items.map(itemId => {
            const has = entries?.has?.(collectionLogEntryKey(category.id, section.id, itemId)) || false
            return (
              <div
                key={itemId}
                class={`flex items-center gap-2 px-2 py-1 rounded text-[11px] border ${
                  has
                    ? 'border-[var(--color-hp-green)] bg-[var(--color-hp-green)] bg-opacity-10 text-[var(--color-hp-green)]'
                    : 'border-[var(--color-void-border)] text-[var(--color-parchment)] opacity-60'
                }`}
                style={has ? { backgroundColor: 'rgba(39, 174, 96, 0.12)' } : null}
              >
                <span class="flex-shrink-0">{has ? '✓' : '·'}</span>
                <span class="truncate">{itemLabel(itemId)}</span>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function CollectionCategory({ category, entries }) {
  const [open, setOpen] = useState(false)
  const totals = useMemo(() => {
    let obtained = 0, total = 0
    for (const sec of category.sections) {
      const s = summarizeSection(entries, category.id, sec.id, sec.items)
      obtained += s.obtained; total += s.total
    }
    return { obtained, total }
  }, [entries, category])
  const complete = totals.total > 0 && totals.obtained >= totals.total
  const countClass = complete
    ? 'text-[var(--color-hp-green)]'
    : 'text-[var(--color-parchment)] opacity-80'

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        class="w-full flex items-center justify-between gap-2 px-3 py-2 bg-transparent border-0 text-left cursor-pointer"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-lg flex-shrink-0">{category.icon}</span>
          <span class="font-[var(--font-display)] text-sm font-bold text-[var(--color-gold)] truncate">{category.label}</span>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class={`text-[11px] font-mono ${countClass}`}>{totals.obtained}/{totals.total}</span>
          <span class="text-[var(--color-gold)] text-xs">{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && (
        <div class="px-3 pb-3 space-y-2">
          {category.sections.map(sec => (
            <CollectionSection key={sec.id} category={category} section={sec} entries={entries} />
          ))}
        </div>
      )}
    </Card>
  )
}

export default function CollectionLogPanel() {
  const data = getCollectionLogData()
  const [entries, setEntries] = useState(getCachedEntries())
  const [serverTotal, setServerTotal] = useState(getCachedTotal())
  const [loading, setLoading] = useState(!entries)

  useEffect(() => {
    const unsub = subscribe(({ entries, total }) => {
      setEntries(entries ? new Set(entries) : null)
      setServerTotal(total)
    })
    if (!getCachedEntries()) {
      setLoading(true)
      fetchCollectionLog().then(res => {
        if (res?.entries) setEntries(new Set(res.entries))
        if (typeof res?.total === 'number') setServerTotal(res.total)
      }).finally(() => setLoading(false))
    } else {
      setEntries(new Set(getCachedEntries()))
      setServerTotal(getCachedTotal())
      setLoading(false)
    }
    return unsub
  }, [])

  const summary = summarizeProgress(entries)
  // Server-bundled total wins when present, in case a deploy is mid-flight and
  // client/server json disagree.
  const total = typeof serverTotal === 'number' ? serverTotal : summary.total
  const localTotal = getCollectionLogTotal()
  const obtained = Math.min(summary.obtained, total)
  const complete = total > 0 && obtained >= total
  const countClass = complete ? 'text-[var(--color-hp-green)]' : 'text-[var(--color-gold)]'

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <SectionHeader>Total Collected</SectionHeader>
        <span class={`text-sm font-mono font-bold ${countClass}`}>{obtained}/{total}</span>
      </div>
      {total !== localTotal && (
        <div class="text-[10px] text-[var(--color-parchment)] opacity-50">
          Server has {total} entries (this build bundles {localTotal}); reload to refresh.
        </div>
      )}
      {loading ? (
        <div class="text-center py-4 text-[var(--color-parchment)] opacity-60 text-sm">
          Loading collection log...
        </div>
      ) : (
        <div class="space-y-2">
          {data.categories.map(cat => (
            <CollectionCategory key={cat.id} category={cat} entries={entries} />
          ))}
        </div>
      )}
    </div>
  )
}
