import { requireAuth, json } from '../_lib/auth.js'
import { assertNotInCoopSession } from '../_lib/game/coopBoss.js'
import itemsData from '../../src/data/items.json' assert { type: 'json' }
import minigamesData from '../../src/data/minigames.json' assert { type: 'json' }
import questsData from '../../src/data/quests.json' assert { type: 'json' }
import { assertPurchasable } from '../_lib/game/rewards.js'
import { loadCharacterWithSave, writeSave } from '../_lib/game/save.js'
import { subtractCoins } from '../_lib/game/economy.js'
import { addItemToInventory } from '../_lib/game/inventory.js'
import { auditLog } from '../_lib/game/audit.js'
import { toErrorResponse } from '../_lib/game/errors.js'
import { getLevelFromXP } from '../../src/engine/experience.js'
import { ALL_SKILLS, MAX_TOTAL_LEVEL } from '../../src/utils/constants.js'
import { hasSlayerStoreUnlock } from '../../src/engine/slayerUnlocks.js'
import { questRequirementMet } from '../../src/engine/questGates.js'

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

    // A co-op boss fight owns this save: the room is mutating the pack tick by
    // tick and replays its snapshot on write-back.
    const coopLock = await assertNotInCoopSession(env, characterId)
    if (coopLock) return coopLock

    const item = itemsData[itemId]
    if (!item) return json({ error: 'Item not found', code: 'ITEM_NOT_FOUND' }, 404)

    const { row, saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, auth.identity.id)
    const allowMinigameUnlockPurchase = MINIGAME_STORE_PRODUCTS.has(itemId) && unlockedMinigameItems.has(itemId)
    // Authorize a slayer-gear coin sale strictly from the server's own save —
    // the unlock is recorded only when the item was bought with slayer points
    // (settleActionCompletion). Never trust a client-supplied flag here.
    const allowSlayerStorePurchase = hasSlayerStoreUnlock(saveObject.settings?.slayerStoreUnlocks, itemId)
    const restriction = assertPurchasable(item, { isIronman: Boolean(row.is_ironman), isOneLife: Boolean(row.is_one_life), allowMinigameUnlockPurchase, allowSlayerStorePurchase })
    if (!restriction.allowed) return json({ error: restriction.message, code: restriction.code }, 403)

    // Quest-unlock items are server-authoritative too: the client disables the
    // Buy button until the quest is done, but the completion gate has to hold
    // here or an account can end up owning gear it can never equip (the equip
    // check trusts the same completedQuests set).
    if (!questRequirementMet(saveObject.settings?.completedQuests || [], item.questUnlock)) {
      const questName = questsData.find((q) => q.id === item.questUnlock)?.name || 'the required quest'
      return json({ error: `You must complete ${questName} to buy this item.`, code: 'QUEST_REQUIREMENT_NOT_MET' }, 403)
    }

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

    // The Max Cape is only purchasable by a maxed account (every skill at the
    // level cap). Total level is summed from the save's per-skill XP.
    if (item.isMaxCape) {
      const totalLevel = ALL_SKILLS.reduce(
        (sum, skill) => sum + getLevelFromXP(saveObject.stats?.[skill]?.xp || 0),
        0,
      )
      if (totalLevel < MAX_TOTAL_LEVEL) {
        return json({ error: `You must be maxed (${MAX_TOTAL_LEVEL} total level) to buy this cape.`, code: 'MAX_LEVEL_REQUIREMENT_NOT_MET' }, 403)
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
