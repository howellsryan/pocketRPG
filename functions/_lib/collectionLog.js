import collectionLogData from '../../src/data/collectionLog.json' assert { type: 'json' }

// Build a single Set keyed by `${sourceType}:${sourceId}:${itemId}` so server
// validation is O(1). Done at module load — runs once per Worker isolate.
const VALID = (() => {
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

const SOURCE_TYPE_ALIASES = {
  dungeoneering: 'skilling',
  slayer: 'skilling',
}

// Top-level total — used by the client to render the "0/N collected" header
// when the client-side bundle disagrees with the server (rare, but possible
// if a deploy is mid-flight).
export const TOTAL_ENTRIES = (() => {
  let n = 0
  for (const cat of (collectionLogData.categories || [])) {
    for (const sec of (cat.sections || [])) n += (sec.items || []).length
  }
  return n
})()

// Each entry must satisfy: (sourceType, sourceId, itemId) is in the bundled
// collection log. Items obtained via store/PvP/console can never be valid
// because they have no PvE source mapped here.
export function isValidEntry(sourceType, sourceId, itemId) {
  if (typeof sourceType !== 'string' || typeof sourceId !== 'string' || typeof itemId !== 'string') return false
  if (!sourceType || !sourceId || !itemId) return false
  const normalizedSourceType = SOURCE_TYPE_ALIASES[sourceType] || sourceType
  return VALID.has(`${normalizedSourceType}:${sourceId}:${itemId}`)
}
