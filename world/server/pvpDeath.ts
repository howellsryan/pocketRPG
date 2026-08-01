// What a Wilderness death costs, and what it records.
//
// The rule is the whole point of the zone: everything. Pack and worn gear both
// hit the floor, which is why the camp has a bank chest ten tiles from the gate
// — banking before you cross is the decision the area is built around.
import { auditLog } from '../../functions/_lib/game/audit.js'
import { persistPvpBotCollectionLog } from '../../functions/_lib/collectionLog.js'
import { isPvpCoinReplacementItem, getPvpCoinReplacementValue } from '../../src/engine/lootTransfer.js'
import itemsData from '../../src/data/items.json'
import type { InvSlot } from '../shared/protocol'
import type { Env } from './env'

const COINS_ID = 'coins'

export type DroppedStack = { itemId: string; quantity: number }

export type DeathDrops = {
  /** Every stack that hits the floor, pack and worn together. */
  drops: DroppedStack[]
  /** The subset that came out of the PACK. The caller drains the provenance
   * pools (sessionItems.ts) with exactly these — worn gear was never in a pool,
   * it leaves the save through the emptied equipment snapshot instead, so
   * draining it here would double-count and take the units off the save twice. */
  fromPack: DroppedStack[]
}

/** An untradeable never reaches the floor — it is destroyed with its owner and
 * the killer gets its coin value instead. Same rule, same numbers and the same
 * minigame-unlock special case as the duel settlement
 * (src/engine/lootTransfer.js): an account-bound item may not change hands in
 * the Wilderness any more than it may on the Trading Post.
 *
 * A worthless untradeable (no shopValue) converts to nothing and is simply
 * lost, which is what the duel path has always done. */
function toFloorStacks(tally: Map<string, number>): DroppedStack[] {
  const out: DroppedStack[] = []
  let coins = 0
  for (const [itemId, quantity] of tally) {
    if (itemId === COINS_ID) { coins += quantity; continue }
    if (isPvpCoinReplacementItem(itemId, itemsData)) {
      coins += getPvpCoinReplacementValue({ itemId, quantity }, itemsData)
      continue
    }
    out.push({ itemId, quantity })
  }
  if (coins > 0) out.push({ itemId: COINS_ID, quantity: coins })
  return out
}

/**
 * Everything a killed player leaves behind. Pure: the caller owns spawning the
 * loot entities and clearing the session.
 *
 * Stacks are merged by itemId so 3 slots of 100 coins land as one 300-coin pile
 * rather than three piles the killer has to walk over one at a time.
 *
 * `drops` is what hits the floor (untradeables already converted to coins);
 * `fromPack` is what the player actually carried, item ids intact — the pools
 * are drained by real item id, so converting there would take coins the player
 * never had off the save and leave the untradeable in it.
 */
export function collectDeathDrops(inventory: InvSlot[], equipment: Record<string, unknown>): DeathDrops {
  const packTally = new Map<string, number>()
  for (const slot of inventory) {
    if (!slot?.itemId) continue
    const qty = Math.max(0, Math.floor(Number(slot.quantity) || 0))
    if (qty < 1) continue
    packTally.set(slot.itemId, (packTally.get(slot.itemId) ?? 0) + qty)
  }

  const total = new Map<string, number>(packTally)
  for (const entry of Object.values(equipment)) {
    const worn = entry as { itemId?: unknown; quantity?: unknown } | null
    const itemId = typeof worn?.itemId === 'string' ? worn.itemId : null
    if (!itemId) continue
    // Ammo and other stackable worn slots carry a real quantity; everything
    // else is one item however the slot was written.
    const qty = Math.max(1, Math.floor(Number(worn?.quantity) || 1))
    total.set(itemId, (total.get(itemId) ?? 0) + qty)
  }

  return {
    drops: toFloorStacks(total),
    fromPack: [...packTally.entries()].map(([itemId, quantity]) => ({ itemId, quantity })),
  }
}

/**
 * Records a player kill on the rank ladder — the same column the duel system
 * incremented, so the Wilderness feeds the ladder
 * that already exists rather than opening a second one.
 *
 * Bot kills are deliberately NOT recorded: a bot is not a character row, and a
 * ladder anyone can farm off the roaming opponent is not a ladder.
 */
export async function recordPvpKill(env: Env, killerCharId: string, victimCharId: string): Promise<void> {
  const killerId = Number(killerCharId)
  const victimId = Number(victimCharId)
  if (!Number.isFinite(killerId) || killerId <= 0) return
  try {
    await env.DB.prepare(
      `UPDATE characters
          SET total_pvp_kills = COALESCE(total_pvp_kills, 0) + 1,
              last_updated_total_pvp_kills = ?
        WHERE id = ? AND deleted_at IS NULL`,
    ).bind(Date.now(), killerId).run()
  } catch (err) {
    console.error('[World][pvp] kill increment failed', { killerId, err: String(err) })
  }
  await auditLog(env, 'world_pvp_kill', { killerCharacterId: killerId, victimCharacterId: victimId }).catch(() => {})
}

/**
 * Records a bot kill's server-authoritative side effects: the collection log
 * slot for any Zesta unique the drop table rolled, and an audit row.
 *
 * The item itself is spawned on the floor like any other drop — it can be lost
 * to the next player who walks over the corpse, exactly as a boss unique can
 * out here. The log entry is written at the KILL, mirroring recordBossKill, so
 * a player who dies on the way home still has the slot.
 */
export async function recordPvpBotKill(
  env: Env,
  killerCharId: string,
  templateId: string,
  drops: DroppedStack[],
): Promise<void> {
  const killerId = Number(killerCharId)
  if (!Number.isFinite(killerId) || killerId <= 0) return
  // persistPvpBotCollectionLog is the same writer /api/pvp settlement used, and
  // it validates the slot itself — so a coins roll is a silent no-op and only a
  // real Zesta unique lands in the log.
  for (const drop of drops) {
    await persistPvpBotCollectionLog(env, killerId, drop.itemId)
  }
  await auditLog(env, 'world_pvp_bot_kill', {
    characterId: killerId,
    botTemplateId: templateId,
    drops,
  }).catch(() => {})
}
