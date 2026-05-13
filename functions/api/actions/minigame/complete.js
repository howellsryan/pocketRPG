import { makeCompletionHandler } from '../_completeShared.js'
import minigamesData from '../../../../src/data/minigames.json' assert { type: 'json' }

const TASKS_BY_ID = new Map((minigamesData?.tasks || []).map((task) => [task?.id, task]))

function resolveMinigameRewards({ sourceId }) {
  const task = TASKS_BY_ID.get(sourceId)
  if (!task) return []
  const qty = Math.max(1, Math.floor(Number(task.qty) || 1))
  if (Array.isArray(task.rewardItems) && task.rewardItems.length > 0) {
    return task.rewardItems.map((itemId) => ({ itemId, quantity: qty }))
  }
  return task.product ? [{ itemId: task.product, quantity: qty }] : []
}

export const onRequestPost = makeCompletionHandler('minigames', { resolveRewards: resolveMinigameRewards })
