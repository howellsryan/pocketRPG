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

export function getCollectionLogData() {
  return collectionLogData
}

export function getCollectionLogTotal() {
  return TOTAL
}

// Map each itemId to the set of (categoryId, sectionId) pairs it appears in.
// Used by drop hooks: after a kill we know `itemId` and the source identity
// (e.g. monster id), so we ask "is this item in the collection log under
// {category, section}?" before queuing the record.
const ITEM_INDEX = (() => {
  const map = new Map() // itemId -> Array<{categoryId, sectionId}>
  for (const cat of (collectionLogData.categories || [])) {
    for (const sec of (cat.sections || [])) {
      for (const itemId of (sec.items || [])) {
        const arr = map.get(itemId) || []
        arr.push({ categoryId: cat.id, sectionId: sec.id })
        map.set(itemId, arr)
      }
    }
  }
  return map
})()

export function isLoggedDrop(itemId, categoryId, sectionId) {
  if (!itemId || !categoryId || !sectionId) return false
  return VALID_KEYS.has(`${categoryId}:${sectionId}:${itemId}`)
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
// the obtained-vs-total summary used for the top-level header.
export function summarizeProgress(entriesSet) {
  if (!entriesSet || typeof entriesSet.has !== 'function') {
    return { obtained: 0, total: TOTAL }
  }
  let obtained = 0
  for (const cat of (collectionLogData.categories || [])) {
    for (const sec of (cat.sections || [])) {
      for (const itemId of (sec.items || [])) {
        if (entriesSet.has(`${cat.id}:${sec.id}:${itemId}`)) obtained++
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
    if (entriesSet.has(`${categoryId}:${sectionId}:${itemId}`)) obtained++
  }
  return { obtained, total: items.length }
}

export const __testing = { ITEM_INDEX, VALID_KEYS, TOTAL }
