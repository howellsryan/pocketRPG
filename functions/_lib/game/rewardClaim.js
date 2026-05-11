import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import { isValidEntry } from '../collectionLog.js'
import { GameApiError } from './errors.js'
import { addItemToInventory } from './inventory.js'

export const PROTECTED_SOURCE_TYPES = new Set(['boss', 'raid', 'clue', 'minigame', 'monsters', 'raids', 'clues', 'minigames', 'dungeoneering', 'slayer'])

export function validateRewardClaimPayload(body) {
  const sourceType = typeof body?.sourceType === 'string' ? body.sourceType : ''
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : ''
  const rewards = Array.isArray(body?.rewards) ? body.rewards : null
  if (!PROTECTED_SOURCE_TYPES.has(sourceType)) throw new GameApiError('INVALID_SOURCE_TYPE', 'Invalid source type', 400)
  if (!sourceId) throw new GameApiError('INVALID_SOURCE_ID', 'Invalid source id', 400)
  if (!rewards || rewards.length < 1 || rewards.length > 32) throw new GameApiError('INVALID_REWARDS', 'Invalid rewards payload', 400)
  return { sourceType, sourceId, rewards }
}

export function applyRewardClaim(saveObject, claim) {
  const granted = []
  for (const reward of claim.rewards) {
    const itemId = typeof reward?.itemId === 'string' ? reward.itemId : null
    const quantity = Math.floor(Number(reward?.quantity) || 0)
    if (!itemId || quantity < 1) throw new GameApiError('INVALID_REWARD_ITEM', 'Invalid reward item', 400)
    const item = itemsData[itemId]
    if (!item) throw new GameApiError('ITEM_NOT_FOUND', `Unknown item: ${itemId}`, 404)
    // High-value grant protection: endpoint only accepts protected source items.
    if (!isValidEntry(claim.sourceType, claim.sourceId, itemId)) {
      throw new GameApiError('INVALID_REWARD_SOURCE', 'Reward item not valid for source', 403)
    }
    addItemToInventory(saveObject, itemId, quantity)
    granted.push({ itemId, quantity })
  }

  const slayerPoints = Math.floor(Number(claim?.slayerPoints) || 0)
  if (slayerPoints > 0) {
    if (!saveObject.slayer) saveObject.slayer = {}
    saveObject.slayer.points = (Number(saveObject.slayer.points) || 0) + slayerPoints
  }

  const dungeoneeringTokens = Math.floor(Number(claim?.dungeoneeringTokens) || 0)
  if (dungeoneeringTokens > 0) {
    saveObject.dungeoneeringTokens = (Number(saveObject.dungeoneeringTokens) || 0) + dungeoneeringTokens
  }

  return { granted, slayerPoints, dungeoneeringTokens }
}
