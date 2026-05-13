import { GameApiError } from './errors.js'
import { addItemToInventory } from './inventory.js'

const MAX_IDLE_WINDOW_MS = 24 * 60 * 60 * 1000 + 5 * 60 * 1000
const SKIP_HOUR_MS = 60 * 60 * 1000

export function validateIdleClaimWindow({ lastActiveAt, serverNow, expectedLastActiveAt, isSkipHour = false }) {
  const last = Number(lastActiveAt)
  const now = Number(serverNow)
  const expected = Number(expectedLastActiveAt)
  if (!Number.isFinite(last) || !Number.isFinite(now)) throw new GameApiError('IDLE_STATE_MISSING', 'Idle state is missing', 400)
  if (Number.isFinite(expected) && expected !== last) throw new GameApiError('IDLE_STALE_CLAIM', 'idle_stale_claim', 409)

  let elapsed = now - last
  if (elapsed < 0) throw new GameApiError('IDLE_CLOCK_ROLLBACK', 'Clock rollback detected', 400)
  if (elapsed > MAX_IDLE_WINDOW_MS) throw new GameApiError('IDLE_ELAPSED_IMPOSSIBLE', 'Idle elapsed exceeds allowed window', 400)
  if (isSkipHour) elapsed = Math.min(MAX_IDLE_WINDOW_MS, elapsed + SKIP_HOUR_MS)
  return elapsed
}

export function applyIdleClaimRewards(saveObject, claimRewards = {}, elapsedMs) {
  const elapsedHours = elapsedMs / (60 * 60 * 1000)
  const coinsPerHour = Math.max(0, Number(claimRewards?.coinsPerHour) || 0)
  const maxCoins = Math.max(0, Number(claimRewards?.maxCoins) || 0)
  const grantedCoins = Math.floor(Math.min(maxCoins, coinsPerHour * elapsedHours))
  if (grantedCoins > 0) saveObject.coins = (Number(saveObject.coins) || 0) + grantedCoins

  const grantedItems = []
  for (const reward of (claimRewards?.items || [])) {
    const itemId = typeof reward?.itemId === 'string' ? reward.itemId : null
    const perHour = Math.max(0, Number(reward?.perHour) || 0)
    const max = Math.max(0, Number(reward?.max) || 0)
    const qty = Math.floor(Math.min(max, perHour * elapsedHours))
    if (!itemId || qty <= 0) continue
    addItemToInventory(saveObject, itemId, qty)
    grantedItems.push({ itemId, quantity: qty })
  }

  return { grantedCoins, grantedItems }
}
