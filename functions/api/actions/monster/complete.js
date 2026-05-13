import { makeCompletionHandler } from '../_completeShared.js'
import { rollMonsterRewardsById } from '../../../_lib/game/monsterRewards.js'

export const onRequestPost = makeCompletionHandler('monsters', {
  resolveRewards: ({ sourceId }) => rollMonsterRewardsById(sourceId),
})
