import { makeCompletionHandler } from '../_completeShared.js'
import { rollMonsterRewardsById } from '../../../_lib/game/monsterRewards.js'
import { hardModeForKill } from '../../../_lib/game/hardMode.js'
import { doesSlayerTaskMatchMonster } from '../../../../src/engine/slayerTasks.js'

export const onRequestPost = makeCompletionHandler('monsters', {
  resolveRewards: async ({ sourceId, body, saveObject, env, characterId }) => {
    const slayerTask = saveObject?.settings?.slayerTask
    const isOnTask = !!(slayerTask && doesSlayerTaskMatchMonster(slayerTask.monsterId, sourceId))
    const hardMode = await hardModeForKill(env, characterId, 'monsters', sourceId, body)
    return rollMonsterRewardsById(sourceId, Math.random, isOnTask, hardMode)
  },
})
