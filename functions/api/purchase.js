import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInActiveMatch } from '../_lib/pvp.js'
import itemsData from '../../src/data/items.json' assert { type: 'json' }
import minigamesData from '../../src/data/minigames.json' assert { type: 'json' }
import { assertPurchasable } from '../_lib/game/rewards.js'
import { loadCharacterWithSave, writeSave } from '../_lib/game/save.js'
import { subtractCoins } from '../_lib/game/economy.js'
import { addItemToInventory } from '../_lib/game/inventory.js'
import { auditLog } from '../_lib/game/audit.js'
import { toErrorResponse } from '../_lib/game/errors.js'
import { getLevelFromXP } from '../../src/engine/experience.js'

const MINIGAME_UNLOCK_STORE_PRICE = 4_500_000
const MINIGAME_STORE_PRODUCTS = new Set(
  (minigamesData?.tasks || [])
    .flatMap((task) => (Array.isArray(task?.rewardItems) && task.rewardItems.length > 0 ? task.rewardItems : [task?.product]))
    .filter(Boolean),
)

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  try {
    const body = await request.json()
    const characterId = parseInt(request.headers.get('X-Character-Id') || '0', 10)
    const itemId = body?.item_id
    const quantity = Math.floor(Number(body?.quantity) || 0)
    const unlockedMinigameItems = new Set(Array.isArray(body?.unlocked_minigame_items) ? body.unlocked_minigame_items : [])
    if (!characterId || !itemId || quantity < 1) return json({ error: 'Invalid request parameters' }, 400)

    const lock = await assertNotInActiveMatch(env, characterId)
    if (lock) return lock

    const item = itemsData[itemId]
    if (!item) return json({ error: 'Item not found', code: 'ITEM_NOT_FOUND' }, 404)

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    const allowMinigameUnlockPurchase = MINIGAME_STORE_PRODUCTS.has(itemId) && unlockedMinigameItems.has(itemId)
    const restriction = assertPurchasable(item, { isIronman: Boolean(row.is_ironman), allowMinigameUnlockPurchase })
    if (!restriction.allowed) return json({ error: restriction.message, code: restriction.code }, 403)

    if (item.isSkillCape) {
      const reqSkill = Object.keys(item.requirements || {})[0]
      if (reqSkill) {
        const playerXP = saveObject.stats?.[reqSkill]?.xp || 0
        const playerLevel = getLevelFromXP(playerXP)
        if (playerLevel < 99) {
          return json({ error: `You need level 99 ${reqSkill} to buy this cape.`, code: 'LEVEL_REQUIREMENT_NOT_MET' }, 403)
        }
      }
    }

    const unitCost = allowMinigameUnlockPurchase ? MINIGAME_UNLOCK_STORE_PRICE : (Number(item.shopValue) || 0)
    const totalCost = unitCost * quantity
    subtractCoins(saveObject, totalCost)
    if (item.stackable) {
      addItemToInventory(saveObject, itemId, quantity, { stackable: true, noted: false })
    } else if (quantity > 1) {
      addItemToInventory(saveObject, itemId, quantity, { stackable: true, noted: true })
    } else {
      addItemToInventory(saveObject, itemId, 1, { stackable: false, noted: false })
    }
    const write = await writeSave(env, characterId, saveObject, saveRevision)

    await auditLog(env, 'shop_purchase', { characterId, identityId: auth.identity.id, itemId, quantity, totalCost }, { swallow: true })
    return json({ ok: true, item_id: itemId, quantity, totalCost, updatedAt: write.updatedAt, save_revision: write.saveRevision, coins: saveObject.coins })
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
