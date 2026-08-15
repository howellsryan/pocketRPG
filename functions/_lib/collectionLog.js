import collectionLogData from '../../src/data/collectionLog.json' assert { type: 'json' }
import itemsData from '../../src/data/items.json' assert { type: 'json' }
import skillsData from '../../src/data/skills.json' assert { type: 'json' }
import summoningData from '../../src/data/summoning.json' assert { type: 'json' }

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

// Every item that occupies a collection log slot, regardless of which source
// fills it. Distinct from VALID above, which answers "did this source drop it".
const LOGGED_ITEM_IDS = (() => {
  const set = new Set()
  for (const cat of (collectionLogData.categories || [])) {
    for (const sec of (cat.sections || [])) {
      for (const itemId of (sec.items || [])) set.add(itemId)
    }
  }
  return set
})()

// Whether an item is one the collection log tracks. Takes the CANONICAL item id
// — the log is authored in canonical ids, so a legacy synonym answers false.
export function isCollectionLogItem(itemId) {
  return typeof itemId === 'string' && LOGGED_ITEM_IDS.has(itemId)
}

// Every recipe in the game that turns items INTO another item, flattened to
// { product, inputs }. Three tables author them: an item's own combine fields
// (the upgrade recipes — visage shield, the godswords), a skill action's
// `materials` (crafting, smithing, fletching, herblore…), and a summoning
// creature's pouch. Recipe ids are all canonical, verified against items.json.
function recipeEdges() {
  const edges = []
  for (const item of Object.values(itemsData)) {
    if (!item?.combineResult) continue
    edges.push({ product: item.combineResult, inputs: [item.id, item.combineWith].filter(Boolean) })
  }
  for (const skill of Object.values(skillsData)) {
    for (const action of (skill?.actions || [])) {
      if (!action?.product || !action.materials) continue
      edges.push({ product: action.product, inputs: Object.keys(action.materials) })
    }
  }
  for (const creature of (summoningData?.creatures || [])) {
    if (!creature?.pouch) continue
    edges.push({ product: creature.pouch, inputs: [creature.secondary, creature.charm].filter(Boolean) })
  }
  return edges
}

// The logged items plus everything a recipe can build out of one, to any depth:
// an uncut onyx is logged, so the onyx, the onyx amulet and the amulet of fury
// it becomes are all part of that same drop. Transitive by fixpoint rather than
// one hop, because the chains really are that long (uncut onyx → onyx → onyx
// amulet → amulet of fury) and a one-hop answer would sell the last link.
const LOG_LINEAGE_ITEM_IDS = (() => {
  const set = new Set(LOGGED_ITEM_IDS)
  const edges = recipeEdges()
  let grew = true
  while (grew) {
    grew = false
    for (const { product, inputs } of edges) {
      if (set.has(product)) continue
      if (!inputs.some((id) => set.has(id))) continue
      set.add(product)
      grew = true
    }
  }
  return set
})()

// Whether an item is a collection log entry OR is made from one. Canonical ids.
// The distinction from isCollectionLogItem matters for anything asking "does
// this fill a log slot"; this one answers "did this come out of a logged drop".
export function isCollectionLogLineageItem(itemId) {
  return typeof itemId === 'string' && LOG_LINEAGE_ITEM_IDS.has(itemId)
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
