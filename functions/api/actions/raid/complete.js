import { makeCompletionHandler } from '../_completeShared.js'
import { rollRaidRewardsById } from '../../../_lib/game/raidRewards.js'

export const onRequestPost = makeCompletionHandler('raids', {
  resolveRewards: ({ sourceId }) => rollRaidRewardsById(sourceId),
})
