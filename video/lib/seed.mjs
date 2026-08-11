/**
 * Character seeding for the video pipeline.
 *
 * Filming a progression montage means jumping a character forward instantly —
 * we cannot play 200 hours to record 60 seconds. There are no debug hooks on
 * `window`, so the way in is IndexedDB directly, the same approach
 * `scripts/repro-preset-item-loss.mjs` uses to stage a bug.
 *
 * This ONLY ever runs against a throwaway demo profile in a headless browser.
 * It is not a save editor: nothing here talks to the server, and demo mode has
 * no cloud save to corrupt (skill `save-item-grant` covers real characters).
 *
 * `buildSeed` is pure so it can be unit-tested; `applySeed` does the IDB write.
 */
import { getXPForLevel } from '../../src/engine/experience.js'
import { ALL_SKILLS, HITPOINTS_START_XP, INVENTORY_SIZE, EQUIPMENT_SLOTS } from '../../src/utils/constants.js'
import itemsData from '../../src/data/items.json' with { type: 'json' }

const SKILLS = [...new Set(ALL_SKILLS)]
const SKILL_SET = new Set(SKILLS)
const SLOT_SET = new Set(EQUIPMENT_SLOTS)
// A mistyped id is not a crash — the game just renders an empty slot — so it
// would ship as a broken-looking video rather than a failed render.
const ITEM_IDS = new Set(Object.values(itemsData).map((item) => item.id))

function assertItem(itemId, where) {
  if (!ITEM_IDS.has(itemId)) throw new Error(`seed.${where}: unknown item '${itemId}' (not in src/data/items.json)`)
  return itemId
}

/**
 * Turn a recipe's seed spec into the exact records each IndexedDB store holds.
 * Shapes mirror `src/db/stores.js` — stats keyed by skill, inventory by slot
 * index, bank by itemId, equipment by slot name.
 */
export function buildSeed(spec = {}) {
  const { levels = {}, equipment = {}, inventory = [], bank = {} } = spec

  for (const skill of Object.keys(levels)) {
    if (skill !== 'all' && !SKILL_SET.has(skill)) throw new Error(`seed.levels: unknown skill '${skill}'`)
  }
  for (const slot of Object.keys(equipment)) {
    if (!SLOT_SET.has(slot)) throw new Error(`seed.equipment: unknown slot '${slot}'`)
  }
  if (inventory.length > INVENTORY_SIZE) {
    throw new Error(`seed.inventory: ${inventory.length} items exceeds the ${INVENTORY_SIZE}-slot cap`)
  }

  const level = (skill) => {
    const explicit = levels[skill] ?? levels.all
    if (explicit == null) return skill === 'hitpoints' ? 10 : 1
    if (!Number.isInteger(explicit) || explicit < 1 || explicit > 99) {
      throw new Error(`seed.levels.${skill}: must be an integer 1-99 (got ${explicit})`)
    }
    // Hitpoints never drops below its level-10 baseline, matching a fresh save.
    return skill === 'hitpoints' ? Math.max(10, explicit) : explicit
  }

  const stats = SKILLS.map((skill) => {
    const lvl = level(skill)
    const xp = skill === 'hitpoints' && lvl === 10 ? HITPOINTS_START_XP : getXPForLevel(lvl)
    return [skill, { skill, xp, level: lvl }]
  })

  return {
    stats,
    equipment: Object.entries(equipment).map(([slot, v]) => {
      const entry = typeof v === 'string' ? { itemId: v, quantity: 1 } : v
      assertItem(entry.itemId, `equipment.${slot}`)
      return [slot, entry]
    }),
    inventory: inventory.map((entry, i) => {
      const slot = typeof entry === 'string' ? { itemId: entry, quantity: 1 } : entry
      assertItem(slot.itemId, `inventory[${i}]`)
      return [i, slot]
    }),
    bank: Object.entries(bank).map(([itemId, v]) => [
      assertItem(itemId, `bank.${itemId}`),
      typeof v === 'number' ? { itemId, quantity: v } : { itemId, ...v },
    ]),
  }
}

/**
 * Write the seed into the page's IndexedDB. The caller must reload afterwards —
 * the app reads these stores at boot, so a live page will not pick them up.
 */
export async function applySeed(page, spec) {
  const records = buildSeed(spec)
  await page.evaluate(async (recs) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('PocketRPG')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const write = (store, entries) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).clear()
      for (const [key, value] of entries) tx.objectStore(store).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    for (const store of ['stats', 'equipment', 'inventory', 'bank']) {
      if (recs[store]?.length) await write(store, recs[store])
      else if (store !== 'stats') await write(store, [])
    }
    db.close()
  }, records)
  return records
}
