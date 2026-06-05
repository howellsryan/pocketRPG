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

// Insert a collection log entry for a PvP bot loot box unique drop.
// sourceType='pvp', sourceId='pvp_bots'. Idempotent (ON CONFLICT DO NOTHING).
// Returns the entry object if inserted, null if skipped/invalid.
export async function persistPvpBotCollectionLog(env, characterId, itemId) {
  if (!env?.DB || !characterId || !itemId) return null
  if (!isValidEntry('pvp', 'pvp_bots', itemId)) return null
  const now = Date.now()
  try {
    await env.DB.prepare(
      `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
       VALUES (?, ?, 'pvp', 'pvp_bots', ?)
       ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`
    ).bind(characterId, itemId, now).run()
    return { itemId, sourceType: 'pvp', sourceId: 'pvp_bots' }
  } catch {
    return null
  }
}
