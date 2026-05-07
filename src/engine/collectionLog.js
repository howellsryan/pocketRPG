// Pure helpers for the PvE collection log.
//
// Engine code computes whether a given drop should be recorded, the UI
// renders progress summaries, and the cloud client posts entries. None of
// these helpers should reach into UI state.

import collectionLogData from '../data/collectionLog.json'

const VALID_KEYS = (() => {
  const set = new Set()
  for (const cat of (collectionLogData.categories || [])) {
    for (const sec of (cat.sections || [])) {
      for (const itemId of (sec.items || [])) {
        set.add(`${cat.id}:${sec.id}:${itemId}`)
      }
    }
  }
  return set
})()

const TOTAL = (() => {
  let n = 0
  for (const cat of (collectionLogData.categories || [])) {
    for (const sec of (cat.sections || [])) n += (sec.items || []).length
  }
  return n
})()

// Items that appear in two or more collection-log slots. Once obtained from
// any source, every slot for that item is considered collected (e.g. dragon
// axe drops from all three dagannoth kings — getting it from one credits all
// three slots). Sourced from collectionLog.json.sharedItems.
const SHARED_ITEMS = new Set(collectionLogData.sharedItems || [])

export function getCollectionLogData() {
  return collectionLogData
}

export function getCollectionLogTotal() {
  return TOTAL
}

export function isSharedCollectionLogItem(itemId) {
  return SHARED_ITEMS.has(itemId)
}

export function isLoggedDrop(itemId, categoryId, sectionId) {
  if (!itemId || !categoryId || !sectionId) return false
  return VALID_KEYS.has(`${categoryId}:${sectionId}:${itemId}`)
}

// True when a given (category, section, item) slot should render as obtained
// for the user. Direct match always counts; shared items count when ANY entry
// for that itemId exists across the user's log.
export function isSlotObtained(entriesSet, categoryId, sectionId, itemId) {
  if (!entriesSet || typeof entriesSet.has !== 'function') return false
  if (entriesSet.has(`${categoryId}:${sectionId}:${itemId}`)) return true
  if (!SHARED_ITEMS.has(itemId)) return false
  // Shared item: scan the user's entries for any source with this itemId.
  for (const key of entriesSet) {
    if (typeof key === 'string' && key.endsWith(`:${itemId}`)) return true
  }
  return false
}

// Filter an array of {itemId, ...} drops down to those that belong in the
// collection log under (categoryId, sectionId). Returns just the itemIds.
export function filterLoggedDrops(drops, categoryId, sectionId) {
  if (!Array.isArray(drops)) return []
  const out = []
  const seen = new Set()
  for (const d of drops) {
    const id = d?.itemId
    if (!id || seen.has(id)) continue
    if (isLoggedDrop(id, categoryId, sectionId)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out
}

// Given an entries Set keyed by `${sourceType}:${sourceId}:${itemId}`, return
// the obtained-vs-total summary used for the top-level header. Shared items
// inflate every matching slot once any one of them is collected.
export function summarizeProgress(entriesSet) {
  if (!entriesSet || typeof entriesSet.has !== 'function') {
    return { obtained: 0, total: TOTAL }
  }
  let obtained = 0
  for (const cat of (collectionLogData.categories || [])) {
    for (const sec of (cat.sections || [])) {
      for (const itemId of (sec.items || [])) {
        if (isSlotObtained(entriesSet, cat.id, sec.id, itemId)) obtained++
      }
    }
  }
  return { obtained, total: TOTAL }
}

// Per-section completion. Used by the section header chip to display
// "3/14 collected" and turn green at full completion.
export function summarizeSection(entriesSet, categoryId, sectionId, items) {
  if (!entriesSet || typeof entriesSet.has !== 'function') {
    return { obtained: 0, total: items.length }
  }
  let obtained = 0
  for (const itemId of items) {
    if (isSlotObtained(entriesSet, categoryId, sectionId, itemId)) obtained++
  }
  return { obtained, total: items.length }
}

export const __testing = { VALID_KEYS, TOTAL, SHARED_ITEMS }
