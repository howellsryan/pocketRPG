import { makeCompletionHandler } from '../_completeShared.js'
import { rollMonsterRewardsById } from '../../../_lib/game/monsterRewards.js'
import { doesSlayerTaskMatchMonster } from '../../../../src/engine/slayerTasks.js'

export const onRequestPost = makeCompletionHandler('monsters', {
  resolveRewards: ({ sourceId, saveObject }) => {
    const slayerTask = saveObject?.settings?.slayerTask
    const isOnTask = !!(slayerTask && doesSlayerTaskMatchMonster(slayerTask.monsterId, sourceId))
    return rollMonsterRewardsById(sourceId, Math.random, isOnTask)
  },
})
