import { makeCompletionHandler } from '../_completeShared.js'
import { rollClueRewardsByLevel } from '../../../_lib/game/clueRewards.js'

export const onRequestPost = makeCompletionHandler('clues', {
  resolveRewards: ({ sourceId }) => rollClueRewardsByLevel(sourceId),
})
